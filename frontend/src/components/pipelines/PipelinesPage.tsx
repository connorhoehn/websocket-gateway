// frontend/src/components/pipelines/PipelinesPage.tsx
//
// List view for pipelines (route `/pipelines`). Matches PIPELINES_PLAN.md
// §18.3 layout: sticky header with primary CTA, filter bar (search / status /
// trigger / sort), and a card grid populated from localStorage-backed storage.
//
// Phase 1: no real run data yet, so runs-today is always "never run". The
// editor route handles the actual run dispatch — see TODO below for Phase 4.
//
// Multi-select / bulk actions:
//   The `[Select]` toggle in the header enables selection mode. In that mode,
//   each card shows a checkbox top-right; clicking the card toggles selection
//   instead of opening the editor. The filter bar grows a "select-all-visible"
//   master checkbox with indeterminate state. Shift-clicking a per-row
//   checkbox extends the selection range from the last click.
//
//   When at least one card is selected a sticky bulk-action bar appears below
//   the filter row with: Clear, Export selected as JSON (single combined
//   file, mirroring the runs-page UX), Publish selected, Archive selected
//   (toggle), Add tag, Remove tag, Delete. Keyboard: Escape clears selection,
//   Cmd/Ctrl+A selects all currently-filtered cards, Delete/Backspace opens
//   the bulk delete confirm.
//
// URL-bound state (mirrors `<PipelineRunsPage/>`):
//   ?status=draft,published,archived   multi-select status chips
//                                       empty/missing = draft + published
//                                       (archived hidden by default)

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import {
  listPipelines,
  loadPipeline,
  createPipeline,
  createDemoPipeline,
  deletePipeline,
  duplicatePipeline,
  exportPipelineJSON,
  publishPipeline,
  archivePipeline,
  savePipeline,
  type PipelineIndexEntry,
} from './persistence/pipelineStorage';
import TemplatesModal from './TemplatesModal';
import { useTriggerRun } from './hooks/useTriggerRun';
import type { PipelineTemplate } from './templates';
import type {
  PipelineDefinition,
  TriggerBinding,
  TriggerType,
} from '../../types/pipeline';
import EmptyState from '../shared/EmptyState';
import Modal from '../shared/Modal';
import IconPicker from '../shared/IconPicker';
import { useToast } from '../shared/ToastProvider';
import { useIdentityContext } from '../../contexts/IdentityContext';
import {
  colors,
  chipStyle,
  fieldStyle,
  saveBtnStyle,
  cancelBtnStyle,
  menuBtn,
} from '../../constants/styles';

// ---------------------------------------------------------------------------
// Types / filters
// ---------------------------------------------------------------------------

export type StatusKey = 'draft' | 'published' | 'archived';
export const STATUS_KEYS: readonly StatusKey[] = ['draft', 'published', 'archived'] as const;

const STATUS_LABEL: Record<StatusKey, string> = {
  draft: 'Draft',
  published: 'Published',
  archived: 'Archived',
};

// When the URL has no `status` param at all, default the filter to hide
// archived pipelines (so the list isn't cluttered after an archive). The user
// can still see them by toggling the Archived chip.
const DEFAULT_STATUS_KEYS: readonly StatusKey[] = ['draft', 'published'] as const;

type TriggerFilter = 'all' | 'manual' | 'document' | 'schedule' | 'webhook';
type SortKey = 'updated' | 'name' | 'created';

/**
 * Parse the `?status=` param into a Set. Unknown values are dropped silently.
 * Empty or missing param → `null`, signaling the caller should fall back to
 * `DEFAULT_STATUS_KEYS`.
 */
export function parseStatusParam(raw: string | null): Set<StatusKey> | null {
  if (raw == null) return null;
  if (raw.trim() === '') return new Set<StatusKey>();
  const allowed = new Set<string>(STATUS_KEYS);
  const out = new Set<StatusKey>(
    raw
      .split(',')
      .map((s) => s.trim())
      .filter((s) => allowed.has(s)) as StatusKey[],
  );
  return out;
}

