#!/usr/bin/env node
// Verifies pipeline types stay in sync across:
//   1. websocket-gateway/frontend/src/types/pipeline.ts (canonical)
//   2. distributed-core/src/applications/pipeline/types.ts (mirror, optional)
//   3. websocket-gateway/schemas/pipeline.schema.json
//   4. websocket-gateway/social-api/openapi/pipelines.yaml
//
// Strategy: regex-based extraction of top-level type/interface declarations.
// Schema + OpenAPI are checked by name coverage (their hand-maintained shapes
// would diff too noisily field-by-field). Documented intentional divergences
// per TYPES_SYNC.md are allow-listed.

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// Repo-relative paths so this works on any developer machine + CI.
// Script lives at <repo>/scripts/check-types-sync.mjs.
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const GATEWAY_TS = resolve(REPO_ROOT, 'frontend/src/types/pipeline.ts');
// distributed-core is now an npm dep; the published tarball ships dist/
// only (no src/), so the cross-repo source compare is a local-dev-only
// nicety. Falls back gracefully when the file isn't present (existsSync
// gate below).
const DCORE_TS   = resolve(REPO_ROOT, '../distributed-core/src/applications/pipeline/types.ts');
const SCHEMA     = resolve(REPO_ROOT, 'schemas/pipeline.schema.json');
const OPENAPI    = resolve(REPO_ROOT, 'social-api/openapi/pipelines.yaml');

// Kernel/SDK split: dcore keeps LLMProvider as `string`, no UI-only
// publishedSnapshot, PipelineWireEvent gateway-first.
const DCORE_DIVERGENCE_ALLOWLIST = new Set(['LLMProvider', 'PipelineDefinition', 'PipelineWireEvent']);

// Dual-emit deprecation window: dcore migrating `pipeline.X.Y` → `pipeline:X:Y`.
// Normalize event-name separators to colons before comparison. Remove this
// when dcore + gateway have both landed the new names. See handoff notes.
const normEvents = (s) => s.replace(/pipeline\.([\w.]+)/g, (_, rest) => 'pipeline:' + rest.replace(/\./g, ':'));

// Names that need no own $defs / components.schemas entry (covered elsewhere
// or are runtime-only unions). PipelineDefinition IS the schema's root.
const COMMON_OPTIONAL = new Set([
  'NodeData', 'PipelineEventMap',
  'TriggerType', 'TransformType', 'ActionType',
  'JoinMode', 'JoinMergeStrategy', 'ApprovalTimeoutAction',
  'NodeType', 'PipelineStatus', 'LLMProvider',
]);
const SCHEMA_OPTIONAL = new Set([...COMMON_OPTIONAL, 'PipelineDefinition']);

const issues = [];
const fail = (kind, name, detail = '') => issues.push({ kind, name, detail });

function read(p) { return readFileSync(p, 'utf8'); }

