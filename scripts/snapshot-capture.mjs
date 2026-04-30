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
//
// Only user-facing UI surfaces. Per handoff #34 (orchestrator), no
// `/api/*` JSON routes — Chromium rendering of raw JSON is useless for
// a visual evolution archive. If a UI page exists for DLQ / Inspector
// it goes here under a non-`api-` slug; today neither has a dedicated
// React page (the data shows up under the pipeline editor when one is
// live), so they're omitted entirely.
const PAGES = [
  { slug: 'previews',              url: '/previews' },
  { slug: 'social',                url: '/social' },
  { slug: 'dashboard',             url: '/dashboard' },
  { slug: 'documents',             url: '/documents' },
  { slug: 'document-types',        url: '/document-types' },
  { slug: 'field-types',           url: '/field-types' },
  { slug: 'pipelines',             url: '/pipelines' },
  { slug: 'pipelines-approvals',   url: '/pipelines/approvals' },
  { slug: 'observability',         url: '/observability' },
  { slug: 'observability-nodes',   url: '/observability/nodes' },
  { slug: 'observability-events',  url: '/observability/events' },
  { slug: 'observability-metrics', url: '/observability/metrics' },
];

// Slugs that previously appeared in PAGES and have been retired. The
// runbook tells the operator to `rm -rf` these directories under
// $AGENT_HUB_ROOT/snapshots/ — the script can't delete them itself
// (worker policy: no destructive ops outside this repo).
const DEPRECATED_SLUGS = ['api-pipelines-inspector', 'api-pipelines-dlq'];

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

  // One-time hint about retired snapshot directories — the script can't
  // delete files outside the gateway repo (worker policy), so we surface
  // the dirs the operator should `rm -rf` manually if they're still
  // around from earlier captures.
  for (const slug of DEPRECATED_SLUGS) {
    const dir = join(SNAPSHOTS_ROOT, slug);
    if (existsSync(dir)) {
      log(`deprecated slug present: ${dir}`);
      log(`  → remove with: rm -rf "${dir}"`);
    }
  }

  const runTimestamp = new Date().toISOString().replace(/[:.]/g, '-');

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

  // Probe whether /health reports OK (200 with checks all green) — used
  // to detect that the existing social-api is wired to a healthy stack.
  // 503 = degraded, in which case we recommend a restart with the
  // snapshot env so screenshots aren't all error states.
  async function probeHealthOk(url) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(1_500) });
      return res.status === 200;
    } catch {
      return false;
    }
  }

  try {
    // Tilt is the canonical local-dev orchestrator (per orchestrator
    // handoff #35). The script no longer spawns its own social-api or
    // frontend; the operator is expected to have run `tilt up` (or
    // started the dev stack equivalently) before running snapshots.
    //
    // We probe :3001/health and :5174 to confirm the stack is up, and
    // abort with a clear message if either is missing.
    if (!(await probe(`http://localhost:${SOCIAL_API_PORT}/health`))) {
      err(`social-api not reachable on :${SOCIAL_API_PORT}`);
      err('start the dev stack first:  tilt up');
      err('(or run social-api locally — `cd social-api && npm run dev`)');
      throw new Error('social-api unreachable; aborting snapshot');
    }
    if (!(await probeHealthOk(`http://localhost:${SOCIAL_API_PORT}/health`))) {
      log(`WARNING: social-api /health is degraded (HTTP != 200).`);
      log('  Snapshots will show the degraded banner.');
      log('  Verify Tilt brought up the DDB + Redis pods successfully:');
      log('    tilt status   (or open the Tilt UI at http://localhost:10350)');
    }

    if (!(await probe(FRONTEND_BASE))) {
      err(`frontend not reachable at ${FRONTEND_BASE}`);
      err('start the dev stack first:  tilt up');
      err('(Tilt brings up frontend-dev as a local_resource at :5174)');
      throw new Error('frontend unreachable; aborting snapshot');
    }
    log(`stack reachable: social-api on :${SOCIAL_API_PORT}, frontend on :${FRONTEND_PORT}`);

    // Capture.
    const { captured, errored } = await captureAll(runTimestamp);
    await writeIndex(runTimestamp, captured, errored);

    log(`run complete: ${captured.length} captured, ${errored.length} errored`);

    // Run journeys (hub#54). Same lifecycle window — frontend + social-api
    // are still up. Failures inside individual journeys don't fail the
    // whole snapshot run.
    log('starting journey runner');
    try {
      const { spawnSync } = await import('node:child_process');
      const journeyResult = spawnSync(
        process.execPath,
        [join(REPO_ROOT, 'scripts', 'snapshot-journeys.mjs')],
        {
          cwd: REPO_ROOT,
          env: { ...process.env, JOURNEY_RUN_ID: runTimestamp },
          stdio: 'inherit',
        },
      );
      if (journeyResult.status === 0) {
        log('journeys: all passed');
      } else {
        log(`journeys: completed with exit code ${journeyResult.status} (some failed; see journeys/index.json)`);
      }
    } catch (e) {
      err(`journey runner spawn failed: ${e?.message ?? e}`);
    }
  } catch (e) {
    err(`run failed: ${e?.message ?? e}`);
    exitCode = 1;
  }
  // No teardown — the script doesn't own the dev stack lifecycle
  // anymore (Tilt does, per handoff #35). Operator runs `tilt down`
  // when they're done.
  process.exit(exitCode);
}

main();
