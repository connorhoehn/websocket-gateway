// social-api/src/routes/pipelineWebhooks.ts
//
// Public webhook endpoints for pipeline triggers. Mounted at /hooks/pipeline
// in app.ts BEFORE the Cognito auth middleware so external systems (Stripe,
// GitHub, internal cron, etc.) can fire pipelines without a JWT.
//
// Phase 1: validate path, capture x-* headers + body, log + 202.
// Phase 4 (this file): also enforce HMAC-SHA256 signature verification when
// the matched pipeline definition's webhook trigger binding carries a
// `webhookSecret`. Format follows GitHub's convention:
//
//   X-Pipeline-Signature-256: sha256=<hex>
//
// where `<hex>` is HMAC-SHA256(secret, raw_request_body). When no secret is
// configured we fall back to the legacy "accept unsigned" behavior so dev
// fixtures keep working — Phase-5 will gate this on a global config flag.
//
// Raw-body gotcha: `express.json()` is mounted globally in `createApp()`
// which would consume `req.body` before this route runs. To preserve the
// exact bytes signed by the source we mount `express.raw({ type: '*/*' })`
// at the router level — Express picks the first body parser that matches,
// so the upstream `express.json()` never touches webhook traffic. After
// signature verification we parse the raw buffer ourselves into the JSON
// object that the existing log line / future Phase-4 forwarder expects.

import express, { Router, type Request, type Response } from 'express';
import {
  SIGNATURE_HEADER,
  verifySignature,
} from '../lib/webhookSignature';
import { stubPipelineStore } from './pipelineDefinitions';

export const pipelineWebhooksRouter = Router();

// Path constraint shared with the frontend TriggerConfig "Full URL" preview:
// alphanumeric plus _ and -, max 64 chars. Matches the regex used in the UI
// validator so the displayed URL is always invokable.
const VALID_PATH_RE = /^[a-zA-Z0-9_-]{1,64}$/;

// 1 MiB upper bound — webhook payloads are typically tiny (KB), and a hard
// cap prevents an unauthenticated public endpoint from being used as a
// memory-amplification vector.
const MAX_BODY_BYTES = 1024 * 1024;

/**
 * Pure helper exposed for tests — extracts only the `x-*` headers (case-
 * insensitive) and discards everything else. Authorization, Cookie, and
 * Content-Type are intentionally excluded so they never leak into pipeline
 * context as a side-effect of the webhook bridge. The signature header is
 * also stripped here — once verified it has no business reaching pipeline
 * context.
 */
export function pickSafeHeaders(
  headers: Record<string, string | string[] | undefined>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    if (typeof v === 'string' && k.toLowerCase().startsWith('x-')) {
      if (k.toLowerCase() === SIGNATURE_HEADER) continue;
      out[k] = v;
    }
  }
  return out;
}

/**
 * Lookup the webhook secret (if any) configured for a given path across all
 * pipeline definitions. Returns the first match — paths are expected to be
 * unique per user / pipeline, but the route itself is global so we accept
 * the first hit. Returning `undefined` means "no secret configured" and the
 * route falls through to the Phase-1 "accept unsigned" behavior.
 *
 * Exported so the test suite can stub it out without coupling tests to the
 * full pipeline-definition upsert flow.
 */
