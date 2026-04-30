// frontend/src/components/RoomList.test.tsx
//
// Hub task #3: when /api/rooms returns 500 the sidebar must surface an error
// instead of falling back to the empty "No rooms yet" copy. This test passes
// the error directly into RoomList so it does not depend on useRooms / fetch
// mocking — that path is exercised by integration coverage.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { RoomList } from './RoomList';

const noopAsync = async (): Promise<void> => undefined;

function renderRoomList(overrides: Partial<React.ComponentProps<typeof RoomList>> = {}) {
  return render(
    <RoomList
      idToken="tok"
      rooms={[]}
      createRoom={noopAsync}
      createDM={noopAsync}
      loading={false}
      onRoomSelect={() => {}}
      compact
      {...overrides}
    />,
  );
}

describe('RoomList — fetch error surfacing', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders an inline error + retry button when error is set and rooms is empty', () => {
    const onRetry = vi.fn();
    renderRoomList({ error: 'Failed to load rooms (500)', onRetry });

    expect(screen.getByText("Couldn't load rooms")).toBeInTheDocument();
    expect(screen.getByText('Failed to load rooms (500)')).toBeInTheDocument();
    expect(screen.queryByText(/no rooms yet/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('hides the error state when rooms are present (cached from a prior load)', () => {
    renderRoomList({
      error: 'Failed to load rooms (500)',
      rooms: [{
        roomId: 'r1',
        channelId: 'c1',
        name: 'general',
        type: 'standalone',
        ownerId: 'u1',
        createdAt: '2026-04-29T00:00:00Z',
      }],
    });

    expect(screen.queryByText("Couldn't load rooms")).not.toBeInTheDocument();
    expect(screen.getByText('general')).toBeInTheDocument();
  });

  it('falls back to "No rooms yet" only when there is no error', () => {
    renderRoomList();
    expect(screen.getByText(/no rooms yet/i)).toBeInTheDocument();
  });
});
