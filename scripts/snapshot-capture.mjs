#!/usr/bin/env node
//
// Phase 51 / observability — Wayback-Machine-style UI snapshot job.
//
// Boots social-api + frontend dev servers, captures full-page PNGs of the
// gateway's key pages via a real Chromium, writes them under
//   $AGENT_HUB_ROOT/snapshots/<slug>/<UTC-iso-timestamp>.png
// and a per-run index at $AGENT_HUB_ROOT/snapshots/index.json, then tears
// the servers back down.
//
// Run from the repo root:
//   node scripts/snapshot-capture.mjs
//
// See .planning/SNAPSHOT-CAPTURE.md for the full operator runbook.

import { spawn } from 'node:child_process';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(__filename), '..');

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const HUB_ROOT = process.env.AGENT_HUB_ROOT
  ?? '/Users/connorhoehn/Projects/hoehn-claude-orchestrator';
const SNAPSHOTS_ROOT = join(HUB_ROOT, 'snapshots');

const SOCIAL_API_PORT = 3001;
const FRONTEND_PORT = 5174;
const FRONTEND_BASE = `http://localhost:${FRONTEND_PORT}`;

const SERVER_BOOT_TIMEOUT_MS = 60_000;
const PAGE_NAVIGATE_TIMEOUT_MS = 15_000;
const PAGE_SETTLE_DELAY_MS = 1_500; // give CSS transitions / data fetches a moment

const VIEWPORT = { width: 1440, height: 900 };

// Page list — slug + URL (relative to FRONTEND_BASE). Slug becomes the
// directory name under snapshots/<slug>/. Pages that 404 / error / time
// out are recorded in index.json with the failure reason; one bad page
// does NOT abort the run.
const PAGES = [
  { slug: 'previews',                url: '/previews' },
  { slug: 'social',                  url: '/social' },
  { slug: 'dashboard',               url: '/dashboard' },
  { slug: 'documents',               url: '/documents' },
  { slug: 'document-types',          url: '/document-types' },
  { slug: 'field-types',             url: '/field-types' },
  { slug: 'pipelines',               url: '/pipelines' },
  { slug: 'pipelines-approvals',     url: '/pipelines/approvals' },
  { slug: 'observability',           url: '/observability' },
  { slug: 'observability-nodes',     url: '/observability/nodes' },
  { slug: 'observability-events',    url: '/observability/events' },
  { slug: 'observability-metrics',   url: '/observability/metrics' },
  // API JSON renders (via the vite proxy → social-api)
  { slug: 'api-pipelines-inspector', url: '/api/pipelines/inspector/summary' },
  { slug: 'api-pipelines-dlq',       url: '/api/pipelines/dlq' },
];

// ---------------------------------------------------------------------------
// Logging helpers
// ---------------------------------------------------------------------------

function log(msg) {
  const ts = new Date().toISOString();
  console.log(`[snapshot ${ts}] ${msg}`);
}

function err(msg) {
  const ts = new Date().toISOString();
  console.error(`[snapshot ${ts}] ERROR ${msg}`);
}

// ---------------------------------------------------------------------------
// Server lifecycle
// ---------------------------------------------------------------------------

function spawnDevServer(name, command, args, cwd, env = {}) {
  log(`spawning ${name}: ${command} ${args.join(' ')} (cwd=${cwd})`);
  const child = spawn(command, args, {
    cwd,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false,
  });
  // Stream output prefixed for easy grep when debugging.
  child.stdout.on('data', (d) => process.stdout.write(`[${name}] ${d}`));
  child.stderr.on('data', (d) => process.stderr.write(`[${name}] ${d}`));
  child.on('exit', (code) => log(`${name} exited code=${code}`));
  return child;
}

async function pollUntilReady(url, label, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(2_000) });
      // Any HTTP response (even 404 or 503) means the server is listening.
      if (res.status > 0) {
        log(`${label} ready at ${url} (HTTP ${res.status})`);
        return true;
      }
    } catch {
      // Not yet listening — keep polling.
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`${label} did not become ready within ${timeoutMs}ms (url=${url})`);
}

function killChild(child, name) {
  if (!child || child.killed) return;
  try {
    child.kill('SIGTERM');
    log(`sent SIGTERM to ${name}`);
  } catch (e) {
    err(`failed to SIGTERM ${name}: ${e.message}`);
  }
  // Hard fallback after a short grace.
  setTimeout(() => {
    try {
      if (!child.killed) {
        child.kill('SIGKILL');
        log(`escalated to SIGKILL on ${name}`);
      }
    } catch { /* ignore */ }
  }, 3_000).unref();
}

// ---------------------------------------------------------------------------
// Capture
// ---------------------------------------------------------------------------

