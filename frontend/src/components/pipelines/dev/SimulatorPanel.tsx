// frontend/src/components/pipelines/dev/SimulatorPanel.tsx
//
// Dev-only simulator panel. Lets a developer pick a `PipelineEventMap` event
// type, tweak a JSON payload (pre-filled with a skeleton for that event), set
// an optional `seq`, and fire it at the gateway's `pipelineEventSource` via
// the `{ service: 'pipeline', action: 'sim-emit' }` frame. Requires
// `DCORE_ENABLE_TEST_EMIT=1` on the gateway process.
//
// Renders only in Vite dev mode (`import.meta.env.DEV === true`); callers
// must gate mounting on the same check so this module is tree-shaken from
// production builds.
//
// See PIPELINES_PLAN.md §14 (WebSocket protocol) for the full frame format.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Modal from '../../shared/Modal';
import { useToast } from '../../shared/ToastProvider';
import { useWebSocketContext } from '../../../contexts/WebSocketContext';
import type { GatewayMessage } from '../../../types/gateway';
import type { PipelineEventMap } from '../../../types/pipeline';

// ---------------------------------------------------------------------------
// Event catalog — kept as a string-literal tuple so `EventKey` stays in sync
// with the runtime <select> options. If PipelineEventMap grows a new key,
// TypeScript will flag the missing entry when the tuple is re-checked against
// `keyof PipelineEventMap` via the `_ExhaustiveCheck` assertion below.
// ---------------------------------------------------------------------------

const EVENT_TYPES = [
  // Run lifecycle
  'pipeline.run.started',
  'pipeline.run.completed',
  'pipeline.run.failed',
  'pipeline.run.cancelled',
  // Distribution events
  'pipeline.run.orphaned',
  'pipeline.run.reassigned',
  // Step lifecycle
  'pipeline.step.started',
  'pipeline.step.completed',
  'pipeline.step.failed',
  'pipeline.step.skipped',
  'pipeline.step.cancelled',
  // LLM streaming
  'pipeline.llm.prompt',
  'pipeline.llm.token',
  'pipeline.llm.response',
  // Approval
  'pipeline.approval.requested',
  'pipeline.approval.recorded',
  // Pause / resume / retry
  'pipeline.run.paused',
  'pipeline.run.resumed',
  'pipeline.run.resumeFromStep',
  'pipeline.run.retry',
  // External webhook (Phase 4 producer)
  'pipeline.webhook.triggered',
  // Join bookkeeping
  'pipeline.join.waiting',
  'pipeline.join.fired',
] as const satisfies ReadonlyArray<keyof PipelineEventMap>;

type EventKey = (typeof EVENT_TYPES)[number];

// Compile-time assertion: EVENT_TYPES must cover every key of the event map.
// If a new key is added to PipelineEventMap without updating the array, the
// generic default below stops resolving to `never`, the `extends never`
// constraint fails, and this exported type surfaces the error.
export type AssertEventTypesExhaustive<
  T extends never = Exclude<keyof PipelineEventMap, EventKey>,
> = T;

// ---------------------------------------------------------------------------
// Recent-fires history
// ---------------------------------------------------------------------------
//
// We persist to sessionStorage (not localStorage) because this is a
// per-debugging-session tool: a dev typically wants their replay buffer to
// survive a hot reload, but a fresh tab should start clean. sessionStorage
// gives us exactly that, matching how SourceDiagnosticBanner persists its
// dismissal flag.

const HISTORY_STORAGE_KEY = 'pipeline-sim-history';
const HISTORY_CAP = 20;

export interface SimHistoryEntry {
  eventType: EventKey;
  /** Raw payload string (kept verbatim so re-fire restores the exact JSON the dev sent). */
  payload: string;
  seq: string;
  /** Wall-clock ms epoch when the emit was queued. */
  ts: number;
}

function readHistory(): SimHistoryEntry[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.sessionStorage.getItem(HISTORY_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Defensive filter: drop entries whose eventType is no longer a valid key
    // (e.g. PipelineEventMap shrank between sessions). Keeps TS happy and
    // prevents stale rows from surviving a refactor.
    const valid = parsed.filter(
      (e): e is SimHistoryEntry =>
        e &&
        typeof e === 'object' &&
        typeof (e as { eventType?: unknown }).eventType === 'string' &&
        (EVENT_TYPES as readonly string[]).includes((e as { eventType: string }).eventType) &&
        typeof (e as { payload?: unknown }).payload === 'string' &&
        typeof (e as { seq?: unknown }).seq === 'string' &&
        typeof (e as { ts?: unknown }).ts === 'number',
    );
    return valid.slice(0, HISTORY_CAP);
  } catch {
    return [];
  }
}

