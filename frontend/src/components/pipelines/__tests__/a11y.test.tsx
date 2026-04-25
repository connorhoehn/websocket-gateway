// Automated accessibility audit for pipeline + observability pages.
//
// Uses axe-core directly (no React wrapper) so it runs under vitest+jsdom
// without additional framework glue. We scope the audit to `critical` and
// `serious` impact violations — anything less is noise for a smoke-style
// regression net.
//
// Suppressed rules are listed inline with justifications. If axe flags a
// legitimate issue here, fix the component (add aria-label, associate a
// label, etc.) rather than broadening the suppression list.

import { describe, test, beforeEach, vi } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router';
import type { ReactNode } from 'react';
import axe from 'axe-core';

// ---------------------------------------------------------------------------
// Context mocks (mirror routesSmoke.test.tsx)
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
// Imports (after mocks are registered)
// ---------------------------------------------------------------------------

import { EventStreamProvider } from '../context/EventStreamContext';
import { PipelineRunsProvider } from '../context/PipelineRunsContext';
import { ToastProvider } from '../../shared/ToastProvider';
import PipelinesPage from '../PipelinesPage';
import PendingApprovalsPage from '../PendingApprovalsPage';
import DashboardPage from '../../observability/DashboardPage';
import NodesPage from '../../observability/NodesPage';
import EventsPage from '../../observability/EventsPage';
import MetricsPage from '../../observability/MetricsPage';
import ObservabilityLayout from '../../observability/ObservabilityLayout';
import { createPipeline, publishPipeline } from '../persistence/pipelineStorage';

// ---------------------------------------------------------------------------
// Audit helper
// ---------------------------------------------------------------------------

// Rules we intentionally disable, each with a justification. Keep this list
// short — if it grows, we've started ignoring real issues.
const DISABLED_RULES: Record<string, { enabled: boolean }> = {
  // react-flow's canvas wraps arbitrary node content and breaks the
  // "main must be the top-level landmark" heuristic. Not something we can
  // fix without rewriting the canvas library.
  'landmark-main-is-top-level': { enabled: false },
  // jsdom doesn't compute layout/colors, so contrast checks produce
  // false-positives against our inline `style={{ color: ... }}` usage.
  // Contrast is covered by visual review + the Playwright suite instead.
  'color-contrast': { enabled: false },
  // Our pages intentionally render as sub-views without a top-level <main>.
  // The app-level landmark is mounted by AppLayout, which tests don't mount.
  'region': { enabled: false },
  'landmark-one-main': { enabled: false },
  // Empty-page-title is a document-level check; irrelevant for component
  // fragments rendered inside a MemoryRouter in jsdom.
  'document-title': { enabled: false },
  'html-has-lang': { enabled: false },
  'html-lang-valid': { enabled: false },
};

async function audit(container: HTMLElement): Promise<void> {
  const results = await axe.run(container, {
    rules: DISABLED_RULES,
    resultTypes: ['violations'],
  });

  // Only fail on critical + serious — moderate/minor are tracked separately.
  const blocking = results.violations.filter(
    v => v.impact === 'critical' || v.impact === 'serious',
  );

  if (blocking.length > 0) {
    const details = blocking
      .map(
        v =>
          `[${v.impact}] ${v.id}: ${v.description}\n` +
          `  help: ${v.helpUrl}\n` +
          `  affects ${v.nodes.length} node(s):\n` +
          v.nodes
            .slice(0, 3)
            .map(n => `    - ${n.html.slice(0, 160)}`)
            .join('\n'),
      )
      .join('\n\n');
    throw new Error(`axe-core violations:\n${details}`);
  }
}

// ---------------------------------------------------------------------------
// Providers + seed helpers
// ---------------------------------------------------------------------------

function Providers({ children }: { children: ReactNode }) {
  return (
    <ToastProvider>
      <EventStreamProvider>
        <PipelineRunsProvider>{children}</PipelineRunsProvider>
      </EventStreamProvider>
    </ToastProvider>
  );
}

function clearPipelineStorage(): void {
  for (const k of Object.keys(localStorage)) {
    if (
      k.startsWith('ws_pipelines_v1') ||
      k.startsWith('ws_pipeline_runs_v1')
    ) {
      localStorage.removeItem(k);
    }
  }
}

function seedPipelines(): void {
  // Two drafts + one published gives the list view both chip variants and
  // the enabled Run button to audit.
  createPipeline({ name: 'Draft pipeline A', createdBy: 'test-user' });
  createPipeline({ name: 'Draft pipeline B', createdBy: 'test-user', icon: '📝' });
  const third = createPipeline({ name: 'Published pipeline C', createdBy: 'test-user' });
  publishPipeline(third.id);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Accessibility audit', () => {
  beforeEach(() => {
    clearPipelineStorage();
  });

  test('PipelinesPage (empty state) has no critical violations', async () => {
    const { container } = render(
      <MemoryRouter>
        <Providers>
          <PipelinesPage />
        </Providers>
      </MemoryRouter>,
    );
    await audit(container);
  });

  test('PipelinesPage (with seeded data) has no critical violations', async () => {
    seedPipelines();
    const { container } = render(
      <MemoryRouter>
        <Providers>
          <PipelinesPage />
        </Providers>
      </MemoryRouter>,
    );
    await audit(container);
  });

  test('PendingApprovalsPage has no critical violations', async () => {
    const { container } = render(
      <MemoryRouter>
        <Providers>
          <PendingApprovalsPage />
        </Providers>
      </MemoryRouter>,
    );
    await audit(container);
  });

  test('DashboardPage (observability) has no critical violations', async () => {
    const { container } = render(
      <MemoryRouter>
        <Routes>
          <Route path="/" element={<ObservabilityLayout />}>
            <Route index element={<DashboardPage />} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );
    await audit(container);
  });

  test('NodesPage (observability) has no critical violations', async () => {
    const { container } = render(
      <MemoryRouter>
        <Routes>
          <Route path="/" element={<ObservabilityLayout />}>
            <Route index element={<NodesPage />} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );
    await audit(container);
  });

  test('EventsPage (observability) has no critical violations', async () => {
    const { container } = render(
      <MemoryRouter>
        <Routes>
          <Route path="/" element={<ObservabilityLayout />}>
            <Route index element={<EventsPage />} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );
    await audit(container);
  });

  test('MetricsPage (observability) has no critical violations', async () => {
    const { container } = render(
      <MemoryRouter>
        <Routes>
          <Route path="/" element={<ObservabilityLayout />}>
            <Route index element={<MetricsPage />} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );
    await audit(container);
  });
});
