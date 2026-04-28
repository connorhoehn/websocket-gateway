// social-api/src/pipeline/__tests__/createBridge.test.ts
//
// Tests the bridge that wraps distributed-core's PipelineModule behind the
// PipelineBridge contract consumed by social-api routes. Uses a minimal mock
// PipelineModule (just the methods createBridge calls) so the suite doesn't
// boot a real cluster — that's covered by bootstrap.test.ts.

import { createBridge } from '../createBridge';
import type { PipelineModule } from 'distributed-core';
import type { PipelineRunSnapshot, PendingApprovalRow } from '../../routes/pipelineTriggers';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

interface MockModule {
  createResource: jest.Mock;
  getRun: jest.Mock;
  getHistory: jest.Mock;
  resolveApproval: jest.Mock;
  listActiveRuns: jest.Mock;
  cancelRun: jest.Mock;
  getPendingApprovals: jest.Mock;
  getMetrics: jest.Mock;
}

function makeMockModule(): MockModule {
  return {
    createResource: jest.fn(),
    getRun: jest.fn(),
    getHistory: jest.fn(),
    resolveApproval: jest.fn(),
    listActiveRuns: jest.fn(),
    cancelRun: jest.fn(),
    getPendingApprovals: jest.fn(),
    getMetrics: jest.fn(),
  };
}

function bridge(mod: MockModule) {
  // The bridge only depends on the eight methods we mock — cast through
  // unknown so we don't have to stub every PipelineModule field.
  return createBridge(mod as unknown as PipelineModule);
}

// ---------------------------------------------------------------------------
// trigger() — wraps PipelineModule.createResource
// ---------------------------------------------------------------------------

describe('createBridge — trigger()', () => {
  test('forwards args into createResource and returns the runId', async () => {
    const mod = makeMockModule();
    mod.createResource.mockResolvedValue({
      applicationData: { runId: 'run-abc' },
    });
    const b = bridge(mod);

    const result = await b.trigger!({
      pipelineId: 'p-1',
      definition: { id: 'p-1', nodes: [], edges: [] },
      triggerPayload: { hello: 'world' },
      triggeredBy: { userId: 'u-1' },
    });

    expect(result).toEqual({ runId: 'run-abc' });
    expect(mod.createResource).toHaveBeenCalledTimes(1);
    const call = mod.createResource.mock.calls[0][0];
    expect(call.applicationData.pipelineId).toBe('p-1');
    expect(call.applicationData.triggerPayload).toEqual({ hello: 'world' });
    expect(call.applicationData.triggeredBy).toEqual({ userId: 'u-1' });
  });

  test('throws when createResource omits runId', async () => {
    const mod = makeMockModule();
    mod.createResource.mockResolvedValue({ applicationData: {} });
    const b = bridge(mod);

    await expect(
      b.trigger!({ pipelineId: 'p-1', triggeredBy: { userId: 'u-1' } }),
    ).rejects.toThrow(/did not return a runId/);
  });

  test('throws when applicationData is missing entirely', async () => {
    const mod = makeMockModule();
    mod.createResource.mockResolvedValue({});
    const b = bridge(mod);

    await expect(
      b.trigger!({ pipelineId: 'p-1', triggeredBy: { userId: 'u-1' } }),
    ).rejects.toThrow(/did not return a runId/);
  });
});

// ---------------------------------------------------------------------------
// getRun() — narrows the PipelineModule shape into PipelineRunSnapshot
// ---------------------------------------------------------------------------