function persistHistory(entries: SimHistoryEntry[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // sessionStorage unavailable (private mode, quota): silently ignore.
  }
}

function formatRelative(now: number, ts: number): string {
  const deltaMs = Math.max(0, now - ts);
  const sec = Math.floor(deltaMs / 1000);
  if (sec < 5) return 'just now';
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  return `${day}d ago`;
}

// ---------------------------------------------------------------------------
// Payload skeletons — pre-filled JSON shown in the textarea when the user
// picks an event type. Values are illustrative placeholders a dev can tweak.
// ---------------------------------------------------------------------------

function isoNow(): string {
  return new Date().toISOString();
}

function skeletonFor(eventType: EventKey): Record<string, unknown> {
  switch (eventType) {
    case 'pipeline.run.started':
      return { runId: 'run-sim-1', pipelineId: 'pipeline-1', triggeredBy: { kind: 'manual', userId: 'dev' }, at: isoNow() };
    case 'pipeline.run.completed':
      return { runId: 'run-sim-1', durationMs: 1234, at: isoNow() };
    case 'pipeline.run.failed':
      return { runId: 'run-sim-1', error: { nodeId: 'step-1', message: 'simulated failure' }, at: isoNow() };
    case 'pipeline.run.cancelled':
      return { runId: 'run-sim-1', at: isoNow() };
    case 'pipeline.run.orphaned':
      return { runId: 'run-sim-1', previousOwner: 'node-a', at: isoNow() };
    case 'pipeline.run.reassigned':
      return { runId: 'run-sim-1', from: 'node-a', to: 'node-b', at: isoNow() };
    case 'pipeline.step.started':
      return { runId: 'run-sim-1', stepId: 'step-1', nodeType: 'llm', at: isoNow() };
    case 'pipeline.step.completed':
      return { runId: 'run-sim-1', stepId: 'step-1', durationMs: 320, output: null, at: isoNow() };
    case 'pipeline.step.failed':
      return { runId: 'run-sim-1', stepId: 'step-1', error: 'simulated step failure', at: isoNow() };
    case 'pipeline.step.skipped':
      return { runId: 'run-sim-1', stepId: 'step-1', reason: 'condition false', at: isoNow() };
    case 'pipeline.step.cancelled':
      return { runId: 'run-sim-1', stepId: 'step-1', at: isoNow() };
    case 'pipeline.llm.prompt':
      return { runId: 'run-sim-1', stepId: 'step-1', model: 'claude-opus-4', prompt: 'Hello', at: isoNow() };
    case 'pipeline.llm.token':
      return { runId: 'run-sim-1', stepId: 'step-1', token: 'Hi', at: isoNow() };
    case 'pipeline.llm.response':
      return { runId: 'run-sim-1', stepId: 'step-1', response: 'Hi there', tokensIn: 10, tokensOut: 4, at: isoNow() };
    case 'pipeline.approval.requested':
      return { runId: 'run-sim-1', stepId: 'step-1', approvers: [{ userId: 'dev' }], at: isoNow() };
    case 'pipeline.approval.recorded':
      return { runId: 'run-sim-1', stepId: 'step-1', userId: 'dev', decision: 'approve', at: isoNow() };
    case 'pipeline.run.paused':
      return { runId: 'run-sim-1', atStepIds: ['step-1'], at: isoNow() };
    case 'pipeline.run.resumed':
      return { runId: 'run-sim-1', at: isoNow() };
    case 'pipeline.run.resumeFromStep':
      return { runId: 'run-sim-1', fromNodeId: 'step-1', at: isoNow() };
    case 'pipeline.run.retry':
      return { newRunId: 'run-sim-2', previousRunId: 'run-sim-1', at: isoNow() };
    case 'pipeline.webhook.triggered':
      return { webhookPath: '/example', body: { hello: 'world' }, headers: { 'x-source': 'curl' }, at: isoNow() };
    case 'pipeline.join.waiting':
      return { runId: 'run-sim-1', stepId: 'join-1', received: 1, required: 2, at: isoNow() };
    case 'pipeline.join.fired':
      return { runId: 'run-sim-1', stepId: 'join-1', inputs: ['step-1', 'step-2'], at: isoNow() };
    default: {
      // Should be unreachable thanks to the exhaustive check above.
      const _never: never = eventType;
      return _never;
    }
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export interface SimulatorPanelProps {
  open: boolean;
  onClose: () => void;
}

export default function SimulatorPanel({ open, onClose }: SimulatorPanelProps) {
  // Guard at render time — callers should also gate mounting, but this makes
  // the component itself safe to import unconditionally without shipping UI
  // in production builds.
  if (!import.meta.env.DEV) return null;

  return <SimulatorPanelInner open={open} onClose={onClose} />;
}

function SimulatorPanelInner({ open, onClose }: SimulatorPanelProps) {
  const { sendMessage, onMessage } = useWebSocketContext();
  const { toast } = useToast();

  const [eventType, setEventType] = useState<EventKey>('pipeline.run.started');
  const [payloadText, setPayloadText] = useState<string>(() =>
    JSON.stringify(skeletonFor('pipeline.run.started'), null, 2),
  );
  const [seq, setSeq] = useState<string>('0');
  const [pendingCorrelationId, setPendingCorrelationId] = useState<string | null>(null);
  const [history, setHistory] = useState<SimHistoryEntry[]>(() => readHistory());

  /**
   * Holds the entry that's been queued (sent over the wire) but not yet
   * acknowledged. We append to history only after the gateway acks the
   * frame so a malformed/rejected emit doesn't pollute the replay list.
   */
  const pendingEntryRef = useRef<SimHistoryEntry | null>(null);

  // Tick once a minute so the "Xm ago" labels age without us caring about
  // the absolute time. A single number suffices — the render below derives
  // every row's relative label from `now` independently.
  const [now, setNow] = useState<number>(() => Date.now());
  useEffect(() => {
    if (!open) return undefined;
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, [open]);

  // Persist any history mutation. Cheap (small array, small string) and runs
  // synchronously enough that a refresh right after a fire keeps the row.
  useEffect(() => {
    persistHistory(history);
  }, [history]);

  // Re-populate the textarea whenever the event type changes.
  const handleEventTypeChange = useCallback((next: EventKey) => {
    setEventType(next);
    setPayloadText(JSON.stringify(skeletonFor(next), null, 2));
  }, []);

  // Listen for ack/error frames keyed to our correlationId. Toasts on match.
  useEffect(() => {
    if (!pendingCorrelationId) return undefined;
    const unsub = onMessage((msg: GatewayMessage) => {
      if (msg.correlationId !== pendingCorrelationId) return;
      if (msg.type === 'pipeline:ack' && msg.action === 'sim-emit') {
        toast('Event emitted', { type: 'success', durationMs: 1500 });
        // Promote the queued entry into history (most-recent first, capped).
        const entry = pendingEntryRef.current;
        if (entry) {
          setHistory((prev) => [entry, ...prev].slice(0, HISTORY_CAP));
        }
        pendingEntryRef.current = null;
        setPendingCorrelationId(null);
      } else if (msg.type === 'error' && msg.service === 'pipeline') {
        const errMsg = typeof msg.message === 'string' ? msg.message : 'sim-emit failed';
        toast(`sim-emit: ${errMsg}`, { type: 'error' });
        pendingEntryRef.current = null;
        setPendingCorrelationId(null);
      }
    });
    return unsub;
  }, [pendingCorrelationId, onMessage, toast]);

  const handleEmit = useCallback(() => {
    let payload: unknown;
    try {
      payload = JSON.parse(payloadText);
    } catch (err) {
      toast(`Invalid JSON: ${(err as Error).message}`, { type: 'error' });
      return;
    }

    const parsedSeq = Number.parseInt(seq, 10);
    const correlationId = `sim-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

    sendMessage({
      service: 'pipeline',
      action: 'sim-emit',
      eventType,
      payload,
      seq: Number.isFinite(parsedSeq) ? parsedSeq : 0,
      correlationId,
    });
    pendingEntryRef.current = {
      eventType,
      payload: payloadText,
      seq,
      ts: Date.now(),
    };
    setPendingCorrelationId(correlationId);
  }, [payloadText, seq, eventType, sendMessage, toast]);

  // Re-fire: hydrate the form from a history row so the dev can inspect or
  // tweak before re-sending. We deliberately do NOT auto-fire — the brief
  // calls that out as a guardrail. We also do NOT auto-bump seq (the seq
  // input is a manual field today, not an auto-incrementing counter), so
  // re-fire restores the original seq verbatim; bumping is the dev's call.
  const handleRefire = useCallback((entry: SimHistoryEntry) => {
    setEventType(entry.eventType);
    setPayloadText(entry.payload);
    setSeq(entry.seq);
  }, []);

  const handleClearHistory = useCallback(() => {
    setHistory([]);
  }, []);

  const eventOptions = useMemo(
    () =>
      EVENT_TYPES.map((t) => (
        <option key={t} value={t}>
          {t}
        </option>
      )),
    [],
  );

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Pipeline event simulator"
      maxWidth={560}
      backdropTestId="sim-panel-backdrop"
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: '6px 12px',
              fontSize: 13,
              background: 'none',
              border: 'none',
              color: '#64748b',
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            Close
          </button>
          <button
            type="button"
            onClick={handleEmit}
            data-testid="sim-emit-button"
            style={{
              padding: '7px 16px',
              fontSize: 13,
              fontWeight: 600,
              background: '#2563eb',
              color: '#fff',
              border: 'none',
              borderRadius: 7,
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            ▶ Emit
          </button>
        </>
      }
    >
      <div
        style={{
          fontSize: 12,
          color: '#92400e',
          background: '#fef3c7',
          border: '1px solid #fde68a',
          borderRadius: 6,
          padding: '8px 10px',
          marginBottom: 14,
          lineHeight: 1.45,
        }}
      >
        Dev only — requires <code>DCORE_ENABLE_TEST_EMIT=1</code> on the
        gateway. Emits fake events onto the pipelineEventSource to exercise
        the frontend without a real pipeline executor.
      </div>

      <label
        style={{
          display: 'block',
          fontSize: 12,
          fontWeight: 600,
          color: '#334155',
          marginBottom: 4,
        }}
      >
        Event type
      </label>
      <select
        data-testid="sim-event-type"
        value={eventType}
        onChange={(e) => handleEventTypeChange(e.target.value as EventKey)}
        style={{
          width: '100%',
          padding: '7px 8px',
          fontSize: 13,
          borderRadius: 6,
          border: '1px solid #cbd5e1',
          background: '#fff',
          fontFamily: 'inherit',
          marginBottom: 12,
        }}
      >
        {eventOptions}
      </select>

      <label
        style={{
          display: 'block',
          fontSize: 12,
          fontWeight: 600,
          color: '#334155',
          marginBottom: 4,
        }}
      >
        Payload (JSON)
      </label>
      <textarea
        data-testid="sim-payload"
        value={payloadText}
        onChange={(e) => setPayloadText(e.target.value)}
        spellCheck={false}
        rows={12}
        style={{
          width: '100%',
          padding: 8,
          fontSize: 12,
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          borderRadius: 6,
          border: '1px solid #cbd5e1',
          resize: 'vertical',
          marginBottom: 12,
          boxSizing: 'border-box',
        }}
      />

      <label
        style={{
          display: 'block',
          fontSize: 12,
          fontWeight: 600,
          color: '#334155',
          marginBottom: 4,
        }}
      >
        Seq (optional)
      </label>
      <input
        data-testid="sim-seq"
        type="number"
        value={seq}
        onChange={(e) => setSeq(e.target.value)}
        style={{
          width: 120,
          padding: '6px 8px',
          fontSize: 13,
          borderRadius: 6,
          border: '1px solid #cbd5e1',
          fontFamily: 'inherit',
        }}
      />

      {history.length > 0 && (
        <div data-testid="sim-history" style={{ marginTop: 16 }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: 6,
            }}
          >
            <span
              style={{
                fontSize: 12,
                fontWeight: 600,
                color: '#334155',
              }}
            >
              Recent fires ({history.length})
            </span>
            <button
              type="button"
              data-testid="sim-history-clear"
              onClick={handleClearHistory}
              style={{
                fontSize: 11,
                background: 'none',
                border: 'none',
                color: '#64748b',
                cursor: 'pointer',
                padding: 0,
                textDecoration: 'underline',
                fontFamily: 'inherit',
              }}
            >
              Clear history
            </button>
          </div>
          {/*
            Inner scroll container so a long history (up to 20 rows) doesn't
            push the modal taller than the viewport. The Modal shell itself
            has no overflow handling, so we cap height here.
          */}
          <ul
            style={{
              listStyle: 'none',
              margin: 0,
              padding: 0,
              maxHeight: 180,
              overflowY: 'auto',
              border: '1px solid #e2e8f0',
              borderRadius: 6,
              background: '#f8fafc',
            }}
          >
            {history.map((entry, idx) => (
              <li
                key={`${entry.ts}-${idx}`}
                data-testid="sim-history-row"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 8,
                  padding: '6px 8px',
                  borderBottom:
                    idx === history.length - 1 ? 'none' : '1px solid #e2e8f0',
                  fontSize: 12,
                }}
              >
                <span
                  style={{
                    color: '#94a3b8',
                    fontVariantNumeric: 'tabular-nums',
                    minWidth: 64,
                  }}
                >
                  {formatRelative(now, entry.ts)}
                </span>
                <span
                  style={{
                    flex: 1,
                    color: '#0f172a',
                    fontFamily:
                      'ui-monospace, SFMono-Regular, Menlo, monospace',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                  title={entry.eventType}
                >
                  {entry.eventType}
                </span>
                <button
                  type="button"
                  data-testid="sim-history-refire"
                  onClick={() => handleRefire(entry)}
                  style={{
                    fontSize: 11,
                    padding: '3px 8px',
                    background: '#fff',
                    border: '1px solid #cbd5e1',
                    borderRadius: 4,
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                    color: '#334155',
                  }}
                >
                  ↻ re-fire
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Modal>
  );
}
