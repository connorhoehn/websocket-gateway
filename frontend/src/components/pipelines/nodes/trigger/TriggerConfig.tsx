// frontend/src/components/pipelines/nodes/trigger/TriggerConfig.tsx
//
// Config panel for Trigger nodes. See PIPELINES_PLAN.md §18.10.
//
// Fields rendered are conditional on `triggerType`:
//   document.*  → document type dropdown (from localStorage `ws_document_types_v1`)
//   schedule    → cron input + placeholder "Next fires" preview
//   webhook     → path input + read-only full-URL preview

import { useContext, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import type { TriggerNodeData, TriggerType } from '../../../../types/pipeline';
import { fieldStyle, colors } from '../../../../constants/styles';
import { parseCron, nextFires } from '../../cron/cronUtils';
import { useToast } from '../../../shared/ToastProvider';
import { PipelineEditorContext } from '../../context/PipelineEditorContext';

// Webhook path constraint — must mirror the regex enforced by the social-api
// route at /hooks/pipeline/:path. Out of sync = users see a green URL the
// server rejects with 400. Update both sides together.
const WEBHOOK_PATH_RE = /^[a-zA-Z0-9_-]{1,64}$/;

// Public webhook host — defaulted to the local social-api so dev environments
// without VITE_SOCIAL_API_URL still produce an invokable preview URL.
const SOCIAL_API_URL =
  (import.meta.env as Record<string, string>).VITE_SOCIAL_API_URL ??
  'http://localhost:3001';

export interface TriggerConfigProps {
  data: TriggerNodeData;
  onChange: (patch: Partial<TriggerNodeData>) => void;
}

// ---------------------------------------------------------------------------
// Shared label / help / error styles (kept local to avoid touching constants)
// ---------------------------------------------------------------------------

const labelStyle: CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  color: colors.textSecondary,
};

const requiredDot: CSSProperties = {
  color: '#dc2626',
  marginLeft: 4,
};

const helpStyle: CSSProperties = {
  fontSize: 11,
  color: colors.textTertiary,
  marginTop: 2,
};

const errorStyle: CSSProperties = {
  fontSize: 11,
  color: '#dc2626',
  marginTop: 2,
};

const errorFieldStyle: CSSProperties = {
  ...fieldStyle,
  borderColor: '#dc2626',
};

// Minimal localStorage document-type shape (null-safe, read-only).
interface StoredDocType { id: string; name: string }

function readDocTypes(): StoredDocType[] {
  try {
    const raw = localStorage.getItem('ws_document_types_v1');
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((x): x is Record<string, unknown> => typeof x === 'object' && x !== null)
      .filter(x => typeof x.id === 'string' && typeof x.name === 'string')
      .map(x => ({ id: x.id as string, name: x.name as string }));
  } catch {
    return [];
  }
}

const TRIGGER_TYPE_OPTIONS: Array<{ value: TriggerType; label: string }> = [
  { value: 'manual',            label: 'Manual' },
  { value: 'document.finalize', label: 'Document finalize' },
  { value: 'document.submit',   label: 'Document submit' },
  { value: 'document.comment',  label: 'Document comment' },
  { value: 'schedule',          label: 'Schedule' },
  { value: 'webhook',           label: 'Webhook' },
];