describe('createBridge — getRun()', () => {
  test('returns the run when the module has one with required fields', () => {
    const mod = makeMockModule();
    mod.getRun.mockReturnValue({
      runId: 'run-abc',
      pipelineId: 'p-1',
      status: 'running',
      startedAt: '2026-04-26T00:00:00Z',
    });
    const b = bridge(mod);

    const snap = b.getRun('run-abc');
    expect(snap).toMatchObject({ runId: 'run-abc', pipelineId: 'p-1', status: 'running' });
    expect(mod.getRun).toHaveBeenCalledWith('run-abc');
  });

  test('returns null when the module returns null', () => {
    const mod = makeMockModule();
    mod.getRun.mockReturnValue(null);
    expect(bridge(mod).getRun('run-x')).toBeNull();
  });

  test('returns null when the module returns a malformed shape (missing runId)', () => {
    const mod = makeMockModule();
    mod.getRun.mockReturnValue({ pipelineId: 'p-1' });
    expect(bridge(mod).getRun('run-x')).toBeNull();
  });

  test('returns null when the module returns a non-object', () => {
    const mod = makeMockModule();
    mod.getRun.mockReturnValue(undefined);
    expect(bridge(mod).getRun('run-x')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// getHistory() — passes through to module.getHistory
// ---------------------------------------------------------------------------

describe('createBridge — getHistory()', () => {
  test('forwards (runId, fromVersion) and returns events', async () => {
    const events = [
      { id: 'e1', type: 'pipeline:run:started', payload: {}, timestamp: 1, sourceNodeId: 'n', version: 0 },
      { id: 'e2', type: 'pipeline:step:started', payload: { stepId: 's1' }, timestamp: 2, sourceNodeId: 'n', version: 1 },
    ];
    const mod = makeMockModule();
    mod.getHistory.mockResolvedValue(events);

    const out = await bridge(mod).getHistory('run-abc', 0);
    expect(out).toEqual(events);
    expect(mod.getHistory).toHaveBeenCalledWith('run-abc', 0);
  });

  test('returns [] when the underlying bus has no WAL (per cross-repo contract)', async () => {
    const mod = makeMockModule();
    mod.getHistory.mockResolvedValue([]);
    expect(await bridge(mod).getHistory('run-abc', 0)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// listActiveRuns() — flattens PipelineRunResource[] into PipelineRunSnapshot[]
// ---------------------------------------------------------------------------

describe('createBridge — listActiveRuns()', () => {
  test('unwraps applicationData on each resource', () => {
    const mod = makeMockModule();
    mod.listActiveRuns.mockReturnValue([
      { applicationData: { runId: 'run-1', pipelineId: 'p-1', status: 'running' } },
      { applicationData: { runId: 'run-2', pipelineId: 'p-2', status: 'pending' } },
    ]);

    // The interface types listActiveRuns() as `T[] | Promise<T[]>` for
    // bridge implementations that prefer async; createBridge returns sync.
    // Cast to the array branch for indexing.
    const out = bridge(mod).listActiveRuns!() as PipelineRunSnapshot[];
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ runId: 'run-1', pipelineId: 'p-1' });
    expect(out[1]).toMatchObject({ runId: 'run-2', pipelineId: 'p-2' });
  });

  test('skips resources without a valid run snapshot inside applicationData', () => {
    const mod = makeMockModule();
    mod.listActiveRuns.mockReturnValue([
      { applicationData: { runId: 'run-1', pipelineId: 'p-1', status: 'running' } },
      { applicationData: undefined },
      { applicationData: { pipelineId: 'p-x' } }, // missing runId
      {},
    ]);

    const out = bridge(mod).listActiveRuns!() as PipelineRunSnapshot[];
    expect(out).toHaveLength(1);
    expect(out[0].runId).toBe('run-1');
  });

  test('returns [] when no resources are in flight', () => {
    const mod = makeMockModule();
    mod.listActiveRuns.mockReturnValue([]);
    expect(bridge(mod).listActiveRuns!()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// cancelRun() / resolveApproval() — fire-and-forget pass-through
// ---------------------------------------------------------------------------

describe('createBridge — cancelRun() / resolveApproval()', () => {
  test('cancelRun forwards the runId verbatim', () => {
    const mod = makeMockModule();
    bridge(mod).cancelRun!('run-abc', 'u-1');
    expect(mod.cancelRun).toHaveBeenCalledWith('run-abc');
  });

  test('resolveApproval forwards all five arguments', async () => {
    const mod = makeMockModule();
    await bridge(mod).resolveApproval('run-1', 'step-2', 'u-3', 'approve', 'looks good');
    expect(mod.resolveApproval).toHaveBeenCalledWith('run-1', 'step-2', 'u-3', 'approve', 'looks good');
  });

  test('resolveApproval works without an optional comment', async () => {
    const mod = makeMockModule();
    await bridge(mod).resolveApproval('run-1', 'step-2', 'u-3', 'reject');
    expect(mod.resolveApproval).toHaveBeenCalledWith('run-1', 'step-2', 'u-3', 'reject', undefined);
  });
});

// ---------------------------------------------------------------------------
// getPendingApprovals() — pass-through with shape cast
// ---------------------------------------------------------------------------

describe('createBridge — getPendingApprovals()', () => {
  test('returns the rows as PendingApprovalRow[]', () => {
    const mod = makeMockModule();
    const row = {
      runId: 'r1',
      stepId: 's1',
      pipelineId: 'p1',
      approvers: [{ userId: 'u1', role: 'reviewer' }],
      message: 'please review',
      requestedAt: '2026-04-26T00:00:00Z',
    };
    mod.getPendingApprovals.mockReturnValue([row]);

    const out = bridge(mod).getPendingApprovals!() as PendingApprovalRow[];
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject(row);
  });

  test('returns [] when no approvals are pending', () => {
    const mod = makeMockModule();
    mod.getPendingApprovals.mockReturnValue([]);
    expect(bridge(mod).getPendingApprovals!()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// getMetrics() — full pass-through of dashboard fields
// ---------------------------------------------------------------------------

describe('createBridge — getMetrics()', () => {
  test('forwards every dashboard field the module exposes', async () => {
    const mod = makeMockModule();
    mod.getMetrics.mockResolvedValue({
      moduleId: 'pipeline-x',
      runsStarted: 100,
      runsCompleted: 80,
      runsFailed: 5,
      runsActive: 12,
      runsAwaitingApproval: 7,
      avgDurationMs: 8200,
      llmTokensIn: 250_000,
      llmTokensOut: 90_000,
      avgFirstTokenLatencyMs: 420,
      asOf: '2026-04-28T12:00:00.000Z',
      activeRuns: 3, // unrelated extra — fine to ignore (route projects fields)
    });

    const out = await bridge(mod).getMetrics!();
    expect(out).toEqual({
      runsStarted: 100,
      runsCompleted: 80,
      runsFailed: 5,
      runsActive: 12,
      runsAwaitingApproval: 7,
      avgDurationMs: 8200,
      llmTokensIn: 250_000,
      llmTokensOut: 90_000,
      avgFirstTokenLatencyMs: 420,
      asOf: '2026-04-28T12:00:00.000Z',
    });
  });

  test('omits fields the module does not expose (older versions)', async () => {
    const mod = makeMockModule();
    mod.getMetrics.mockResolvedValue({ runsAwaitingApproval: 7 });

    const out = await bridge(mod).getMetrics!();
    // Legacy contract: a module that only exposes runsAwaitingApproval still
    // produces a usable bridge result. Other fields stay absent (route → null).
    expect(out).toEqual({ runsAwaitingApproval: 7 });
  });

  test('coerces missing runsAwaitingApproval to 0 (legacy callers depend on this)', async () => {
    const mod = makeMockModule();
    mod.getMetrics.mockResolvedValue({});

    const out = await bridge(mod).getMetrics!();
    expect(out).toEqual({ runsAwaitingApproval: 0 });
  });

  test('drops non-finite numerics rather than salvaging them', async () => {
    const mod = makeMockModule();
    mod.getMetrics.mockResolvedValue({
      runsAwaitingApproval: '5', // string — not silently parsed
      runsStarted: Number.NaN,
      runsCompleted: Number.POSITIVE_INFINITY,
      avgFirstTokenLatencyMs: 'fast', // garbage — dropped, not parsed
    });

    const out = await bridge(mod).getMetrics!();
    // String runsAwaitingApproval coerces to 0 (legacy), other garbage drops.
    expect(out).toEqual({ runsAwaitingApproval: 0 });
  });
});
