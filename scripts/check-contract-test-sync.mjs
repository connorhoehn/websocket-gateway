#!/usr/bin/env node
// Verifies the pipelineExecutor contract test file is shape-synchronized
// across websocket-gateway and distributed-core per TYPES_SYNC.md.
//
// Why not strict line-equality? The gateway test imports `MockExecutor` and
// drives it directly; the dcore test wires a real executor against a fake
// `LLMClient`. The executor *bring-up* differs by repo — that's expected.
// What MUST stay identical is the BEHAVIORAL surface: the describe/test
// hierarchy and the names of every test case. A test renamed or removed in
// one repo and not the other is the actual drift we care about.
//
// We extract every `describe(...)` and `test(...)` / `it(...)` literal name
// and compare the two ordered lists. Anything else is allowed to differ.

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// Repo-relative paths so this works on any developer machine + CI.
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const GATEWAY = resolve(REPO_ROOT, 'frontend/src/components/pipelines/__tests__/pipelineExecutor.contract.test.ts');
// distributed-core's contract test is in the source tree, not in the
// published dist/ — so cross-repo compare is a local-dev nicety only.
// Skips gracefully when the sibling checkout isn't present.
const DCORE   = resolve(REPO_ROOT, '../distributed-core/src/applications/pipeline/__tests__/pipelineExecutor.contract.test.ts');

// Anchor: the gateway file MUST type-import from the canonical types module.
const REQUIRED_GATEWAY_IMPORT = /from\s+['"][^'"]*types\/pipeline['"]/;

function read(p) { return readFileSync(p, 'utf8'); }

/** Extract ordered (kind, name) tuples for `describe`/`test`/`it` calls.
 *  Tolerates `.skip`/`.only`, leading whitespace, and any quote style. */
function extractCases(src) {
  const out = [];
  const re = /\b(describe|test|it)(?:\.\w+)*\s*\(\s*(['"`])((?:\\.|(?!\2).)*?)\2/g;
  let m;
  while ((m = re.exec(src))) out.push({ kind: m[1] === 'it' ? 'test' : m[1], name: m[3] });
  return out;
}

// Dual-emit deprecation window: dcore is migrating event names from
// `pipeline.X.Y` (dot) to `pipeline:X:Y` (colon). During the window, normalize
// to colons before comparing. Remove this once dcore lands the new names and
// gateway has migrated. Tracked in PIPELINES_PLAN / handoff.
const normEvents = (s) => s.replace(/pipeline\.([\w.]+)/g, (_, rest) => 'pipeline:' + rest.replace(/\./g, ':'));

const issues = [];
function fail(kind, detail) { issues.push({ kind, detail }); }

// ---------------------------------------------------------------------------
// Gateway file integrity (always required)
// ---------------------------------------------------------------------------

if (!existsSync(GATEWAY)) {
  console.error(`✗ gateway contract test missing: ${GATEWAY}`);
  process.exit(2);
}
const gSrc = read(GATEWAY);
if (!REQUIRED_GATEWAY_IMPORT.test(gSrc)) {
  fail('gateway-bad-import', 'contract test must `import type {...} from ".../types/pipeline"`');
}

// Spot-check: every PipelineEventMap event name we emit MUST appear in the
// test (the test's job is to pin event ordering, so each event lands here).
const REQUIRED_EVENTS = [
  'pipeline.run.started',
  'pipeline.run.completed',
  'pipeline.run.failed',
  'pipeline.run.cancelled',
  'pipeline.step.started',
  'pipeline.step.completed',
  'pipeline.step.failed',
  'pipeline.step.skipped',
  'pipeline.step.cancelled',
  'pipeline.llm.prompt',
  'pipeline.llm.token',
  'pipeline.llm.response',
  'pipeline.approval.requested',
  'pipeline.approval.recorded',
  'pipeline.join.waiting',
  'pipeline.join.fired',
];
for (const e of REQUIRED_EVENTS) {
  if (!gSrc.includes(`'${e}'`) && !gSrc.includes(`"${e}"`)) {
    fail('gateway-missing-event', `contract test does not reference '${e}'`);
  }
}

const gCases = extractCases(gSrc);
if (gCases.filter(c => c.kind === 'test').length === 0) {
  fail('gateway-no-tests', 'no test()/it() calls extracted — parser likely off');
}

// ---------------------------------------------------------------------------
// Cross-repo compare (only if dcore copy exists)
// ---------------------------------------------------------------------------

if (existsSync(DCORE)) {
  const dCases = extractCases(read(DCORE));
  // Compare ORDERED list of describe + test names. Event names normalized
  // for the dual-emit window (see normEvents above).
  const flat = (cases) => cases.map(c => `${c.kind}:${normEvents(c.name)}`);
  const gFlat = flat(gCases);
  const dFlat = flat(dCases);

  const gSet = new Set(gFlat);
  const dSet = new Set(dFlat);
  for (const x of gFlat) if (!dSet.has(x)) fail('only-in-gateway', x);
  for (const x of dFlat) if (!gSet.has(x)) fail('only-in-dcore', x);

  // Order check (only when sets match — otherwise the noise is overwhelming).
  if (issues.filter(i => i.kind === 'only-in-gateway' || i.kind === 'only-in-dcore').length === 0) {
    for (let i = 0; i < gFlat.length; i++) {
      if (gFlat[i] !== dFlat[i]) {
        fail('order-mismatch', `position ${i + 1}: gateway=${gFlat[i]} | dcore=${dFlat[i]}`);
        break;
      }
    }
  }
} else {
  console.warn('⚠  distributed-core contract test not present; cross-repo compare skipped.');
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

if (issues.length === 0) {
  console.log(`✓ contract test in sync (${gCases.filter(c => c.kind === 'test').length} test cases checked)`);
  process.exit(0);
}

console.error(`✗ ${issues.length} contract test sync issue(s):`);
for (const { kind, detail } of issues) {
  console.error(`  [${kind}] ${detail}`);
}
console.error('\nRule (TYPES_SYNC.md): pipelineExecutor.contract.test.ts is the behavioral');
console.error('source of truth for both executors. Bring-up code (LLMClient/MockExecutor)');
console.error('may differ by repo, but the describe/test hierarchy must match exactly.');
process.exit(1);