export default function TriggerConfig({ data, onChange }: TriggerConfigProps) {
  const { toast } = useToast();
  // Secret is server-minted and lives on `triggerBinding`, not on the node
  // data — but the editor context owns the live definition so we can pull it
  // out for the reveal/copy interaction. `null` context is gracefully
  // tolerated (storybook, tests, etc.) so this component still renders
  // outside an editor provider.
  const editor = useContext(PipelineEditorContext);
  const webhookSecret = editor?.definition?.triggerBinding?.webhookSecret;
  const [secretRevealed, setSecretRevealed] = useState(false);
  const isDoc = data.triggerType.startsWith('document.');
  const docTypes = useMemo(() => (isDoc ? readDocTypes() : []), [isDoc]);

  const docTypeMissing = isDoc && !data.documentTypeId;
  const scheduleMissing = data.triggerType === 'schedule' && !data.schedule;
  const webhookMissing  = data.triggerType === 'webhook'  && !data.webhookPath;

  // Webhook path validity (only meaningful when triggerType === 'webhook' and
  // a non-empty value is set). Empty path → show the "set a path" hint;
  // invalid path → show the red regex hint; valid path → show the full URL.
  const webhookPathRaw = data.webhookPath ?? '';
  const webhookPathInvalid =
    data.triggerType === 'webhook' &&
    webhookPathRaw.length > 0 &&
    !WEBHOOK_PATH_RE.test(webhookPathRaw);
  const webhookFullUrl =
    data.triggerType === 'webhook' && WEBHOOK_PATH_RE.test(webhookPathRaw)
      ? `${SOCIAL_API_URL}/hooks/pipeline/${webhookPathRaw}`
      : null;

  const onCopyWebhookUrl = () => {
    if (!webhookFullUrl) return;
    void navigator.clipboard
      .writeText(webhookFullUrl)
      .then(() => toast('Webhook URL copied', { type: 'success' }))
      .catch(() => toast('Could not copy webhook URL', { type: 'error' }));
  };

  const onCopyWebhookSecret = () => {
    if (!webhookSecret) return;
    void navigator.clipboard
      .writeText(webhookSecret)
      .then(() => toast('Webhook secret copied', { type: 'success' }))
      .catch(() => toast('Could not copy webhook secret', { type: 'error' }));
  };

  // Schedule preview — parse the cron and compute the next 3 fires.
  const cronExpr = data.triggerType === 'schedule' ? (data.schedule ?? '') : '';
  const parsedCron = useMemo(
    () => (cronExpr ? parseCron(cronExpr) : null),
    [cronExpr],
  );
  const upcomingFires = useMemo(() => {
    if (!parsedCron) return [];
    return nextFires(parsedCron, new Date(), 3);
  }, [parsedCron]);
  const cronInvalid = data.triggerType === 'schedule' && !!cronExpr && !parsedCron;

  const eventLabel =
    data.triggerType === 'document.finalize' ? 'On finalize' :
    data.triggerType === 'document.submit'   ? 'On submit for review' :
    data.triggerType === 'document.comment'  ? 'On comment added' : '';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '12px 16px' }}>
      {/* Trigger type */}
      <div>
        <label style={labelStyle}>
          Trigger type<span style={requiredDot}>●</span>
        </label>
        <select
          style={{ ...fieldStyle, marginTop: 4 }}
          value={data.triggerType}
          onChange={(e) => onChange({ triggerType: e.target.value as TriggerType })}
        >
          {TRIGGER_TYPE_OPTIONS.map(opt => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      </div>

      {/* Document type (when document.*) */}
      {isDoc && (
        <div>
          <label style={labelStyle}>
            Document type<span style={requiredDot}>●</span>
          </label>
          <select
            style={{ ...(docTypeMissing ? errorFieldStyle : fieldStyle), marginTop: 4 }}
            value={data.documentTypeId ?? ''}
            onChange={(e) => onChange({ documentTypeId: e.target.value || undefined })}
          >
            <option value="">— select a document type —</option>
            {docTypes.map(dt => (
              <option key={dt.id} value={dt.id}>{dt.name}</option>
            ))}
          </select>
          {docTypeMissing
            ? <div style={errorStyle}>Select a document type.</div>
            : <div style={helpStyle}>Which document type should trigger this pipeline.</div>
          }
          {eventLabel && (
            <div style={{ ...helpStyle, marginTop: 6 }}>
              Event: <span style={{ fontWeight: 600, color: colors.textSecondary }}>{eventLabel}</span>
            </div>
          )}
        </div>
      )}

      {/* Schedule (cron) */}
      {data.triggerType === 'schedule' && (
        <div>
          <label style={labelStyle}>
            Schedule (cron)<span style={requiredDot}>●</span>
          </label>
          <input
            type="text"
            style={{
              ...((scheduleMissing || cronInvalid) ? errorFieldStyle : fieldStyle),
              marginTop: 4,
              fontFamily: 'monospace',
            }}
            placeholder="*/15 * * * *"
            value={data.schedule ?? ''}
            onChange={(e) => onChange({ schedule: e.target.value })}
          />
          {scheduleMissing && (
            <div style={errorStyle}>Cron expression is required.</div>
          )}
          {!scheduleMissing && cronInvalid && (
            <div style={errorStyle}>
              Invalid cron expression — supports *, */N, N,M, A-B, exact values.
            </div>
          )}
          {!scheduleMissing && !cronInvalid && (
            <div style={helpStyle}>5-field cron: minute hour day month weekday.</div>
          )}
          <div
            style={{
              marginTop: 8,
              padding: 8,
              background: colors.surfaceInset,
              border: `1px dashed ${colors.border}`,
              borderRadius: 6,
              fontSize: 11,
              color: colors.textTertiary,
              fontFamily: 'monospace',
            }}
          >
            {upcomingFires.length > 0 ? (
              <>
                <div style={{ color: colors.textSecondary, marginBottom: 4 }}>
                  Next 3 fires:
                </div>
                {upcomingFires.map((d, i) => (
                  <div key={i}>{d.toLocaleString()}</div>
                ))}
              </>
            ) : (
              <span>Next fires: enter a valid cron expression to preview.</span>
            )}
          </div>
        </div>
      )}

      {/* Webhook */}
      {data.triggerType === 'webhook' && (
        <div>
          <label style={labelStyle}>
            Path<span style={requiredDot}>●</span>
          </label>
          <input
            type="text"
            style={{
              ...(webhookMissing || webhookPathInvalid ? errorFieldStyle : fieldStyle),
              marginTop: 4,
              fontFamily: 'monospace',
            }}
            placeholder="weekly-digest"
            value={webhookPathRaw}
            onChange={(e) => onChange({ webhookPath: e.target.value })}
          />
          {webhookMissing ? (
            <div style={errorStyle}>Webhook path is required.</div>
          ) : webhookPathInvalid ? (
            <div style={errorStyle}>
              Path must be alphanumeric (plus _, -)
            </div>
          ) : (
            <div style={helpStyle}>
              Alphanumeric, _, or - (max 64 chars). No leading slash.
            </div>
          )}

          {/* Full URL preview / copy button */}
          <div
            style={{
              marginTop: 8,
              padding: 8,
              background: colors.surfaceInset,
              border: `1px dashed ${colors.border}`,
              borderRadius: 6,
              fontSize: 11,
              color: colors.textSecondary,
              fontFamily: 'monospace',
              wordBreak: 'break-all',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}
          >
            {webhookFullUrl ? (
              <>
                <span style={{ flex: 1 }}>
                  <span
                    style={{
                      fontFamily: 'sans-serif',
                      color: colors.textTertiary,
                      marginRight: 4,
                    }}
                  >
                    Full URL:
                  </span>
                  {webhookFullUrl}
                </span>
                <button
                  type="button"
                  onClick={onCopyWebhookUrl}
                  style={{
                    fontSize: 11,
                    padding: '2px 8px',
                    border: `1px solid ${colors.border}`,
                    borderRadius: 4,
                    background: 'transparent',
                    color: colors.textSecondary,
                    cursor: 'pointer',
                    fontFamily: 'sans-serif',
                  }}
                >
                  Copy
                </button>
              </>
            ) : (
              <span style={{ fontFamily: 'sans-serif', color: colors.textTertiary }}>
                Set a path above to see the URL
              </span>
            )}
          </div>

          {/*
            Webhook signing secret — minted server-side on first save and
            round-tripped on every PipelineDefinition response. Surfaced
            here so the user can copy it into their webhook source's
            "secret" field. Hidden by default to avoid shoulder-surfing.
          */}
          <div style={{ marginTop: 8 }}>
            <label style={labelStyle}>Signing secret</label>
            <div
              style={{
                marginTop: 4,
                padding: 8,
                background: colors.surfaceInset,
                border: `1px dashed ${colors.border}`,
                borderRadius: 6,
                fontSize: 11,
                color: colors.textSecondary,
                fontFamily: 'monospace',
                wordBreak: 'break-all',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
              }}
            >
              {webhookSecret ? (
                <>
                  <span style={{ flex: 1 }} aria-label="webhook secret">
                    {secretRevealed ? webhookSecret : '•'.repeat(32)}
                  </span>
                  <button
                    type="button"
                    onClick={() => setSecretRevealed((v) => !v)}
                    style={{
                      fontSize: 11,
                      padding: '2px 8px',
                      border: `1px solid ${colors.border}`,
                      borderRadius: 4,
                      background: 'transparent',
                      color: colors.textSecondary,
                      cursor: 'pointer',
                      fontFamily: 'sans-serif',
                    }}
                  >
                    {secretRevealed ? 'Hide' : 'Reveal'}
                  </button>
                  <button
                    type="button"
                    onClick={onCopyWebhookSecret}
                    style={{
                      fontSize: 11,
                      padding: '2px 8px',
                      border: `1px solid ${colors.border}`,
                      borderRadius: 4,
                      background: 'transparent',
                      color: colors.textSecondary,
                      cursor: 'pointer',
                      fontFamily: 'sans-serif',
                    }}
                  >
                    Copy
                  </button>
                </>
              ) : (
                <span style={{ fontFamily: 'sans-serif', color: colors.textTertiary }}>
                  Save the pipeline to mint a signing secret. External callers
                  must send <code>X-Pipeline-Signature-256: sha256=&lt;hmac&gt;</code>.
                </span>
              )}
            </div>
            <div style={helpStyle}>
              HMAC-SHA256 of the raw request body. Send as
              {' '}<code>X-Pipeline-Signature-256: sha256=&lt;hex&gt;</code>.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
