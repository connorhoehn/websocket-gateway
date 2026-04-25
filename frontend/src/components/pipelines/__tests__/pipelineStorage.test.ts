// frontend/src/components/pipelines/__tests__/pipelineStorage.test.ts
//
// Unit tests for the localStorage-backed pipeline persistence module.
// See PIPELINES_PLAN.md §13.4.
//
// NOTE on framework: Vitest (jest-compatible API). See `frontend/vite.config.ts`.

import { describe, test, expect, beforeEach } from 'vitest';
import {
  createPipeline,
  deletePipeline,
  duplicatePipeline,
  exportPipelineJSON,
  importPipelineJSON,
  listPipelines,
  loadPipeline,
  publishPipeline,
  savePipeline,
} from '../persistence/pipelineStorage';
import type {
  PipelineDefinition,
  PipelineEdge,
  PipelineNode,
  TransformNodeData,
  TriggerNodeData,
} from '../../../types/pipeline';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTriggerNode(id = 't1'): PipelineNode {
  const data: TriggerNodeData = { type: 'trigger', triggerType: 'manual' };
  return { id, type: 'trigger', position: { x: 40, y: 120 }, data };
}

function makeTransformNode(id = 'x1'): PipelineNode {
  const data: TransformNodeData = {
    type: 'transform',
    transformType: 'template',
    expression: '{{context.body}}',
  };
  return { id, type: 'transform', position: { x: 200, y: 120 }, data };
}

function makeEdge(
  id: string,
  source: string,
  target: string,
  sourceHandle = 'out',
  targetHandle = 'in',
): PipelineEdge {
  return { id, source, sourceHandle, target, targetHandle };
}

