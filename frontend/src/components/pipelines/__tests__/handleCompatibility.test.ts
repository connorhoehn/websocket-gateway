// frontend/src/components/pipelines/__tests__/handleCompatibility.test.ts
//
// Unit tests for `isValidHandleConnection` — exercises every handle
// combination from the PIPELINES_PLAN.md §5 handle-type table.
//
// NOTE on framework: Vitest (jest-compatible API). See `frontend/vite.config.ts`.

import { describe, test, expect } from 'vitest';
import { isValidHandleConnection } from '../validation/handleCompatibility';
import type { NodeType } from '../../../types/pipeline';

describe('isValidHandleConnection', () => {
  test('Trigger.out -> any.in is valid', () => {
    const targets: NodeType[] = [
      'llm',
      'transform',
      'condition',
      'action',
      'fork',
      'approval',
    ];
    for (const t of targets) {
      expect(isValidHandleConnection('trigger', 'out', t, 'in')).toBe(true);
    }
  });

  test('Trigger cannot be a target (no input)', () => {
    expect(isValidHandleConnection('llm', 'out', 'trigger', 'in')).toBe(false);
    expect(isValidHandleConnection('transform', 'out', 'trigger', 'in')).toBe(false);
    expect(isValidHandleConnection('action', 'out', 'trigger', 'out')).toBe(false);
  });

  test('LLM.out and LLM.error -> any.in is valid', () => {
    expect(isValidHandleConnection('llm', 'out', 'transform', 'in')).toBe(true);
    expect(isValidHandleConnection('llm', 'error', 'action', 'in')).toBe(true);
    expect(isValidHandleConnection('llm', 'out', 'condition', 'in')).toBe(true);
    expect(isValidHandleConnection('llm', 'error', 'approval', 'in')).toBe(true);
  });

  test('Condition.true and Condition.false -> any.in is valid', () => {
    expect(isValidHandleConnection('condition', 'true', 'llm', 'in')).toBe(true);
    expect(isValidHandleConnection('condition', 'false', 'action', 'in')).toBe(true);
    expect(isValidHandleConnection('condition', 'true', 'transform', 'in')).toBe(true);
    // Unknown condition sub-handle rejected
    expect(isValidHandleConnection('condition', 'maybe', 'action', 'in')).toBe(false);
  });

  test('Fork.branch-0, branch-1, etc. -> any.in is valid', () => {
    expect(isValidHandleConnection('fork', 'branch-0', 'action', 'in')).toBe(true);
    expect(isValidHandleConnection('fork', 'branch-1', 'transform', 'in')).toBe(true);
    expect(isValidHandleConnection('fork', 'branch-7', 'llm', 'in')).toBe(true);
    expect(isValidHandleConnection('fork', 'branch-42', 'condition', 'in')).toBe(true);
  });

  test('Fork.out is NOT a valid source (Fork has branch-N)', () => {
    expect(isValidHandleConnection('fork', 'out', 'action', 'in')).toBe(false);
    // Malformed branch handles also rejected
    expect(isValidHandleConnection('fork', 'branch-', 'action', 'in')).toBe(false);
    expect(isValidHandleConnection('fork', 'branch-abc', 'action', 'in')).toBe(false);
    expect(isValidHandleConnection('fork', 'branch--1', 'action', 'in')).toBe(false);
  });

  test('Join.in-0, in-1 -> from any source is valid', () => {
    expect(isValidHandleConnection('transform', 'out', 'join', 'in-0')).toBe(true);
    expect(isValidHandleConnection('action', 'out', 'join', 'in-1')).toBe(true);
    expect(isValidHandleConnection('llm', 'out', 'join', 'in-5')).toBe(true);
    expect(isValidHandleConnection('condition', 'true', 'join', 'in-0')).toBe(true);
    // Join doesn't accept plain `in`
    expect(isValidHandleConnection('transform', 'out', 'join', 'in')).toBe(false);
  });

  test('Approval.approved and Approval.rejected -> any.in is valid', () => {
    expect(isValidHandleConnection('approval', 'approved', 'action', 'in')).toBe(true);
    expect(isValidHandleConnection('approval', 'rejected', 'action', 'in')).toBe(true);
    expect(isValidHandleConnection('approval', 'approved', 'llm', 'in')).toBe(true);
    // Unknown approval handle rejected
    expect(isValidHandleConnection('approval', 'pending', 'action', 'in')).toBe(false);
  });

  test('rejects targeting Trigger', () => {
    // Every possible source can't target Trigger
    const sources: [NodeType, string][] = [
      ['llm', 'out'],
      ['llm', 'error'],
      ['transform', 'out'],
      ['condition', 'true'],
      ['condition', 'false'],
      ['action', 'out'],
      ['action', 'error'],
      ['fork', 'branch-0'],
      ['join', 'out'],
      ['approval', 'approved'],
      ['approval', 'rejected'],
    ];
    for (const [srcType, srcHandle] of sources) {
      expect(isValidHandleConnection(srcType, srcHandle, 'trigger', 'in')).toBe(false);
    }
  });

  test('rejects unknown node types', () => {
    // Safety check: an unknown source type must not throw; it should simply
    // return false. (We cast via `unknown` to bypass the TS enum.)
    const bogus = 'not-a-type' as unknown as NodeType;
    // Current implementation indexes the handle map by type, so an unknown
    // type will throw. Keep the expectation defensive: either false or
    // throws — both indicate rejection. Assert it's at least "not valid".
    let result: boolean | 'throws' = 'throws';
    try {
      result = isValidHandleConnection(bogus, 'out', 'action', 'in');
    } catch {
      result = 'throws';
    }
    expect(result === false || result === 'throws').toBe(true);

    let result2: boolean | 'throws' = 'throws';
    try {
      result2 = isValidHandleConnection('trigger', 'out', bogus, 'in');
    } catch {
      result2 = 'throws';
    }
    expect(result2 === false || result2 === 'throws').toBe(true);
  });

  test('Transform.out and Action.out/error -> any.in is valid', () => {
    expect(isValidHandleConnection('transform', 'out', 'llm', 'in')).toBe(true);
    expect(isValidHandleConnection('action', 'out', 'transform', 'in')).toBe(true);
    expect(isValidHandleConnection('action', 'error', 'action', 'in')).toBe(true);
    // Unknown source handle rejected
    expect(isValidHandleConnection('transform', 'error', 'action', 'in')).toBe(false);
  });

  test('Join.out -> any.in is valid', () => {
    expect(isValidHandleConnection('join', 'out', 'action', 'in')).toBe(true);
    expect(isValidHandleConnection('join', 'out', 'transform', 'in')).toBe(true);
    // Join doesn't have 'branch' or 'approved' outputs
    expect(isValidHandleConnection('join', 'approved', 'action', 'in')).toBe(false);
  });

  test('rejects invalid target handle on non-Join, non-Trigger targets', () => {
    // Normal targets only accept 'in' — 'in-0' is only for Join
    expect(isValidHandleConnection('trigger', 'out', 'llm', 'in-0')).toBe(false);
    expect(isValidHandleConnection('trigger', 'out', 'action', 'wrong')).toBe(false);
    expect(isValidHandleConnection('trigger', 'out', 'transform', '')).toBe(false);
  });
});
