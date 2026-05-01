// frontend/src/components/doc-types/DocumentTypeWizard.tsx
//
// 3-step wizard for creating or editing a document type.
// Step 1: Basic info (name, description, icon)
// Step 2: Fields — Drupal-style section-type picker + reorderable field list
// Step 3: View modes — per-field visibility and renderer overrides

import { useEffect, useState } from 'react';
import {
  DndContext,
  closestCorners,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
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

// Phase 51 / hub#70 — sortable wrappers for the multi-page wizard render.
// Each SortablePage owns a drag handle (the ⋮⋮ on the page header) plus
// a nested SortableContext over its section ids; SortableSection owns
// the section row's drag handle.

interface SortablePageProps {
  page: DocumentTypePage;
  pageIdx: number;
  totalPages: number;
  isActive: boolean;
  setActivePageId: (id: string) => void;
  movePage: (pageId: string, dir: -1 | 1) => void;
  removePage: (pageId: string) => void;
  renamePage: (pageId: string, title: string) => void;
  pages: DocumentTypePage[];
  fieldsById: Map<string, DocumentTypeField>;
  renderRow: (sectionId: string, page: DocumentTypePage, idx: number) => React.ReactNode;
  moveSectionToPage: (sectionId: string, fromPageId: string, toPageId: string) => void;
}

function SortablePage({
  page, pageIdx, totalPages, isActive, setActivePageId,
  movePage, removePage, renamePage, pages, fieldsById, renderRow, moveSectionToPage,
}: SortablePageProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: page.id });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };
  return (
    <div
      ref={setNodeRef}
      style={style}
      data-testid={`wizard-page-${page.id}`}
    >
      <div style={{
        ...card,
        marginBottom: 12,
        background: isActive ? '#faf5ff' : '#fff',
        borderColor: isActive ? '#c4b5fd' : '#e2e8f0',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          <button
            type="button"
            data-testid={`page-drag-handle-${page.id}`}
            {...attributes}
            {...listeners}
            style={{
              cursor: 'grab',
              padding: '2px 4px',
              fontSize: 14,
              color: '#94a3b8',
              border: 'none',
              background: 'transparent',
              userSelect: 'none',
              touchAction: 'none',
            }}
            title="Drag to reorder pages"
          >⋮⋮</button>
          <button
            type="button"
            data-testid={`page-up-${page.id}`}
            disabled={pageIdx === 0}
            onClick={() => movePage(page.id, -1)}
            style={{ ...btn('ghost', pageIdx === 0), padding: '2px 6px', fontSize: 11 }}
          >▲</button>
          <button
            type="button"
            data-testid={`page-down-${page.id}`}
            disabled={pageIdx === totalPages - 1}
            onClick={() => movePage(page.id, +1)}
            style={{ ...btn('ghost', pageIdx === totalPages - 1), padding: '2px 6px', fontSize: 11 }}
          >▼</button>
          <span style={{ fontSize: 12, fontWeight: 600, color: '#94a3b8', minWidth: 56 }}>
            Page {pageIdx + 1}
          </span>
          <input
            data-testid={`page-title-${page.id}`}
            value={page.title ?? ''}
            placeholder={`Page ${pageIdx + 1}`}
            onChange={(e) => renamePage(page.id, e.target.value)}
            style={{ ...input, flex: 1, padding: '4px 8px', fontSize: 13 }}
            onFocus={() => setActivePageId(page.id)}
          />
          <button
            type="button"
            data-testid={`page-remove-${page.id}`}
            disabled={totalPages <= 1}
            onClick={() => removePage(page.id)}
            style={{ ...btn('ghost', totalPages <= 1), padding: '2px 8px', fontSize: 13, color: '#ef4444' }}
            title="Remove page (sections move to first page)"
          >✕</button>
        </div>

        {page.sectionIds.length === 0 ? (
          <div
            data-testid={`page-empty-${page.id}`}
            style={{ padding: '12px 8px', color: '#94a3b8', fontSize: 12, fontStyle: 'italic' }}
          >
            No sections on this page yet — click the page header to make it active, then pick a section type.
          </div>
        ) : (
          <SortableContext items={page.sectionIds} strategy={verticalListSortingStrategy}>
            <div data-testid={`page-sections-${page.id}`}>
              {page.sectionIds.map((sid, idx) => {
                if (!fieldsById.get(sid)) return null;
                return (
                  <SortableSection
                    key={sid}
                    sectionId={sid}
                    page={page}
                    idx={idx}
                    pages={pages}
                    renderRow={renderRow}
                    moveSectionToPage={moveSectionToPage}
                  />
                );
              })}
            </div>
          </SortableContext>
        )}
      </div>
    </div>
  );
}

interface SortableSectionProps {
  sectionId: string;
  page: DocumentTypePage;
  idx: number;
  pages: DocumentTypePage[];
  renderRow: (sectionId: string, page: DocumentTypePage, idx: number) => React.ReactNode;
  moveSectionToPage: (sectionId: string, fromPageId: string, toPageId: string) => void;
}

function SortableSection({ sectionId, page, idx, pages, renderRow, moveSectionToPage }: SortableSectionProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: sectionId });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };
  return (
    <div ref={setNodeRef} style={{ ...style, display: 'flex', alignItems: 'center', gap: 6 }}>
      <button
        type="button"
        data-testid={`section-drag-handle-${sectionId}`}
        {...attributes}
        {...listeners}
        style={{
          cursor: 'grab', padding: '2px 4px', fontSize: 14, color: '#94a3b8',
          border: 'none', background: 'transparent',
          userSelect: 'none', touchAction: 'none', flexShrink: 0,
        }}
        title="Drag to reorder sections (or drop on another page)"
      >⋮⋮</button>
      <div style={{ flex: 1 }}>{renderRow(sectionId, page, idx)}</div>
      {pages.length > 1 && (
        <select
          data-testid={`section-move-page-${sectionId}`}
          value={page.id}
          onChange={(e) => moveSectionToPage(sectionId, page.id, e.target.value)}
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

  // Phase 51 / hub#70 — drag-and-drop reordering.
  // findContainer maps either a page id OR a section id to its owning page.
  // Used by onDragOver / onDragEnd to disambiguate page-vs-section drags
  // and to detect cross-page section moves.
  const findContainer = (id: string): string | undefined => {
    if (pages.some((p) => p.id === id)) return id;
    for (const p of pages) if (p.sectionIds.includes(id)) return p.id;
    return undefined;
  };

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragOver = (e: DragOverEvent) => {
    const { active, over } = e;
    if (!over) return;
    const activeId = String(active.id);
    const overId = String(over.id);
    const activeContainer = findContainer(activeId);
    const overContainer = findContainer(overId);
    if (!activeContainer || !overContainer) return;
    if (activeContainer === overContainer) return;
    // Page drag is handled in onDragEnd, not onDragOver.
    if (pages.some((p) => p.id === activeId)) return;
    // Section being dragged into a different page → move it now.
    setPages(pages.map((p) => {
      if (p.id === activeContainer) return { ...p, sectionIds: p.sectionIds.filter((s) => s !== activeId) };
      if (p.id === overContainer)   return { ...p, sectionIds: [...p.sectionIds, activeId] };
      return p;
    }));
  };

  const handleDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over) return;
    const activeId = String(active.id);
    const overId = String(over.id);

    // Page-level drag: both ids are page ids.
    if (pages.some((p) => p.id === activeId) && pages.some((p) => p.id === overId)) {
      const oldIndex = pages.findIndex((p) => p.id === activeId);
      const newIndex = pages.findIndex((p) => p.id === overId);
      if (oldIndex !== -1 && newIndex !== -1 && oldIndex !== newIndex) {
        setPages(arrayMove(pages, oldIndex, newIndex));
      }
      return;
    }

    // Section-level drag: figure out which page the active item is in
    // (after onDragOver may have moved it cross-page) and reorder
    // within that page.
    const activeContainer = findContainer(activeId);
    if (!activeContainer) return;
    const page = pages.find((p) => p.id === activeContainer);
    if (!page) return;
    const oldIndex = page.sectionIds.indexOf(activeId);
    const newIndex = page.sectionIds.indexOf(overId);
    if (oldIndex !== -1 && newIndex !== -1 && oldIndex !== newIndex) {
      setPages(pages.map((p) =>
        p.id === activeContainer ? { ...p, sectionIds: arrayMove(p.sectionIds, oldIndex, newIndex) } : p,
      ));
    }
  };

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
          // Multi-page rendering wrapped in a DndContext for drag-drop
          // reorder (hub#70). Within-page section reorder, cross-page
          // section move, and page reorder are all handled by a single
          // onDragEnd / onDragOver pair. Button-based controls remain
          // for accessibility.
          <DndContext
            sensors={sensors}
            collisionDetection={closestCorners}
            onDragOver={handleDragOver}
            onDragEnd={handleDragEnd}
          >
            <SortableContext items={pages.map((p) => p.id)} strategy={verticalListSortingStrategy}>
              {pages.map((p, pageIdx) => (
                <SortablePage
                  key={p.id}
                  page={p}
                  pageIdx={pageIdx}
                  totalPages={pages.length}
                  isActive={p.id === activePageId}
                  setActivePageId={setActivePageId}
                  movePage={movePage}
                  removePage={removePage}
                  renamePage={renamePage}
                  pages={pages}
                  fieldsById={fieldsById}
                  renderRow={renderRow}
                  moveSectionToPage={moveSectionToPage}
                />
              ))}
            </SortableContext>
          </DndContext>
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

  // Phase 51 Phase G — JSON Schema export
  const handleExportSchema = async () => {
    if (!initialType?.id) return;
    try {
      const res = await fetch(`/api/document-types/${initialType.id}/schema`);
      if (!res.ok) throw new Error(`Export failed: ${res.statusText}`);
      const schema = await res.json();
      const blob = new Blob([JSON.stringify(schema, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${name.trim().replace(/\s+/g, '-').toLowerCase()}-schema.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      alert(`Export failed: ${(e as Error).message}`);
    }
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
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" onClick={onCancel} style={btn('ghost')}>
            Cancel
          </button>
          {initialType?.id && (
            <button type="button" onClick={handleExportSchema} style={btn('secondary')} title="Download JSON Schema">
              Export Schema
            </button>
          )}
        </div>
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
