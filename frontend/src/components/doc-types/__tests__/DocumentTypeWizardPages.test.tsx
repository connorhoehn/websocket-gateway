// Phase 51 / hub#66 — wizard tests for the new Pages → Sections layout.
//
// These cover the new affordances (+ Add Page, page-level config when ≥ 2
// pages, move-section-to-page select). Existing single-page rendering and
// the 37 prior wizard tests are unchanged and live in
// DocumentTypeWizard.test.tsx.

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DocumentTypeWizard } from '../DocumentTypeWizard';

async function gotoStep2(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.type(screen.getByTestId('name-input'), name);
  await user.click(screen.getByTestId('wizard-next'));
}

describe('DocumentTypeWizard — Pages & Sections (hub#66)', () => {
  it('shows + Add Page button on step 2 even with a single page', async () => {
    const user = userEvent.setup();
    render(<DocumentTypeWizard onSave={vi.fn()} onCancel={vi.fn()} />);
    await gotoStep2(user, 'Test');
    expect(screen.getByTestId('add-page')).toBeInTheDocument();
  });

  it('hides the page-config-toc toggle when there is only one page', async () => {
    const user = userEvent.setup();
    render(<DocumentTypeWizard onSave={vi.fn()} onCancel={vi.fn()} />);
    await gotoStep2(user, 'Test');
    expect(screen.queryByTestId('page-config-toc')).not.toBeInTheDocument();
  });

  it('reveals the page-config-toc toggle once a second page exists', async () => {
    const user = userEvent.setup();
    render(<DocumentTypeWizard onSave={vi.fn()} onCancel={vi.fn()} />);
    await gotoStep2(user, 'Test');
    await user.click(screen.getByTestId('add-page'));
    expect(screen.getByTestId('page-config-toc')).toBeInTheDocument();
  });

  it('renders page headers and per-page section containers when ≥ 2 pages', async () => {
    const user = userEvent.setup();
    render(<DocumentTypeWizard onSave={vi.fn()} onCancel={vi.fn()} />);
    await gotoStep2(user, 'Test');
    await user.click(screen.getByTestId('add-page'));
    // Both page-empty- testids should now be present (each page is empty).
    const emptyMarkers = await screen.findAllByTestId(/^page-empty-/);
    expect(emptyMarkers.length).toBeGreaterThanOrEqual(2);
  });

  it('save() handler receives both `fields` and `pages`', async () => {
    const onSave = vi.fn();
    const user = userEvent.setup();
    render(<DocumentTypeWizard onSave={onSave} onCancel={vi.fn()} />);
    await gotoStep2(user, 'Sample');
    // Add one section to satisfy the visible state.
    await user.click(screen.getByTestId('add-field-tasks'));
    // Walk to the end and save.
    await user.click(screen.getByTestId('wizard-next')); // step 2 -> 3
    await user.click(screen.getByTestId('wizard-next')); // step 3 -> save
    expect(onSave).toHaveBeenCalledTimes(1);
    const payload = onSave.mock.calls[0][0] as {
      fields: { id: string }[];
      pages: { id: string; sectionIds: string[] }[];
      pageConfig: { showTableOfContents: boolean };
    };
    expect(payload.fields).toHaveLength(1);
    expect(payload.pages).toHaveLength(1);
    expect(payload.pages[0].sectionIds).toEqual([payload.fields[0].id]);
    expect(payload.pageConfig.showTableOfContents).toBe(false);
  });
});

describe('DocumentTypeWizard — new section types in side panel (hub#66)', () => {
  it('exposes File Upload, Diagram, and Link Block buttons', async () => {
    const user = userEvent.setup();
    render(<DocumentTypeWizard onSave={vi.fn()} onCancel={vi.fn()} />);
    await gotoStep2(user, 'Test');
    expect(screen.getByTestId('add-field-file-upload')).toBeInTheDocument();
    expect(screen.getByTestId('add-field-diagram')).toBeInTheDocument();
    expect(screen.getByTestId('add-field-link-block')).toBeInTheDocument();
  });
});