interface PipelineRow extends PipelineIndexEntry {
  version: number;
  publishedVersion?: number;
  nodeCount: number;
  triggerBinding?: TriggerBinding;
  createdAt: string;
  icon: string;
  tags: string[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toRow(def: PipelineDefinition, fallbackIcon?: string): PipelineRow {
  return {
    id: def.id,
    name: def.name,
    status: def.status,
    updatedAt: def.updatedAt,
    version: def.version,
    publishedVersion: def.publishedVersion,
    nodeCount: def.nodes.length,
    triggerBinding: def.triggerBinding,
    createdAt: def.createdAt,
    icon: def.icon ?? fallbackIcon ?? '🔀',
    tags: def.tags ?? [],
  };
}

function triggerCategory(binding?: TriggerBinding): TriggerFilter {
  const ev: TriggerType | undefined = binding?.event;
  if (!ev || ev === 'manual') return 'manual';
  if (ev === 'schedule') return 'schedule';
  if (ev === 'webhook') return 'webhook';
  return 'document';
}

function triggerSummary(binding?: TriggerBinding): { icon: string; text: string } {
  const cat = triggerCategory(binding);
  if (cat === 'manual') return { icon: '▶', text: 'Manual' };
  if (cat === 'schedule') return { icon: '⏱', text: binding?.schedule ?? 'Schedule' };
  if (cat === 'webhook') return { icon: '🔌', text: binding?.webhookPath ?? 'Webhook' };
  return { icon: '🗎', text: `On ${binding?.event}` };
}

function downloadJSON(filename: string, json: string): void {
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function slugify(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    || 'pipeline';
}

function todayStamp(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

// ---------------------------------------------------------------------------
// Card
// ---------------------------------------------------------------------------

interface PipelineCardProps {
  row: PipelineRow;
  onOpen: () => void;
  onRun: () => void;
  onDuplicate: () => void;
  onExport: () => void;
  onDelete: () => void;
  // Selection
  selectionMode: boolean;
  selected: boolean;
  anySelected: boolean;
  /**
   * Toggle selection for this card. The boolean argument is true when the
   * triggering event held Shift — used by the page to extend the selection
   * range from the most recently clicked checkbox.
   */
  onToggleSelect: (shiftKey: boolean) => void;
}

function PipelineCard({
  row, onOpen, onRun, onDuplicate, onExport, onDelete,
  selectionMode, selected, anySelected, onToggleSelect,
}: PipelineCardProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [hovered, setHovered] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onDocClick = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [menuOpen]);

  const isPublished = row.status === 'published';
  const isArchived = row.status === 'archived';
  const hasPublishedVersion = typeof row.publishedVersion === 'number';
  const trigger = triggerSummary(row.triggerBinding);

  // Row 2: status chip with a variant that reflects draft-with-published state.
  let statusLabel: string;
  let statusVariant: 'success' | 'neutral' | 'warning' | 'danger';
  if (isArchived) {
    statusLabel = `Archived · v${row.version}`;
    statusVariant = 'danger';
  } else if (isPublished) {
    statusLabel = `Published · v${row.version}`;
    statusVariant = 'success';
  } else if (hasPublishedVersion) {
    statusLabel = `Draft · v${row.version} (published v${row.publishedVersion})`;
    statusVariant = 'warning';
  } else {
    statusLabel = `Draft · v${row.version}`;
    statusVariant = 'neutral';
  }

  const runDisabled = !isPublished;

  const stop = (fn: () => void) => (e: React.MouseEvent) => {
    e.stopPropagation();
    fn();
  };

  // Show checkbox when selection mode is active, OR when hovered, OR when any
  // card is already selected (so the user can easily expand their selection).
  const checkboxVisible = selectionMode || selected || hovered || anySelected;

  const handleCardClick = (e: React.MouseEvent) => {
    if (selectionMode) {
      onToggleSelect(e.shiftKey);
    } else {
      onOpen();
    }
  };

  // Selected visual treatment: primary-color border + subtle glow, matching
  // the node-selection pattern used elsewhere in the app.
  const borderColor = selected
    ? colors.primary
    : (hovered ? colors.primary : colors.border);
  const boxShadow = selected
    ? `0 0 0 4px rgba(100,108,255,0.18)`
    : (hovered ? '0 2px 8px rgba(15,23,42,0.06)' : 'none');

  return (
    <div
      data-testid={`pipeline-card-${row.id}`}
      data-selected={selected ? 'true' : 'false'}
      onClick={handleCardClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => { setHovered(false); setMenuOpen(false); }}
      style={{
        display: 'flex', flexDirection: 'column', gap: 10,
        width: '100%', minHeight: 160,
        padding: 14, background: colors.surface,
        border: `1px solid ${borderColor}`,
        borderRadius: 10, cursor: 'pointer',
        transition: 'border-color 100ms, box-shadow 100ms',
        boxShadow,
        position: 'relative',
      }}
    >
      {/* Selection checkbox (top-right) */}
      {checkboxVisible && (
        <label
          onClick={(e) => e.stopPropagation()}
          style={{
            position: 'absolute', top: 8, right: 8,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            width: 22, height: 22,
            cursor: 'pointer',
            zIndex: 1,
          }}
        >
          <input
            type="checkbox"
            data-testid={`pipeline-select-${row.id}`}
            checked={selected}
            onClick={(e) => {
              // onClick is the only synthetic event guaranteed to surface the
              // native shiftKey flag in jsdom (`fireEvent.click` doesn't fire
              // mousedown). Do the toggle here instead of relying on onChange.
              e.stopPropagation();
              onToggleSelect(e.shiftKey);
            }}
            onKeyDown={(e) => {
              // Shift+Space → keyboard equivalent of shift-click.
              if (e.key === ' ' || e.key === 'Spacebar') {
                e.preventDefault();
                onToggleSelect(e.shiftKey);
              }
            }}
            // Controlled-input warning suppressor: React requires onChange on
            // checked inputs. We do the work in onClick (so we can read
            // shiftKey), so onChange is intentionally a no-op.
            onChange={() => { /* handled in onClick */ }}
            style={{ cursor: 'pointer', width: 16, height: 16, accentColor: colors.primary }}
          />
        </label>
      )}

      {/* Row 1: icon + name */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, paddingRight: checkboxVisible ? 28 : 0 }}>
        <span style={{ fontSize: 22, flexShrink: 0 }} aria-hidden>{row.icon}</span>
        <div
          style={{
            flex: 1, minWidth: 0, fontSize: 14, fontWeight: 700,
            color: colors.textPrimary,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}
          title={row.name}
        >
          {row.name}
        </div>
      </div>

      {/* Row 2: status chip */}
      <div>
        <span style={chipStyle(statusVariant)}>{statusLabel}</span>
      </div>

      {/* Row 3: trigger summary */}
      <div style={{ fontSize: 12, color: colors.textSecondary, display: 'flex', alignItems: 'center', gap: 6 }}>
        <span aria-hidden>{trigger.icon}</span>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {trigger.text}
        </span>
      </div>

      {/* Row 4: meta */}
      <div style={{ fontSize: 12, color: colors.textTertiary }}>
        {row.nodeCount} node{row.nodeCount === 1 ? '' : 's'} · never run
      </div>

      {/* Row 5: actions */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 'auto' }}>
        <button
          data-testid={`run-pipeline-${row.id}`}
          onClick={stop(onRun)}
          disabled={runDisabled}
          title={runDisabled ? 'Run requires published state' : 'Run pipeline'}
          style={{
            ...saveBtnStyle(runDisabled),
            padding: '5px 12px', fontSize: 12,
          }}
        >
          Run
        </button>
        <button
          data-testid={`edit-pipeline-${row.id}`}
          onClick={stop(onOpen)}
          style={{
            padding: '5px 12px', fontSize: 12, fontWeight: 600,
            background: colors.surface, color: colors.textSecondary,
            border: `1px solid ${colors.borderField}`, borderRadius: 6,
            cursor: 'pointer', fontFamily: 'inherit',
          }}
        >
          Edit
        </button>
        <div style={{ position: 'relative', marginLeft: 'auto' }} ref={menuRef}>
          <button
            data-testid={`overflow-pipeline-${row.id}`}
            onClick={stop(() => setMenuOpen(v => !v))}
            aria-label="More actions"
            style={{
              padding: '4px 8px', fontSize: 14, fontWeight: 700,
              background: 'transparent', color: colors.textSecondary,
              border: `1px solid transparent`, borderRadius: 6,
              cursor: 'pointer', fontFamily: 'inherit', lineHeight: 1,
            }}
          >
            ⋯
          </button>
          {menuOpen && (
            <div
              data-testid={`overflow-menu-${row.id}`}
              onClick={(e) => e.stopPropagation()}
              style={{
                position: 'absolute', right: 0, top: '100%', marginTop: 4,
                background: colors.surface, border: `1px solid ${colors.border}`,
                borderRadius: 8, boxShadow: '0 8px 24px rgba(15,23,42,0.12)',
                minWidth: 160, zIndex: 10, overflow: 'hidden',
              }}
            >
              <button style={menuBtn} onClick={stop(() => { setMenuOpen(false); onDuplicate(); })}>
                Duplicate
              </button>
              <button style={menuBtn} onClick={stop(() => { setMenuOpen(false); onExport(); })}>
                Export JSON
              </button>
              <button
                style={{ ...menuBtn, color: '#dc2626' }}
                onClick={stop(() => { setMenuOpen(false); onDelete(); })}
              >
                Delete
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// New-pipeline modal
// ---------------------------------------------------------------------------

function NewPipelineModal({
  open,
  onClose,
  onCreate,
}: {
  open: boolean;
  onClose: () => void;
  onCreate: (name: string, icon: string) => void;
}) {
  const [name, setName] = useState('');
  const [icon, setIcon] = useState('🔀');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setName('');
      setIcon('🔀');
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  const canSubmit = name.trim().length > 0;
  const handleSubmit = () => { if (canSubmit) onCreate(name.trim(), icon); };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Create new pipeline"
      maxWidth={440}
      footer={
        <>
          <button data-testid="new-pipeline-cancel" style={cancelBtnStyle} onClick={onClose}>
            Cancel
          </button>
          <button
            data-testid="new-pipeline-confirm"
            style={saveBtnStyle(!canSubmit)}
            disabled={!canSubmit}
            onClick={handleSubmit}
          >
            Create pipeline
          </button>
        </>
      }
    >
      <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: colors.textSecondary, marginBottom: 6 }}>
        Icon
      </label>
      <div style={{ marginBottom: 14 }}>
        <IconPicker value={icon} onChange={setIcon} />
      </div>
      <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: colors.textSecondary, marginBottom: 6 }}>
        Name
      </label>
      <input
        ref={inputRef}
        data-testid="new-pipeline-name"
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') handleSubmit(); }}
        placeholder="e.g. Invoice summarizer"
        style={{ ...fieldStyle, width: '100%', padding: '8px 12px', fontSize: 14 }}
      />
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Bulk action bar — sticky, shown only when selected.size > 0
// ---------------------------------------------------------------------------

interface BulkActionBarProps {
  count: number;
  onClear: () => void;
  onExport: () => void;
  onExportAsJSON: () => void;
  onPublish: () => void;
  onArchive: () => void;
  onAddTag: () => void;
  onRemoveTag: () => void;
  onDelete: () => void;
  onDeleteWithConfirm: () => void;
  addTagOpen: boolean;
  removeTagOpen: boolean;
  onSubmitAddTag: (tag: string) => void;
  onSubmitRemoveTag: (tag: string) => void;
  onCloseAddTag: () => void;
  onCloseRemoveTag: () => void;
  unionTags: string[];
}

function BulkActionBar({
  count, onClear, onExport, onExportAsJSON, onPublish, onArchive,
  onAddTag, onRemoveTag, onDelete, onDeleteWithConfirm,
  addTagOpen, removeTagOpen, onSubmitAddTag, onSubmitRemoveTag,
  onCloseAddTag, onCloseRemoveTag, unionTags,
}: BulkActionBarProps) {
  const [addTagText, setAddTagText] = useState('');
  const addTagInputRef = useRef<HTMLInputElement>(null);
  const addTagPopoverRef = useRef<HTMLDivElement>(null);
  const removeTagPopoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (addTagOpen) {
      setAddTagText('');
      setTimeout(() => addTagInputRef.current?.focus(), 30);
    }
  }, [addTagOpen]);

  // Click-outside to dismiss the add-tag popover.
  useEffect(() => {
    if (!addTagOpen) return;
    const handler = (e: MouseEvent) => {
      if (!addTagPopoverRef.current?.contains(e.target as Node)) onCloseAddTag();
    };
    // Next tick to avoid the opener click immediately closing us.
    const id = window.setTimeout(() => {
      document.addEventListener('mousedown', handler);
    }, 0);
    return () => {
      window.clearTimeout(id);
      document.removeEventListener('mousedown', handler);
    };
  }, [addTagOpen, onCloseAddTag]);

  // Click-outside to dismiss the remove-tag popover.
  useEffect(() => {
    if (!removeTagOpen) return;
    const handler = (e: MouseEvent) => {
      if (!removeTagPopoverRef.current?.contains(e.target as Node)) onCloseRemoveTag();
    };
    const id = window.setTimeout(() => {
      document.addEventListener('mousedown', handler);
    }, 0);
    return () => {
      window.clearTimeout(id);
      document.removeEventListener('mousedown', handler);
    };
  }, [removeTagOpen, onCloseRemoveTag]);

  const handleAddTagSubmit = () => {
    const v = addTagText.trim();
    if (v.length === 0) return;
    onSubmitAddTag(v);
    setAddTagText('');
  };

  const pillBtnStyle: React.CSSProperties = {
    padding: '5px 10px', fontSize: 12, fontWeight: 600,
    background: colors.surface, color: colors.textSecondary,
    border: `1px solid ${colors.borderField}`, borderRadius: 6,
    cursor: 'pointer', fontFamily: 'inherit',
  };

  return (
    <div
      data-testid="bulk-action-bar"
      style={{
        minHeight: 40, flexShrink: 0, display: 'flex', alignItems: 'center',
        gap: 12, padding: '0 24px',
        borderBottom: `1px solid ${colors.border}`,
        background: '#eef2ff',
        position: 'sticky', top: 56, zIndex: 1,
      }}
    >
      <span data-testid="bulk-count" style={{ fontSize: 13, fontWeight: 600, color: colors.textPrimary }}>
        {count} selected
      </span>
      <span style={{ color: colors.textTertiary }}>·</span>
      <button data-testid="bulk-clear" style={pillBtnStyle} onClick={onClear}>
        Clear
      </button>
      <button data-testid="bulk-publish" style={pillBtnStyle} onClick={onPublish}>
        Publish selected
      </button>
      <button data-testid="bulk-archive" style={pillBtnStyle} onClick={onArchive}>
        Archive selected
      </button>
      <button data-testid="bulk-export-json" style={pillBtnStyle} onClick={onExportAsJSON}>
        Export selected as JSON
      </button>
      <button data-testid="bulk-export" style={pillBtnStyle} onClick={onExport}>
        Export all
      </button>
      <button
        data-testid="bulk-delete-confirm-prompt"
        style={pillBtnStyle}
        onClick={onDeleteWithConfirm}
      >
        Delete selected
      </button>

      {/* Add tag button + popover */}
      <div style={{ position: 'relative' }}>
        <button data-testid="bulk-add-tag-btn" style={pillBtnStyle} onClick={onAddTag}>
          Add tag…
        </button>
        {addTagOpen && (
          <div
            ref={addTagPopoverRef}
            data-testid="bulk-add-tag-popover"
            onClick={(e) => e.stopPropagation()}
            style={{
              position: 'absolute', top: '100%', left: 0, marginTop: 6,
              background: colors.surface, border: `1px solid ${colors.border}`,
              borderRadius: 8, boxShadow: '0 8px 24px rgba(15,23,42,0.12)',
              minWidth: 220, padding: 10, zIndex: 10,
              display: 'flex', flexDirection: 'column', gap: 8,
            }}
          >
            <input
              ref={addTagInputRef}
              type="text"
              data-testid="bulk-add-tag-input"
              placeholder="Tag name"
              value={addTagText}
              onChange={(e) => setAddTagText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleAddTagSubmit();
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  onCloseAddTag();
                }
              }}
              style={{ ...fieldStyle, width: '100%', padding: '6px 10px', fontSize: 13 }}
            />
            <button
              data-testid="bulk-add-tag-submit"
              style={{ ...saveBtnStyle(addTagText.trim().length === 0), padding: '5px 10px', fontSize: 12 }}
              disabled={addTagText.trim().length === 0}
              onClick={handleAddTagSubmit}
            >
              Add
            </button>
          </div>
        )}
      </div>

