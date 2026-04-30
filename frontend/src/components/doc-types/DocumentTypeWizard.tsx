// frontend/src/components/doc-types/DocumentTypeWizard.tsx
//
// 3-step wizard for creating or editing a document type.
// Step 1: Basic info (name, description, icon)
// Step 2: Fields — Drupal-style section-type picker + reorderable field list
// Step 3: View modes — per-field visibility and renderer overrides

import { useEffect, useState } from 'react';
import type { ViewMode } from '../../types/document';
import type {
  DocumentType,
  DocumentTypeField,
  DocumentTypePage,
  DocumentTypePageConfig,
} from '../../types/documentType';
import { makeEmptyField, getPagesView, getPageConfig } from '../../types/documentType';
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
}

function Step1Info({ name, setName, description, setDescription }: Step1Props) {
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

function Step2Fields({
  fields, setFields, pages, setPages, pageConfig, setPageConfig,
}: {
  fields: DocumentTypeField[];
  setFields: (f: DocumentTypeField[]) => void;
  pages: DocumentTypePage[];
  setPages: (p: DocumentTypePage[]) => void;
  pageConfig: DocumentTypePageConfig;
  setPageConfig: (c: DocumentTypePageConfig) => void;
}) {
  // The currently-selected page (where new sections land). Defaults to
  // the first (and only) page until the operator adds a second page.
  const [activePageId, setActivePageId] = useState<string>(pages[0]?.id ?? 'page-default');

  // If `pages` reshapes such that the active page is gone, snap back
  // to the first remaining page. Done in an effect, not during render.
  useEffect(() => {
    if (pages.length > 0 && !pages.find((p) => p.id === activePageId)) {
      setActivePageId(pages[0].id);
    }
  }, [pages, activePageId]);

  const addField = (type: string) => {
    const f = makeEmptyField(type);
    setFields([...fields, f]);
    // Append to the active page so the operator sees it land where they expect.
    setPages(pages.map((p) =>
      p.id === activePageId ? { ...p, sectionIds: [...p.sectionIds, f.id] } : p
    ));
  };

  const update = (id: string, patch: Partial<DocumentTypeField>) => {
    setFields(fields.map(f => f.id === id ? { ...f, ...patch } : f));
  };

  const remove = (id: string) => {
    setFields(fields.filter(f => f.id !== id));
    setPages(pages.map((p) => ({ ...p, sectionIds: p.sectionIds.filter((s) => s !== id) })));
  };

  // Move a section within its page (up/down by one slot).
  const moveSectionInPage = (pageId: string, sectionId: string, dir: -1 | 1) => {
    setPages(pages.map((p) => {
      if (p.id !== pageId) return p;
      const idx = p.sectionIds.indexOf(sectionId);
      const target = idx + dir;
      if (idx < 0 || target < 0 || target >= p.sectionIds.length) return p;
      const next = [...p.sectionIds];
      [next[idx], next[target]] = [next[target], next[idx]];
      return { ...p, sectionIds: next };
    }));
  };

  // Move a section to a different page (append to that page's list).
  const moveSectionToPage = (sectionId: string, fromPageId: string, toPageId: string) => {
    if (fromPageId === toPageId) return;
    setPages(pages.map((p) => {
      if (p.id === fromPageId) return { ...p, sectionIds: p.sectionIds.filter((s) => s !== sectionId) };
      if (p.id === toPageId)   return { ...p, sectionIds: [...p.sectionIds, sectionId] };
      return p;
    }));
  };

  const movePage = (pageId: string, dir: -1 | 1) => {
    const idx = pages.findIndex((p) => p.id === pageId);
    const target = idx + dir;
    if (idx < 0 || target < 0 || target >= pages.length) return;
    const next = [...pages];
    [next[idx], next[target]] = [next[target], next[idx]];
    setPages(next);
  };

  const addPage = () => {
    const id = `page-${(typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : Math.random().toString(36).slice(2, 10)}`;
    setPages([...pages, { id, sectionIds: [] }]);
    setActivePageId(id);
  };

  const renamePage = (pageId: string, title: string) => {
    setPages(pages.map((p) => p.id === pageId ? { ...p, title: title || undefined } : p));
  };

  const removePage = (pageId: string) => {
    if (pages.length <= 1) return; // always keep at least one page
    // Move sections from removed page to the first remaining page so we
    // don't orphan fields.
    const removed = pages.find((p) => p.id === pageId);
    const orphaned = removed?.sectionIds ?? [];
    const remaining = pages.filter((p) => p.id !== pageId);
    if (orphaned.length > 0 && remaining.length > 0) {
      remaining[0] = { ...remaining[0], sectionIds: [...remaining[0].sectionIds, ...orphaned] };
    }
    setPages(remaining);
    if (activePageId === pageId) setActivePageId(remaining[0]?.id ?? '');
  };

  // Lookup helper — section id → field. The wizard's `fields` array is
  // the source of truth for individual section properties; pages just
  // reference fields by id.
  const fieldsById = new Map(fields.map((f) => [f.id, f]));

  // Backwards-compat: when there's only ONE page, render the section list
  // exactly as the pre-#66 wizard did so the 37 existing tests don't
  // observe a structural change. Page UI (headers, between-page move,
  // page reorder, page-level config) only kicks in once a second page
  // is added.
  const isSinglePage = pages.length === 1;

  // Render a single FieldRow given its position within a page. Reused
  // by both the single-page legacy path and the multi-page path.
  const renderRow = (sectionId: string, page: DocumentTypePage, idx: number) => {
    const f = fieldsById.get(sectionId);
    if (!f) return null;
    return (
      <FieldRow
        key={f.id}
        field={f}
        index={idx}
        total={page.sectionIds.length}
        onRename={(name) => update(f.id, { name })}
        onChangeType={(sectionType) => update(f.id, { sectionType, rendererOverrides: {} })}
        onRemove={() => remove(f.id)}
        onMoveUp={() => moveSectionInPage(page.id, f.id, -1)}
        onMoveDown={() => moveSectionInPage(page.id, f.id, +1)}
        onToggleRequired={() => update(f.id, { required: !f.required })}
        onToggleCollapsed={() => update(f.id, { defaultCollapsed: !f.defaultCollapsed })}
      />
    );
  };

  return (
    <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start' }}>
      {/* Left — pages of sections */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 10, letterSpacing: '0.02em' }}>
          SECTIONS {fields.length > 0 && <span style={{ color: '#646cff' }}>({fields.length}{!isSinglePage ? ` across ${pages.length} pages` : ''})</span>}
        </div>

        {isSinglePage ? (
          // Legacy single-page rendering — preserves the existing
          // `fields-list` testid contract for the 37 existing tests.
          fields.length === 0 ? (
            <div style={{
              ...card, textAlign: 'center', padding: '32px 16px',
              color: '#94a3b8', fontSize: 13, borderStyle: 'dashed',
            }}>
              <div style={{ fontSize: 28, marginBottom: 8 }}>📋</div>
              No sections yet — pick a section type →
            </div>
          ) : (
            <div data-testid="fields-list">
              {pages[0].sectionIds.map((sid, idx) => renderRow(sid, pages[0], idx))}
            </div>
          )
        ) : (
          // Multi-page rendering. Each page gets its own card with a
          // header, a sortable section list, and per-page controls.
          pages.map((p, pageIdx) => (
            <div
              key={p.id}
              data-testid={`wizard-page-${p.id}`}
              style={{
                ...card,
                marginBottom: 12,
                background: p.id === activePageId ? '#faf5ff' : '#fff',
                borderColor: p.id === activePageId ? '#c4b5fd' : '#e2e8f0',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                <button
                  type="button"
                  data-testid={`page-up-${p.id}`}
                  disabled={pageIdx === 0}
                  onClick={() => movePage(p.id, -1)}
                  style={{ ...btn('ghost', pageIdx === 0), padding: '2px 6px', fontSize: 11 }}
                >▲</button>
                <button
                  type="button"
                  data-testid={`page-down-${p.id}`}
                  disabled={pageIdx === pages.length - 1}
                  onClick={() => movePage(p.id, +1)}
                  style={{ ...btn('ghost', pageIdx === pages.length - 1), padding: '2px 6px', fontSize: 11 }}
                >▼</button>
                <span style={{ fontSize: 12, fontWeight: 600, color: '#94a3b8', minWidth: 56 }}>
                  Page {pageIdx + 1}
                </span>
                <input
                  data-testid={`page-title-${p.id}`}
                  value={p.title ?? ''}
                  placeholder={`Page ${pageIdx + 1}`}
                  onChange={(e) => renamePage(p.id, e.target.value)}
                  style={{ ...input, flex: 1, padding: '4px 8px', fontSize: 13 }}
                  onFocus={() => setActivePageId(p.id)}
                />
                <button
                  type="button"
                  data-testid={`page-remove-${p.id}`}
                  disabled={pages.length <= 1}
                  onClick={() => removePage(p.id)}
                  style={{ ...btn('ghost', pages.length <= 1), padding: '2px 8px', fontSize: 13, color: '#ef4444' }}
                  title="Remove page (sections move to first page)"
                >✕</button>
              </div>

              {p.sectionIds.length === 0 ? (
                <div
                  data-testid={`page-empty-${p.id}`}
                  style={{ padding: '12px 8px', color: '#94a3b8', fontSize: 12, fontStyle: 'italic' }}
                >
                  No sections on this page yet — click the page header to make it active, then pick a section type.
                </div>
              ) : (
                <div data-testid={`page-sections-${p.id}`}>
                  {p.sectionIds.map((sid, idx) => {
                    const f = fieldsById.get(sid);
                    if (!f) return null;
                    return (
                      <div key={sid} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <div style={{ flex: 1 }}>{renderRow(sid, p, idx)}</div>
                        {pages.length > 1 && (
                          <select
                            data-testid={`section-move-page-${sid}`}
                            value={p.id}
                            onChange={(e) => moveSectionToPage(sid, p.id, e.target.value)}
                            style={{
                              fontSize: 11, padding: '4px 6px', borderRadius: 4,
                              fontFamily: 'inherit', cursor: 'pointer',
                              background: '#f8fafc', border: '1px solid #e2e8f0',
                            }}
                            title="Move section to another page"
                          >
                            {pages.map((pp, pi) => (
                              <option key={pp.id} value={pp.id}>
                                {pp.title || `Page ${pi + 1}`}
                              </option>
                            ))}
                          </select>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ))
        )}

        {/* + Add Page — always available; multi-page UI only kicks in
            once the operator clicks this. */}
        <button
          type="button"
          data-testid="add-page"
          onClick={addPage}
          style={{
            ...btn('ghost'), marginTop: 8, fontSize: 12, padding: '6px 12px',
            border: '1px dashed #c4b5fd', color: '#646cff', borderRadius: 6,
          }}
        >
          + Add Page
        </button>

        {/* Page-level config — only visible when 2+ pages exist. */}
        {pages.length > 1 && (
          <div
            data-testid="page-config-toc"
            style={{ marginTop: 16, padding: 10, background: '#f8fafc', borderRadius: 6, fontSize: 13 }}
          >
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={pageConfig.showTableOfContents}
                onChange={(e) => setPageConfig({ ...pageConfig, showTableOfContents: e.target.checked })}
              />
              <span>Show table of contents (multi-page documents only)</span>
            </label>
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
  // Icon picker was removed from Step 1 — types now ship with the default
  // 📄 unless an existing type already had one set (preserved on edit).
  const icon = initialType?.icon ?? '📄';
  const [fields,      setFields]      = useState<DocumentTypeField[]>(initialType?.fields    ?? []);
  // Phase 51 / hub#66 — pages layer above fields. When the wizard is
  // opened on a legacy single-page type, getPagesView derives a single
  // page wrapping all fields so the wizard logic can read uniformly.
  const [pages, setPages] = useState<DocumentTypePage[]>(() => (
    initialType
      ? getPagesView(initialType)
      : [{ id: 'page-default', sectionIds: [] }]
  ));
  const [pageConfig, setPageConfig] = useState<DocumentTypePageConfig>(() => (
    initialType ? getPageConfig(initialType) : { showTableOfContents: false }
  ));

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
    onSave({ name: name.trim(), description, icon, fields, pages, pageConfig });
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
          />
        )}
        {step === 2 && (
          <Step2Fields
            fields={fields}
            setFields={setFields}
            pages={pages}
            setPages={setPages}
            pageConfig={pageConfig}
            setPageConfig={setPageConfig}
          />
        )}
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
