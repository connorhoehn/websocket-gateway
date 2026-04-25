// frontend/src/components/doc-types/DocumentTypeWizard.tsx
//
// 3-step wizard for creating or editing a document type.
// Step 1: Basic info (name, description, icon)
// Step 2: Fields — Drupal-style section-type picker + reorderable field list
// Step 3: View modes — per-field visibility and renderer overrides

import { useState } from 'react';
import type { ViewMode } from '../../types/document';
import type {
  DocumentType,
  DocumentTypeField,
} from '../../types/documentType';
import {
  DOCUMENT_TYPE_ICONS,
  makeEmptyField,
} from '../../types/documentType';
// Trigger side-effect registrations so getFieldTypes() / getFieldType() are populated
import '../../renderers';
import { getFieldTypes, getFieldType } from '../../renderers/registry';

// ---------------------------------------------------------------------------
// Shared styles
// ---------------------------------------------------------------------------

const btn = (variant: 'primary' | 'secondary' | 'ghost' | 'danger', disabled = false): React.CSSProperties => {
  const base: React.CSSProperties = {
    padding: '7px 16px', fontSize: 13, fontWeight: 600, borderRadius: 7,
    cursor: disabled ? 'not-allowed' : 'pointer', fontFamily: 'inherit',
    transition: 'background 120ms', border: '1px solid transparent',
    opacity: disabled ? 0.5 : 1,
  };
  if (variant === 'primary')   return { ...base, background: '#646cff', color: '#fff', border: 'none' };
  if (variant === 'secondary') return { ...base, background: '#fff', color: '#374151', border: '1px solid #d1d5db' };
  if (variant === 'danger')    return { ...base, background: '#fff', color: '#dc2626', border: '1px solid #fca5a5' };
  return { ...base, background: 'none', color: '#64748b', border: 'none' };
};

const input: React.CSSProperties = {
  width: '100%', boxSizing: 'border-box',
  border: '1px solid #d1d5db', borderRadius: 7, padding: '8px 12px',
  fontSize: 14, fontFamily: 'inherit', background: '#f9fafb', color: '#0f172a',
  outline: 'none',
};

const label: React.CSSProperties = {
  display: 'block', fontSize: 12, fontWeight: 600,
  color: '#374151', marginBottom: 5, letterSpacing: '0.02em',
};

const card: React.CSSProperties = {
  background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, padding: '16px',
};

const STEP_LABELS = ['Basic Info', 'Sections', 'View Modes'];

// ---------------------------------------------------------------------------
// Step indicator
// ---------------------------------------------------------------------------

