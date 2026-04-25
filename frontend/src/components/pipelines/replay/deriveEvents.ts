// frontend/src/components/pipelines/replay/deriveEvents.ts
//
// Phase 1 event-timeline derivation for persisted pipeline runs.
//
// A stored `PipelineRun` is a post-hoc snapshot of an execution: we have the
// full `steps` map with timings, outputs, LLM metadata, and approval records
// but we do NOT have the original wire-event stream that drove the canvas in
// real time. This module reconstructs a best-effort `PipelineWireEvent[]`
// timeline from that snapshot so the replay scrubber can feed it back into
// `EventStreamContext.dispatchEnvelope` and re-animate the canvas.
//
// Phase 5 will replace this with a true WAL replay from distributed-core's
// EventBus — derivation is lossy (token cadence is synthetic, intra-step
// ordering between approvals is approximated by `ApprovalRecord.at`) and is
// only a stand-in until the write-ahead log ships.
//
// Output invariants:
//   - Events are ordered by their historical `emittedAt` (ascending).
//   - `seq` is monotonically assigned from 0 in the same order.
//   - `sourceNodeId` is the sentinel string `'replay'`.
//   - Run-scoped events (`pipeline.run.*`) bracket the per-step events.
//   - Per-step emission order is: started → llm.prompt → llm.token(s) →
//     llm.response → approval.requested → approval.recorded(s) → terminal.

import type {
  ApprovalNodeData,
  NodeType,
  PipelineEventMap,
  PipelineRun,
  PipelineWireEvent,
  StepExecution,
} from '../../../types/pipeline';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const REPLAY_SOURCE_NODE_ID = 'replay';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Parse an ISO timestamp to an epoch-ms number, falling back to the supplied
 * default if the string is missing or unparseable. Timeline derivation should
 * never throw on malformed run history — the replay strip just degrades to a
 * less accurate cadence.
 */
function parseTs(iso: string | undefined, fallbackMs: number): number {
  if (!iso) return fallbackMs;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : fallbackMs;
}

/**
 * Best-effort classification of a StepExecution's originating node type when
 * we don't have the pipeline definition handy. Used only to populate the
 * `nodeType` field on `pipeline.step.started` events — the canvas does not
 * rely on it for layout, only for filter / glyph purposes.
 */
function inferNodeType(step: StepExecution): NodeType {
  if (step.llm) return 'llm';
  if (step.approvals) return 'approval';
  return 'action';
}

/**
 * Split an LLM response into synthetic "tokens". We keep the splitter dumb
 * and deterministic — words and trailing punctuation are each one token.
 * Phase 5 (WAL replay) will emit the real token stream verbatim.
 */
function synthesizeTokens(response: string): string[] {
  if (!response) return [];
  // Match word runs and punctuation separately, then re-attach whitespace so
  // concatenating all tokens reconstructs the original string verbatim.
  const matches = response.match(/\s*\S+/g);
  return matches ?? [];
}

/**
 * Map a terminal `StepStatus` to the event key the executor would have
 * emitted. Non-terminal statuses (pending / running / awaiting) yield `null`
 * — the timeline skips the terminal event in that case (e.g. a run halted
 * mid-step leaves the step as `running`).
 */
function stepTerminalEventType(
  step: StepExecution,
): keyof PipelineEventMap | null {
  switch (step.status) {
    case 'completed':
      return 'pipeline.step.completed';
    case 'failed':
      return 'pipeline.step.failed';
    case 'skipped':
      return 'pipeline.step.skipped';
    case 'cancelled':
      return 'pipeline.step.cancelled';
    default:
      return null;
  }
}

/**
 * Map a terminal `RunStatus` to the corresponding run-level event key.
 * Non-terminal run statuses yield `null` so we don't fabricate completions.
 */
