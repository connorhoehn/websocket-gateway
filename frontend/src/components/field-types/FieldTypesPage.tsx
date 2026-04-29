// frontend/src/components/field-types/FieldTypesPage.tsx
//
// Admin page for managing custom data types.
// Data types define the primitive storage type a document section holds.
// Built-in renderer wrappers (Task List, Rich Text, etc.) are NOT shown here —
// those belong to Document Types. Only user-defined data types live here.
//
// State machine: idle → create → idle  |  idle → edit → idle
// Delete flows through a confirmation modal.

import { useState } from 'react';
import { useCustomFieldTypes } from '../../hooks/useCustomFieldTypes';
import type { CustomFieldType } from '../../types/fieldType';

// ---------------------------------------------------------------------------
// Primitive storage types — Drupal-style field type catalogue
// ---------------------------------------------------------------------------

interface PrimitiveStorageType {
  id: string;
  label: string;
  description: string;
  /** Renderer key to delegate to. null = no renderer yet (coming soon). */
  rendererBase: string | null;
}

const PRIMITIVE_STORAGE_TYPES: PrimitiveStorageType[] = [
  { id: 'boolean',               label: 'Boolean',               description: 'A true or false value.',                                    rendererBase: null },
  { id: 'decimal',               label: 'Decimal',               description: 'A decimal (fixed-point) number.',                           rendererBase: null },
  { id: 'float',                 label: 'Float',                 description: 'A floating-point number.',                                  rendererBase: null },
  { id: 'image',                 label: 'Image',                 description: 'An image file with optional alt text and caption.',          rendererBase: null },
  { id: 'integer',               label: 'Integer',               description: 'A whole number.',                                           rendererBase: null },
  { id: 'list_float',            label: 'List (float)',          description: 'An enumerated list of floating-point values.',               rendererBase: null },
  { id: 'list_integer',          label: 'List (integer)',        description: 'An enumerated list of integer values.',                      rendererBase: null },
  { id: 'list_text',             label: 'List (text)',           description: 'An enumerated list of plain-text values.',                   rendererBase: 'checklist' },
  { id: 'long_text',             label: 'Long text',             description: 'Multi-line plain text.',                                    rendererBase: 'rich-text' },
  { id: 'long_text_and_summary', label: 'Long text and summary', description: 'Formatted text with an optional teaser/summary.',           rendererBase: 'rich-text' },
  { id: 'term_reference',        label: 'Term reference',        description: 'A reference to a controlled-vocabulary taxonomy term.',      rendererBase: null },
  { id: 'text',                  label: 'Text',                  description: 'Short plain text, single line.',                            rendererBase: 'rich-text' },
];

const AVAILABLE = PRIMITIVE_STORAGE_TYPES.filter(p => p.rendererBase !== null);
const COMING_SOON = PRIMITIVE_STORAGE_TYPES.filter(p => p.rendererBase === null);

// ---------------------------------------------------------------------------
// Shared micro-styles
// ---------------------------------------------------------------------------

const btn = (variant: 'primary' | 'secondary' | 'ghost' | 'danger', disabled = false): React.CSSProperties => {
  const base: React.CSSProperties = {
    padding: '7px 16px', fontSize: 13, fontWeight: 600, borderRadius: 7,
    cursor: disabled ? 'not-allowed' : 'pointer', fontFamily: 'inherit',
    border: '1px solid transparent', opacity: disabled ? 0.5 : 1,
  };
  if (variant === 'primary')   return { ...base, background: '#646cff', color: '#fff', border: 'none' };
  if (variant === 'secondary') return { ...base, background: '#fff', color: '#374151', border: '1px solid #d1d5db' };
  if (variant === 'danger')    return { ...base, background: '#fff', color: '#dc2626', border: '1px solid #fca5a5' };
  return { ...base, background: 'none', color: '#64748b', border: 'none' };
};

const inputStyle: React.CSSProperties = {
  width: '100%', boxSizing: 'border-box',
  border: '1px solid #d1d5db', borderRadius: 7, padding: '8px 12px',
  fontSize: 14, fontFamily: 'inherit', background: '#f9fafb', color: '#0f172a',
  outline: 'none',
};

const labelStyle: React.CSSProperties = {
  display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 5,
};

// ---------------------------------------------------------------------------
// Delete confirmation modal
// ---------------------------------------------------------------------------

