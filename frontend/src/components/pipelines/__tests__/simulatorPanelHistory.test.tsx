// frontend/src/components/pipelines/__tests__/simulatorPanelHistory.test.tsx
//
// Covers the dev-only SimulatorPanel's "Recent fires" history list:
//   1. After two successful fires, both rows render most-recent-first.
//   2. Clicking "↻ re-fire" repopulates the form (event type + payload + seq)
//      from the stored history entry.
//
// We mock the WebSocketContext with a hand-rolled message bus so the test can
// drive `pipeline:ack` frames manually — the ack is what triggers the entry
// being committed into history (a malformed/rejected emit is intentionally
// NOT committed). ToastProvider is wrapped live since SimulatorPanel calls
// `useToast()` and stubbing it would defeat its own integration story.

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { GatewayMessage } from '../../../types/gateway';

// ── WebSocket bus shared between the mock module and the test ─────────────
type Listener = (msg: GatewayMessage) => void;
const listeners: Set<Listener> = new Set();
const sentMessages: Array<Record<string, unknown>> = [];

function emitFromGateway(msg: GatewayMessage): void {
  for (const l of listeners) l(msg);
}

vi.mock('../../../contexts/WebSocketContext', () => ({
  useWebSocketContext: () => ({
    connectionState: 'connected',
    sendMessage: (m: Record<string, unknown>) => {
      sentMessages.push(m);
    },
    onMessage: (fn: Listener) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    ws: null,
    clientId: 'test-user',
    sessionToken: 'test-session',
  }),
  WebSocketProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

// SUT and live ToastProvider — imported AFTER mocks so the mock applies.
import SimulatorPanel from '../dev/SimulatorPanel';
import { ToastProvider } from '../../shared/ToastProvider';

const HISTORY_KEY = 'pipeline-sim-history';

function renderPanel() {
  return render(
    <ToastProvider>
      <SimulatorPanel open={true} onClose={() => {}} />
    </ToastProvider>,
  );
}

/** Drive one full emit + ack roundtrip. Returns the correlationId we acked. */
function emitAndAck(): string {
  fireEvent.click(screen.getByTestId('sim-emit-button'));
  // The most-recent message is our outgoing sim-emit; pull its correlationId
  // and answer with the matching ack frame the panel listens for.
  const sent = sentMessages[sentMessages.length - 1];
  const correlationId = String(sent.correlationId);
  act(() => {
    emitFromGateway({
      type: 'pipeline:ack',
      action: 'sim-emit',
      correlationId,
    });
  });
  return correlationId;
}

describe('SimulatorPanel — recent fires history', () => {
  beforeEach(() => {
    listeners.clear();
    sentMessages.length = 0;
    window.sessionStorage.removeItem(HISTORY_KEY);
  });

  afterEach(() => {
    cleanup();
    window.sessionStorage.removeItem(HISTORY_KEY);
  });

  test('history is hidden until a successful fire lands', () => {
    renderPanel();
    expect(screen.queryByTestId('sim-history')).toBeNull();
  });

  test('two fires render two rows in most-recent-first order', () => {
    renderPanel();

    // First fire: default selection (pipeline.run.started).
    emitAndAck();

    // Second fire: switch event type so the two rows are distinguishable.
    fireEvent.change(screen.getByTestId('sim-event-type'), {
      target: { value: 'pipeline.step.failed' },
    });
    emitAndAck();

    const rows = screen.getAllByTestId('sim-history-row');
    expect(rows).toHaveLength(2);
    // Most-recent-first: the second fire (step.failed) is on top.
    expect(rows[0]).toHaveTextContent('pipeline.step.failed');
    expect(rows[1]).toHaveTextContent('pipeline.run.started');

    // sessionStorage mirrors the in-memory state.
    const persisted = JSON.parse(
      window.sessionStorage.getItem(HISTORY_KEY) ?? '[]',
    );
    expect(persisted).toHaveLength(2);
    expect(persisted[0].eventType).toBe('pipeline.step.failed');
    expect(persisted[1].eventType).toBe('pipeline.run.started');
  });

  test('re-fire button repopulates the form (event type, payload, seq)', () => {
    renderPanel();

    // Customize the form so we can prove re-fire restores these exact values.
    fireEvent.change(screen.getByTestId('sim-event-type'), {
      target: { value: 'pipeline.llm.token' },
    });
    const payloadEl = screen.getByTestId('sim-payload') as HTMLTextAreaElement;
    const customPayload = '{"runId":"run-xyz","stepId":"s-1","token":"hello"}';
    fireEvent.change(payloadEl, { target: { value: customPayload } });
    fireEvent.change(screen.getByTestId('sim-seq'), { target: { value: '42' } });

    emitAndAck();

    // Mutate the form so we can detect that re-fire actually wrote it back.
    fireEvent.change(screen.getByTestId('sim-event-type'), {
      target: { value: 'pipeline.run.cancelled' },
    });
    fireEvent.change(payloadEl, { target: { value: '{"different":true}' } });
    fireEvent.change(screen.getByTestId('sim-seq'), { target: { value: '0' } });

    // Click the row's re-fire button — exactly one row, exactly one button.
    fireEvent.click(screen.getByTestId('sim-history-refire'));

    expect((screen.getByTestId('sim-event-type') as HTMLSelectElement).value).toBe(
      'pipeline.llm.token',
    );
    expect((screen.getByTestId('sim-payload') as HTMLTextAreaElement).value).toBe(
      customPayload,
    );
    expect((screen.getByTestId('sim-seq') as HTMLInputElement).value).toBe('42');
  });

  test('clear-history empties the list and the storage entry', () => {
    renderPanel();
    emitAndAck();
    expect(screen.getAllByTestId('sim-history-row')).toHaveLength(1);

    fireEvent.click(screen.getByTestId('sim-history-clear'));
    expect(screen.queryByTestId('sim-history')).toBeNull();
    expect(window.sessionStorage.getItem(HISTORY_KEY)).toBe('[]');
  });
});