      {/* Remove tag button + popover */}
      <div style={{ position: 'relative' }}>
        <button
          data-testid="bulk-remove-tag-btn"
          style={{ ...pillBtnStyle, opacity: unionTags.length === 0 ? 0.5 : 1, cursor: unionTags.length === 0 ? 'not-allowed' : 'pointer' }}
          onClick={onRemoveTag}
          disabled={unionTags.length === 0}
          title={unionTags.length === 0 ? 'No tags on selected pipelines' : 'Remove tag from selected'}
        >
          Remove tag…
        </button>
        {removeTagOpen && (
          <div
            ref={removeTagPopoverRef}
            data-testid="bulk-remove-tag-popover"
            onClick={(e) => e.stopPropagation()}
            style={{
              position: 'absolute', top: '100%', left: 0, marginTop: 6,
              background: colors.surface, border: `1px solid ${colors.border}`,
              borderRadius: 8, boxShadow: '0 8px 24px rgba(15,23,42,0.12)',
              minWidth: 220, maxWidth: 320, padding: 10, zIndex: 10,
              display: 'flex', flexDirection: 'column', gap: 8,
            }}
          >
            <div style={{ fontSize: 12, color: colors.textSecondary }}>
              Click a tag to remove it from all selected:
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {unionTags.length === 0 ? (
                <div style={{ fontSize: 12, color: colors.textTertiary }}>No tags to remove.</div>
              ) : (
                unionTags.map(tag => (
                  <button
                    key={tag}
                    data-testid={`bulk-remove-tag-chip-${tag}`}
                    onClick={() => onSubmitRemoveTag(tag)}
                    style={{
                      padding: '3px 8px', fontSize: 12, fontWeight: 500,
                      background: '#fef2f2', color: '#dc2626',
                      border: '1px solid #fecaca', borderRadius: 12,
                      cursor: 'pointer', fontFamily: 'inherit',
                    }}
                  >
                    {tag} ✕
                  </button>
                ))
              )}
            </div>
          </div>
        )}
      </div>

