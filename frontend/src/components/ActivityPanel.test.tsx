// frontend/src/components/ActivityPanel.test.tsx
//
// Verifies that ActivityPanel surfaces a fetch failure with an inline error +
// retry control, instead of silently rendering the "No activity yet" empty
// state. Regression cover for hub task #2.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

vi.stubEnv('VITE_SOCIAL_API_URL', 'http://api.test');

import { ActivityPanel } from './ActivityPanel';
import { ToastProvider } from './shared/ToastProvider';

// Cognito-style JWT with a `sub` claim. Valid base64 in the payload segment.
const ID_TOKEN = `header.${btoa(JSON.stringify({ sub: 'user-123' }))}.sig`;

function renderPanel() {
  return render(
    <ToastProvider>
      <ActivityPanel
        idToken={ID_TOKEN}
        sendMessage={() => {}}
        onMessage={() => () => {}}
        connectionState="disconnected"
      />
    </ToastProvider>,
  );
}

describe('ActivityPanel — fetch error surfacing', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('renders an inline error + retry button when /api/activity fails', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response('boom', { status: 500, statusText: 'Internal Server Error' }),
    );
    vi.stubGlobal('fetch', fetchMock);

    renderPanel();

    // Panel message ("Couldn't load activity") is distinct from the toast
    // copy ("Couldn't load activity feed") so an exact-string match scopes
    // to the inline error.
    expect(await screen.findByText("Couldn't load activity")).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
    // The bare "No activity yet" empty state must NOT show when the fetch failed.
    expect(screen.queryByText(/no activity yet/i)).not.toBeInTheDocument();
  });

  it('refetches when retry is clicked, and clears the error on success', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('boom', { status: 500 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ items: [], nextKey: null }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    vi.stubGlobal('fetch', fetchMock);

    renderPanel();

    const retry = await screen.findByRole('button', { name: /retry/i });
    await act(async () => {
      fireEvent.click(retry);
    });

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(await screen.findByText(/no activity yet/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /retry/i })).not.toBeInTheDocument();
  });
});