function runTerminalEventType(
  run: PipelineRun,
): keyof PipelineEventMap | null {
  switch (run.status) {
    case 'completed':
      return 'pipeline.run.completed';
    case 'failed':
      return 'pipeline.run.failed';
    case 'cancelled':
      return 'pipeline.run.cancelled';
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Reconstructs the event sequence for a (typically completed) pipeline run by
 * walking its stored `steps` map. The output is ordered by event timestamp,
 * with `seq` numbers assigned monotonically from 0 and `sourceNodeId` set to
 * `'replay'`. See module header for invariants and Phase-5 migration notes.
 */
export function deriveEventsFromRun(
  run: PipelineRun,
): PipelineWireEvent[] {
  // Raw (unsequenced) entries accumulate here, then get a final pass to
  // assign monotonic `seq` numbers after the ordering is locked in.
  type RawEntry = {
    eventType: keyof PipelineEventMap;
    payload: PipelineEventMap[keyof PipelineEventMap];
    emittedAt: number;
  };
  const raw: RawEntry[] = [];

  const runStartMs = parseTs(run.startedAt, Date.now());

  // ── Run start ─────────────────────────────────────────────────────────
  raw.push({
    eventType: 'pipeline.run.started',
    payload: {
      runId: run.id,
      pipelineId: run.pipelineId,
      triggeredBy: run.triggeredBy,
      at: run.startedAt,
    },
    emittedAt: runStartMs,
  });

  // ── Per-step events (sorted chronologically) ──────────────────────────
  const steps = Object.values(run.steps).slice().sort((a, b) => {
    const ta = parseTs(a.startedAt, runStartMs);
    const tb = parseTs(b.startedAt, runStartMs);
    return ta - tb;
  });

  for (const step of steps) {
    const stepStartMs = parseTs(step.startedAt, runStartMs);
    const stepEndMs = parseTs(step.completedAt, stepStartMs);
    const startedAtIso = step.startedAt ?? run.startedAt;
    const completedAtIso = step.completedAt ?? startedAtIso;

    // step.started
    raw.push({
      eventType: 'pipeline.step.started',
      payload: {
        runId: run.id,
        stepId: step.nodeId,
        nodeType: inferNodeType(step),
        at: startedAtIso,
      },
      emittedAt: stepStartMs,
    });

    // LLM — prompt, tokens, response
    if (step.llm) {
      // The prompt lands immediately after the step starts.
      raw.push({
        eventType: 'pipeline.llm.prompt',
        payload: {
          runId: run.id,
          stepId: step.nodeId,
          model: '',
          prompt: step.llm.prompt,
          at: startedAtIso,
        },
        emittedAt: stepStartMs,
      });

      // Tokens are spaced evenly across the step's wall-clock window so the
      // scrubber can see them as distinct timeline ticks.
      const tokens = synthesizeTokens(step.llm.response);
      if (tokens.length > 0) {
        const span = Math.max(1, stepEndMs - stepStartMs);
        const step_ms = span / (tokens.length + 1);
        for (let i = 0; i < tokens.length; i++) {
          const tMs = stepStartMs + step_ms * (i + 1);
          raw.push({
            eventType: 'pipeline.llm.token',
            payload: {
              runId: run.id,
              stepId: step.nodeId,
              token: tokens[i],
              at: new Date(tMs).toISOString(),
            },
            emittedAt: tMs,
          });
        }
      }

      // Response lands right before the terminal step event.
      raw.push({
        eventType: 'pipeline.llm.response',
        payload: {
          runId: run.id,
          stepId: step.nodeId,
          response: step.llm.response,
          tokensIn: step.llm.tokensIn,
          tokensOut: step.llm.tokensOut,
          at: completedAtIso,
        },
        emittedAt: stepEndMs,
      });
    }

    // Approval — requested, then recorded per ApprovalRecord
    if (step.approvals) {
      // We don't persist the original approver list — synthesize one by
      // echoing every userId seen in the records. The canvas only uses this
      // for badge counts, not identity, so `type: 'user'` is sufficient.
      const approvers: ApprovalNodeData['approvers'] = step.approvals.map(
        (a) => ({ type: 'user', value: a.userId }),
      );
      raw.push({
        eventType: 'pipeline.approval.requested',
        payload: {
          runId: run.id,
          stepId: step.nodeId,
          approvers,
          at: startedAtIso,
        },
        emittedAt: stepStartMs,
      });

      for (const record of step.approvals) {
        const recordMs = parseTs(record.at, stepStartMs);
        raw.push({
          eventType: 'pipeline.approval.recorded',
          payload: {
            runId: run.id,
            stepId: step.nodeId,
            userId: record.userId,
            decision: record.decision,
            at: record.at,
          },
          emittedAt: recordMs,
        });
      }
    }

    // Terminal step event
    const terminalType = stepTerminalEventType(step);
    if (terminalType === 'pipeline.step.completed') {
      raw.push({
        eventType: terminalType,
        payload: {
          runId: run.id,
          stepId: step.nodeId,
          durationMs: step.durationMs ?? Math.max(0, stepEndMs - stepStartMs),
          output: step.output,
          at: completedAtIso,
        },
        emittedAt: stepEndMs,
      });
    } else if (terminalType === 'pipeline.step.failed') {
      raw.push({
        eventType: terminalType,
        payload: {
          runId: run.id,
          stepId: step.nodeId,
          error: step.error ?? 'unknown',
          at: completedAtIso,
        },
        emittedAt: stepEndMs,
      });
    } else if (terminalType === 'pipeline.step.skipped') {
      raw.push({
        eventType: terminalType,
        payload: {
          runId: run.id,
          stepId: step.nodeId,
          reason: step.error ?? 'skipped',
          at: completedAtIso,
        },
        emittedAt: stepEndMs,
      });
    } else if (terminalType === 'pipeline.step.cancelled') {
      raw.push({
        eventType: terminalType,
        payload: {
          runId: run.id,
          stepId: step.nodeId,
          at: completedAtIso,
        },
        emittedAt: stepEndMs,
      });
    }
  }

  // ── Terminal run event ────────────────────────────────────────────────
  const runEndMs = parseTs(run.completedAt, runStartMs);
  const runEndIso = run.completedAt ?? run.startedAt;
  const runTerminal = runTerminalEventType(run);
  if (runTerminal === 'pipeline.run.completed') {
    raw.push({
      eventType: runTerminal,
      payload: {
        runId: run.id,
        durationMs: run.durationMs ?? Math.max(0, runEndMs - runStartMs),
        at: runEndIso,
      },
      emittedAt: runEndMs,
    });
  } else if (runTerminal === 'pipeline.run.failed') {
    raw.push({
      eventType: runTerminal,
      payload: {
        runId: run.id,
        error:
          run.error ?? {
            nodeId: '',
            message: 'unknown',
          },
        at: runEndIso,
      },
      emittedAt: runEndMs,
    });
  } else if (runTerminal === 'pipeline.run.cancelled') {
    raw.push({
      eventType: runTerminal,
      payload: {
        runId: run.id,
        at: runEndIso,
      },
      emittedAt: runEndMs,
    });
  }

  // ── Final ordering + seq assignment ───────────────────────────────────
  // Stable sort on emittedAt. Events with identical timestamps retain their
  // insertion order — that's what gives us the per-step phase ordering
  // (started → llm.prompt → tokens → ... → terminal) even when a step is
  // effectively instantaneous.
  const indexed = raw.map((r, idx) => ({ r, idx }));
  indexed.sort((a, b) => {
    if (a.r.emittedAt !== b.r.emittedAt) return a.r.emittedAt - b.r.emittedAt;
    return a.idx - b.idx;
  });

  return indexed.map(({ r }, seq) => ({
    eventType: r.eventType,
    payload: r.payload,
    seq,
    sourceNodeId: REPLAY_SOURCE_NODE_ID,
    emittedAt: r.emittedAt,
  })) as PipelineWireEvent[];
}