      <button
        data-testid="bulk-delete"
        style={{
          padding: '5px 12px', fontSize: 12, fontWeight: 600,
          background: '#dc2626', color: '#fff', border: 'none',
          borderRadius: 6, cursor: 'pointer', fontFamily: 'inherit',
          marginLeft: 'auto',
        }}
        onClick={onDelete}
      >
        Delete
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function PipelinesPage() {
  const navigate = useNavigate();
  const { userId } = useIdentityContext();
  const { toast } = useToast();
  const { triggerRun, isTriggering } = useTriggerRun();
  const [searchParams, setSearchParams] = useSearchParams();

  const [rows, setRows] = useState<PipelineRow[]>([]);
  const [search, setSearch] = useState('');
  const [triggerFilter, setTriggerFilter] = useState<TriggerFilter>('all');
  const [sortKey, setSortKey] = useState<SortKey>('updated');

  // Status filter is URL-bound (multi-select) for shareable links + back-button
  // restore. Missing param → DEFAULT_STATUS_KEYS (drafts + published, no
  // archived). Empty string → empty Set, which by convention means "all" so
  // links built by the toolbar's clear-all action don't trip the default.
  const statusFilterParsed = useMemo(
    () => parseStatusParam(searchParams.get('status')),
    [searchParams],
  );
  const statusFilter: Set<StatusKey> = useMemo(() => {
    if (statusFilterParsed == null) return new Set<StatusKey>(DEFAULT_STATUS_KEYS);
    return statusFilterParsed;
  }, [statusFilterParsed]);
  // Was the URL explicit (vs. default)? Tracks the difference so the user can
  // reach "show every status including archived" by clicking the Archived chip.
  const statusExplicit = statusFilterParsed != null;

  const updateStatusParam = (next: Set<StatusKey>) => {
    const params = new URLSearchParams(searchParams);
    // Build the canonical csv (sorted to keep URLs deterministic).
    if (next.size === 0) {
      // Empty Set → encode as empty string so the URL is explicit (and
      // semantically distinct from the missing-param default).
      params.set('status', '');
    } else {
      const csv = STATUS_KEYS.filter(k => next.has(k)).join(',');
      params.set('status', csv);
    }
    setSearchParams(params, { replace: true });
  };

  const toggleStatusKey = (k: StatusKey) => {
    const base: Set<StatusKey> = statusExplicit
      ? new Set(statusFilter)
      : new Set(DEFAULT_STATUS_KEYS);
    if (base.has(k)) base.delete(k);
    else base.add(k);
    updateStatusParam(base);
  };

  const [newModalOpen, setNewModalOpen] = useState(false);
  const [templatesModalOpen, setTemplatesModalOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  // ─── Bulk selection state ─────────────────────────────────────────────────
  //
  // Mini state machine:
  //   idle               ── click [Select] ──▶ selectionMode=true
  //   selectionMode      ── click card       ──▶ selected += id
  //   selected.size > 0  ── bulk action bar shows
  //                      ── Clear / Escape    ──▶ selected = ∅
  //                      ── Cmd/Ctrl+A        ──▶ selected = allFiltered
  //                      ── Delete/Backspace  ──▶ bulkDeleteOpen = true
  //                      ── Add tag           ──▶ addTagPopoverOpen = true
  //                      ── Remove tag        ──▶ removeTagPopoverOpen = true
  //                      ── Export all        ──▶ staggered downloadJSON loop
  const [selectionMode, setSelectionMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [addTagOpen, setAddTagOpen] = useState(false);
  const [removeTagOpen, setRemoveTagOpen] = useState(false);
  // Most recently clicked row index (in the visible/filtered list). Used to
  // anchor the shift-click range select.
  const lastClickedIdxRef = useRef<number | null>(null);
  const selectAllRef = useRef<HTMLInputElement>(null);

  // Load / refresh from storage.
  const refresh = useCallback(() => {
    const entries = listPipelines();
    const enriched: PipelineRow[] = [];
    for (const e of entries) {
      const def = loadPipeline(e.id);
      if (def) enriched.push(toRow(def, e.icon));
    }
    setRows(enriched);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  // ─── Filter + sort pipeline (client-side) ─────────────────────────────────

  const visibleRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = rows.filter(r => {
      if (q) {
        // Match name OR any tag substring — tag filtering chip stays hidden by
        // default, but free-text search should still find tagged pipelines.
        const nameHit = r.name.toLowerCase().includes(q);
        const tagHit = r.tags.some(t => t.toLowerCase().includes(q));
        if (!nameHit && !tagHit) return false;
      }
      // Empty Set with `statusExplicit=true` means "match all" (the user has
      // expressed intent to see everything). The default (no URL param) uses
      // DEFAULT_STATUS_KEYS, which excludes 'archived'.
      if (!(statusExplicit && statusFilter.size === 0)) {
        if (!statusFilter.has(r.status as StatusKey)) return false;
      }
      if (triggerFilter !== 'all' && triggerCategory(r.triggerBinding) !== triggerFilter) return false;
      return true;
    });

    const sorted = [...filtered];
    if (sortKey === 'name') {
      sorted.sort((a, b) => a.name.localeCompare(b.name));
    } else if (sortKey === 'created') {
      sorted.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    } else {
      sorted.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    }
    return sorted;
  }, [rows, search, statusFilter, statusExplicit, triggerFilter, sortKey]);

  // Union of tags across the selected rows (for the "Remove tag…" popover).
  const selectedUnionTags = useMemo(() => {
    const tagSet = new Set<string>();
    for (const r of rows) {
      if (!selected.has(r.id)) continue;
      for (const t of r.tags) tagSet.add(t);
    }
    return Array.from(tagSet).sort((a, b) => a.localeCompare(b));
  }, [rows, selected]);

  const filteredIds = useMemo(() => visibleRows.map(r => r.id), [visibleRows]);

  // ─── Handlers ────────────────────────────────────────────────────────────

  const clearSelection = useCallback(() => {
    setSelected(new Set());
    setAddTagOpen(false);
    setRemoveTagOpen(false);
  }, []);

  const handleToggleSelectMode = () => {
    if (selectionMode) {
      // Turning off also clears any selection.
      clearSelection();
      setSelectionMode(false);
    } else {
      setSelectionMode(true);
    }
  };

  const handleToggleSelect = (id: string, shiftKey = false) => {
    const visible = visibleRows;
    const idx = visible.findIndex(r => r.id === id);
    // Snapshot the anchor BEFORE we update the ref below — the setSelected
    // updater runs during commit, by which time `lastClickedIdxRef.current`
    // would already hold the new idx and the range collapses to a single row.
    const anchorIdx = lastClickedIdxRef.current;
    if (idx !== -1) lastClickedIdxRef.current = idx;
    setSelected(prev => {
      const next = new Set(prev);
      const turnOn = !next.has(id);
      // Shift-click range: extend from anchorIdx → idx.
      if (shiftKey && anchorIdx != null && idx !== -1) {
        const lo = Math.min(anchorIdx, idx);
        const hi = Math.max(anchorIdx, idx);
        for (let i = lo; i <= hi; i++) {
          const r = visible[i];
          if (!r) continue;
          if (turnOn) next.add(r.id);
          else next.delete(r.id);
        }
      } else if (turnOn) {
        next.add(id);
      } else {
        next.delete(id);
      }
      return next;
    });
  };

  const handleSelectAllFiltered = useCallback(() => {
    setSelected(new Set(filteredIds));
  }, [filteredIds]);

  // Header "select-all-visible" checkbox — toggles all visible rows. If every
  // visible row is already selected, this acts as "deselect all visible".
  const allVisibleSelected =
    visibleRows.length > 0 && visibleRows.every(r => selected.has(r.id));
  const someVisibleSelected =
    !allVisibleSelected && visibleRows.some(r => selected.has(r.id));

  const handleHeaderToggleAll = () => {
    setSelected(prev => {
      const next = new Set(prev);
      if (allVisibleSelected) {
        for (const r of visibleRows) next.delete(r.id);
      } else {
        for (const r of visibleRows) next.add(r.id);
      }
      return next;
    });
    // Selecting via header re-arms `selectionMode` so the checkboxes stay
    // visible on every card.
    if (!selectionMode) setSelectionMode(true);
  };

  // Wire indeterminate visual state on the master checkbox.
  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = someVisibleSelected;
    }
  }, [someVisibleSelected]);

