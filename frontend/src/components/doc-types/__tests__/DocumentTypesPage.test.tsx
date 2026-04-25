// frontend/src/components/doc-types/__tests__/DocumentTypesPage.test.tsx
//
// Integration tests for the DocumentTypesPage — the master-detail shell that
// wraps the wizard and the type list.  Exercises the complete interaction loop:
// create → list → edit → delete (with confirmation modal).

import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DocumentTypesPage } from '../DocumentTypesPage';
import { STORAGE_KEY, loadTypes, persistTypes } from '../../../hooks/useDocumentTypes';
import type { DocumentType } from '../../../types/documentType';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeStoredType(overrides: Partial<DocumentType> = {}): DocumentType {
  return {
    id: crypto.randomUUID(),
    name: 'Stored Type',
    description: 'pre-existing',
    icon: '📄',
    fields: [],
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    ...overrides,
  };
}

function seedStorage(types: DocumentType[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(types));
}

// Navigate the wizard all the way to save from step 1 (name already typed).
// Wizard is now 3 steps (workflow step removed in Phase 0). The same
// `wizard-next` button advances to the next step or, on the final step,
// commits the save.
async function completeSave(user: ReturnType<typeof userEvent.setup>) {
  for (let i = 0; i < 3; i++) {
    await user.click(screen.getByTestId('wizard-next'));
  }
}

beforeEach(() => {
  localStorage.clear();
});

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

