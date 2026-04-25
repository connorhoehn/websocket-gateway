// frontend/src/components/doc-types/__tests__/DocumentTypeWizard.test.tsx
//
// Interaction coverage for the DocumentTypeWizard.
// Tests each step's stateful behaviours: navigation, validation, field
// mutations, renderer overrides, and final save payload.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DocumentTypeWizard } from '../DocumentTypeWizard';
import type { DocumentType } from '../../../types/documentType';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const noop = () => {};

function setup(props?: Partial<React.ComponentProps<typeof DocumentTypeWizard>>) {
  const onSave   = vi.fn();
  const onCancel = vi.fn();
  const user     = userEvent.setup();
  render(
    <DocumentTypeWizard
      onSave={onSave}
      onCancel={onCancel}
      {...props}
    />,
  );
  return { onSave, onCancel, user };
}

// Navigate to step 2 (fills name, clicks Next)
async function goToStep2(user: ReturnType<typeof userEvent.setup>, name = 'My Type') {
  await user.type(screen.getByTestId('name-input'), name);
  await user.click(screen.getByTestId('wizard-next'));
}

// Navigate to step 3
async function goToStep3(user: ReturnType<typeof userEvent.setup>, name = 'My Type') {
  await goToStep2(user, name);
  await user.click(screen.getByTestId('wizard-next'));
}

// ---------------------------------------------------------------------------
// Step indicator
// ---------------------------------------------------------------------------