export function lookupWebhookSecret(path: string): string | undefined {
  for (const def of stubPipelineStore.allPipelines()) {
    const d = def as {
      triggerBinding?: {
        event?: string;
        webhookPath?: string;
        webhookSecret?: string;
      };
    };
    const tb = d?.triggerBinding;
    if (!tb || tb.event !== 'webhook') continue;
    if (tb.webhookPath !== path) continue;
    if (typeof tb.webhookSecret === 'string' && tb.webhookSecret.length > 0) {
      return tb.webhookSecret;
    }
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Raw-body capture
// ---------------------------------------------------------------------------
//
// `express.raw` short-circuits the upstream `express.json()` because Express
// only invokes one body parser per request — the first one whose `type`
// predicate matches. Mounting it at the router level scopes that override
// to /hooks/pipeline only; the rest of the API still gets parsed JSON.
// `type: '*/*'` accepts whatever Content-Type the caller sends so signed
// non-JSON payloads (form-encoded, plain text, etc.) still verify.
const captureRawBody = express.raw({
  type: '*/*',
  limit: MAX_BODY_BYTES,
});

/**
 * Parse the raw body buffer as JSON. Returns `{}` for empty bodies and the
 * parsed value for valid JSON; non-JSON payloads are surfaced as a string
 * under `__raw` so downstream pipeline context still has *something* to act
 * on without lying about its shape.
 */
function parseBody(raw: Buffer): unknown {
  if (!raw || raw.length === 0) return {};
  const text = raw.toString('utf8');
  try {
    return JSON.parse(text);
  } catch {
    return { __raw: text };
  }
}

// POST /hooks/pipeline/:path
pipelineWebhooksRouter.post(
  '/:path',
  captureRawBody,
  async (req: Request, res: Response) => {
    const path = req.params.path;
    if (!VALID_PATH_RE.test(path)) {
      return res
        .status(400)
        .json({ error: 'invalid path: alphanumeric, _, -, max 64 chars' });
    }

    // `express.raw` puts a Buffer on `req.body` (or `{}` if no body was sent
    // — we tolerate both). Coerce to a Buffer for the HMAC step.
    const rawBody: Buffer = Buffer.isBuffer(req.body)
      ? req.body
      : Buffer.alloc(0);

    // Signature verification — only when a secret is configured for the
    // matched path. No secret = legacy "accept unsigned" behavior so Phase-1
    // dev fixtures keep working.
    const secret = lookupWebhookSecret(path);
    if (secret) {
      const headerRaw = req.headers[SIGNATURE_HEADER];
      const header = Array.isArray(headerRaw) ? headerRaw[0] : headerRaw;
      const ok = verifySignature(secret, rawBody, header);
      if (!ok) {
        // Structured log so observability can alert on forged or
        // misconfigured webhook sources without grepping free-form text.
        // eslint-disable-next-line no-console
        console.error('[pipeline-webhook] signature verification failed', {
          webhookPath: path,
          hasHeader: typeof header === 'string' && header.length > 0,
          bodySize: rawBody.length,
        });
        return res.status(401).json({
          // RFC 7807 problem-details — `type` + `title` + `status` are the
          // mandatory fields; `detail` carries the human-readable reason.
          type: 'about:blank',
          title: 'Invalid webhook signature',
          status: 401,
          detail:
            typeof header === 'string' && header.length > 0
              ? 'X-Pipeline-Signature-256 did not match the expected HMAC-SHA256 of the request body.'
              : 'X-Pipeline-Signature-256 header is required when a webhook secret is configured.',
        });
      }
    }

    // Forward only `x-*` headers (and never the signature header) so we
    // don't leak Authorization / Cookie etc. into pipeline context.
    const safeHeaders = pickSafeHeaders(
      req.headers as Record<string, string | string[] | undefined>,
    );

    const parsedBody = parseBody(rawBody);

    const payload = {
      webhookPath: path,
      body: parsedBody,
      headers: safeHeaders,
      at: new Date().toISOString(),
    };

    // TODO Phase 4: forward `payload` to the gateway pipeline event source so
    // a `pipeline.webhook.triggered` event reaches the frontend (or
    // PipelineModule) and matches it to a pipeline. For Phase 1, log + 202.
    // eslint-disable-next-line no-console
    console.log('[pipeline-webhook] received', {
      path,
      bodySize: rawBody.length,
      signed: !!secret,
    });

    return res.status(202).json({
      accepted: true,
      webhookPath: path,
      at: payload.at,
    });
  },
);