  const handleCreate = (name: string, icon: string) => {
    const def = createPipeline({ name, createdBy: userId, icon });
    setNewModalOpen(false);
    navigate(`/pipelines/${def.id}`);
  };

  const handleSpawnDemo = () => {
    const def = createDemoPipeline(userId);
    refresh();
    navigate(`/pipelines/${def.id}`);
  };

  const handleSelectTemplate = (template: PipelineTemplate) => {
    const def = template.build(userId);
    savePipeline(def);
    setTemplatesModalOpen(false);
    navigate(`/pipelines/${def.id}`);
  };

  const handleOpen = (id: string) => navigate(`/pipelines/${id}`);

  const handleRun = async (row: PipelineRow) => {
    if (row.status !== 'published') {
      toast('Run requires published state', { type: 'warning' });
      return;
    }
    if (isTriggering) return;
    // Dispatch a manual trigger with empty payload via Agent 1's hook, then
    // route to the editor so the user sees the live execution. On failure we
    // still navigate so they can inspect/retry from the editor surface.
    try {
      const runId = await triggerRun(row.id, {});
      if (runId) {
        toast(`Run started for "${row.name}"`, { type: 'success' });
      } else {
        toast('Could not start run', { type: 'error' });
      }
    } catch (err) {
      toast(`Run failed: ${(err as Error).message}`, { type: 'error' });
    } finally {
      navigate(`/pipelines/${row.id}`);
    }
  };

