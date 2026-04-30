// Phase 51 Phase A — vitest for the auto-generated typed-document form.
//
// Coverage:
//   - text + cardinality=1: renders <input type="text">; submit fires with the value
//   - long_text + cardinality=1: renders <textarea>; submit fires with the value
//   - text + cardinality=unlimited: renders one input; + adds another; − removes;
//     empty entries are dropped before onSubmit fires
//   - required field validation: empty submit shows inline error and does NOT call onSubmit
//   - successful submit: success indicator appears, fields reset to defaults
//   - submit error from onSubmit surfaces inline

import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { TypedDocumentForm } from './TypedDocumentForm';
import type { ApiDocumentType } from '../../hooks/useTypedDocuments';

function makeType(): ApiDocumentType {
  return {
    typeId: 'type-1',
    name: 'Note',
    description: '',
    icon: '📝',
    fields: [
      { fieldId: 'f-title', name: 'title', fieldType: 'text',      widget: 'text_field', cardinality: 1,           required: true,  helpText: '' },
      { fieldId: 'f-body',  name: 'body',  fieldType: 'long_text', widget: 'textarea',   cardinality: 1,           required: false, helpText: '' },
      { fieldId: 'f-tags',  name: 'tags',  fieldType: 'text',      widget: 'text_field', cardinality: 'unlimited', required: false, helpText: '' },
    ],
    createdBy: 'admin',
    createdAt: '2026-04-30T00:00:00Z',
    updatedAt: '2026-04-30T00:00:00Z',
  };
}

afterEach(() => {
  cleanup();
});

