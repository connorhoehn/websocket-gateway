// Phase 51 Phase A + B — auto-generated form for an API-shaped DocumentType.
//
// Widget mapping:
//   - text + cardinality=1       → <input type="text">
//   - long_text + cardinality=1  → <textarea>
//   - number + cardinality=1     → <input type="number">
//   - date + cardinality=1       → <input type="date">
//   - boolean + cardinality=1    → <input type="checkbox">
//   - text/number/date + cardinality=unlimited → list of inputs with + / −
//   - boolean + unlimited is REJECTED at the backend (semantically meaningless)
//
// Form internal state stores text-shaped values as strings; numbers are
// coerced via Number() at submit time, dates pass through as ISO strings,
// booleans live as actual booleans tied to checkbox state.

import { useState } from 'react';
import type { ApiDocumentType, ApiDocumentTypeField, TypedDocumentValue } from '../../hooks/useTypedDocuments';

// Form state per field. Booleans are stored natively; everything else is a
// string (or string array for unlimited) for clean input wiring.
type SingleStored = string | boolean;
type FieldStored = SingleStored | string[];

interface FormState {
  [fieldId: string]: FieldStored;
}

export interface TypedDocumentFormProps {
  type: ApiDocumentType;
  onSubmit: (values: Record<string, TypedDocumentValue>) => Promise<void>;
  /** Reset to defaults after a successful submit (default true). */
  resetOnSubmit?: boolean;
}

function defaultForField(field: ApiDocumentTypeField): FieldStored {
  if (field.cardinality === 'unlimited') return [''];
  if (field.fieldType === 'boolean') return false;
  return '';
}

function coerceSingle(field: ApiDocumentTypeField, raw: SingleStored): TypedDocumentValue | null {
  switch (field.fieldType) {
    case 'text':
    case 'long_text':
      return typeof raw === 'string' && raw !== '' ? raw : null;
    case 'date':
      return typeof raw === 'string' && raw !== '' ? raw : null;
    case 'number': {
      if (typeof raw !== 'string' || raw.trim() === '') return null;
      const n = Number(raw);
      return Number.isFinite(n) ? n : null;
    }
    case 'boolean':
      return typeof raw === 'boolean' ? raw : null;
  }
}

function coerceUnlimited(field: ApiDocumentTypeField, arr: string[]): TypedDocumentValue | null {
  const out: (string | number)[] = [];
  for (const entry of arr) {
    if (entry.trim() === '') continue;
    if (field.fieldType === 'number') {
      const n = Number(entry);
      if (!Number.isFinite(n)) return null; // signal a coercion error
      out.push(n);
    } else {
      out.push(entry);
    }
  }
  return out.length > 0 ? (out as string[] | number[]) : null;
}

export function TypedDocumentForm({ type, onSubmit, resetOnSubmit = true }: TypedDocumentFormProps): JSX.Element {
  const [values, setValues] = useState<FormState>(() => {
    const init: FormState = {};
    for (const f of type.fields) init[f.fieldId] = defaultForField(f);
    return init;
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successKey, setSuccessKey] = useState(0);

  const setField = (fieldId: string, v: FieldStored): void => {
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

    // Required-field check + per-type coercion in one pass.
    const cleaned: Record<string, TypedDocumentValue> = {};
    for (const field of type.fields) {
      const stored = values[field.fieldId];
      let coerced: TypedDocumentValue | null;
      if (field.cardinality === 'unlimited') {
        coerced = coerceUnlimited(field, Array.isArray(stored) ? stored : []);
        if (coerced === null && Array.isArray(stored) && stored.some((s) => s.trim() !== '')) {
          // Some entries present but coercion failed — number parse error.
          setError(`${field.name}: invalid value for ${field.fieldType}`);
          return;
        }
      } else {
        coerced = coerceSingle(field, stored as SingleStored);
      }

      if (field.required && (coerced === null || (typeof coerced === 'boolean' && !coerced && field.fieldType !== 'boolean'))) {
        // boolean fields don't have a "missing" state — false is a valid
        // present value. The (typeof === 'boolean' && !coerced) clause is
        // guarded by field.fieldType !== 'boolean' so an unchecked required
        // boolean still passes through (Phase D will add a "must-be-true"
        // validation rule if operators need it).
        setError(`${field.name} is required`);
        return;
      }
      // Boolean false IS a valid coerced value — coerceSingle returns it
      // explicitly. Skip null-coerced (i.e. truly empty) optional fields.
      if (coerced !== null) cleaned[field.fieldId] = coerced;
    }

    setSubmitting(true);
    try {
      await onSubmit(cleaned);
      if (resetOnSubmit) {
        const reset: FormState = {};
        for (const f of type.fields) reset[f.fieldId] = defaultForField(f);
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
                onChange={(e) => setField(field.fieldId, e.target.value)}
                rows={4}
                style={{ fontFamily: 'inherit', fontSize: 13, padding: 8, border: '1px solid #cbd5e1', borderRadius: 6 }}
              />
            )}

            {field.cardinality === 1 && field.widget === 'text_field' && (
              <input
                data-testid={`input-${field.fieldId}`}
                type="text"
                value={typeof v === 'string' ? v : ''}
                onChange={(e) => setField(field.fieldId, e.target.value)}
                style={{ fontFamily: 'inherit', fontSize: 13, padding: 8, border: '1px solid #cbd5e1', borderRadius: 6 }}
              />
            )}

            {field.cardinality === 1 && field.widget === 'number_input' && (
              <input
                data-testid={`input-${field.fieldId}`}
                type="number"
                value={typeof v === 'string' ? v : ''}
                onChange={(e) => setField(field.fieldId, e.target.value)}
                style={{ fontFamily: 'inherit', fontSize: 13, padding: 8, border: '1px solid #cbd5e1', borderRadius: 6 }}
              />
            )}

            {field.cardinality === 1 && field.widget === 'date_picker' && (
              <input
                data-testid={`input-${field.fieldId}`}
                type="date"
                value={typeof v === 'string' ? v : ''}
                onChange={(e) => setField(field.fieldId, e.target.value)}
                style={{ fontFamily: 'inherit', fontSize: 13, padding: 8, border: '1px solid #cbd5e1', borderRadius: 6 }}
              />
            )}

            {field.cardinality === 1 && field.widget === 'checkbox' && (
              <input
                data-testid={`input-${field.fieldId}`}
                type="checkbox"
                checked={typeof v === 'boolean' ? v : false}
                onChange={(e) => setField(field.fieldId, e.target.checked)}
                style={{ alignSelf: 'flex-start' }}
              />
            )}

            {field.cardinality === 'unlimited' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {(Array.isArray(v) ? v : ['']).map((entry, idx) => (
                  <div key={idx} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <input
                      data-testid={`input-${field.fieldId}-${idx}`}
                      type={field.widget === 'number_input' ? 'number' : field.widget === 'date_picker' ? 'date' : 'text'}
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
