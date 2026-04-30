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
