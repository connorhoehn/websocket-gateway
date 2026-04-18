// frontend/src/hooks/__tests__/useAwareness.test.ts

import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import * as Y from 'yjs';
import { GatewayProvider } from '../../providers/GatewayProvider';
import { useAwareness } from '../useAwareness';

// queueMicrotask + setParticipants need an extra React tick to commit.
async function flushMicrotasks() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('useAwareness', () => {
  it('returns empty participants when provider is null', () => {
    const { result } = renderHook(() =>
      useAwareness(null, {
        userId: 'u1',
        displayName: 'Alice',
        color: '#f00',
        mode: 'editor',
      }),
    );
    expect(result.current.participants).toEqual([]);
  });

  it('derives participants from awareness state (excluding self)', async () => {
    const ydoc = new Y.Doc();
    const provider = new GatewayProvider(ydoc, 'doc:test', vi.fn());

    const { result } = renderHook(() =>
      useAwareness(provider, {
        userId: 'u1',
        displayName: 'Alice',
        color: '#f00',
        mode: 'editor',
      }),
    );

    // Simulate a remote client by setting awareness state on a fake clientID.
    act(() => {
      provider.awareness.states.set(999, {
        user: {
          userId: 'u2',
          displayName: 'Bob',
          color: '#0f0',
          mode: 'editor',
          currentSectionId: null,
          lastSeen: Date.now(),
          idle: false,
        },
      });
      // Manually fire the change event — 999 was "added"
      provider.awareness.emit('change', [
        { added: [999], updated: [], removed: [] },
        'local',
      ]);
    });

    // Microtask to flush queueMicrotask setParticipants.
    await flushMicrotasks();

    expect(result.current.participants).toHaveLength(1);
    expect(result.current.participants[0]).toMatchObject({
      userId: 'u2',
      displayName: 'Bob',
      mode: 'editor',
    });

    provider.destroy();
  });

  it('excludes local client from participants', async () => {
    const ydoc = new Y.Doc();
    const provider = new GatewayProvider(ydoc, 'doc:test', vi.fn());

    // Set local state
    provider.awareness.setLocalStateField('user', {
      userId: 'self',
      displayName: 'Me',
      color: '#00f',
      mode: 'editor',
      currentSectionId: null,
      lastSeen: Date.now(),
      idle: false,
    });

    const { result } = renderHook(() =>
      useAwareness(provider, {
        userId: 'self',
        displayName: 'Me',
        color: '#00f',
        mode: 'editor',
      }),
    );

    await flushMicrotasks();

    expect(result.current.participants).toEqual([]);

    provider.destroy();
  });

  it('maps mode "ack" → "reviewer"', async () => {
    const ydoc = new Y.Doc();
    const provider = new GatewayProvider(ydoc, 'doc:test', vi.fn());

    const { result } = renderHook(() =>
      useAwareness(provider, {
        userId: 'u1',
        displayName: 'Alice',
        color: '#f00',
        mode: 'editor',
      }),
    );

    act(() => {
      provider.awareness.states.set(42, {
        user: {
          userId: 'u2',
          displayName: 'Bob',
          color: '#0f0',
          mode: 'ack',
          currentSectionId: null,
          lastSeen: Date.now(),
          idle: false,
        },
      });
      provider.awareness.emit('change', [
        { added: [42], updated: [], removed: [] },
        'local',
      ]);
    });

    await flushMicrotasks();

    expect(result.current.participants[0]?.mode).toBe('reviewer');

    provider.destroy();
  });
});
