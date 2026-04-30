// Phase 51 Phase A — auto-generated form for an API-shaped DocumentType.
//
// Given an ApiDocumentType, render an input per field:
//   - text + cardinality=1       → <input type="text">
//   - long_text + cardinality=1  → <textarea>
//   - text + cardinality=unlimited → list of <input>s with + / − controls
//
// Submit: validates required fields are non-empty, then calls onSubmit with
// values keyed by fieldId. Submit errors surface inline at the top of the
// form (no toast — the page wires error handling separately).

import { useState } from 'react';
import type { ApiDocumentType, ApiDocumentTypeField } from '../../hooks/useTypedDocuments';

interface FormValue {
  [fieldId: string]: string | string[];
}

export interface TypedDocumentFormProps {
  type: ApiDocumentType;
  onSubmit: (values: Record<string, string | string[]>) => Promise<void>;
  /** Reset to defaults after a successful submit (default true). */
  resetOnSubmit?: boolean;
}

function defaultValueForField(field: ApiDocumentTypeField): string | string[] {
  return field.cardinality === 'unlimited' ? [''] : '';
}

export function TypedDocumentForm({ type, onSubmit, resetOnSubmit = true }: TypedDocumentFormProps): JSX.Element {
  const [values, setValues] = useState<FormValue>(() => {
    const init: FormValue = {};
    for (const f of type.fields) init[f.fieldId] = defaultValueForField(f);
    return init;
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successKey, setSuccessKey] = useState(0);

  const setSingle = (fieldId: string, v: string): void => {
    setValues((prev) => ({ ...prev, [fieldId]: v }));
  };
  const setArrayAt = (fieldId: string, idx: number, v: string): void => {
    setValues((prev) => {
      const arr = Array.isArray(prev[fieldId]) ? [...(prev[fieldId] as string[])] : [];
      arr[idx] = v;
      return { ...prev, [fieldId]: arr };
    });
  };
  const addArrayEntry = (fieldId: string): void => {
    setValues((prev) => {
      const arr = Array.isArray(prev[fieldId]) ? [...(prev[fieldId] as string[]), ''] : [''];
      return { ...prev, [fieldId]: arr };
    });
  };
  const removeArrayEntry = (fieldId: string, idx: number): void => {
    setValues((prev) => {
      const arr = Array.isArray(prev[fieldId]) ? [...(prev[fieldId] as string[])] : [];
      arr.splice(idx, 1);
      return { ...prev, [fieldId]: arr.length ? arr : [''] };
    });
  };

  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setError(null);

    for (const field of type.fields) {
      const v = values[field.fieldId];
      if (field.required) {
        if (Array.isArray(v)) {
          if (v.every((s) => s.trim() === '')) {
            setError(`${field.name} is required`);
            return;
          }
        } else if (!v || v.trim() === '') {
          setError(`${field.name} is required`);
          return;
        }
      }
    }

    const cleaned: Record<string, string | string[]> = {};
    for (const field of type.fields) {
      const v = values[field.fieldId];
      if (Array.isArray(v)) {
        const filtered = v.filter((s) => s.trim() !== '');
        if (filtered.length > 0) cleaned[field.fieldId] = filtered;
      } else if (v.trim() !== '') {
        cleaned[field.fieldId] = v;
      }
    }

    setSubmitting(true);
    try {
      await onSubmit(cleaned);
      if (resetOnSubmit) {
        const reset: FormValue = {};
        for (const f of type.fields) reset[f.fieldId] = defaultValueForField(f);
        setValues(reset);
      }
      setSuccessKey((k) => k + 1);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} data-testid="typed-document-form" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ fontSize: 16, fontWeight: 600, color: '#0f172a' }}>
        New {type.name}
      </div>

      {error && (
        <div data-testid="form-error" role="alert" style={{ color: '#dc2626', fontSize: 13 }}>
          {error}
        </div>
      )}
      {successKey > 0 && !error && (
        <div data-testid="form-success" key={successKey} style={{ color: '#16a34a', fontSize: 13 }}>
          ✓ Saved
        </div>
      )}

      {type.fields.map((field) => {
        const v = values[field.fieldId];

        return (
          <div key={field.fieldId} data-testid={`field-${field.fieldId}`} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <label style={{ fontSize: 13, fontWeight: 500, color: '#374151' }}>
              {field.name}
              {field.required && <span style={{ color: '#dc2626', marginLeft: 4 }}>*</span>}
            </label>

            {field.cardinality === 1 && field.widget === 'textarea' && (
              <textarea
                data-testid={`input-${field.fieldId}`}
                value={typeof v === 'string' ? v : ''}
                onChange={(e) => setSingle(field.fieldId, e.target.value)}
                rows={4}
                style={{ fontFamily: 'inherit', fontSize: 13, padding: 8, border: '1px solid #cbd5e1', borderRadius: 6 }}
              />
            )}

            {field.cardinality === 1 && field.widget === 'text_field' && (
              <input
                data-testid={`input-${field.fieldId}`}
                type="text"
                value={typeof v === 'string' ? v : ''}
                onChange={(e) => setSingle(field.fieldId, e.target.value)}
                style={{ fontFamily: 'inherit', fontSize: 13, padding: 8, border: '1px solid #cbd5e1', borderRadius: 6 }}
              />
            )}

            {field.cardinality === 'unlimited' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {(Array.isArray(v) ? v : ['']).map((entry, idx) => (
                  <div key={idx} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <input
                      data-testid={`input-${field.fieldId}-${idx}`}
                      type="text"
                      value={entry}
                      onChange={(e) => setArrayAt(field.fieldId, idx, e.target.value)}
                      style={{ flex: 1, fontFamily: 'inherit', fontSize: 13, padding: 8, border: '1px solid #cbd5e1', borderRadius: 6 }}
                    />
                    <button
                      type="button"
                      data-testid={`remove-${field.fieldId}-${idx}`}
                      onClick={() => removeArrayEntry(field.fieldId, idx)}
                      style={{ background: 'none', border: '1px solid #cbd5e1', color: '#94a3b8', cursor: 'pointer', borderRadius: 6, padding: '4px 10px', fontSize: 13 }}
                    >
                      −
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  data-testid={`add-${field.fieldId}`}
                  onClick={() => addArrayEntry(field.fieldId)}
                  style={{ alignSelf: 'flex-start', background: 'none', border: '1px dashed #cbd5e1', color: '#646cff', cursor: 'pointer', borderRadius: 6, padding: '4px 12px', fontSize: 13 }}
                >
                  + Add another
                </button>
              </div>
            )}

            {field.helpText && (
              <span style={{ fontSize: 11, color: '#94a3b8' }}>{field.helpText}</span>
            )}
          </div>
        );
      })}

      <button
        type="submit"
        data-testid="submit-typed-document"
        disabled={submitting}
        style={{
          alignSelf: 'flex-start',
          padding: '8px 18px',
          fontSize: 13,
          fontWeight: 600,
          background: submitting ? '#a5b4fc' : '#646cff',
          color: '#fff',
          border: 'none',
          borderRadius: 6,
          cursor: submitting ? 'wait' : 'pointer',
          fontFamily: 'inherit',
        }}
      >
        {submitting ? 'Saving…' : 'Save'}
      </button>
    </form>
  );
}
