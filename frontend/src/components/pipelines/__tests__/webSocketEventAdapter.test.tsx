// frontend/src/components/pipelines/__tests__/webSocketEventAdapter.test.tsx
//
// Unit coverage for the Phase 4 `useWebSocketPipelineEvents` adapter.
// Exercises enable/disable gating, connection-state gating, subscribe &
// unsubscribe frames, message decoding + sentinel defaults, and reconnect
// behaviour on channel change.
//
// Framework: Vitest + @testing-library/react.

import React from 'react';
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, act } from '@testing-library/react';
import type {
  ConnectionState,
  GatewayMessage,
} from '../../../types/gateway';

// ---------------------------------------------------------------------------
// Mock the WebSocketContext so we never touch the real provider tree. The
// mock exposes controllable sendMessage + onMessage stubs and a setter for
// connectionState so tests can re-render with different transport states.
// ---------------------------------------------------------------------------

type MessageHandler = (msg: GatewayMessage) => void;

const sendMessageSpy = vi.fn();
let currentConnectionState: ConnectionState = 'connected';
const handlers: MessageHandler[] = [];

function resetMockBus(): void {
  sendMessageSpy.mockReset();
  handlers.length = 0;
  currentConnectionState = 'connected';
}

function dispatch(msg: GatewayMessage): void {
  handlers.forEach((h) => h(msg));
}

// Stable onMessage so the effect's dep array doesn't change identity across
// renders — matches the real WebSocketContext, which exposes a memoized fn.
const onMessageStable = (handler: MessageHandler) => {
  handlers.push(handler);
  return () => {
    const idx = handlers.indexOf(handler);
    if (idx !== -1) handlers.splice(idx, 1);
  };
};