function DeleteModal({ name, onConfirm, onCancel }: {
  name: string; onConfirm: () => void; onCancel: () => void;
}) {
  return (
    <div
      data-testid="delete-modal"
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}
      onClick={onCancel}
    >
      <div
        style={{ background: '#fff', borderRadius: 10, padding: '28px 32px', maxWidth: 400, width: '90vw', boxShadow: '0 8px 32px rgba(0,0,0,0.18)' }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ fontSize: 17, fontWeight: 700, color: '#0f172a', marginBottom: 8 }}>Delete data type?</div>
        <p style={{ fontSize: 13, color: '#64748b', marginBottom: 20 }}>
          <strong>{name}</strong> will be removed. Document types that reference it will keep their existing sections, but this type won't appear in the picker for new sections.
        </p>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button data-testid="cancel-delete" onClick={onCancel} style={btn('secondary')}>Cancel</button>
          <button data-testid="confirm-delete" onClick={onConfirm} style={btn('danger')}>Delete</button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step indicator
// ---------------------------------------------------------------------------

function StepIndicator({ step }: { step: 1 | 2 }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', marginBottom: 28 }}>
      {([
        [1, 'Storage type'],
        [2, 'Display'],
      ] as const).map(([n, label], i) => {
        const active = n === step;
        const done   = n < step;
        return (
          <div key={n} style={{ display: 'flex', alignItems: 'center' }}>
            <div style={{
              width: 26, height: 26, borderRadius: '50%', flexShrink: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 12, fontWeight: 700,
              background: done ? '#646cff' : active ? '#ede9fe' : '#f1f5f9',
              color: done ? '#fff' : active ? '#4c1d95' : '#94a3b8',
              border: active ? '2px solid #646cff' : '2px solid transparent',
            }}>
              {done ? '✓' : n}
            </div>
            <span style={{
              marginLeft: 6, fontSize: 12, fontWeight: active ? 600 : 400,
              color: active ? '#0f172a' : '#94a3b8', whiteSpace: 'nowrap',
            }}>
              {label}
            </span>
            {i < 1 && (
              <div style={{ width: 28, height: 1, background: '#e2e8f0', margin: '0 10px', flexShrink: 0 }} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 1 — Label + Storage type
// ---------------------------------------------------------------------------

function Step1({
  name, setName,
  description, setDescription,
  primitiveType, setPrimitiveType,
  nameError,
}: {
  name: string; setName: (v: string) => void;
  description: string; setDescription: (v: string) => void;
  primitiveType: string; setPrimitiveType: (v: string) => void;
  nameError: string;
}) {
  const selected = PRIMITIVE_STORAGE_TYPES.find(p => p.id === primitiveType);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div>
        <span style={labelStyle}>Label <span style={{ color: '#dc2626' }}>*</span></span>
        <input
          data-testid="name-input"
          style={inputStyle}
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="e.g. Article title, Publication date, Author bio…"
          maxLength={80}
          autoFocus
        />
        {nameError && <div style={{ color: '#dc2626', fontSize: 12, marginTop: 4 }}>{nameError}</div>}
      </div>

      <div>
        <span style={labelStyle}>Description</span>
        <textarea
          data-testid="description-input"
          style={{ ...inputStyle, minHeight: 64, resize: 'vertical' }}
          value={description}
          onChange={e => setDescription(e.target.value)}
          placeholder="Optional — describe when and how this field is used"
          maxLength={300}
        />
      </div>

      <div>
        <span style={labelStyle}>
          Field type <span style={{ fontWeight: 400, color: '#94a3b8' }}>— what kind of data this field stores</span>
        </span>

        {/* Drupal-style select */}
        <select
          data-testid="primitive-type-select"
          value={primitiveType}
          onChange={e => setPrimitiveType(e.target.value)}
          style={{
            ...inputStyle,
            cursor: 'pointer',
            appearance: 'auto',
          }}
        >
          <option value="">— Select a field type —</option>
          <optgroup label="Available now">
            {AVAILABLE.map(p => (
              <option key={p.id} value={p.id}>{p.label}</option>
            ))}
          </optgroup>
          <optgroup label="Coming soon">
            {COMING_SOON.map(p => (
              <option key={p.id} value={p.id} disabled>{p.label}</option>
            ))}
          </optgroup>
        </select>

        {/* Description of selected type */}
        {selected && (
          <div style={{
            marginTop: 10, padding: '10px 14px', borderRadius: 7,
            background: '#f8fafc', border: '1px solid #e2e8f0',
            fontSize: 13, color: '#475569',
          }}>
            <strong style={{ color: '#0f172a' }}>{selected.label}</strong> — {selected.description}
            {selected.rendererBase && (
              <span style={{ marginLeft: 8, fontSize: 11, color: '#94a3b8' }}>
                · renders with: {selected.rendererBase}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 2 — Display (visibility + formatter per view mode)
// ---------------------------------------------------------------------------

const VIEW_MODES = [
  { key: 'editor', label: 'Editor' },
  { key: 'ack',    label: 'Review' },
  { key: 'reader', label: 'Read'   },
] as const;

// Minimal renderer key catalogue for each view mode, keyed by rendererBase
const RENDERER_KEYS: Record<string, Record<string, string[]>> = {
  'rich-text': {
    editor: ['rich-text:editor'],
    ack:    ['rich-text:ack'],
    reader: ['rich-text:reader'],
  },
  'checklist': {
    editor: ['checklist:editor'],
    ack:    ['checklist:ack'],
    reader: ['checklist:reader'],
  },
};

const RENDERER_LABELS: Record<string, string> = {
  'rich-text:editor': 'Rich Text Editor',
  'rich-text:ack':    'Rich Text Review',
  'rich-text:reader': 'Rich Text Reader',
  'checklist:editor': 'Checklist Editor',
  'checklist:ack':    'Checklist Review',
  'checklist:reader': 'Checklist Reader',
};

function Step2({
  name,
  primitiveType,
  formatters, setFormatters,
  visibility, setVisibility,
}: {
  name: string;
  primitiveType: string;
  formatters: Record<string, string>; setFormatters: (v: Record<string, string>) => void;
  visibility: Record<string, boolean>; setVisibility: (v: Record<string, boolean>) => void;
}) {
  const prim = PRIMITIVE_STORAGE_TYPES.find(p => p.id === primitiveType);
  const fieldLabel = name.trim() || prim?.label || 'Field';
  const rendererKeys = prim?.rendererBase ? RENDERER_KEYS[prim.rendererBase] ?? {} : {};

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <p style={{ margin: '0 0 16px', fontSize: 13, color: '#64748b' }}>
        Configure which view modes this field appears in and which renderer to use.
      </p>

      <div style={{ border: '1px solid #e2e8f0', borderRadius: 10, overflow: 'hidden' }}>
        {/* Header */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
          <div style={{ padding: '10px 16px', fontSize: 13, fontWeight: 700, color: '#0f172a' }}>Field</div>
          {VIEW_MODES.map(m => (
            <div key={m.key} style={{ padding: '10px 16px', fontSize: 13, fontWeight: 700, color: '#0f172a' }}>{m.label}</div>
          ))}
        </div>

        {/* Data row */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', alignItems: 'flex-start', padding: '14px 0' }}>
          {/* Field cell */}
          <div style={{ padding: '0 16px' }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: '#0f172a' }}>{fieldLabel}</div>
            <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>{prim?.label ?? primitiveType}</div>
          </div>

          {/* Mode cells */}
          {VIEW_MODES.map(m => {
            const options = rendererKeys[m.key] ?? [];
            const isVisible = visibility[m.key] ?? true;
            return (
              <div key={m.key} style={{ padding: '0 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 7, cursor: 'pointer', userSelect: 'none' }}>
                  <input
                    type="checkbox"
                    checked={isVisible}
                    onChange={e => setVisibility({ ...visibility, [m.key]: e.target.checked })}
                    style={{ width: 16, height: 16, accentColor: '#646cff', cursor: 'pointer' }}
                  />
                  <span style={{ fontSize: 13, color: '#374151' }}>Visible</span>
                </label>
                {isVisible && options.length > 0 && (
                  <select
                    value={formatters[m.key] ?? options[0]}
                    onChange={e => setFormatters({ ...formatters, [m.key]: e.target.value })}
                    style={{
                      width: '100%', fontSize: 13, border: '1px solid #d1d5db', borderRadius: 6,
                      padding: '6px 10px', background: '#fff', color: '#374151',
                      fontFamily: 'inherit', cursor: 'pointer',
                    }}
                  >
                    {options.map(key => (
                      <option key={key} value={key}>{RENDERER_LABELS[key] ?? key}</option>
                    ))}
                  </select>
                )}
                {isVisible && options.length === 0 && (
                  <span style={{ fontSize: 12, color: '#94a3b8', fontStyle: 'italic' }}>Default</span>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Data type form — 2-step
// ---------------------------------------------------------------------------

interface DataTypeFormProps {
  initial?: CustomFieldType;
  onSave: (draft: Omit<CustomFieldType, 'id' | 'createdAt' | 'updatedAt'>) => void;
  onCancel: () => void;
}

function DataTypeForm({ initial, onSave, onCancel }: DataTypeFormProps) {
  const [step, setStep] = useState<1 | 2>(1);
  const [name, setName] = useState(initial?.name ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [primitiveType, setPrimitiveType] = useState(initial?.primitiveType ?? '');
  const [nameError, setNameError] = useState('');

  const prim = PRIMITIVE_STORAGE_TYPES.find(p => p.id === primitiveType);
  const rendererKeys = prim?.rendererBase ? RENDERER_KEYS[prim.rendererBase] ?? {} : {};

  const [formatters, setFormatters] = useState<Record<string, string>>(() => ({
    editor: (rendererKeys['editor'] ?? [])[0] ?? '',
    ack:    (rendererKeys['ack']    ?? [])[0] ?? '',
    reader: (rendererKeys['reader'] ?? [])[0] ?? '',
  }));
  const [visibility, setVisibility] = useState<Record<string, boolean>>({
    editor: true, ack: true, reader: true,
  });

  const canNext = !!primitiveType && !!prim?.rendererBase;

  const handleNext = () => {
    if (!name.trim()) { setNameError('Label is required'); return; }
    if (!primitiveType) { setNameError('Please select a field type'); return; }
    setNameError('');
    setStep(2);
  };

  const handleSave = () => {
    const baseType = prim?.rendererBase ?? 'rich-text';
    onSave({
      name: name.trim(),
      icon: '',
      description: description.trim(),
      primitiveType,
      baseType,
    });
  };

  return (
    <div>
      <StepIndicator step={step} />

      {step === 1 && (
        <Step1
          name={name} setName={v => { setName(v); if (v.trim()) setNameError(''); }}
          description={description} setDescription={setDescription}
          primitiveType={primitiveType} setPrimitiveType={setPrimitiveType}
          nameError={nameError}
        />
      )}

      {step === 2 && (
        <Step2
          name={name}
          primitiveType={primitiveType}
          formatters={formatters} setFormatters={setFormatters}
          visibility={visibility} setVisibility={setVisibility}
        />
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: 20, marginTop: 20, borderTop: '1px solid #e2e8f0' }}>
        <button type="button" onClick={onCancel} style={btn('ghost')}>Cancel</button>
        <div style={{ display: 'flex', gap: 8 }}>
          {step === 2 && (
            <button type="button" onClick={() => setStep(1)} style={btn('secondary')}>← Back</button>
          )}
          {step === 1 ? (
            <button
              data-testid="next-button"
              type="button"
              onClick={handleNext}
              style={btn('primary', !canNext)}
              disabled={!canNext}
            >
              Next →
            </button>
          ) : (
            <button data-testid="save-button" type="button" onClick={handleSave} style={btn('primary')}>
              {initial ? 'Save Changes' : 'Create Data Type'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// List item
// ---------------------------------------------------------------------------

function TypeListItem({
  label, primitiveLabel, active, onSelect, onDelete,
}: {
  label: string; primitiveLabel: string;
  active: boolean;
  onSelect: () => void; onDelete: () => void;
}) {
  return (
    <div
      onClick={onSelect}
      style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '8px 14px', cursor: 'pointer', borderRadius: 7,
        background: active ? '#f1f0ff' : 'transparent',
        borderLeft: active ? '3px solid #646cff' : '3px solid transparent',
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: '#0f172a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {label}
        </div>
        <div style={{ fontSize: 11, color: '#94a3b8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {primitiveLabel}
        </div>
      </div>
      <button
        type="button"
        onClick={e => { e.stopPropagation(); onDelete(); }}
        title="Delete"
        style={{ ...btn('ghost'), padding: '2px 6px', fontSize: 14, color: '#ef4444', flexShrink: 0 }}
      >
        ×
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Idle panel
// ---------------------------------------------------------------------------

function IdlePanel({ onCreateNew }: { onCreateNew: () => void }) {
  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '40px 24px', textAlign: 'center' }}>
      <div style={{ fontSize: 16, fontWeight: 600, color: '#374151', marginBottom: 8 }}>Data Types</div>
      <div style={{ fontSize: 13, color: '#94a3b8', maxWidth: 360, marginBottom: 24, lineHeight: 1.6 }}>
        Data types define the primitive storage type a document section holds — Text, Long text, Integer, Boolean, and more.
        Create custom types to give sections distinct labels and display configuration.
      </div>
      <button
        data-testid="new-data-type-empty-btn"
        type="button"
        onClick={onCreateNew}
        style={btn('primary')}
      >
        + New Data Type
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

type Mode = 'idle' | 'create' | 'edit';

export default function FieldTypesPage() {
  const { types: customTypes, createType, updateType, deleteType } = useCustomFieldTypes();
  const [mode, setMode] = useState<Mode>('idle');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [saveMessage, setSaveMessage] = useState<{ text: string; key: number } | null>(null);

  const editingType = editingId ? customTypes.find(t => t.id === editingId) : undefined;
  const confirmDeleteType = confirmDeleteId ? customTypes.find(t => t.id === confirmDeleteId) : undefined;

  const flashSave = (text: string) => setSaveMessage({ text, key: Date.now() });

  const handleSave = (draft: Omit<CustomFieldType, 'id' | 'createdAt' | 'updatedAt'>) => {
    if (mode === 'create') {
      createType(draft);
      flashSave('Data type created');
    } else if (mode === 'edit' && editingId) {
      updateType(editingId, draft);
      flashSave('Changes saved');
    }
    setMode('idle');
    setEditingId(null);
  };

  const handleDelete = (id: string) => {
    deleteType(id);
    setConfirmDeleteId(null);
    if (editingId === id) { setMode('idle'); setEditingId(null); }
  };

  const primLabel = (t: CustomFieldType) => {
    return PRIMITIVE_STORAGE_TYPES.find(p => p.id === t.primitiveType)?.label ?? t.baseType;
  };

  return (
    <div style={{ display: 'flex', height: '100%', minHeight: 0, position: 'relative' }}>

      {/* Left sidebar */}
      <div style={{
        width: 264, flexShrink: 0, borderRight: '1px solid #e2e8f0',
        display: 'flex', flexDirection: 'column', overflowY: 'auto',
        background: '#fafbfc',
      }}>
        <div style={{ padding: '16px 14px 10px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: '#374151' }}>Data Types</span>
          <button
            data-testid="new-data-type-button"
            type="button"
            onClick={() => { setMode('create'); setEditingId(null); }}
            style={{ ...btn('primary'), padding: '5px 12px', fontSize: 12 }}
          >
            + New
          </button>
        </div>

        <div style={{ padding: '4px 8px', flex: 1 }}>
          {customTypes.length === 0 ? (
            <div style={{ padding: '20px 12px', textAlign: 'center', color: '#94a3b8', fontSize: 12 }}>
              No custom data types yet.
            </div>
          ) : (
            customTypes.map(t => (
              <TypeListItem
                key={t.id}
                label={t.name}
                primitiveLabel={primLabel(t)}
                active={editingId === t.id}
                onSelect={() => { setMode('edit'); setEditingId(t.id); }}
                onDelete={() => setConfirmDeleteId(t.id)}
              />
            ))
          )}
        </div>

        {/* Save feedback */}
        {saveMessage && (
          <div
            key={saveMessage.key}
            data-testid="save-banner"
            style={{
              padding: '8px 14px', borderTop: '1px solid #bbf7d0',
              background: '#f0fdf4', fontSize: 12, color: '#16a34a', fontWeight: 500,
            }}
          >
            ✓ {saveMessage.text}
          </div>
        )}
      </div>

      {/* Right panel */}
      <div style={{ flex: 1, minWidth: 0, overflowY: 'auto' }}>
        {mode === 'idle' && (
          <IdlePanel onCreateNew={() => setMode('create')} />
        )}

        {(mode === 'create' || mode === 'edit') && (
          <div style={{ padding: '28px 32px' }}>
            <h2 style={{ margin: '0 0 24px', fontSize: 18, fontWeight: 700, color: '#0f172a' }}>
              {mode === 'create' ? 'New Data Type' : `Edit: ${editingType?.name ?? ''}`}
            </h2>
            <DataTypeForm
              key={editingId ?? 'new'}
              initial={editingType}
              onSave={handleSave}
              onCancel={() => { setMode('idle'); setEditingId(null); }}
            />
          </div>
        )}
      </div>

      {confirmDeleteType && (
        <DeleteModal
          name={confirmDeleteType.name}
          onConfirm={() => handleDelete(confirmDeleteType.id)}
          onCancel={() => setConfirmDeleteId(null)}
        />
      )}
    </div>
  );
}