  const handleDuplicate = (id: string) => {
    const clone = duplicatePipeline(id);
    refresh();
    if (clone) toast(`Duplicated as "${clone.name}"`, { type: 'success' });
  };

  const handleExport = (row: PipelineRow) => {
    const json = exportPipelineJSON(row.id);
    if (!json) {
      toast('Export failed', { type: 'error' });
      return;
    }
    downloadJSON(`${slugify(row.name)}.pipeline.json`, json);
  };

  const handleDeleteConfirm = () => {
    if (!deleteId) return;
    deletePipeline(deleteId);
    setDeleteId(null);
    refresh();
    toast('Pipeline deleted', { type: 'success' });
  };

  const deleteRow = deleteId ? rows.find(r => r.id === deleteId) : null;

  // ─── Bulk action handlers ────────────────────────────────────────────────

  const handleBulkExport = () => {
    // N staggered downloads (100ms apart) to dodge browser download throttling.
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    ids.forEach((id, i) => {
      window.setTimeout(() => {
        const row = rows.find(r => r.id === id);
        const json = exportPipelineJSON(id);
        if (!row || !json) return;
        downloadJSON(
          `${slugify(row.name)}-${todayStamp()}.pipeline.json`,
          json,
        );
      }, i * 100);
    });
    toast(`Exported ${ids.length} pipeline${ids.length === 1 ? '' : 's'}`, { type: 'success' });
  };

  const handleBulkAddTagSubmit = (tag: string) => {
    const ids = Array.from(selected);
    for (const id of ids) {
      const def = loadPipeline(id);
      if (!def) continue;
      const current = def.tags ?? [];
      if (current.includes(tag)) continue;
      def.tags = [...current, tag];
      savePipeline(def);
    }
    setAddTagOpen(false);
    refresh();
    toast(`Added tag "${tag}" to ${ids.length} pipeline${ids.length === 1 ? '' : 's'}`, { type: 'success' });
  };

  const handleBulkRemoveTagSubmit = (tag: string) => {
    const ids = Array.from(selected);
    for (const id of ids) {
      const def = loadPipeline(id);
      if (!def) continue;
      const current = def.tags ?? [];
      if (!current.includes(tag)) continue;
      def.tags = current.filter(t => t !== tag);
      savePipeline(def);
    }
    refresh();
    toast(`Removed tag "${tag}" from ${ids.length} pipeline${ids.length === 1 ? '' : 's'}`, { type: 'success' });
    // Leave the popover open so user can remove additional tags, but if no
    // union tags remain for this selection, close it.
    // (We compute union from `rows`, which is the pre-refresh state here; a
    // re-render will pick up the updated set and hide chips appropriately.)
  };

  const handleBulkDeleteConfirm = () => {
    const ids = Array.from(selected);
    for (const id of ids) deletePipeline(id);
    setBulkDeleteOpen(false);
    clearSelection();
    refresh();
    toast(`Deleted ${ids.length} pipeline${ids.length === 1 ? '' : 's'}`, { type: 'success' });
  };

  // ─── New bulk actions: publish / archive / export-as-JSON / delete-confirm ─
  //
  // These mirror the runs-page bulk-action toolbar UX. publish/archive are
  // optimistic (no confirm prompt — easy to undo). delete uses window.confirm
  // since it's destructive. exportAsJSON downloads a single combined file
  // (distinct from the per-pipeline staggered Export-all path above).

  const handleBulkPublish = () => {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    let publishedCount = 0;
    let skippedCount = 0;
    for (const id of ids) {
      const def = loadPipeline(id);
      if (!def) continue;
      // Skip already-published pipelines (idempotent).
      if (def.status === 'published') {
        skippedCount += 1;
        continue;
      }
      const res = publishPipeline(id);
      if (res) publishedCount += 1;
    }
    refresh();
    if (skippedCount > 0) {
      toast(
        `Published ${publishedCount}; skipped ${skippedCount} already published`,
        { type: 'success' },
      );
    } else {
      toast(
        `Published ${publishedCount} pipeline${publishedCount === 1 ? '' : 's'}`,
        { type: 'success' },
      );
    }
  };

  const handleBulkArchive = () => {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    let archivedCount = 0;
    let unarchivedCount = 0;
    for (const id of ids) {
      const def = loadPipeline(id);
      if (!def) continue;
      const wasArchived = def.status === 'archived';
      const res = archivePipeline(id);
      if (!res) continue;
      if (wasArchived) unarchivedCount += 1;
      else archivedCount += 1;
    }
    refresh();
    const parts: string[] = [];
    if (archivedCount > 0) parts.push(`Archived ${archivedCount}`);
    if (unarchivedCount > 0) parts.push(`Unarchived ${unarchivedCount}`);
    toast(parts.join(' · ') || 'No pipelines changed', { type: 'success' });
  };

  const handleBulkExportAsJSON = () => {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    const defs: PipelineDefinition[] = [];
    for (const id of ids) {
      const def = loadPipeline(id);
      if (def) defs.push(def);
    }
    if (defs.length === 0) {
      toast('Export failed', { type: 'error' });
      return;
    }
    // ISO timestamp with `:` and `.` swapped for filename safety on Windows
    // (mirrors the runs-page export filename scheme).
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    downloadJSON(`pipelines-${ts}.json`, JSON.stringify(defs, null, 2));
    toast(
      `Exported ${defs.length} pipeline${defs.length === 1 ? '' : 's'}`,
      { type: 'success' },
    );
  };

  const handleBulkDeleteWithConfirm = () => {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    const ok = window.confirm(
      `Delete ${ids.length} pipeline${ids.length === 1 ? '' : 's'}? This cannot be undone.`,
    );
    if (!ok) return;
    for (const id of ids) deletePipeline(id);
    clearSelection();
    refresh();
    toast(
      `Deleted ${ids.length} pipeline${ids.length === 1 ? '' : 's'}`,
      { type: 'success' },
    );
  };