async function captureAll(runTimestamp) {
  // Resolve playwright from the frontend's node_modules — the gateway repo
  // root doesn't pin playwright as a direct dep.
  const playwrightPath = join(REPO_ROOT, 'frontend', 'node_modules', 'playwright', 'index.js');
  if (!existsSync(playwrightPath)) {
    throw new Error(`playwright not found at ${playwrightPath} — run \`npm install\` in frontend/`);
  }
  // playwright/index.js is a CJS module that re-exports a Playwright
  // instance as `module.exports`. Under ESM dynamic import that surfaces
  // as `default`. Pull chromium off it.
  const playwrightMod = await import(playwrightPath);
  const chromium = playwrightMod.chromium ?? playwrightMod.default?.chromium;
  if (!chromium) {
    throw new Error('could not resolve chromium from the playwright module');
  }

  log('launching chromium');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: VIEWPORT,
    ignoreHTTPSErrors: true,
  });
  const page = await context.newPage();

  // Suppress dev-time noise — the app fires many WS reconnects in dev mode
  // when no gateway WS is running. They're not errors for our purposes.
  page.on('pageerror', (e) => log(`pageerror @ ${page.url()}: ${e.message}`));

  const captured = [];
  const errored = [];

  for (const { slug, url } of PAGES) {
    const fullUrl = `${FRONTEND_BASE}${url}`;
    log(`capturing ${slug} <- ${fullUrl}`);
    const slugDir = join(SNAPSHOTS_ROOT, slug);
    await mkdir(slugDir, { recursive: true });
    const outPath = join(slugDir, `${runTimestamp}.png`);

    try {
      await page.goto(fullUrl, {
        waitUntil: 'domcontentloaded',
        timeout: PAGE_NAVIGATE_TIMEOUT_MS,
      });
      // Best-effort settle — wait for net idle but don't fail if it doesn't
      // settle (the app's polling intervals make networkidle rare).
      try {
        await page.waitForLoadState('networkidle', { timeout: 3_000 });
      } catch { /* ignore — proceed anyway */ }
      await page.waitForTimeout(PAGE_SETTLE_DELAY_MS);

      await page.screenshot({ path: outPath, fullPage: true });
      captured.push({ slug, url: fullUrl, path: outPath });
      log(`  ✓ ${outPath}`);
    } catch (e) {
      const reason = e?.message ?? String(e);
      errored.push({ slug, url: fullUrl, reason });
      err(`  ✗ ${slug}: ${reason}`);
    }
  }

  await context.close();
  await browser.close();
  return { captured, errored };
}

// ---------------------------------------------------------------------------
// Index file
// ---------------------------------------------------------------------------

function getCommitSha() {
  try {
    return execSync('git rev-parse HEAD', { cwd: REPO_ROOT })
      .toString().trim();
  } catch {
    return null;
  }
}

async function writeIndex(runTimestamp, captured, errored) {
  const indexPath = join(SNAPSHOTS_ROOT, 'index.json');
  let index = { runs: [] };
  if (existsSync(indexPath)) {
    try {
      const existing = await readFile(indexPath, 'utf8');
      const parsed = JSON.parse(existing);
      if (parsed && Array.isArray(parsed.runs)) index = parsed;
    } catch (e) {
      err(`could not parse existing index.json — overwriting: ${e.message}`);
    }
  }
  const commitSha = getCommitSha();
  index.runs.push({
    timestamp: runTimestamp,
    commitSha,
    captured: captured.map((c) => ({ slug: c.slug, url: c.url })),
    errored: errored.map((e) => ({ slug: e.slug, url: e.url, reason: e.reason })),
  });
  await writeFile(indexPath, JSON.stringify(index, null, 2));
  log(`index updated -> ${indexPath} (${index.runs.length} runs total)`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  log(`HUB_ROOT=${HUB_ROOT}`);
  log(`SNAPSHOTS_ROOT=${SNAPSHOTS_ROOT}`);
  await mkdir(SNAPSHOTS_ROOT, { recursive: true });

  const runTimestamp = new Date().toISOString().replace(/[:.]/g, '-');

  let socialApi = null;
  let frontend = null;
  let exitCode = 0;

  // Helper: probe a URL with a short timeout. Returns true if any HTTP
  // response comes back (i.e. someone is listening).
  async function probe(url) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(1_500) });
      return res.status > 0;
    } catch {
      return false;
    }
  }

  try {
    // Reuse a running social-api if one's already up — avoids EADDRINUSE
    // when the operator has `npm run dev` going in another terminal.
    if (await probe(`http://localhost:${SOCIAL_API_PORT}/health`)) {
      log(`social-api already running on :${SOCIAL_API_PORT}, reusing`);
    } else {
      // The dev script already sets SKIP_AUTH + LOCALSTACK pointers — local
      // infra (Dynamo/Redis) may be down; the server still starts and
      // reports 503-degraded on /health, which is fine for snapshot purposes.
      socialApi = spawnDevServer(
        'social-api',
        'npm',
        ['run', 'dev'],
        join(REPO_ROOT, 'social-api'),
      );
      await pollUntilReady(
        `http://localhost:${SOCIAL_API_PORT}/health`,
        'social-api',
        SERVER_BOOT_TIMEOUT_MS,
      );
    }

    if (await probe(FRONTEND_BASE)) {
      log(`frontend already running on :${FRONTEND_PORT}, reusing`);
    } else {
      // Boot frontend with auth bypass. Vite's dev server proxies /api/* to
      // social-api on port 3001.
      frontend = spawnDevServer(
        'frontend',
        'npm',
        ['run', 'dev'],
        join(REPO_ROOT, 'frontend'),
        { VITE_DEV_BYPASS_AUTH: 'true' },
      );
      await pollUntilReady(FRONTEND_BASE, 'frontend', SERVER_BOOT_TIMEOUT_MS);
    }

    // Capture.
    const { captured, errored } = await captureAll(runTimestamp);
    await writeIndex(runTimestamp, captured, errored);

    log(`run complete: ${captured.length} captured, ${errored.length} errored`);
  } catch (e) {
    err(`run failed: ${e?.message ?? e}`);
    exitCode = 1;
  } finally {
    killChild(frontend, 'frontend');
    killChild(socialApi, 'social-api');
    // Give the kills a moment to propagate.
    await new Promise((r) => setTimeout(r, 1_500));
  }
  process.exit(exitCode);
}

main();