function StepIndicator({ step, total }: { step: number; total: number }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 0, marginBottom: 28 }}>
      {Array.from({ length: total }, (_, i) => {
        const n = i + 1;
        const active = n === step;
        const done = n < step;
        return (
          <div key={n} style={{ display: 'flex', alignItems: 'center' }}>
            <div style={{
              width: 28, height: 28, borderRadius: '50%', flexShrink: 0,
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
              {STEP_LABELS[i]}
            </span>
            {n < total && (
              <div style={{ width: 32, height: 1, background: '#e2e8f0', margin: '0 10px', flexShrink: 0 }} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 1 — Basic Info
// ---------------------------------------------------------------------------

interface Step1Props {
  name: string; setName: (v: string) => void;
  description: string; setDescription: (v: string) => void;
  icon: string; setIcon: (v: string) => void;
}

function Step1Info({ name, setName, description, setDescription, icon, setIcon }: Step1Props) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div>
        <span style={label}>Name <span style={{ color: '#dc2626' }}>*</span></span>
        <input
          data-testid="name-input"
          style={input}
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="e.g. Sprint Planning, Retrospective, Meeting Notes…"
          maxLength={80}
          autoFocus
        />
      </div>

      <div>
        <span style={label}>Description</span>
        <textarea
          data-testid="description-input"
          style={{ ...input, minHeight: 72, resize: 'vertical' }}
          value={description}
          onChange={e => setDescription(e.target.value)}
          placeholder="Optional — describe when this document type is used"
          maxLength={300}
        />
      </div>

      <div>
        <span style={label}>Icon</span>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {DOCUMENT_TYPE_ICONS.map(emoji => (
            <button
              key={emoji}
              data-testid={`icon-${emoji}`}
              type="button"
              onClick={() => setIcon(emoji)}
              style={{
                width: 38, height: 38, borderRadius: 8, fontSize: 18,
                cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: icon === emoji ? '#ede9fe' : '#f8fafc',
                border: icon === emoji ? '2px solid #646cff' : '2px solid #e2e8f0',
              }}
              title={emoji}
            >
              {emoji}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 2 — Fields
// ---------------------------------------------------------------------------

function FieldRow({
  field, index, total,
  onRename, onChangeType, onRemove, onMoveUp, onMoveDown, onToggleRequired, onToggleCollapsed,
}: {
  field: DocumentTypeField;
  index: number; total: number;
  onRename: (name: string) => void;
  onChangeType: (type: string) => void;
  onRemove: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onToggleRequired: () => void;
  onToggleCollapsed: () => void;
}) {
  const def = getFieldType(field.sectionType);
  const allTypes = getFieldTypes();

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8,
      padding: '8px 10px', borderRadius: 8,
      background: '#f8fafc', border: '1px solid #e2e8f0',
      marginBottom: 6,
    }}>
      {/* Reorder */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 1, flexShrink: 0 }}>
        <button type="button" disabled={index === 0} onClick={onMoveUp}
          data-testid={`field-up-${field.id}`}
          style={{ ...btn('ghost', index === 0), padding: '1px 4px', fontSize: 10, lineHeight: 1 }}>▲</button>
        <button type="button" disabled={index === total - 1} onClick={onMoveDown}
          data-testid={`field-down-${field.id}`}
          style={{ ...btn('ghost', index === total - 1), padding: '1px 4px', fontSize: 10, lineHeight: 1 }}>▼</button>
      </div>

      {/* Icon */}
      <span style={{ fontSize: 16, flexShrink: 0 }}>{def?.icon ?? '📄'}</span>

      {/* Name */}
      <input
        data-testid={`field-name-${field.id}`}
        value={field.name}
        onChange={e => onRename(e.target.value)}
        style={{ ...input, background: 'transparent', border: '1px solid transparent', flex: 1, minWidth: 0, padding: '4px 6px' }}
        onFocus={e => { e.currentTarget.style.border = '1px solid #c4b5fd'; e.currentTarget.style.background = '#fff'; }}
        onBlur={e => { e.currentTarget.style.border = '1px solid transparent'; e.currentTarget.style.background = 'transparent'; }}
      />

      {/* Type select — editable badge */}
      <select
        data-testid={`field-type-${field.id}`}
        value={field.sectionType}
        onChange={e => onChangeType(e.target.value)}
        style={{
          fontSize: 11, padding: '3px 6px', borderRadius: 4, flexShrink: 0,
          background: '#ede9fe', color: '#4c1d95', fontWeight: 600,
          border: '1px solid #c4b5fd', cursor: 'pointer',
          fontFamily: 'inherit', appearance: 'auto',
        }}
      >
        {allTypes.map(t => (
          <option key={t.type} value={t.type}>{t.label}</option>
        ))}
      </select>

      {/* Toggles */}
      <button type="button" onClick={onToggleRequired}
        data-testid={`field-required-${field.id}`}
        title="Required"
        style={{
          ...btn(field.required ? 'primary' : 'secondary'), padding: '3px 8px',
          fontSize: 11, flexShrink: 0,
          background: field.required ? '#ede9fe' : '#f8fafc',
          color: field.required ? '#4c1d95' : '#94a3b8',
          border: field.required ? '1px solid #c4b5fd' : '1px solid #e2e8f0',
        }}>
        Required
      </button>
      <button type="button" onClick={onToggleCollapsed}
        data-testid={`field-collapsed-${field.id}`}
        title="Collapsed by default"
        style={{
          ...btn('secondary'), padding: '3px 8px',
          fontSize: 11, flexShrink: 0,
          background: field.defaultCollapsed ? '#f0fdf4' : '#f8fafc',
          color: field.defaultCollapsed ? '#16a34a' : '#94a3b8',
          border: field.defaultCollapsed ? '1px solid #86efac' : '1px solid #e2e8f0',
        }}>
        Collapsed
      </button>

      {/* Delete */}
      <button type="button" onClick={onRemove}
        data-testid={`field-remove-${field.id}`}
        style={{ ...btn('ghost'), padding: '2px 6px', fontSize: 14, color: '#ef4444', flexShrink: 0 }}>
        ×
      </button>
    </div>
  );
}

function Step2Fields({ fields, setFields }: {
  fields: DocumentTypeField[];
  setFields: (f: DocumentTypeField[]) => void;
}) {
  const addField = (type: string) => {
    setFields([...fields, makeEmptyField(type)]);
  };

  const update = (id: string, patch: Partial<DocumentTypeField>) => {
    setFields(fields.map(f => f.id === id ? { ...f, ...patch } : f));
  };

  const remove = (id: string) => setFields(fields.filter(f => f.id !== id));

  const moveUp = (i: number) => {
    if (i === 0) return;
    const next = [...fields];
    [next[i - 1], next[i]] = [next[i], next[i - 1]];
    setFields(next);
  };

  const moveDown = (i: number) => {
    if (i === fields.length - 1) return;
    const next = [...fields];
    [next[i], next[i + 1]] = [next[i + 1], next[i]];
    setFields(next);
  };

  return (
    <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start' }}>
      {/* Left — added fields */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 10, letterSpacing: '0.02em' }}>
          SECTIONS {fields.length > 0 && <span style={{ color: '#646cff' }}>({fields.length})</span>}
        </div>
        {fields.length === 0 ? (
          <div style={{
            ...card, textAlign: 'center', padding: '32px 16px',
            color: '#94a3b8', fontSize: 13, borderStyle: 'dashed',
          }}>
            <div style={{ fontSize: 28, marginBottom: 8 }}>📋</div>
            No sections yet — pick a section type →
          </div>
        ) : (
          <div data-testid="fields-list">
            {fields.map((f, i) => (
              <FieldRow
                key={f.id}
                field={f}
                index={i}
                total={fields.length}
                onRename={name => update(f.id, { name })}
                onChangeType={sectionType => update(f.id, { sectionType, rendererOverrides: {} })}
                onRemove={() => remove(f.id)}
                onMoveUp={() => moveUp(i)}
                onMoveDown={() => moveDown(i)}
                onToggleRequired={() => update(f.id, { required: !f.required })}
                onToggleCollapsed={() => update(f.id, { defaultCollapsed: !f.defaultCollapsed })}
              />
            ))}
          </div>
        )}
      </div>

      {/* Right — field type picker */}
      <div style={{ width: 220, flexShrink: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 10, letterSpacing: '0.02em' }}>
          SECTION TYPES
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {getFieldTypes().map(fieldDef => (
            <button
              key={fieldDef.type}
              data-testid={`add-field-${fieldDef.type}`}
              type="button"
              onClick={() => addField(fieldDef.type)}
              style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '10px 12px', borderRadius: 8, width: '100%',
                background: '#fff', border: '1px solid #e2e8f0',
                cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit',
                transition: 'border-color 120ms',
              }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = '#c4b5fd'; e.currentTarget.style.background = '#faf5ff'; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = '#e2e8f0'; e.currentTarget.style.background = '#fff'; }}
            >
              <span style={{ fontSize: 20, flexShrink: 0 }}>{fieldDef.icon}</span>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#0f172a' }}>{fieldDef.label}</div>
                <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 1 }}>{fieldDef.description}</div>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 3 — View Modes
// ---------------------------------------------------------------------------

function ViewModeCell({ field, mode, onToggleHidden, onOverrideChange }: {
  field: DocumentTypeField;
  mode: ViewMode;
  onToggleHidden: () => void;
  onOverrideChange: (key: string) => void;
}) {
  const hidden = field.hiddenInModes.includes(mode);
  const fieldTypeDef = getFieldType(field.sectionType);
  const options = fieldTypeDef?.rendererKeys[mode] ?? [];
  const currentOverride = field.rendererOverrides[mode] ?? options[0] ?? '';

  return (
    <td style={{ padding: '10px 12px', verticalAlign: 'top' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', userSelect: 'none' }}>
          <input
            data-testid={`visibility-${field.id}-${mode}`}
            type="checkbox"
            checked={!hidden}
            onChange={onToggleHidden}
            style={{ accentColor: '#646cff' }}
          />
          <span style={{ fontSize: 12, color: hidden ? '#94a3b8' : '#374151' }}>
            {hidden ? 'Hidden' : 'Visible'}
          </span>
        </label>
        {!hidden && options.length > 0 && (
          <select
            data-testid={`renderer-${field.id}-${mode}`}
            value={currentOverride}
            onChange={e => onOverrideChange(e.target.value)}
            style={{
              fontSize: 11, border: '1px solid #d1d5db', borderRadius: 5,
              padding: '3px 6px', background: '#f9fafb', color: '#374151',
              fontFamily: 'inherit', cursor: 'pointer',
            }}
          >
            {options.map(key => (
              <option key={key} value={key}>{fieldTypeDef?.rendererLabels[key] ?? key}</option>
            ))}
          </select>
        )}
        {!hidden && options.length === 0 && (
          <span style={{ fontSize: 11, color: '#94a3b8' }}>Default renderer</span>
        )}
      </div>
    </td>
  );
}

function Step3ViewModes({ fields, setFields }: {
  fields: DocumentTypeField[];
  setFields: (f: DocumentTypeField[]) => void;
}) {
  const modes: ViewMode[] = ['editor', 'ack', 'reader'];
  const modeLabels: Record<ViewMode, string> = { editor: 'Editor', ack: 'Review', reader: 'Read' };

  const update = (id: string, patch: Partial<DocumentTypeField>) => {
    setFields(fields.map(f => f.id === id ? { ...f, ...patch } : f));
  };

  const toggleHidden = (fieldId: string, mode: ViewMode) => {
    const field = fields.find(f => f.id === fieldId)!;
    const hidden = field.hiddenInModes.includes(mode);
    update(fieldId, {
      hiddenInModes: hidden
        ? field.hiddenInModes.filter(m => m !== mode)
        : [...field.hiddenInModes, mode],
    });
  };

  const setRenderer = (fieldId: string, mode: ViewMode, key: string) => {
    const field = fields.find(f => f.id === fieldId)!;
    update(fieldId, { rendererOverrides: { ...field.rendererOverrides, [mode]: key } });
  };

  if (fields.length === 0) {
    return (
      <div style={{ ...card, textAlign: 'center', padding: '40px 16px', color: '#94a3b8' }}>
        No fields defined — go back to Step 2 and add some fields first.
      </div>
    );
  }

  return (
    <div style={{ overflowX: 'auto' }}>
      <p style={{ fontSize: 13, color: '#64748b', marginBottom: 16 }}>
        Configure which view modes each field appears in and which renderer to use.
      </p>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr style={{ background: '#f8fafc' }}>
            <th style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 600, color: '#374151', borderBottom: '2px solid #e2e8f0', whiteSpace: 'nowrap' }}>
              Field
            </th>
            {modes.map(m => (
              <th key={m} style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 600, color: '#374151', borderBottom: '2px solid #e2e8f0', minWidth: 130 }}>
                {modeLabels[m]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {fields.map((f, i) => {
            const def = getFieldType(f.sectionType);
            return (
              <tr key={f.id} style={{ borderBottom: '1px solid #f1f5f9', background: i % 2 === 0 ? '#fff' : '#fafbfc' }}>
                <td style={{ padding: '10px 12px', verticalAlign: 'middle' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                    <span>{def?.icon}</span>
                    <span style={{ fontWeight: 500, color: '#0f172a' }}>{f.name}</span>
                    {f.required && <span style={{ fontSize: 10, background: '#ede9fe', color: '#4c1d95', padding: '1px 5px', borderRadius: 4 }}>required</span>}
                  </div>
                </td>
                {modes.map(m => (
                  <ViewModeCell
                    key={m}
                    field={f}
                    mode={m}
                    onToggleHidden={() => toggleHidden(f.id, m)}
                    onOverrideChange={key => setRenderer(f.id, m, key)}
                  />
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Wizard shell
// ---------------------------------------------------------------------------

export interface DocumentTypeWizardProps {
  initialType?: DocumentType;
  onSave: (type: Omit<DocumentType, 'id' | 'createdAt' | 'updatedAt'>) => void;
  onCancel: () => void;
}

export function DocumentTypeWizard({ initialType, onSave, onCancel }: DocumentTypeWizardProps) {
  const TOTAL_STEPS = 3;
  // Start on step 2 (Sections) when editing so fields are immediately visible
  const [step, setStep] = useState(initialType ? 2 : 1);

  // Draft state — one slice per wizard field so re-renders stay cheap
  const [name,        setName]        = useState(initialType?.name        ?? '');
  const [description, setDescription] = useState(initialType?.description ?? '');
  const [icon,        setIcon]        = useState(initialType?.icon        ?? '📄');
  const [fields,      setFields]      = useState<DocumentTypeField[]>(initialType?.fields    ?? []);

  const [nameError, setNameError] = useState('');

  const canAdvance = (): boolean => {
    if (step === 1) return name.trim().length > 0;
    return true;
  };

  const handleNext = () => {
    if (step === 1 && !name.trim()) {
      setNameError('Name is required');
      return;
    }
    setNameError('');
    if (step < TOTAL_STEPS) setStep(s => s + 1);
    else handleSave();
  };

  const handleSave = () => {
    onSave({ name: name.trim(), description, icon, fields });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Step indicator */}
      <StepIndicator step={step} total={TOTAL_STEPS} />

      {/* Step content — scrollable */}
      <div style={{ flex: 1, overflowY: 'auto', paddingRight: 4 }}>
        {step === 1 && (
          <Step1Info
            name={name} setName={v => { setName(v); if (v.trim()) setNameError(''); }}
            description={description} setDescription={setDescription}
            icon={icon} setIcon={setIcon}
          />
        )}
        {step === 2 && <Step2Fields fields={fields} setFields={setFields} />}
        {step === 3 && <Step3ViewModes fields={fields} setFields={setFields} />}

        {nameError && (
          <div style={{ color: '#dc2626', fontSize: 13, marginTop: 8 }}>{nameError}</div>
        )}
      </div>

      {/* Navigation */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        paddingTop: 16, borderTop: '1px solid #e2e8f0', marginTop: 16, flexShrink: 0,
      }}>
        <button type="button" onClick={onCancel} style={btn('ghost')}>
          Cancel
        </button>
        <div style={{ display: 'flex', gap: 8 }}>
          {step > 1 && (
            <button type="button" onClick={() => setStep(s => s - 1)} style={btn('secondary')}>
              ← Back
            </button>
          )}
          <button
            type="button"
            data-testid="wizard-next"
            onClick={handleNext}
            disabled={!canAdvance()}
            style={btn('primary', !canAdvance())}
          >
            {step === TOTAL_STEPS ? (initialType ? 'Save Changes' : 'Create Type') : 'Next →'}
          </button>
        </div>
      </div>
    </div>
  );
}