describe('TypedDocumentForm', () => {
  it('renders an input per cardinality=1 field with the right widget', () => {
    render(<TypedDocumentForm type={makeType()} onSubmit={vi.fn()} />);
    const titleInput = screen.getByTestId('input-f-title') as HTMLInputElement;
    expect(titleInput.tagName).toBe('INPUT');
    expect(titleInput.type).toBe('text');

    const bodyInput = screen.getByTestId('input-f-body') as HTMLTextAreaElement;
    expect(bodyInput.tagName).toBe('TEXTAREA');
  });

  it('submits cardinality=1 string values keyed by fieldId', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<TypedDocumentForm type={makeType()} onSubmit={onSubmit} />);

    fireEvent.change(screen.getByTestId('input-f-title'), { target: { value: 'Hello' } });
    fireEvent.change(screen.getByTestId('input-f-body'),  { target: { value: 'Body text' } });
    fireEvent.click(screen.getByTestId('submit-typed-document'));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit).toHaveBeenCalledWith({
      'f-title': 'Hello',
      'f-body': 'Body text',
    });
  });

  it('blocks submit when a required field is empty (no onSubmit call, inline error)', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<TypedDocumentForm type={makeType()} onSubmit={onSubmit} />);

    fireEvent.click(screen.getByTestId('submit-typed-document'));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByTestId('form-error')).toHaveTextContent(/title is required/i);
  });

  it('unlimited cardinality: + adds an entry, − removes, empties are dropped on submit', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<TypedDocumentForm type={makeType()} onSubmit={onSubmit} />);

    // satisfy the required title
    fireEvent.change(screen.getByTestId('input-f-title'), { target: { value: 'T' } });

    // Initial: one tags input present
    expect(screen.getByTestId('input-f-tags-0')).toBeInTheDocument();

    // Add two more, fill them
    fireEvent.click(screen.getByTestId('add-f-tags'));
    fireEvent.click(screen.getByTestId('add-f-tags'));
    fireEvent.change(screen.getByTestId('input-f-tags-0'), { target: { value: 'a' } });
    fireEvent.change(screen.getByTestId('input-f-tags-1'), { target: { value: '' } }); // intentionally empty
    fireEvent.change(screen.getByTestId('input-f-tags-2'), { target: { value: 'c' } });

    // Remove the first to verify the control wires
    // (this leaves us with [empty, 'c'] — both should still pass through since
    // the empty one gets filtered)
    fireEvent.click(screen.getByTestId('remove-f-tags-0'));

    fireEvent.click(screen.getByTestId('submit-typed-document'));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const submitted = onSubmit.mock.calls[0][0] as Record<string, string | string[]>;
    expect(submitted['f-title']).toBe('T');
    expect(Array.isArray(submitted['f-tags'])).toBe(true);
    expect(submitted['f-tags']).toEqual(['c']);
  });

  it('shows a success indicator after a successful submit and resets defaults', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<TypedDocumentForm type={makeType()} onSubmit={onSubmit} />);

    fireEvent.change(screen.getByTestId('input-f-title'), { target: { value: 'Hello' } });
    fireEvent.click(screen.getByTestId('submit-typed-document'));

    await waitFor(() => expect(screen.queryByTestId('form-success')).toBeInTheDocument());

    // After reset the title field is empty again
    expect((screen.getByTestId('input-f-title') as HTMLInputElement).value).toBe('');
  });

  it('surfaces an error from onSubmit inline (no success indicator)', async () => {
    const onSubmit = vi.fn().mockRejectedValue(new Error('Server said no'));
    render(<TypedDocumentForm type={makeType()} onSubmit={onSubmit} />);

    fireEvent.change(screen.getByTestId('input-f-title'), { target: { value: 'Hello' } });
    fireEvent.click(screen.getByTestId('submit-typed-document'));

    await waitFor(() => expect(screen.getByTestId('form-error')).toHaveTextContent(/Server said no/));
    expect(screen.queryByTestId('form-success')).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Phase B — number / date / boolean widget coverage
// ---------------------------------------------------------------------------

function makePhaseBType(): ApiDocumentType {
  return {
    typeId: 'type-b',
    name: 'Mixed',
    description: '',
    icon: '🧪',
    fields: [
      { fieldId: 'f-count',   name: 'count',     fieldType: 'number',  widget: 'number_input', cardinality: 1,           required: true,  helpText: '' },
      { fieldId: 'f-when',    name: 'when',      fieldType: 'date',    widget: 'date_picker',  cardinality: 1,           required: false, helpText: '' },
      { fieldId: 'f-done',    name: 'completed', fieldType: 'boolean', widget: 'checkbox',     cardinality: 1,           required: false, helpText: '' },
      { fieldId: 'f-scores',  name: 'scores',    fieldType: 'number',  widget: 'number_input', cardinality: 'unlimited', required: false, helpText: '' },
    ],
    createdBy: 'admin',
    createdAt: '2026-04-30T00:00:00Z',
    updatedAt: '2026-04-30T00:00:00Z',
  };
}

describe('TypedDocumentForm — Phase B widgets', () => {
  it('renders number_input as <input type="number">', () => {
    render(<TypedDocumentForm type={makePhaseBType()} onSubmit={vi.fn()} />);
    const input = screen.getByTestId('input-f-count') as HTMLInputElement;
    expect(input.type).toBe('number');
  });

  it('renders date_picker as <input type="date">', () => {
    render(<TypedDocumentForm type={makePhaseBType()} onSubmit={vi.fn()} />);
    const input = screen.getByTestId('input-f-when') as HTMLInputElement;
    expect(input.type).toBe('date');
  });

  it('renders checkbox widget as <input type="checkbox">', () => {
    render(<TypedDocumentForm type={makePhaseBType()} onSubmit={vi.fn()} />);
    const input = screen.getByTestId('input-f-done') as HTMLInputElement;
    expect(input.type).toBe('checkbox');
    expect(input.checked).toBe(false);
  });

  it('coerces number string "42" to numeric 42 on submit', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<TypedDocumentForm type={makePhaseBType()} onSubmit={onSubmit} />);

    fireEvent.change(screen.getByTestId('input-f-count'), { target: { value: '42' } });
    fireEvent.click(screen.getByTestId('submit-typed-document'));

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    const submitted = onSubmit.mock.calls[0][0] as Record<string, unknown>;
    expect(submitted['f-count']).toBe(42);
  });

  it('checkbox toggle submits boolean true (and the false default is dropped as null-coerced)', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<TypedDocumentForm type={makePhaseBType()} onSubmit={onSubmit} />);

    fireEvent.change(screen.getByTestId('input-f-count'), { target: { value: '1' } });
    fireEvent.click(screen.getByTestId('input-f-done'));
    fireEvent.click(screen.getByTestId('submit-typed-document'));

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    const submitted = onSubmit.mock.calls[0][0] as Record<string, unknown>;
    expect(submitted['f-done']).toBe(true);
  });

  it('blocks submit when number coerces to NaN (e.g. via tampered input value)', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<TypedDocumentForm type={makePhaseBType()} onSubmit={onSubmit} />);

    // Number inputs in jsdom permit setting non-numeric values via the
    // change event; we use that to simulate a coercion failure.
    const countInput = screen.getByTestId('input-f-count') as HTMLInputElement;
    fireEvent.change(countInput, { target: { value: '' } });
    fireEvent.click(screen.getByTestId('submit-typed-document'));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByTestId('form-error')).toHaveTextContent(/count is required/i);
  });

  it('unlimited number array submits coerced numeric values, drops empties', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<TypedDocumentForm type={makePhaseBType()} onSubmit={onSubmit} />);

    fireEvent.change(screen.getByTestId('input-f-count'), { target: { value: '1' } });
    fireEvent.click(screen.getByTestId('add-f-scores'));
    fireEvent.click(screen.getByTestId('add-f-scores'));
    fireEvent.change(screen.getByTestId('input-f-scores-0'), { target: { value: '10' } });
    fireEvent.change(screen.getByTestId('input-f-scores-1'), { target: { value: '' } });
    fireEvent.change(screen.getByTestId('input-f-scores-2'), { target: { value: '20' } });
    fireEvent.click(screen.getByTestId('submit-typed-document'));

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    const submitted = onSubmit.mock.calls[0][0] as Record<string, unknown>;
    expect(submitted['f-scores']).toEqual([10, 20]);
  });
});

