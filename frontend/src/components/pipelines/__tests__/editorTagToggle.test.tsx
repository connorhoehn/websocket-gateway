// frontend/src/components/pipelines/__tests__/editorTagToggle.test.tsx
//
// Confirms the editor's TAGS row is hidden by default and that the overflow
// menu's "Show tags" / "Hide tags" toggle persists across remounts via
// localStorage key `ws_pipelines_v1_show_tags`.
//
// Heavy canvas children (NodePalette / PipelineCanvas / ConfigPanel /
// ExecutionLog) are stubbed so the test exercises the top-bar + tag-row
// rendering path without spinning up a full React Flow surface.

import { describe, test, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router';
import type { ReactNode } from 'react';

// ── Context mocks (must precede SUT import) ────────────────────────────────
vi.mock('../../../contexts/IdentityContext', () => ({
  useIdentityContext: () => ({
    userId: 'test-user',
    displayName: 'Test User',
    userEmail: 'test@example.com',
    idToken: 'test-token',
    onSignOut: () => {},
  }),
  IdentityProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock('../../../contexts/PresenceContext', () => ({
  usePresenceContext: () => ({
    presenceUsers: [],
    currentClientId: 'test-user',
    setTyping: () => {},
  }),
  PresenceProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock('../../../contexts/WebSocketContext', () => ({
  useWebSocketContext: () => ({
    connectionState: 'connected',
    sendMessage: () => {},
    onMessage: () => () => {},
    ws: null,
    clientId: 'test-user',
    sessionToken: 'test-session',
  }),
  WebSocketProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

// Stub the canvas-heavy children — they require ReactFlow/window dimensions
// that jsdom doesn't provide. The editor's top-bar + tag row do not rely on
// any of these, so simple no-op replacements are sufficient.
vi.mock('../canvas/PipelineCanvas', () => ({
  default: () => <div data-testid="canvas-stub" />,
}));
vi.mock('../canvas/NodePalette', () => ({
  default: () => <div data-testid="palette-stub" />,
}));
vi.mock('../canvas/ConfigPanel', () => ({
  default: () => <div data-testid="config-stub" />,
}));
vi.mock('../canvas/ExecutionLog', () => ({
  default: () => <div data-testid="log-stub" />,
}));

// SUT and test helpers — imported AFTER mocks so the mocks apply.
import PipelineEditorPage from '../PipelineEditorPage';
import { ToastProvider } from '../../shared/ToastProvider';
import { createPipeline } from '../persistence/pipelineStorage';

const STORAGE_KEY = 'ws_pipelines_v1_show_tags';

function renderEditorAt(pipelineId: string) {
  return render(
    <MemoryRouter initialEntries={[`/pipelines/${pipelineId}`]}>
      <ToastProvider>
        <Routes>
          <Route path="/pipelines/:pipelineId" element={<PipelineEditorPage />} />
        </Routes>
      </ToastProvider>
    </MemoryRouter>,
  );
}

describe('PipelineEditorPage — TAGS row toggle', () => {
  beforeEach(() => {
    // Clear all pipeline-related localStorage keys (incl. the show-tags pref).
    for (const k of Object.keys(localStorage)) {
      if (k.startsWith('ws_pipelines_v1') || k.startsWith('ws_pipeline_runs_v1')) {
        localStorage.removeItem(k);
      }
    }
    cleanup();
  });

  test('hides TAGS row by default and exposes a "Show tags" toggle', () => {
    const def = createPipeline({ name: 'Tag Pipeline', createdBy: 'test-user' });
    renderEditorAt(def.id);

    // Default: hidden — neither the row nor the TAGS label should be present.
    expect(screen.queryByTestId('tags-row')).toBeNull();

    // Open the overflow menu and verify the toggle reads "Show tags".
    fireEvent.click(screen.getByTestId('overflow-menu-btn'));
    const toggle = screen.getByTestId('toggle-tags-row');
    expect(toggle).toHaveTextContent(/show tags/i);
  });

  test('clicking the toggle reveals the row and persists the choice', () => {
    const def = createPipeline({ name: 'Tag Pipeline', createdBy: 'test-user' });
    const { unmount } = renderEditorAt(def.id);

    fireEvent.click(screen.getByTestId('overflow-menu-btn'));
    fireEvent.click(screen.getByTestId('toggle-tags-row'));

    // Row now visible; localStorage records the preference.
    expect(screen.getByTestId('tags-row')).toBeInTheDocument();
    expect(localStorage.getItem(STORAGE_KEY)).toBe('true');

    // Reload by remounting — preference should survive.
    unmount();
    renderEditorAt(def.id);
    expect(screen.getByTestId('tags-row')).toBeInTheDocument();
  });

  test('toggling off persists hidden state across remounts', () => {
    const def = createPipeline({ name: 'Tag Pipeline', createdBy: 'test-user' });
    localStorage.setItem(STORAGE_KEY, 'true');

    const { unmount } = renderEditorAt(def.id);
    expect(screen.getByTestId('tags-row')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('overflow-menu-btn'));
    fireEvent.click(screen.getByTestId('toggle-tags-row'));
    expect(screen.queryByTestId('tags-row')).toBeNull();
    expect(localStorage.getItem(STORAGE_KEY)).toBe('false');

    unmount();
    renderEditorAt(def.id);
    expect(screen.queryByTestId('tags-row')).toBeNull();
  });
});