describe('empty state', () => {
  it('shows the idle panel with no types', () => {
    render(<DocumentTypesPage />);
    expect(screen.getByTestId('idle-panel')).toBeInTheDocument();
    expect(screen.getByText(/No document types yet/i)).toBeInTheDocument();
  });

  it('shows an empty type list in the sidebar', () => {
    render(<DocumentTypesPage />);
    expect(screen.getByTestId('type-list')).toBeInTheDocument();
    expect(screen.queryAllByTestId(/^type-item-/)).toHaveLength(0);
  });

  it('idle panel "Create Document Type" button opens the wizard', async () => {
    const user = userEvent.setup();
    render(<DocumentTypesPage />);
    await user.click(screen.getByTestId('idle-create-btn'));
    expect(screen.getByTestId('name-input')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Create flow
// ---------------------------------------------------------------------------

describe('create flow', () => {
  it('+ New button opens the wizard', async () => {
    const user = userEvent.setup();
    render(<DocumentTypesPage />);
    await user.click(screen.getByTestId('create-type-btn'));
    expect(screen.getByTestId('name-input')).toBeInTheDocument();
  });

  it('saving a new type adds it to the sidebar list', async () => {
    const user = userEvent.setup();
    render(<DocumentTypesPage />);
    await user.click(screen.getByTestId('create-type-btn'));
    await user.type(screen.getByTestId('name-input'), 'Sprint Planning');
    await completeSave(user);

    expect(screen.getByText('Sprint Planning')).toBeInTheDocument();
  });

  it('persists the new type to localStorage', async () => {
    const user = userEvent.setup();
    render(<DocumentTypesPage />);
    await user.click(screen.getByTestId('create-type-btn'));
    await user.type(screen.getByTestId('name-input'), 'Persisted');
    await completeSave(user);

    expect(loadTypes()).toHaveLength(1);
    expect(loadTypes()[0].name).toBe('Persisted');
  });

  it('shows a success banner after saving', async () => {
    const user = userEvent.setup();
    render(<DocumentTypesPage />);
    await user.click(screen.getByTestId('create-type-btn'));
    await user.type(screen.getByTestId('name-input'), 'New Doc');
    await completeSave(user);

    expect(screen.getByTestId('save-message')).toHaveTextContent('"New Doc" created');
  });

  it('returns to idle mode (wizard closes) after save', async () => {
    const user = userEvent.setup();
    render(<DocumentTypesPage />);
    await user.click(screen.getByTestId('create-type-btn'));
    await user.type(screen.getByTestId('name-input'), 'Done');
    await completeSave(user);

    expect(screen.queryByTestId('name-input')).not.toBeInTheDocument();
    expect(screen.getByTestId('idle-panel')).toBeInTheDocument();
  });

  it('Cancel closes the wizard without creating a type', async () => {
    const user = userEvent.setup();
    render(<DocumentTypesPage />);
    await user.click(screen.getByTestId('create-type-btn'));
    await user.click(screen.getByRole('button', { name: /cancel/i }));

    expect(screen.queryByTestId('name-input')).not.toBeInTheDocument();
    expect(loadTypes()).toHaveLength(0);
  });

  it('can create multiple types sequentially', async () => {
    const user = userEvent.setup();
    render(<DocumentTypesPage />);

    for (const name of ['Alpha', 'Beta', 'Gamma']) {
      await user.click(screen.getByTestId('create-type-btn'));
      await user.type(screen.getByTestId('name-input'), name);
      await completeSave(user);
    }

    expect(screen.getByText('Alpha')).toBeInTheDocument();
    expect(screen.getByText('Beta')).toBeInTheDocument();
    expect(screen.getByText('Gamma')).toBeInTheDocument();
    expect(loadTypes()).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// List with pre-existing types
// ---------------------------------------------------------------------------

describe('pre-existing types', () => {
  it('shows all stored types in the sidebar on mount', () => {
    seedStorage([
      makeStoredType({ name: 'Meeting Notes' }),
      makeStoredType({ name: 'Project Brief' }),
    ]);
    render(<DocumentTypesPage />);
    expect(screen.getByText('Meeting Notes')).toBeInTheDocument();
    expect(screen.getByText('Project Brief')).toBeInTheDocument();
  });

  it('clicking the Edit button opens the wizard in edit mode', async () => {
    const type = makeStoredType({ name: 'Retro' });
    seedStorage([type]);
    const user = userEvent.setup();
    render(<DocumentTypesPage />);

    await user.click(screen.getByTestId(`edit-type-${type.id}`));
    // Edit mode opens directly on step 2 (Sections) — step back to reveal
    // the name input so we can verify the wizard loaded this type.
    await user.click(screen.getByRole('button', { name: /← back/i }));
    expect(screen.getByTestId('name-input')).toHaveValue('Retro');
  });

  it('clicking the Edit button highlights the type in the sidebar', async () => {
    const type = makeStoredType({ name: 'Active' });
    seedStorage([type]);
    const user = userEvent.setup();
    render(<DocumentTypesPage />);

    await user.click(screen.getByTestId(`edit-type-${type.id}`));
    const item = screen.getByTestId(`type-item-${type.id}`);
    expect(item).toBeInTheDocument();
    // Wizard is open — "Sections" step is visible (edit mode starts on step 2).
    expect(screen.getByText(/SECTION TYPES/)).toBeInTheDocument();
  });

  it('displays field count in the sidebar item', () => {
    const type = makeStoredType({
      name: 'With Fields',
      fields: [
        { id: 'f1', name: 'Notes', sectionType: 'rich-text', required: false, defaultCollapsed: false, placeholder: '', hiddenInModes: [], rendererOverrides: {} },
        { id: 'f2', name: 'Tasks', sectionType: 'tasks', required: false, defaultCollapsed: false, placeholder: '', hiddenInModes: [], rendererOverrides: {} },
      ],
    });
    seedStorage([type]);
    render(<DocumentTypesPage />);
    expect(screen.getByText(/2 fields/i)).toBeInTheDocument();
  });

});

// ---------------------------------------------------------------------------
// Edit flow
// ---------------------------------------------------------------------------

describe('edit flow', () => {
  // Edit mode opens on Step 2 (Sections) — go back one step to edit the name.
  async function goBackToNameStep(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole('button', { name: /← back/i }));
  }

  it('saving edits updates the type name in the sidebar', async () => {
    const type = makeStoredType({ name: 'Old Name' });
    seedStorage([type]);
    const user = userEvent.setup();
    render(<DocumentTypesPage />);

    await user.click(screen.getByTestId(`edit-type-${type.id}`));
    await goBackToNameStep(user);
    const nameInput = screen.getByTestId('name-input');
    await user.clear(nameInput);
    await user.type(nameInput, 'New Name');
    await completeSave(user);

    expect(screen.getByText('New Name')).toBeInTheDocument();
    expect(screen.queryByText('Old Name')).not.toBeInTheDocument();
  });

  it('shows "X updated" success banner after edit save', async () => {
    const type = makeStoredType({ name: 'Original' });
    seedStorage([type]);
    const user = userEvent.setup();
    render(<DocumentTypesPage />);

    await user.click(screen.getByTestId(`edit-type-${type.id}`));
    await goBackToNameStep(user);
    const nameInput = screen.getByTestId('name-input');
    await user.clear(nameInput);
    await user.type(nameInput, 'Updated');
    await completeSave(user);

    expect(screen.getByTestId('save-message')).toHaveTextContent('"Updated" updated');
  });

  it('persists edits to localStorage', async () => {
    const type = makeStoredType({ name: 'Before' });
    seedStorage([type]);
    const user = userEvent.setup();
    render(<DocumentTypesPage />);

    await user.click(screen.getByTestId(`edit-type-${type.id}`));
    await goBackToNameStep(user);
    const nameInput = screen.getByTestId('name-input');
    await user.clear(nameInput);
    await user.type(nameInput, 'After');
    await completeSave(user);

    const stored = loadTypes();
    expect(stored[0].name).toBe('After');
  });

  it('edit save returns to idle panel', async () => {
    const type = makeStoredType({ name: 'Editme' });
    seedStorage([type]);
    const user = userEvent.setup();
    render(<DocumentTypesPage />);

    await user.click(screen.getByTestId(`edit-type-${type.id}`));
    // Edit mode starts on step 2, so only 2 Next clicks to reach save.
    await user.click(screen.getByTestId('wizard-next'));
    await user.click(screen.getByTestId('wizard-next'));

    expect(screen.getByTestId('idle-panel')).toBeInTheDocument();
    expect(screen.queryByTestId('name-input')).not.toBeInTheDocument();
  });

  it('cancel during edit closes wizard without saving', async () => {
    const type = makeStoredType({ name: 'Untouched' });
    seedStorage([type]);
    const user = userEvent.setup();
    render(<DocumentTypesPage />);

    await user.click(screen.getByTestId(`edit-type-${type.id}`));
    await goBackToNameStep(user);
    await user.clear(screen.getByTestId('name-input'));
    await user.type(screen.getByTestId('name-input'), 'Modified');
    await user.click(screen.getByRole('button', { name: /cancel/i }));

    expect(screen.queryByTestId('name-input')).not.toBeInTheDocument();
    expect(loadTypes()[0].name).toBe('Untouched');
  });
});

// ---------------------------------------------------------------------------
// Delete flow
// ---------------------------------------------------------------------------

describe('delete flow', () => {
  it('clicking × shows the confirmation modal', async () => {
    const type = makeStoredType({ name: 'DeleteMe' });
    seedStorage([type]);
    const user = userEvent.setup();
    render(<DocumentTypesPage />);

    await user.click(screen.getByTestId(`delete-type-${type.id}`));
    expect(screen.getByTestId('delete-modal')).toBeInTheDocument();
    expect(screen.getByText(/"DeleteMe"/)).toBeInTheDocument();
  });

  it('confirming deletion removes the type from the list', async () => {
    const type = makeStoredType({ name: 'GoneType' });
    seedStorage([type]);
    const user = userEvent.setup();
    render(<DocumentTypesPage />);

    await user.click(screen.getByTestId(`delete-type-${type.id}`));
    await user.click(screen.getByTestId('confirm-delete'));

    expect(screen.queryByText('GoneType')).not.toBeInTheDocument();
    expect(screen.queryByTestId('delete-modal')).not.toBeInTheDocument();
  });

  it('confirming deletion persists removal to localStorage', async () => {
    const type = makeStoredType({ name: 'PersistDelete' });
    seedStorage([type]);
    const user = userEvent.setup();
    render(<DocumentTypesPage />);

    await user.click(screen.getByTestId(`delete-type-${type.id}`));
    await user.click(screen.getByTestId('confirm-delete'));

    expect(loadTypes()).toHaveLength(0);
  });

  it('cancelling the modal keeps the type in the list', async () => {
    const type = makeStoredType({ name: 'StayType' });
    seedStorage([type]);
    const user = userEvent.setup();
    render(<DocumentTypesPage />);

    await user.click(screen.getByTestId(`delete-type-${type.id}`));
    await user.click(screen.getByTestId('cancel-delete'));

    expect(screen.getByText('StayType')).toBeInTheDocument();
    expect(screen.queryByTestId('delete-modal')).not.toBeInTheDocument();
  });

  it('clicking the backdrop closes the modal without deleting', async () => {
    const type = makeStoredType({ name: 'BackdropSafe' });
    seedStorage([type]);
    const user = userEvent.setup();
    render(<DocumentTypesPage />);

    await user.click(screen.getByTestId(`delete-type-${type.id}`));
    // Click the backdrop (the modal overlay itself)
    await user.click(screen.getByTestId('delete-modal'));

    expect(screen.queryByTestId('delete-modal')).not.toBeInTheDocument();
    expect(screen.getByText('BackdropSafe')).toBeInTheDocument();
  });

  it('deleting a type that is currently open in the editor returns to idle', async () => {
    const type = makeStoredType({ name: 'OpenThenDelete' });
    seedStorage([type]);
    const user = userEvent.setup();
    render(<DocumentTypesPage />);

    // Open the type in the wizard — edit mode starts on step 2, go back for
    // the name input.
    await user.click(screen.getByTestId(`edit-type-${type.id}`));
    await user.click(screen.getByRole('button', { name: /← back/i }));
    expect(screen.getByTestId('name-input')).toBeInTheDocument();

    // Delete it
    await user.click(screen.getByTestId(`delete-type-${type.id}`));
    await user.click(screen.getByTestId('confirm-delete'));

    expect(screen.getByTestId('idle-panel')).toBeInTheDocument();
    expect(screen.queryByTestId('name-input')).not.toBeInTheDocument();
  });

  it('deleting one type leaves the other types intact', async () => {
    const keep   = makeStoredType({ name: 'KeepMe' });
    const remove = makeStoredType({ name: 'RemoveMe' });
    seedStorage([keep, remove]);
    const user = userEvent.setup();
    render(<DocumentTypesPage />);

    await user.click(screen.getByTestId(`delete-type-${remove.id}`));
    await user.click(screen.getByTestId('confirm-delete'));

    expect(screen.getByText('KeepMe')).toBeInTheDocument();
    expect(screen.queryByText('RemoveMe')).not.toBeInTheDocument();
    expect(loadTypes()).toHaveLength(1);
    expect(loadTypes()[0].name).toBe('KeepMe');
  });
});

// ---------------------------------------------------------------------------
// Mode transitions
// ---------------------------------------------------------------------------

describe('mode transitions', () => {
  it('switching from editing one type to another remounts the wizard', async () => {
    const typeA = makeStoredType({ name: 'Type A' });
    const typeB = makeStoredType({ name: 'Type B' });
    seedStorage([typeA, typeB]);
    const user = userEvent.setup();
    render(<DocumentTypesPage />);

    // Edit mode starts on step 2 — step back to reveal the name input.
    await user.click(screen.getByTestId(`edit-type-${typeA.id}`));
    await user.click(screen.getByRole('button', { name: /← back/i }));
    expect(screen.getByTestId('name-input')).toHaveValue('Type A');

    await user.click(screen.getByTestId(`edit-type-${typeB.id}`));
    await user.click(screen.getByRole('button', { name: /← back/i }));
    expect(screen.getByTestId('name-input')).toHaveValue('Type B');
  });

  it('opening create after editing a type shows an empty wizard', async () => {
    const type = makeStoredType({ name: 'Existing' });
    seedStorage([type]);
    const user = userEvent.setup();
    render(<DocumentTypesPage />);

    await user.click(screen.getByTestId(`edit-type-${type.id}`));
    // Edit mode starts on step 2 — step back to see the name input.
    await user.click(screen.getByRole('button', { name: /← back/i }));
    expect(screen.getByTestId('name-input')).toHaveValue('Existing');

    await user.click(screen.getByTestId('create-type-btn'));
    expect(screen.getByTestId('name-input')).toHaveValue('');
  });
});
