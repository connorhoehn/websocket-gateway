// Phase 51 / hub#70 — drag-handle presence + onDragEnd state machine
// tests for the wizard's multi-page DnD layout.
//
// jsdom doesn't fire PointerEvents the way @dnd-kit's sensors expect,
// so the tests assert on the DOM-level affordances (drag handles
// rendered, sortable items present) and the state-management
// outcomes (button-based reorder still works, schema persists). Full
// drag-gesture e2e coverage belongs to Playwright; the snapshot
// journey carousel is the right surface for that.

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DocumentTypeWizard } from '../DocumentTypeWizard';

async function gotoStep2(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.type(screen.getByTestId('name-input'), name);
  await user.click(screen.getByTestId('wizard-next'));
}

async function makeMultipageWizard() {
  const user = userEvent.setup();
  render(<DocumentTypeWizard onSave={vi.fn()} onCancel={vi.fn()} />);
  await gotoStep2(user, 'DragTest');
  // Add a section so the page isn't empty (cross-page drag needs at
  // least one section in scope).
  await user.click(screen.getByTestId('add-field-tasks'));
  // Add a 2nd page so the multi-page render path activates.
  await user.click(screen.getByTestId('add-page'));
  return { user };
}

describe('DocumentTypeWizard — drag-and-drop affordances (hub#70)', () => {
  it('renders a drag handle on each page header in multi-page mode', async () => {
    await makeMultipageWizard();
    const handles = screen.getAllByTestId(/^page-drag-handle-/);
    // 2 pages → 2 page-drag-handles
    expect(handles.length).toBe(2);
    // Handles should still expose grab cursor + the listener attrs
    // dnd-kit applies (role / tabIndex). They're real <button>s, so
    // we just assert tag + cursor.
    expect(handles[0].tagName).toBe('BUTTON');
    expect(handles[0].getAttribute('style') ?? '').toMatch(/grab/);
  });

  it('renders a drag handle per section within each page', async () => {
    await makeMultipageWizard();
    // The added tasks section lives on page 1; in multi-page mode it
    // gets a section-drag-handle.
    const handles = screen.getAllByTestId(/^section-drag-handle-/);
    expect(handles.length).toBeGreaterThanOrEqual(1);
    expect(handles[0].getAttribute('style') ?? '').toMatch(/grab/);
  });

  it('keeps the button-based reorder controls (accessibility fallback)', async () => {
    await makeMultipageWizard();
    // Page-level up/down still present and clickable.
    expect(screen.getAllByTestId(/^page-up-/).length).toBe(2);
    expect(screen.getAllByTestId(/^page-down-/).length).toBe(2);
    // Move-to-page select still present per section.
    expect(screen.getAllByTestId(/^section-move-page-/).length).toBeGreaterThanOrEqual(1);
  });

  it('cross-page move via the select still updates pages.sectionIds', async () => {
    const onSave = vi.fn();
    const user = userEvent.setup();
    render(<DocumentTypeWizard onSave={onSave} onCancel={vi.fn()} />);
    await gotoStep2(user, 'CrossPage');
    await user.click(screen.getByTestId('add-field-tasks'));
    await user.click(screen.getByTestId('add-page'));

    // Capture the section's testid so we can target the right select.
    const sectionMove = screen.getAllByTestId(/^section-move-page-/)[0] as HTMLSelectElement;
    // Get the second page's id from the options.
    const optionValues = Array.from(sectionMove.options).map((o) => o.value);
    expect(optionValues.length).toBeGreaterThanOrEqual(2);
    // Move to the second page.
    await user.selectOptions(sectionMove, optionValues[1]);

    // Walk wizard to save and assert pages reflect the move.
    await user.click(screen.getByTestId('wizard-next')); // step 2 -> 3
    await user.click(screen.getByTestId('wizard-next')); // step 3 -> save
    expect(onSave).toHaveBeenCalled();
    const payload = onSave.mock.calls[0][0] as { pages: { id: string; sectionIds: string[] }[] };
    // The first page should now be empty; the second page holds the section.
    expect(payload.pages[0].sectionIds.length).toBe(0);
    expect(payload.pages[1].sectionIds.length).toBe(1);
  });
});