vi.mock('../../../contexts/WebSocketContext', () => ({
  useWebSocketContext: () => ({
    connectionState: currentConnectionState,
    sendMessage: sendMessageSpy,
    onMessage: onMessageStable,
    ws: null,
    clientId: 'test-client',
    sessionToken: 'test-session',
  }),
  WebSocketProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// Import after the mock is installed.
import {
  useWebSocketPipelineEvents,
  usePipelineRunChannelSubscription,
} from '../context/WebSocketEventAdapter';

// ---------------------------------------------------------------------------
// Thin host component so we can render and re-render with prop changes.
// ---------------------------------------------------------------------------

interface HarnessProps {
  channel?: string;
  enabled?: boolean;
  onEvent: Parameters<typeof useWebSocketPipelineEvents>[0]['onEvent'];
}

function Harness(props: HarnessProps) {
  useWebSocketPipelineEvents(props);
  return null;
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

beforeEach(() => {
  resetMockBus();
});

afterEach(() => {
  resetMockBus();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useWebSocketPipelineEvents', () => {
  test('is a no-op when enabled=false', () => {
    const onEvent = vi.fn();
    render(<Harness enabled={false} onEvent={onEvent} />);
    expect(sendMessageSpy).not.toHaveBeenCalled();
    expect(handlers).toHaveLength(0);
  });

  test('is a no-op when connectionState is not "connected"', () => {
    currentConnectionState = 'connecting';
    const onEvent = vi.fn();
    render(<Harness enabled onEvent={onEvent} />);
    expect(sendMessageSpy).not.toHaveBeenCalled();
    expect(handlers).toHaveLength(0);
  });

  test('sends a subscribe frame with the given channel when enabled + connected', () => {
    const onEvent = vi.fn();
    render(<Harness enabled channel="pipeline:run:123" onEvent={onEvent} />);

    expect(sendMessageSpy).toHaveBeenCalledWith({
      service: 'pipeline',
      action: 'subscribe',
      channel: 'pipeline:run:123',
    });
  });

  test('defaults to the pipeline:all channel', () => {
    const onEvent = vi.fn();
    render(<Harness enabled onEvent={onEvent} />);
    expect(sendMessageSpy).toHaveBeenCalledWith({
      service: 'pipeline',
      action: 'subscribe',
      channel: 'pipeline:all',
    });
  });

  test('relays pipeline:event messages through onEvent with a full envelope', () => {
    const onEvent = vi.fn();
    render(<Harness enabled onEvent={onEvent} />);

    const frame: GatewayMessage = {
      type: 'pipeline:event',
      eventType: 'pipeline.run.started',
      payload: {
        runId: 'run-1',
        pipelineId: 'pl-1',
        triggeredBy: { userId: 'u', triggerType: 'manual' },
        at: '2026-04-23T00:00:00.000Z',
      },
      seq: 5,
      sourceNodeId: 'node-a',
      emittedAt: 1_714_000_000_000,
    };

    act(() => {
      dispatch(frame);
    });

    expect(onEvent).toHaveBeenCalledTimes(1);
    expect(onEvent.mock.calls[0][0]).toEqual({
      eventType: 'pipeline.run.started',
      payload: frame.payload,
      seq: 5,
      sourceNodeId: 'node-a',
      emittedAt: 1_714_000_000_000,
    });
  });

  test('fills Phase 1 sentinel gaps when server frame omits seq/sourceNodeId/emittedAt', () => {
    const onEvent = vi.fn();
    render(<Harness enabled onEvent={onEvent} />);

    const before = Date.now();
    act(() => {
      dispatch({
        type: 'pipeline:event',
        eventType: 'pipeline.step.started',
        payload: {
          runId: 'r',
          stepId: 's',
          nodeType: 'transform',
          at: 'now',
        },
      } as GatewayMessage);
    });
    const after = Date.now();

    expect(onEvent).toHaveBeenCalledTimes(1);
    const env = onEvent.mock.calls[0][0];
    expect(env.seq).toBe(0);
    expect(env.sourceNodeId).toBe('unknown');
    expect(typeof env.emittedAt).toBe('number');
    expect(env.emittedAt).toBeGreaterThanOrEqual(before);
    expect(env.emittedAt).toBeLessThanOrEqual(after);
  });

  test('ignores non-pipeline:event traffic and frames missing eventType', () => {
    const onEvent = vi.fn();
    render(<Harness enabled onEvent={onEvent} />);

    act(() => {
      dispatch({ type: 'presence', action: 'joined' } as GatewayMessage);
      dispatch({ type: 'pipeline:event' } as GatewayMessage); // no eventType
    });

    expect(onEvent).not.toHaveBeenCalled();
  });

  test('sends unsubscribe on unmount', () => {
    const onEvent = vi.fn();
    const { unmount } = render(<Harness enabled channel="pipeline:all" onEvent={onEvent} />);

    sendMessageSpy.mockClear();
    unmount();

    expect(sendMessageSpy).toHaveBeenCalledWith({
      service: 'pipeline',
      action: 'unsubscribe',
      channel: 'pipeline:all',
    });
    expect(handlers).toHaveLength(0);
  });

  test('re-subscribes with the new channel when the channel prop changes', () => {
    const onEvent = vi.fn();
    const { rerender } = render(
      <Harness enabled channel="pipeline:all" onEvent={onEvent} />,
    );

    expect(sendMessageSpy).toHaveBeenLastCalledWith({
      service: 'pipeline',
      action: 'subscribe',
      channel: 'pipeline:all',
    });

    sendMessageSpy.mockClear();
    rerender(<Harness enabled channel="pipeline:run:new" onEvent={onEvent} />);

    // Expect an unsubscribe of the old channel + subscribe of the new one.
    const calls = sendMessageSpy.mock.calls.map((c) => c[0]);
    expect(calls).toContainEqual({
      service: 'pipeline',
      action: 'unsubscribe',
      channel: 'pipeline:all',
    });
    expect(calls).toContainEqual({
      service: 'pipeline',
      action: 'subscribe',
      channel: 'pipeline:run:new',
    });
  });

  test('does not re-subscribe on every render when onEvent is an inline closure', () => {
    // Render the same harness twice with a fresh onEvent reference each time.
    const { rerender } = render(<Harness enabled onEvent={() => {}} />);

    expect(sendMessageSpy).toHaveBeenCalledTimes(1); // subscribe

    sendMessageSpy.mockClear();
    rerender(<Harness enabled onEvent={() => {}} />);

    // No additional subscribe/unsubscribe just because onEvent identity changed.
    expect(sendMessageSpy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Per-run channel subscription helper
// ---------------------------------------------------------------------------

interface RunSubHarnessProps {
  runId: string | null;
  enabled?: boolean;
}

function RunSubHarness({ runId, enabled = true }: RunSubHarnessProps) {
  usePipelineRunChannelSubscription(runId, { enabled });
  return null;
}

describe('usePipelineRunChannelSubscription', () => {
  test('subscribes to the per-run channel on mount and unsubscribes on unmount', () => {
    const { unmount } = render(<RunSubHarness runId="run-123" />);

    expect(sendMessageSpy).toHaveBeenCalledWith({
      service: 'pipeline',
      action: 'subscribe',
      channel: 'pipeline:run:run-123',
    });

    sendMessageSpy.mockClear();
    unmount();

    expect(sendMessageSpy).toHaveBeenCalledWith({
      service: 'pipeline',
      action: 'unsubscribe',
      channel: 'pipeline:run:run-123',
    });
  });

  test('is a no-op when enabled=false', () => {
    render(<RunSubHarness runId="run-123" enabled={false} />);
    expect(sendMessageSpy).not.toHaveBeenCalled();
  });

  test('is a no-op when runId is null/empty', () => {
    render(<RunSubHarness runId={null} />);
    expect(sendMessageSpy).not.toHaveBeenCalled();
  });

  test('is a no-op when WS is not connected', () => {
    currentConnectionState = 'connecting';
    render(<RunSubHarness runId="run-123" />);
    expect(sendMessageSpy).not.toHaveBeenCalled();
  });

  test('re-subscribes when runId changes', () => {
    const { rerender } = render(<RunSubHarness runId="run-a" />);

    expect(sendMessageSpy).toHaveBeenLastCalledWith({
      service: 'pipeline',
      action: 'subscribe',
      channel: 'pipeline:run:run-a',
    });

    sendMessageSpy.mockClear();
    rerender(<RunSubHarness runId="run-b" />);

    const calls = sendMessageSpy.mock.calls.map((c) => c[0]);
    expect(calls).toContainEqual({
      service: 'pipeline',
      action: 'unsubscribe',
      channel: 'pipeline:run:run-a',
    });
    expect(calls).toContainEqual({
      service: 'pipeline',
      action: 'subscribe',
      channel: 'pipeline:run:run-b',
    });
  });
});
