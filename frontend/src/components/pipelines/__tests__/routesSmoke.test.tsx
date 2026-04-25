// Smoke test: every Phase 1 route mounts without throwing when provided
// minimal providers. Catches wiring regressions (broken imports, missing
// providers, context-throw errors) end-to-end.

import { describe, test, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router';
import type { ReactNode } from 'react';

// ---------------------------------------------------------------------------
// Context mocks — avoid the real WebSocket / identity / presence providers
// so tests stay isolated. Order matters: mock before importing components.
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Dynamic imports so module-top mocks are applied.
// ---------------------------------------------------------------------------

import { EventStreamProvider } from '../context/EventStreamContext';
import { PipelineRunsProvider } from '../context/PipelineRunsContext';
import { ToastProvider } from '../../shared/ToastProvider';
import PipelinesPage from '../PipelinesPage';
import PendingApprovalsPage from '../PendingApprovalsPage';
import PipelineRunsPage from '../PipelineRunsPage';
import DashboardPage from '../../observability/DashboardPage';
import NodesPage from '../../observability/NodesPage';
import EventsPage from '../../observability/EventsPage';
import MetricsPage from '../../observability/MetricsPage';
import ObservabilityLayout from '../../observability/ObservabilityLayout';

function Providers({ children }: { children: ReactNode }) {
  return (
    <ToastProvider>
      <EventStreamProvider>
        <PipelineRunsProvider>{children}</PipelineRunsProvider>
      </EventStreamProvider>
    </ToastProvider>
  );
}

describe('Route smoke tests', () => {
  beforeEach(() => {
    for (const k of Object.keys(localStorage)) {
      if (k.startsWith('ws_pipelines_v1') || k.startsWith('ws_pipeline_runs_v1')) {
        localStorage.removeItem(k);
      }
    }
  });

  test('PipelinesPage (empty) renders the empty-state CTA', () => {
    render(
      <MemoryRouter>
        <Providers>
          <PipelinesPage />
        </Providers>
      </MemoryRouter>,
    );
    expect(screen.getByText(/No pipelines yet/i)).toBeInTheDocument();
  });

  test('PendingApprovalsPage renders an empty state with no approvals', () => {
    render(
      <MemoryRouter>
        <Providers>
          <PendingApprovalsPage />
        </Providers>
      </MemoryRouter>,
    );
    // Page mounts without throwing; multiple "approval" strings are fine
    // (title + empty-state body).
    expect(screen.getAllByText(/approval/i).length).toBeGreaterThan(0);
  });

  test('PipelineRunsPage for a missing pipeline shows "Pipeline not found"', () => {
    render(
      <MemoryRouter initialEntries={['/pipelines/missing/runs']}>
        <Providers>
          <Routes>
            <Route path="/pipelines/:pipelineId/runs" element={<PipelineRunsPage />} />
          </Routes>
        </Providers>
      </MemoryRouter>,
    );
    expect(screen.getByText(/Pipeline not found/i)).toBeInTheDocument();
  });

  test('ObservabilityLayout mounts its provider and renders children', () => {
    render(
      <MemoryRouter>
        <Routes>
          <Route path="/" element={<ObservabilityLayout />}>
            <Route index element={<div data-testid="obs-slot">observability child</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByTestId('obs-slot')).toBeInTheDocument();
  });

  test('DashboardPage mounts under ObservabilityLayout', () => {
    render(
      <MemoryRouter>
        <Routes>
          <Route path="/" element={<ObservabilityLayout />}>
            <Route index element={<DashboardPage />} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );
    // KPI row is always rendered with labels; one of them should appear.
    // "Active" covers both "Active now" and "Active runs".
    expect(screen.getAllByText(/Active/i).length).toBeGreaterThan(0);
  });

  test('NodesPage mounts under ObservabilityLayout', () => {
    render(
      <MemoryRouter>
        <Routes>
          <Route path="/" element={<ObservabilityLayout />}>
            <Route index element={<NodesPage />} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );
    // Chaos rail is always visible
    expect(screen.getAllByText(/chaos/i).length).toBeGreaterThan(0);
  });

  test('EventsPage mounts under ObservabilityLayout', () => {
    render(
      <MemoryRouter>
        <Routes>
          <Route path="/" element={<ObservabilityLayout />}>
            <Route index element={<EventsPage />} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );
    // Filter rail "FILTERS" heading is always present
    expect(screen.getAllByText(/filter/i).length).toBeGreaterThan(0);
  });

  test('MetricsPage mounts under ObservabilityLayout with charts', () => {
    render(
      <MemoryRouter>
        <Routes>
          <Route path="/" element={<ObservabilityLayout />}>
            <Route index element={<MetricsPage />} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );
    // At least one metric card title is always present
    expect(screen.getAllByText(/runs/i).length).toBeGreaterThan(0);
  });
});