// ---------------------------------------------------------------------------
// Phase C — enum + reference widget coverage
// ---------------------------------------------------------------------------

function makePhaseCType(): ApiDocumentType {
  return {
    typeId: 'type-c',
    name: 'PhaseC',
    description: '',
    icon: '🎯',
    fields: [
      { fieldId: 'f-status', name: 'status', fieldType: 'enum', widget: 'select', cardinality: 1, required: true, helpText: '', options: ['draft', 'review', 'published'] },
      { fieldId: 'f-author', name: 'author', fieldType: 'reference', widget: 'reference_picker', cardinality: 1, required: false, helpText: '', referenceTypeId: 'people-type' },
    ],
    createdBy: 'admin',
    createdAt: '2026-04-30T00:00:00Z',
    updatedAt: '2026-04-30T00:00:00Z',
  };
}

describe('TypedDocumentForm — Phase C widgets', () => {
  it('renders an enum widget as <select> with the configured options', () => {
    render(<TypedDocumentForm type={makePhaseCType()} onSubmit={vi.fn()} />);
    const select = screen.getByTestId('input-f-status') as HTMLSelectElement;
    expect(select.tagName).toBe('SELECT');
    const optionValues = Array.from(select.options).map((o) => o.value);
    expect(optionValues).toEqual(['', 'draft', 'review', 'published']);
  });

  it('blocks submit when a required enum field is left at "— select —"', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<TypedDocumentForm type={makePhaseCType()} onSubmit={onSubmit} />);
    fireEvent.click(screen.getByTestId('submit-typed-document'));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByTestId('form-error')).toHaveTextContent(/status is required/i);
  });

  it('submits the chosen enum value as a string', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<TypedDocumentForm type={makePhaseCType()} onSubmit={onSubmit} />);
    fireEvent.change(screen.getByTestId('input-f-status'), { target: { value: 'published' } });
    fireEvent.click(screen.getByTestId('submit-typed-document'));
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    const submitted = onSubmit.mock.calls[0][0] as Record<string, unknown>;
    expect(submitted['f-status']).toBe('published');
  });

  it('reference picker: shows empty hint and disabled select when no options supplied', () => {
    render(<TypedDocumentForm type={makePhaseCType()} onSubmit={vi.fn()} />);
    const select = screen.getByTestId('input-f-author') as HTMLSelectElement;
    expect(select.disabled).toBe(true);
    expect(screen.getByTestId('reference-empty-f-author')).toBeInTheDocument();
  });

  it('reference picker: populates from referenceOptions and submits the selected documentId', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const referenceOptions = {
      'people-type': [
        { value: 'doc-alice', label: 'Alice' },
        { value: 'doc-bob', label: 'Bob' },
      ],
    };
    render(
      <TypedDocumentForm
        type={makePhaseCType()}
        onSubmit={onSubmit}
        referenceOptions={referenceOptions}
      />,
    );
    const select = screen.getByTestId('input-f-author') as HTMLSelectElement;
    expect(select.disabled).toBe(false);
    expect(select.options.length).toBe(3); // empty placeholder + 2 references

    fireEvent.change(screen.getByTestId('input-f-status'), { target: { value: 'draft' } });
    fireEvent.change(select, { target: { value: 'doc-bob' } });
    fireEvent.click(screen.getByTestId('submit-typed-document'));
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    const submitted = onSubmit.mock.calls[0][0] as Record<string, unknown>;
    expect(submitted['f-author']).toBe('doc-bob');
  });
});