function extractTypeBlocks(src) {
  const norm = src
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
    .split('\n').map(l => l.replace(/^export\s+/, '').trimEnd())
    .filter(l => l.trim() !== '').join('\n');
  const out = new Map();
  const re = /\b(type|interface)\s+(\w+)(?:<[^>]*>)?\s*(?:=|extends[^{]*)?\s*({[\s\S]*?^}|[^;\n]+;)/gm;
  let m;
  while ((m = re.exec(norm))) out.set(m[2], m[3].trim());
  return out;
}

function memberNames(body) {
  if (!body || !body.startsWith('{')) return new Set();
  const names = new Set();
  let depth = 0;
  for (const line of body.slice(1, -1).split('\n')) {
    if (depth === 0) {
      const t = line.trim();
      const idMatch = t.match(/^(['"`]?)([A-Za-z_$][\w$.\-]*)\1\??\s*:/);
      if (idMatch) names.add(idMatch[2]);
    }
    depth += (line.match(/{/g) || []).length - (line.match(/}/g) || []).length;
  }
  return names;
}

// 1. Canonical gateway file --------------------------------------------------
if (!existsSync(GATEWAY_TS)) {
  console.error(`✗ canonical types missing: ${GATEWAY_TS}`);
  process.exit(2);
}
const gMap = extractTypeBlocks(read(GATEWAY_TS));

// 2. Cross-repo (distributed-core) compare ----------------------------------
if (existsSync(DCORE_TS)) {
  const dMap = extractTypeBlocks(read(DCORE_TS));
  for (const name of new Set([...gMap.keys(), ...dMap.keys()])) {
    if (DCORE_DIVERGENCE_ALLOWLIST.has(name)) continue;
    if (!gMap.has(name)) fail('dcore-extra', name, 'in dcore not gateway');
    else if (!dMap.has(name)) fail('dcore-missing', name, 'in gateway not dcore');
    else {
      // Dual-emit window: compare member SETS (with separator normalization)
      // and allow dcore to legitimately carry additional members — it dual-
      // emits both old and new event names during the deprecation window.
      // Gateway must remain a subset of dcore; missing-from-dcore is the only
      // hard fail.
      const gMembers = new Set([...memberNames(gMap.get(name))].map(normEvents));
      const dMembers = new Set([...memberNames(dMap.get(name))].map(normEvents));
      const onlyG = [...gMembers].filter(f => !dMembers.has(f));
      if (onlyG.length) {
        fail('dcore-divergent', name, `gateway-only: ${onlyG.join(',')}`);
      }
    }
  }
} else {
  console.warn('⚠  distributed-core types not present; cross-repo compare skipped.');
}

// 3. JSON Schema name coverage ----------------------------------------------
if (!existsSync(SCHEMA)) {
  fail('schema-missing-file', SCHEMA);
} else {
  const schema = JSON.parse(read(SCHEMA));
  const defs = new Set([...Object.keys(schema.$defs || {}), 'PipelineDefinition']);
  for (const name of gMap.keys()) {
    if (SCHEMA_OPTIONAL.has(name) || defs.has(name)) continue;
    fail('schema-missing', name, `no $defs.${name}`);
  }
  for (const v of ['Trigger', 'LLM', 'Transform', 'Condition', 'Action', 'Fork', 'Join', 'Approval']) {
    if (!defs.has(`${v}NodeData`)) fail('schema-missing-variant', `${v}NodeData`);
  }
  for (const k of ['PipelineWireEvent', 'PipelineEventType', 'PipelineRun', 'StepExecution']) {
    if (!defs.has(k)) fail('schema-missing-required', k);
  }
}

// 4. OpenAPI name coverage + endpoints --------------------------------------
if (!existsSync(OPENAPI)) {
  fail('openapi-missing-file', OPENAPI);
} else {
  const yamlSrc = read(OPENAPI);
  const schemaNames = new Set();
  const compIdx = yamlSrc.indexOf('  schemas:');
  if (compIdx >= 0) {
    const re = /^    ([A-Z][A-Za-z0-9_]*):\s*$/gm;
    let m;
    while ((m = re.exec(yamlSrc.slice(compIdx)))) schemaNames.add(m[1]);
  }
  for (const name of gMap.keys()) {
    if (COMMON_OPTIONAL.has(name) || schemaNames.has(name)) continue;
    fail('openapi-missing', name, `components.schemas.${name} not found`);
  }
  for (const v of ['Trigger', 'LLM', 'Transform', 'Condition', 'Action', 'Fork', 'Join', 'Approval']) {
    if (!schemaNames.has(`${v}NodeData`)) fail('openapi-missing-variant', `${v}NodeData`);
  }
  for (const k of ['PipelineWireEvent', 'PipelineEventType', 'PipelineRun', 'StepExecution', 'ObservabilityDashboard']) {
    if (!schemaNames.has(k)) fail('openapi-missing-required', k);
  }
  const REQUIRED_PATHS = [
    '/pipelines/{pipelineId}/runs:',
    '/pipelines/{pipelineId}/runs/{runId}:',
    '/pipelines/{pipelineId}/runs/{runId}/history:',
    '/pipelines/{runId}/approvals:',
    '/observability/dashboard:',
    '/observability/metrics:',
  ];
  for (const p of REQUIRED_PATHS) {
    if (!yamlSrc.includes(`  ${p}`)) fail('openapi-missing-path', p);
  }
  if (!/Idempotency-Key/.test(yamlSrc) || !/X-Idempotency-Replay/.test(yamlSrc)) {
    fail('openapi-missing-idempotency', 'POST /pipelines/{pipelineId}/runs');
  }
}

// Report --------------------------------------------------------------------
if (issues.length === 0) {
  console.log(`✓ pipeline types in sync (${gMap.size} canonical types checked vs schema/openapi/dcore)`);
  process.exit(0);
}
console.error(`✗ ${issues.length} type sync issue(s):`);
for (const { kind, name, detail } of issues) {
  console.error(`  [${kind}] ${name}${detail ? ' — ' + detail : ''}`);
}
console.error('\nRule: pipeline.ts is canonical. Update schema + openapi to match.');
console.error('Cross-repo dcore drift: see TYPES_SYNC.md (allow-listed exceptions only).');
process.exit(1);