  // ─── Keyboard shortcuts ──────────────────────────────────────────────────
  //
  // Escape         → clear selection + exit selection mode (if no popovers/modals open)
  // Cmd/Ctrl+A     → select all filtered rows (only when selectionMode is on)
  // Delete/Backspace → open bulk delete modal (when selected.size > 0)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Don't hijack keys while typing in inputs / textareas / contenteditable.
      const target = e.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable) {
          return;
        }
      }

      if (e.key === 'Escape') {
        // Escape clears selection. Let any open modal handle its own Escape
        // first; if we got here the card isn't focused inside a modal.
        if (selected.size > 0 || selectionMode || addTagOpen || removeTagOpen) {
          setAddTagOpen(false);
          setRemoveTagOpen(false);
          clearSelection();
          setSelectionMode(false);
        }
        return;
      }

      const isMod = e.metaKey || e.ctrlKey;
      if (isMod && (e.key === 'a' || e.key === 'A')) {
        if (selectionMode) {
          e.preventDefault();
          handleSelectAllFiltered();
        }
        return;
      }

      if ((e.key === 'Delete' || e.key === 'Backspace') && selected.size > 0) {
        // Avoid stealing Backspace while a modal is open (the modal owns it).
        if (!bulkDeleteOpen && !deleteId && !newModalOpen && !templatesModalOpen) {
          e.preventDefault();
          setBulkDeleteOpen(true);
        }
      }
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [
    selected, selectionMode, addTagOpen, removeTagOpen,
    bulkDeleteOpen, deleteId, newModalOpen, templatesModalOpen,
    clearSelection, handleSelectAllFiltered,
  ]);

  // ─── Render ──────────────────────────────────────────────────────────────

  const hasAnyPipelines = rows.length > 0;
  const anySelected = selected.size > 0;

  return (
    <div
      data-testid="pipelines-page"
      style={{
        display: 'flex', flexDirection: 'column', height: '100%',
        overflow: 'hidden', background: colors.surfaceInset,
        fontFamily: 'inherit',
      }}
    >
      {/* ── Header (sticky, 56px) ── */}
      <div
        style={{
          height: 56, flexShrink: 0, display: 'flex', alignItems: 'center',
          justifyContent: 'space-between', padding: '0 24px',
          borderBottom: `1px solid ${colors.border}`, background: colors.surface,
          position: 'sticky', top: 0, zIndex: 2,
        }}
      >
        <div style={{ fontSize: 18, fontWeight: 700, color: colors.textPrimary }}>
          Pipelines
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button
            data-testid="select-toggle-btn"
            onClick={handleToggleSelectMode}
            aria-pressed={selectionMode}
            style={{
              padding: '7px 14px', fontSize: 13, fontWeight: 600,
              background: selectionMode ? colors.primary : colors.surface,
              color: selectionMode ? '#fff' : colors.textSecondary,
              border: `1px solid ${selectionMode ? colors.primary : colors.borderField}`,
              borderRadius: 7, cursor: 'pointer', fontFamily: 'inherit',
            }}
          >
            {selectionMode ? '☑ Selecting' : '☑ Select'}
          </button>
          <button
            data-testid="templates-btn"
            onClick={() => setTemplatesModalOpen(true)}
            style={{
              padding: '7px 16px', fontSize: 13, fontWeight: 600,
              background: colors.surface, color: colors.textSecondary,
              border: `1px solid ${colors.borderField}`, borderRadius: 7,
              cursor: 'pointer', fontFamily: 'inherit',
            }}
          >
            Templates
          </button>
          <button
            data-testid="new-pipeline-btn"
            onClick={() => setNewModalOpen(true)}
            style={{ ...saveBtnStyle(false), padding: '7px 16px', fontSize: 13 }}
          >
            + New Pipeline
          </button>
        </div>
      </div>

      {/* ── Filter bar (40px) ── */}
      {hasAnyPipelines && (
        <div
          style={{
            minHeight: 40, flexShrink: 0, display: 'flex', alignItems: 'center',
            gap: 12, padding: '0 24px',
            borderBottom: `1px solid ${colors.border}`,
            background: colors.surface,
          }}
        >
          {/* Header "select-all-visible" checkbox with indeterminate state. */}
          <label
            style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}
            title="Select all visible pipelines"
          >
            <input
              ref={selectAllRef}
              type="checkbox"
              data-testid="pipeline-select-all"
              aria-label="Select all visible pipelines"
              checked={allVisibleSelected}
              onChange={handleHeaderToggleAll}
              style={{ width: 14, height: 14, accentColor: colors.primary }}
            />
            <span style={{ fontSize: 11, color: colors.textTertiary }}>All</span>
          </label>
          <input
            data-testid="pipeline-search"
            type="search"
            placeholder="🔍 Search…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ ...fieldStyle, flex: '0 1 260px', minWidth: 180 }}
          />
          {/* Status filter chips — multi-select, URL-bound (?status=…). */}
          <span
            id="pipelines-status-label"
            style={{ fontSize: 12, color: colors.textSecondary, fontWeight: 500 }}
          >
            Status:
          </span>
          <div
            role="group"
            aria-labelledby="pipelines-status-label"
            style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}
          >
            {STATUS_KEYS.map((s) => {
              const active = statusExplicit
                ? statusFilter.has(s)
                : (DEFAULT_STATUS_KEYS as readonly StatusKey[]).includes(s);
              return (
                <button
                  key={s}
                  type="button"
                  role="checkbox"
                  aria-checked={active}
                  data-testid={`status-chip-${s}`}
                  onClick={() => toggleStatusKey(s)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      toggleStatusKey(s);
                    }
                  }}
                  style={{
                    padding: '6px 12px',
                    fontSize: 12,
                    fontWeight: 500,
                    border: `1px solid ${active ? colors.primary : colors.border}`,
                    background: active ? colors.primary : colors.surface,
                    color: active ? '#fff' : colors.textSecondary,
                    borderRadius: 4,
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                  }}
                >
                  {STATUS_LABEL[s]}
                </button>
              );
            })}
          </div>
          <label style={{ fontSize: 12, color: colors.textSecondary, display: 'flex', alignItems: 'center', gap: 6 }}>
            Trigger:
            <select
              data-testid="trigger-filter"
              value={triggerFilter}
              onChange={(e) => setTriggerFilter(e.target.value as TriggerFilter)}
              style={{ ...fieldStyle, padding: '4px 8px', flex: 'initial' }}
            >
              <option value="all">All</option>
              <option value="manual">Manual</option>
              <option value="document">Document event</option>
              <option value="schedule">Schedule</option>
              <option value="webhook">Webhook</option>
            </select>
          </label>
          <label style={{ fontSize: 12, color: colors.textSecondary, display: 'flex', alignItems: 'center', gap: 6, marginLeft: 'auto' }}>
            Sort:
            <select
              data-testid="sort-key"
              value={sortKey}
              onChange={(e) => setSortKey(e.target.value as SortKey)}
              style={{ ...fieldStyle, padding: '4px 8px', flex: 'initial' }}
            >
              <option value="updated">Recently updated</option>
              <option value="name">Name A–Z</option>
              <option value="created">Recently created</option>
            </select>
          </label>
        </div>
      )}

      {/* ── Bulk action bar (slim, sticky under filter row) ── */}
      {anySelected && (
        <BulkActionBar
          count={selected.size}
          onClear={clearSelection}
          onExport={handleBulkExport}
          onExportAsJSON={handleBulkExportAsJSON}
          onPublish={handleBulkPublish}
          onArchive={handleBulkArchive}
          onAddTag={() => { setAddTagOpen(v => !v); setRemoveTagOpen(false); }}
          onRemoveTag={() => { setRemoveTagOpen(v => !v); setAddTagOpen(false); }}
          onDelete={() => setBulkDeleteOpen(true)}
          onDeleteWithConfirm={handleBulkDeleteWithConfirm}
          addTagOpen={addTagOpen}
          removeTagOpen={removeTagOpen}
          onSubmitAddTag={handleBulkAddTagSubmit}
          onSubmitRemoveTag={handleBulkRemoveTagSubmit}
          onCloseAddTag={() => setAddTagOpen(false)}
          onCloseRemoveTag={() => setRemoveTagOpen(false)}
          unionTags={selectedUnionTags}
        />
      )}

      {/* ── Body ── */}
      <div style={{ flex: 1, overflowY: 'auto', padding: hasAnyPipelines ? 24 : 0 }}>
        {!hasAnyPipelines ? (
          <div style={{ position: 'relative', height: '100%' }}>
            <EmptyState
              icon="🔀"
              title="No pipelines yet"
              body="Design your first one — from scratch or pick a template later."
              actionLabel="+ New Pipeline"
              onAction={() => setNewModalOpen(true)}
            />
            <div
              style={{
                position: 'absolute', left: '50%', bottom: '40%',
                transform: 'translate(-50%, 64px)',
                display: 'flex', alignItems: 'center', gap: 10,
                fontSize: 13, color: colors.textTertiary,
              }}
            >
              <button
                data-testid="empty-state-demo"
                onClick={handleSpawnDemo}
                style={{
                  background: 'transparent', border: 'none', padding: '4px 8px',
                  fontSize: 13, color: colors.primary, cursor: 'pointer',
                  textDecoration: 'underline', fontFamily: 'inherit',
                }}
              >
                or try the demo pipeline
              </button>
              <span aria-hidden>·</span>
              <button
                data-testid="empty-state-templates"
                onClick={() => setTemplatesModalOpen(true)}
                style={{
                  background: 'transparent', border: 'none', padding: '4px 8px',
                  fontSize: 13, color: colors.primary, cursor: 'pointer',
                  textDecoration: 'underline', fontFamily: 'inherit',
                }}
              >
                or browse templates
              </button>
            </div>
          </div>
        ) : visibleRows.length === 0 ? (
          <div
            data-testid="filtered-empty"
            style={{
              textAlign: 'center', padding: 48, fontSize: 13,
              color: colors.textTertiary,
            }}
          >
            No pipelines match the current filters.
          </div>
        ) : (
          <div
            data-testid="pipeline-grid"
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
              gap: 16,
            }}
          >
            {visibleRows.map(row => (
              <PipelineCard
                key={row.id}
                row={row}
                onOpen={() => handleOpen(row.id)}
                onRun={() => { void handleRun(row); }}
                onDuplicate={() => handleDuplicate(row.id)}
                onExport={() => handleExport(row)}
                onDelete={() => setDeleteId(row.id)}
                selectionMode={selectionMode}
                selected={selected.has(row.id)}
                anySelected={anySelected}
                onToggleSelect={(shift) => handleToggleSelect(row.id, shift)}
              />
            ))}
          </div>
        )}
      </div>

      {/* ── New pipeline modal ── */}
      <NewPipelineModal
        open={newModalOpen}
        onClose={() => setNewModalOpen(false)}
        onCreate={handleCreate}
      />

      {/* ── Templates modal ── */}
      <TemplatesModal
        open={templatesModalOpen}
        onClose={() => setTemplatesModalOpen(false)}
        onSelect={handleSelectTemplate}
      />

      {/* ── Single delete confirmation modal ── */}
      <Modal
        open={!!deleteId}
        onClose={() => setDeleteId(null)}
        title="Delete pipeline?"
        maxWidth={400}
        footer={
          <>
            <button
              data-testid="delete-pipeline-cancel"
              style={cancelBtnStyle}
              onClick={() => setDeleteId(null)}
            >
              Cancel
            </button>
            <button
              data-testid="delete-pipeline-confirm"
              onClick={handleDeleteConfirm}
              style={{
                padding: '7px 18px', fontSize: 13, fontWeight: 600,
                background: '#dc2626', color: '#fff', border: 'none',
                borderRadius: 7, cursor: 'pointer', fontFamily: 'inherit',
              }}
            >
              Delete
            </button>
          </>
        }
      >
        {deleteRow && (
          <p style={{ margin: 0 }}>
            <strong>"{deleteRow.name}"</strong> will be permanently removed.
            Run history will also be lost.
          </p>
        )}
      </Modal>

      {/* ── Bulk delete confirmation modal ── */}
      <Modal
        open={bulkDeleteOpen}
        onClose={() => setBulkDeleteOpen(false)}
        title={`Delete ${selected.size} pipeline${selected.size === 1 ? '' : 's'}?`}
        maxWidth={420}
        backdropTestId="bulk-delete-modal"
        footer={
          <>
            <button
              data-testid="bulk-delete-cancel"
              style={cancelBtnStyle}
              onClick={() => setBulkDeleteOpen(false)}
            >
              Cancel
            </button>
            <button
              data-testid="bulk-delete-confirm"
              onClick={handleBulkDeleteConfirm}
              style={{
                padding: '7px 18px', fontSize: 13, fontWeight: 600,
                background: '#dc2626', color: '#fff', border: 'none',
                borderRadius: 7, cursor: 'pointer', fontFamily: 'inherit',
              }}
            >
              Delete {selected.size}
            </button>
          </>
        }
      >
        <p style={{ margin: 0 }}>
          <strong>{selected.size} pipeline{selected.size === 1 ? '' : 's'}</strong> will
          be permanently removed. Run history will also be lost.
        </p>
      </Modal>
    </div>
  );
}
