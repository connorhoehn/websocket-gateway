// frontend/src/components/pipelines/__tests__/TemplatesModal.test.tsx
//
// Unit tests for the TemplatesModal — the gallery that turns "Browse templates"
// into a real persisted pipeline.
//
// Coverage:
//   - renders 6+ templates (cards + meta thumbnails)
//   - selecting a template invokes onCreated(newId) with a real persisted id
//   - the search input filters the grid by name/description/tag
//   - pressing Enter in the search input picks the first match
//   - pressing Escape closes the modal (handled by the underlying Modal)
//
// Framework: Vitest. See frontend/vite.config.ts.

import { describe, test, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import type { ReactNode } from 'react';

// ---------------------------------------------------------------------------
// Context mocks — keep the test isolated from real identity providers.
// Must run before the SUT import below.
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

import TemplatesModal from '../TemplatesModal';
import { pipelineTemplates } from '../templates';
import { listPipelines, loadPipeline } from '../persistence/pipelineStorage';

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  localStorage.clear();
});

function renderModal(props: {
  open?: boolean;
  onClose?: () => void;
  onCreated?: (id: string) => void;
}) {
  const onClose = props.onClose ?? vi.fn();
  const onCreated = props.onCreated ?? vi.fn();
  const utils = render(
    <TemplatesModal
      open={props.open ?? true}
      onClose={onClose}
      onCreated={onCreated}
    />,
  );
  return { ...utils, onClose, onCreated };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TemplatesModal', () => {
  test('renders at least six templates with cards + meta', () => {
    expect(pipelineTemplates.length).toBeGreaterThanOrEqual(6);
    renderModal({});

    // Every template gets a card.
    for (const t of pipelineTemplates) {
      expect(screen.getByTestId(`template-card-${t.id}`)).toBeInTheDocument();
      expect(screen.getByTestId(`template-meta-${t.id}`)).toBeInTheDocument();
      expect(screen.getByTestId(`template-use-${t.id}`)).toBeInTheDocument();
    }
  });

  test('clicking "Use this template" persists a new pipeline and calls onCreated', () => {
    const { onCreated, onClose } = renderModal({});

    const target = pipelineTemplates[0];
    const useBtn = screen.getByTestId(`template-use-${target.id}`);

    expect(listPipelines()).toHaveLength(0);

    fireEvent.click(useBtn);

    // onCreated invoked with a string id.
    expect(onCreated).toHaveBeenCalledTimes(1);
    const [createdId] = (onCreated as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(typeof createdId).toBe('string');
    expect(createdId).toMatch(/[0-9a-f-]{36}/i);

    // Modal asked itself to close.
    expect(onClose).toHaveBeenCalledTimes(1);

    // Pipeline was actually persisted.
    const stored = loadPipeline(createdId);
    expect(stored).not.toBeNull();
    expect(stored!.id).toBe(createdId);
    expect(stored!.status).toBe('draft');
    expect(stored!.name).toBe(`${target.name} (copy)`);

    // Index is updated.
    const index = listPipelines();
    expect(index).toHaveLength(1);
    expect(index[0].id).toBe(createdId);
  });

  test('regenerated node and edge ids match across spawned pipeline', () => {
    const { onCreated } = renderModal({});

    // Pick a multi-node template (the second one — Meeting Notes Assistant has
    // a fork → join structure with 7 nodes).
    const target = pipelineTemplates[1];
    fireEvent.click(screen.getByTestId(`template-use-${target.id}`));

    const [createdId] = (onCreated as ReturnType<typeof vi.fn>).mock.calls[0];
    const def = loadPipeline(createdId)!;

    const nodeIds = new Set(def.nodes.map((n) => n.id));
    expect(nodeIds.size).toBe(def.nodes.length);

    // Every edge endpoint resolves to a real cloned node id.
    for (const e of def.edges) {
      expect(nodeIds.has(e.source)).toBe(true);
      expect(nodeIds.has(e.target)).toBe(true);
    }
  });

  test('search filters the grid by name/tag/description', () => {
    renderModal({});

    const input = screen.getByTestId('templates-search') as HTMLInputElement;

    // Type "approval" — should keep templates whose name/desc/tag matches.
    fireEvent.change(input, { target: { value: 'approval' } });

    const matches = pipelineTemplates.filter(
      (t) =>
        t.name.toLowerCase().includes('approval') ||
        t.description.toLowerCase().includes('approval') ||
        t.tags.some((tag) => tag.includes('approval')),
    );
    expect(matches.length).toBeGreaterThan(0);

    for (const m of matches) {
      expect(screen.getByTestId(`template-card-${m.id}`)).toBeInTheDocument();
    }

    // A template that should NOT be in the filtered set
    const nonMatch = pipelineTemplates.find(
      (t) =>
        !t.name.toLowerCase().includes('approval') &&
        !t.description.toLowerCase().includes('approval') &&
        !t.tags.some((tag) => tag.includes('approval')),
    );
    if (nonMatch) {
      expect(screen.queryByTestId(`template-card-${nonMatch.id}`)).not.toBeInTheDocument();
    }
  });

  test('search with no matches shows an empty state', () => {
    renderModal({});

    const input = screen.getByTestId('templates-search');
    fireEvent.change(input, { target: { value: 'zzznothingmatchesthisstring' } });

    expect(screen.getByTestId('templates-empty')).toBeInTheDocument();
    expect(screen.queryByTestId('templates-grid')).not.toBeInTheDocument();
  });

  test('pressing Enter in the search input selects the first match', () => {
    const { onCreated } = renderModal({});

    const input = screen.getByTestId('templates-search') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'document' } });

    // Confirm at least one match.
    const matches = pipelineTemplates.filter((t) =>
      t.name.toLowerCase().includes('document') ||
      t.description.toLowerCase().includes('document') ||
      t.tags.some((tag) => tag.toLowerCase().includes('document')),
    );
    expect(matches.length).toBeGreaterThan(0);

    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onCreated).toHaveBeenCalledTimes(1);
    const [createdId] = (onCreated as ReturnType<typeof vi.fn>).mock.calls[0];
    const def = loadPipeline(createdId)!;
    // The created pipeline's name should be derived from the first match's name.
    expect(def.name).toBe(`${matches[0].name} (copy)`);
  });

  test('pressing Escape closes the modal', () => {
    const { onClose } = renderModal({});

    act(() => {
      fireEvent.keyDown(window, { key: 'Escape' });
    });

    expect(onClose).toHaveBeenCalled();
  });

  test('does not render anything when open is false', () => {
    renderModal({ open: false });
    expect(screen.queryByTestId('templates-modal')).not.toBeInTheDocument();
    expect(screen.queryByTestId('templates-grid')).not.toBeInTheDocument();
  });
});