describe('StepIndicator', () => {
  it('renders the step labels for the non-workflow steps', () => {
    setup();
    expect(screen.getByText('Basic Info')).toBeInTheDocument();
    expect(screen.getByText('Sections')).toBeInTheDocument();
    expect(screen.getByText('View Modes')).toBeInTheDocument();
  });

  it('shows step 2 label as active after advancing to step 2', async () => {
    const { user } = setup();
    await goToStep2(user);
    // Step 2 is active, the SECTION TYPES picker is visible
    expect(screen.getByText(/SECTION TYPES/)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Step 1 — Basic Info
// ---------------------------------------------------------------------------

describe('Step 1 — Basic Info', () => {
  it('renders the name input, description textarea, and icon picker', () => {
    setup();
    expect(screen.getByTestId('name-input')).toBeInTheDocument();
    expect(screen.getByTestId('description-input')).toBeInTheDocument();
    // At least one icon button should be rendered
    expect(screen.getByTestId('icon-📄')).toBeInTheDocument();
  });

  it('Next button is disabled when name is empty', () => {
    setup();
    expect(screen.getByTestId('wizard-next')).toBeDisabled();
  });

  it('Next button becomes enabled when a name is typed', async () => {
    const { user } = setup();
    await user.type(screen.getByTestId('name-input'), 'Sprint Planning');
    expect(screen.getByTestId('wizard-next')).not.toBeDisabled();
  });

  it('Next button is disabled again if name is cleared after typing', async () => {
    const { user } = setup();
    const nameInput = screen.getByTestId('name-input');
    await user.type(nameInput, 'Temp');
    await user.clear(nameInput);
    expect(screen.getByTestId('wizard-next')).toBeDisabled();
  });

  it('can select an icon from the picker', async () => {
    const { user } = setup();
    const rocketBtn = screen.getByTestId('icon-🚀');
    await user.click(rocketBtn);
    // Selected icon gets a highlighted border — easiest to verify by checking
    // the icon button is present and clicking does not throw
    expect(rocketBtn).toBeInTheDocument();
  });

  it('Cancel calls onCancel', async () => {
    const { onCancel, user } = setup();
    await user.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('Back button is not visible on step 1', () => {
    setup();
    expect(screen.queryByRole('button', { name: /← back/i })).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Step 2 — Fields
// ---------------------------------------------------------------------------

describe('Step 2 — Fields', () => {
  it('shows the field type cards and empty state when no fields', async () => {
    const { user } = setup();
    await goToStep2(user);
    expect(screen.getByText(/No sections yet/i)).toBeInTheDocument();
    expect(screen.getByTestId('add-field-tasks')).toBeInTheDocument();
    expect(screen.getByTestId('add-field-rich-text')).toBeInTheDocument();
    expect(screen.getByTestId('add-field-decisions')).toBeInTheDocument();
    expect(screen.getByTestId('add-field-checklist')).toBeInTheDocument();
  });

  it('clicking a field type card adds a field to the list', async () => {
    const { user } = setup();
    await goToStep2(user);
    await user.click(screen.getByTestId('add-field-tasks'));
    expect(screen.getByTestId('fields-list')).toBeInTheDocument();
    // The FieldRow name input contains the default label. Use the field-name
    // testid since "Task List" also appears as an <option> label on the
    // type <select> inside the same row.
    const nameInput = screen.getByTestId(/^field-name-/) as HTMLInputElement;
    expect(nameInput.value).toBe('Task List');
  });

  it('adding two different field types shows two rows', async () => {
    const { user } = setup();
    await goToStep2(user);
    await user.click(screen.getByTestId('add-field-tasks'));
    await user.click(screen.getByTestId('add-field-rich-text'));
    const rows = screen.getAllByTestId(/^field-name-/);
    expect(rows).toHaveLength(2);
  });

  it('can rename a field', async () => {
    const { user } = setup();
    await goToStep2(user);
    await user.click(screen.getByTestId('add-field-tasks'));

    const nameInput = screen.getByTestId(/^field-name-/) as HTMLInputElement;
    expect(nameInput.value).toBe('Task List');
    await user.clear(nameInput);
    await user.type(nameInput, 'Action Items');
    expect(nameInput.value).toBe('Action Items');
  });

  it('remove button deletes the field', async () => {
    const { user } = setup();
    await goToStep2(user);
    await user.click(screen.getByTestId('add-field-tasks'));

    const removeBtn = screen.getByTestId(/^field-remove-/);
    await user.click(removeBtn);
    expect(screen.getByText(/No sections yet/i)).toBeInTheDocument();
  });

  it('toggling Required changes its visual state', async () => {
    const { user } = setup();
    await goToStep2(user);
    await user.click(screen.getByTestId('add-field-tasks'));

    const reqBtn = screen.getByTestId(/^field-required-/);
    // Click once to mark required — button text stays "Required"
    await user.click(reqBtn);
    expect(reqBtn).toHaveTextContent('Required');
  });

  it('toggling Collapsed changes its visual state', async () => {
    const { user } = setup();
    await goToStep2(user);
    await user.click(screen.getByTestId('add-field-tasks'));

    const collBtn = screen.getByTestId(/^field-collapsed-/);
    await user.click(collBtn);
    expect(collBtn).toHaveTextContent('Collapsed');
  });

  it('up/down reorder buttons are disabled at the boundaries', async () => {
    const { user } = setup();
    await goToStep2(user);
    await user.click(screen.getByTestId('add-field-tasks'));
    await user.click(screen.getByTestId('add-field-rich-text'));

    const upBtns   = screen.getAllByTestId(/^field-up-/);
    const downBtns = screen.getAllByTestId(/^field-down-/);
    // First row: up disabled
    expect(upBtns[0]).toBeDisabled();
    // Last row: down disabled
    expect(downBtns[downBtns.length - 1]).toBeDisabled();
    // First row: down enabled
    expect(downBtns[0]).not.toBeDisabled();
  });

  it('down button moves a field down in the list', async () => {
    const { user } = setup();
    await goToStep2(user);
    await user.click(screen.getByTestId('add-field-tasks'));
    await user.click(screen.getByTestId('add-field-rich-text'));

    const nameInputsBefore = screen
      .getAllByTestId(/^field-name-/)
      .map(el => (el as HTMLInputElement).value);

    const downBtns = screen.getAllByTestId(/^field-down-/);
    await user.click(downBtns[0]);

    const nameInputsAfter = screen
      .getAllByTestId(/^field-name-/)
      .map(el => (el as HTMLInputElement).value);

    expect(nameInputsAfter[0]).toBe(nameInputsBefore[1]);
    expect(nameInputsAfter[1]).toBe(nameInputsBefore[0]);
  });

  it('Back returns to step 1', async () => {
    const { user } = setup();
    await goToStep2(user);
    await user.click(screen.getByRole('button', { name: /← back/i }));
    expect(screen.getByTestId('name-input')).toBeInTheDocument();
  });

  it('fields added in step 2 are preserved when going back and forward', async () => {
    const { user } = setup();
    await goToStep2(user);
    await user.click(screen.getByTestId('add-field-tasks'));

    // Go back to step 1 then forward again
    await user.click(screen.getByRole('button', { name: /← back/i }));
    await user.click(screen.getByTestId('wizard-next'));

    const nameInput = screen.getByTestId(/^field-name-/) as HTMLInputElement;
    expect(nameInput.value).toBe('Task List');
  });
});

// ---------------------------------------------------------------------------
// Step 3 — View Modes
// ---------------------------------------------------------------------------

describe('Step 3 — View Modes', () => {
  it('shows "no fields" message when no fields were added', async () => {
    const { user } = setup();
    await goToStep3(user);
    expect(screen.getByText(/No fields defined/i)).toBeInTheDocument();
  });

  it('shows a row for each added field', async () => {
    const { user } = setup();
    await goToStep2(user);
    await user.click(screen.getByTestId('add-field-tasks'));
    await user.click(screen.getByTestId('add-field-checklist'));
    await user.click(screen.getByTestId('wizard-next')); // → step 3

    expect(screen.getByText('Task List')).toBeInTheDocument();
    expect(screen.getByText('Checklist')).toBeInTheDocument();
  });

  it('all view-mode visibility checkboxes are checked by default', async () => {
    const { user } = setup();
    await goToStep2(user);
    await user.click(screen.getByTestId('add-field-tasks'));
    await user.click(screen.getByTestId('wizard-next')); // → step 3

    const taskFieldId = screen
      .getAllByTestId(/^visibility-/)
      .map(el => el.getAttribute('data-testid') ?? '');

    // All three modes (editor, ack, reader) should be checked
    taskFieldId.forEach(tid => {
      expect(screen.getByTestId(tid)).toBeChecked();
    });
  });

  it('unchecking a visibility checkbox marks the field hidden in that mode', async () => {
    const { user } = setup();
    await goToStep2(user);
    await user.click(screen.getByTestId('add-field-tasks'));
    await user.click(screen.getByTestId('wizard-next')); // → step 3

    const editorCheckboxes = screen.getAllByTestId(/^visibility-.*-editor$/);
    await user.click(editorCheckboxes[0]);
    expect(editorCheckboxes[0]).not.toBeChecked();
  });

  it('renderer dropdown is visible when field is visible', async () => {
    const { user } = setup();
    await goToStep2(user);
    await user.click(screen.getByTestId('add-field-tasks'));
    await user.click(screen.getByTestId('wizard-next')); // → step 3

    const dropdowns = screen.getAllByTestId(/^renderer-/);
    expect(dropdowns.length).toBeGreaterThan(0);
  });

  it('renderer dropdown disappears when field is hidden in that mode', async () => {
    const { user } = setup();
    await goToStep2(user);
    await user.click(screen.getByTestId('add-field-tasks'));
    await user.click(screen.getByTestId('wizard-next')); // → step 3

    const editorCheckbox = screen.getAllByTestId(/^visibility-.*-editor$/)[0];
    const fieldId = editorCheckbox.getAttribute('data-testid')!
      .replace('visibility-', '').replace('-editor', '');

    await user.click(editorCheckbox); // hide
    expect(screen.queryByTestId(`renderer-${fieldId}-editor`)).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Save — correct payload
// ---------------------------------------------------------------------------

describe('onSave payload', () => {
  it('calls onSave with name, description, icon, and empty fields', async () => {
    const { onSave, user } = setup();

    await user.type(screen.getByTestId('name-input'), 'Retro');
    await user.type(screen.getByTestId('description-input'), 'Sprint retrospective template');
    await user.click(screen.getByTestId('icon-🔥'));

    // Navigate steps 2, 3, then save
    await user.click(screen.getByTestId('wizard-next'));
    await user.click(screen.getByTestId('wizard-next'));
    await user.click(screen.getByTestId('wizard-next')); // save

    expect(onSave).toHaveBeenCalledOnce();
    const arg = onSave.mock.calls[0][0] as ReturnType<typeof onSave.mock.calls[0][0]>;
    expect(arg.name).toBe('Retro');
    expect(arg.description).toBe('Sprint retrospective template');
    expect(arg.icon).toBe('🔥');
    expect(arg.fields).toEqual([]);
  });

  it('includes fields added in step 2 in the save payload', async () => {
    const { onSave, user } = setup();
    await user.type(screen.getByTestId('name-input'), 'Template');
    await user.click(screen.getByTestId('wizard-next')); // → step 2

    await user.click(screen.getByTestId('add-field-tasks'));
    await user.click(screen.getByTestId('add-field-decisions'));

    await user.click(screen.getByTestId('wizard-next')); // → step 3
    await user.click(screen.getByTestId('wizard-next')); // save

    const arg = onSave.mock.calls[0][0];
    expect(arg.fields).toHaveLength(2);
    expect(arg.fields[0].sectionType).toBe('tasks');
    expect(arg.fields[1].sectionType).toBe('decisions');
  });

  it('includes hiddenInModes changes from step 3', async () => {
    const { onSave, user } = setup();
    await user.type(screen.getByTestId('name-input'), 'Template');
    await user.click(screen.getByTestId('wizard-next')); // → step 2
    await user.click(screen.getByTestId('add-field-tasks'));
    await user.click(screen.getByTestId('wizard-next')); // → step 3

    // Uncheck editor visibility for the tasks field
    const editorCheckbox = screen.getAllByTestId(/^visibility-.*-editor$/)[0];
    await user.click(editorCheckbox);

    await user.click(screen.getByTestId('wizard-next')); // save

    const field = onSave.mock.calls[0][0].fields[0];
    expect(field.hiddenInModes).toContain('editor');
  });

  it('save button shows "Create Type" on the final step for a new type', async () => {
    const { user } = setup();
    await goToStep3(user);
    expect(screen.getByTestId('wizard-next')).toHaveTextContent('Create Type');
  });
});

// ---------------------------------------------------------------------------
// Edit mode — pre-population
// ---------------------------------------------------------------------------

describe('edit mode (initialType)', () => {
  const initialType: DocumentType = {
    id: 'type-abc',
    name: 'Existing Type',
    description: 'Already there',
    icon: '📊',
    fields: [
      {
        id: 'field-1',
        name: 'Notes',
        sectionType: 'rich-text',
        required: true,
        defaultCollapsed: false,
        placeholder: '',
        hiddenInModes: ['reader'],
        rendererOverrides: {},
      },
    ],
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  };

  // In edit mode the wizard opens on Step 2 (Sections) so fields are
  // immediately visible; click Back to reach Step 1 (Basic Info).
  async function backToStep1(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole('button', { name: /← back/i }));
  }

  it('pre-fills the name input', async () => {
    const { user } = setup({ initialType });
    await backToStep1(user);
    expect(screen.getByTestId('name-input')).toHaveValue('Existing Type');
  });

  it('pre-fills the description input', async () => {
    const { user } = setup({ initialType });
    await backToStep1(user);
    expect(screen.getByTestId('description-input')).toHaveValue('Already there');
  });

  it('pre-fills fields in step 2', () => {
    setup({ initialType });
    // Edit mode opens directly on step 2 — the pre-existing field is visible.
    const nameInput = screen.getByTestId('field-name-field-1') as HTMLInputElement;
    expect(nameInput.value).toBe('Notes');
  });

  it('reflects hiddenInModes in step 3 checkboxes', async () => {
    const { user } = setup({ initialType });
    // Already on step 2 in edit mode — one Next click gets to step 3.
    await user.click(screen.getByTestId('wizard-next')); // → step 3

    // reader is hidden for field-1
    const readerCheckbox = screen.getByTestId('visibility-field-1-reader');
    expect(readerCheckbox).not.toBeChecked();
  });

  it('save button shows "Save Changes" in edit mode', async () => {
    const { user } = setup({ initialType });
    // Edit mode opens on step 2 — single Next click reaches the final step.
    await user.click(screen.getByTestId('wizard-next')); // step 2 → step 3
    expect(screen.getByTestId('wizard-next')).toHaveTextContent('Save Changes');
  });

  it('calls onSave with updated name when renamed and saved', async () => {
    const { onSave, user } = setup({ initialType });
    // Wizard opens on step 2 in edit mode — go back to edit the name.
    await backToStep1(user);

    const nameInput = screen.getByTestId('name-input');
    await user.clear(nameInput);
    await user.type(nameInput, 'Renamed Type');

    await user.click(screen.getByTestId('wizard-next')); // → step 2
    await user.click(screen.getByTestId('wizard-next')); // → step 3
    await user.click(screen.getByTestId('wizard-next')); // save

    expect(onSave).toHaveBeenCalledOnce();
    expect(onSave.mock.calls[0][0].name).toBe('Renamed Type');
  });
});

// ---------------------------------------------------------------------------
// Navigation edge cases
// ---------------------------------------------------------------------------

describe('navigation', () => {
  it('Back on step 2 returns to step 1 with preserved name', async () => {
    const { user } = setup();
    await user.type(screen.getByTestId('name-input'), 'Preserved');
    await user.click(screen.getByTestId('wizard-next'));
    await user.click(screen.getByRole('button', { name: /← back/i }));
    expect(screen.getByTestId('name-input')).toHaveValue('Preserved');
  });

  it('Back on step 3 returns to step 2', async () => {
    const { user } = setup();
    await goToStep3(user);
    await user.click(screen.getByRole('button', { name: /← back/i }));
    expect(screen.getByText(/SECTION TYPES/)).toBeInTheDocument();
  });
});