function makeDef(overrides: Partial<PipelineDefinition> = {}): PipelineDefinition {
  const now = new Date().toISOString();
  return {
    id: overrides.id ?? 'p-test-1',
    name: 'Test Pipeline',
    version: 0,
    status: 'draft',
    nodes: [makeTriggerNode('t1')],
    edges: [],
    createdAt: now,
    updatedAt: now,
    createdBy: 'unit-test',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Lifecycle — clear only the keys this module owns so we don't trip other
// suites that share jsdom's localStorage.
// ---------------------------------------------------------------------------

beforeEach(() => {
  Object.keys(localStorage).forEach(k => {
    if (k.startsWith('ws_pipelines_v1')) localStorage.removeItem(k);
  });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('pipelineStorage', () => {
  test('listPipelines returns [] when nothing is stored', () => {
    expect(listPipelines()).toEqual([]);
  });

  test('createPipeline seeds one Trigger node at (40, 120)', () => {
    const def = createPipeline({ name: 'New', createdBy: 'u1' });
    expect(def.nodes).toHaveLength(1);
    const node = def.nodes[0];
    expect(node.type).toBe('trigger');
    expect(node.data.type).toBe('trigger');
    expect(node.position).toEqual({ x: 40, y: 120 });
    // Trigger defaults to 'manual'
    expect((node.data as TriggerNodeData).triggerType).toBe('manual');
    // Created pipeline is in draft status
    expect(def.status).toBe('draft');
    // savePipeline is called inside createPipeline, which bumps version from 0 to 1
    expect(def.version).toBe(1);
  });

  test('savePipeline bumps version and updates updatedAt', () => {
    const def = makeDef({ version: 3, updatedAt: '2020-01-01T00:00:00.000Z' });
    savePipeline(def);
    expect(def.version).toBe(4);
    expect(def.updatedAt).not.toBe('2020-01-01T00:00:00.000Z');
    // round-trip check
    const loaded = loadPipeline(def.id);
    expect(loaded?.version).toBe(4);
  });

  test('savePipeline upserts the index entry', () => {
    const def = makeDef({ id: 'p-upsert', name: 'First' });
    savePipeline(def);
    let entries = listPipelines();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ id: 'p-upsert', name: 'First', status: 'draft' });

    // Save again with a new name — should upsert, not duplicate.
    def.name = 'Second';
    savePipeline(def);
    entries = listPipelines();
    expect(entries).toHaveLength(1);
    expect(entries[0].name).toBe('Second');
  });

  test('loadPipeline returns null for missing id', () => {
    expect(loadPipeline('does-not-exist')).toBeNull();
  });

  test('loadPipeline round-trips a saved definition', () => {
    const def = makeDef({
      id: 'p-round-trip',
      nodes: [makeTriggerNode('t1'), makeTransformNode('x1')],
      edges: [makeEdge('e1', 't1', 'x1')],
    });
    savePipeline(def);
    const loaded = loadPipeline('p-round-trip');
    expect(loaded).not.toBeNull();
    expect(loaded?.id).toBe('p-round-trip');
    expect(loaded?.nodes).toHaveLength(2);
    expect(loaded?.edges).toHaveLength(1);
    expect(loaded?.edges[0]).toEqual(makeEdge('e1', 't1', 'x1'));
  });

  test('deletePipeline removes both the def and index entry', () => {
    const def = makeDef({ id: 'p-del' });
    savePipeline(def);
    expect(loadPipeline('p-del')).not.toBeNull();
    expect(listPipelines()).toHaveLength(1);

    deletePipeline('p-del');
    expect(loadPipeline('p-del')).toBeNull();
    expect(listPipelines()).toHaveLength(0);
  });

  test('publishPipeline sets status=published and publishedVersion', () => {
    const def = createPipeline({ name: 'Publish Me', createdBy: 'u1' });
    expect(def.status).toBe('draft');
    const startVersion = def.version;

    const published = publishPipeline(def.id);
    expect(published).not.toBeNull();
    expect(published?.status).toBe('published');
    // publishPipeline predicts savePipeline's version bump so publishedVersion
    // matches the version actually stored.
    expect(published?.publishedVersion).toBe(startVersion + 1);
    expect(published?.version).toBe(startVersion + 1);
  });

  test('duplicatePipeline regenerates ids and resets to draft', () => {
    const src = createPipeline({ name: 'Source', createdBy: 'u1' });
    publishPipeline(src.id);

    const dup = duplicatePipeline(src.id);
    expect(dup).not.toBeNull();
    expect(dup!.id).not.toBe(src.id);
    expect(dup!.status).toBe('draft');
    expect(dup!.publishedVersion).toBeUndefined();
    expect(dup!.name).toBe('Source (copy)');
  });

  test('duplicatePipeline preserves structure but assigns new node/edge IDs', () => {
    const src = makeDef({
      id: 'p-dup-src',
      nodes: [makeTriggerNode('t1'), makeTransformNode('x1')],
      edges: [makeEdge('e1', 't1', 'x1')],
    });
    savePipeline(src);

    const dup = duplicatePipeline('p-dup-src');
    expect(dup).not.toBeNull();
    expect(dup!.nodes).toHaveLength(2);
    expect(dup!.edges).toHaveLength(1);

    // IDs changed
    const srcNodeIds = src.nodes.map(n => n.id);
    const dupNodeIds = dup!.nodes.map(n => n.id);
    expect(dupNodeIds.some(id => srcNodeIds.includes(id))).toBe(false);

    // Structure preserved — types in same order
    expect(dup!.nodes.map(n => n.type)).toEqual(['trigger', 'transform']);

    // Edge remapped correctly — source/target reference the new node ids
    const edge = dup!.edges[0];
    expect(edge.id).not.toBe('e1');
    expect(edge.source).toBe(dupNodeIds[0]);
    expect(edge.target).toBe(dupNodeIds[1]);
  });

  test('exportPipelineJSON returns pretty-printed JSON', () => {
    const def = makeDef({ id: 'p-export' });
    savePipeline(def);

    const json = exportPipelineJSON('p-export');
    expect(json).not.toBeNull();
    // Pretty-printed => contains a newline and 2-space indent
    expect(json!.includes('\n')).toBe(true);
    expect(json!.includes('  "id"')).toBe(true);

    // And round-trips to the same shape
    const parsed = JSON.parse(json!);
    expect(parsed.id).toBe('p-export');
    expect(parsed.nodes).toHaveLength(1);
  });

  test('exportPipelineJSON returns null for missing id', () => {
    expect(exportPipelineJSON('does-not-exist')).toBeNull();
  });

  test('importPipelineJSON accepts valid JSON and saves with a new id', () => {
    const original = makeDef({ id: 'p-original', version: 5 });
    const json = JSON.stringify(original);

    const imported = importPipelineJSON(json);
    // Import assigns a new id
    expect(imported.id).not.toBe('p-original');
    // And it's saved — listPipelines() sees it
    expect(listPipelines().some(e => e.id === imported.id)).toBe(true);
    // Load round-trips
    const loaded = loadPipeline(imported.id);
    expect(loaded).not.toBeNull();
    expect(loaded?.name).toBe('Test Pipeline');
  });

  test('importPipelineJSON throws on invalid JSON', () => {
    expect(() => importPipelineJSON('not json {{{')).toThrow(/Invalid pipeline/);
  });

  test('importPipelineJSON throws on missing required fields', () => {
    // Missing `status` entirely
    const bad = JSON.stringify({
      id: 'x',
      name: 'x',
      version: 1,
      nodes: [],
      edges: [],
    });
    expect(() => importPipelineJSON(bad)).toThrow(/Invalid pipeline/);

    // Bad status enum
    const bad2 = JSON.stringify({
      id: 'x',
      name: 'x',
      version: 1,
      status: 'bogus',
      nodes: [],
      edges: [],
    });
    expect(() => importPipelineJSON(bad2)).toThrow(/Invalid pipeline/);

    // Non-object
    expect(() => importPipelineJSON('42')).toThrow(/Invalid pipeline/);
  });
});
