// frontend/src/components/pipelines/TemplatesModal.tsx
//
// Gallery of prebuilt pipeline templates. Pick one and the modal will:
//   1. Call template.build(createdBy) to materialize a fresh PipelineDefinition
//   2. Deep-clone the returned nodes/edges and regenerate every node/edge id so
//      multiple spawns from the same template don't collide
//   3. Reset the cloned def: name = "{Template name} (copy)", status='draft',
//      version=1, createdAt=now, publishedVersion cleared
//   4. Persist via savePipeline(def) (pipelineStorage)
//   5. Close the modal and call onCreated(newPipelineId) so the caller can
//      navigate to the editor
//
// For backwards-compat with callers that still pass the older onSelect prop
// (which receives the raw template), onSelect is also supported. If both are
// supplied, onCreated takes precedence and persistence is the modal's job.
//
// Keyboard:
//   - Esc: close (handled by Modal)
//   - Enter (focused in search input): select first matching template
//
// See PIPELINES_PLAN.md §18.3.

import { useEffect, useMemo, useRef, useState } from 'react';
import Modal from '../shared/Modal';
import { colors, fieldStyle } from '../../constants/styles';
import { savePipeline } from './persistence/pipelineStorage';
import { useIdentityContext } from '../../contexts/IdentityContext';
import { pipelineTemplates, type PipelineTemplate } from './templates';
import type {
  PipelineDefinition,
  PipelineEdge,
  PipelineNode,
} from '../../types/pipeline';

interface TemplatesModalProps {
  open: boolean;
  onClose: () => void;
  /** New API: invoked after the template has been persisted with the new id. */
  onCreated?: (pipelineId: string) => void;
  /** Legacy API: invoked with the raw template; caller is responsible for
   * persistence + navigation. Kept for backwards-compat. */
  onSelect?: (template: PipelineTemplate) => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Deep-clone the template's nodes/edges and regenerate every id so the spawned
 * pipeline can't collide with another spawn from the same template. Edges are
 * rewired against the new node ids via an id remap.
 */
function cloneAndRegenerateIds(def: PipelineDefinition): PipelineDefinition {
  const idMap = new Map<string, string>();
  const nodes: PipelineNode[] = def.nodes.map((n) => {
    const fresh = crypto.randomUUID();
    idMap.set(n.id, fresh);
    // Deep-clone data via JSON round-trip — safe because NodeData is plain JSON.
    return {
      ...n,
      id: fresh,
      data: JSON.parse(JSON.stringify(n.data)) as PipelineNode['data'],
      position: { ...n.position },
    };
  });
  const edges: PipelineEdge[] = def.edges.map((e) => ({
    ...e,
    id: crypto.randomUUID(),
    source: idMap.get(e.source) ?? e.source,
    target: idMap.get(e.target) ?? e.target,
  }));

  const now = new Date().toISOString();
  return {
    ...def,
    id: crypto.randomUUID(),
    name: `${def.name} (copy)`,
    status: 'draft',
    version: 1,
    publishedVersion: undefined,
    publishedSnapshot: undefined,
    nodes,
    edges,
    createdAt: now,
    updatedAt: now,
  };
}

function triggerLabel(def: PipelineDefinition): string {
  const ev = def.triggerBinding?.event ?? 'manual';
  if (ev === 'schedule') return 'Schedule';
  if (ev === 'webhook') return 'Webhook';
  if (ev === 'manual') return 'Manual';
  return ev.startsWith('document.') ? `On ${ev}` : ev;
}

// ---------------------------------------------------------------------------
// Card
// ---------------------------------------------------------------------------

interface TemplateCardProps {
  template: PipelineTemplate;
  /** Computed once for the thumbnail meta-row (node count, trigger). */
  meta: { nodeCount: number; trigger: string };
  onPick: (t: PipelineTemplate) => void;
}

function TemplateCard({ template, meta, onPick }: TemplateCardProps) {
  return (
    <div
      data-testid={`template-card-${template.id}`}
      style={{
        display: 'flex', flexDirection: 'column', gap: 8,
        width: 220, minHeight: 200, padding: 14,
        background: colors.surface, border: `1px solid ${colors.border}`,
        borderRadius: 10, fontFamily: 'inherit',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ fontSize: 24 }} aria-hidden>{template.icon}</span>
        <div
          style={{
            fontSize: 14, fontWeight: 700, color: colors.textPrimary,
            overflow: 'hidden', textOverflow: 'ellipsis',
          }}
        >
          {template.name}
        </div>
      </div>
      <div
        data-testid={`template-meta-${template.id}`}
        style={{ fontSize: 11, color: colors.textTertiary, display: 'flex', gap: 8 }}
      >
        <span>{meta.nodeCount} node{meta.nodeCount === 1 ? '' : 's'}</span>
        <span aria-hidden>·</span>
        <span>{meta.trigger}</span>
      </div>
      <div style={{ fontSize: 12, color: colors.textSecondary, lineHeight: 1.4, flex: 1 }}>
        {template.description}
      </div>
      {template.tags.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {template.tags.map((tag) => (
            <span
              key={tag}
              style={{
                fontSize: 10, fontWeight: 600, padding: '2px 6px', borderRadius: 4,
                background: colors.surfaceHover, color: colors.textSecondary,
                textTransform: 'lowercase',
              }}
            >
              {tag}
            </span>
          ))}
        </div>
      )}
      <button
        type="button"
        data-testid={`template-use-${template.id}`}
        onClick={() => onPick(template)}
        style={{
          marginTop: 'auto',
          padding: '6px 10px', fontSize: 12, fontWeight: 600,
          background: colors.primary, color: '#fff', border: 'none',
          borderRadius: 6, cursor: 'pointer', fontFamily: 'inherit',
        }}
      >
        Use this template
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Modal
// ---------------------------------------------------------------------------

export default function TemplatesModal({
  open, onClose, onCreated, onSelect,
}: TemplatesModalProps) {
  const { userId } = useIdentityContext();
  const [search, setSearch] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);

  // Reset search and focus input on open.
  useEffect(() => {
    if (open) {
      setSearch('');
      setTimeout(() => searchRef.current?.focus(), 30);
    }
  }, [open]);

  // Pre-compute thumbnails (node count + trigger). build() generates fresh ids
  // each call but the *shape* (node count, trigger) is stable, so we run it
  // once per template per modal-open cycle.
  const thumbnails = useMemo(() => {
    const map = new Map<string, { nodeCount: number; trigger: string }>();
    for (const t of pipelineTemplates) {
      const def = t.build(userId || 'anonymous');
      map.set(t.id, { nodeCount: def.nodes.length, trigger: triggerLabel(def) });
    }
    return map;
  }, [userId, open]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return pipelineTemplates;
    return pipelineTemplates.filter((t) =>
      t.name.toLowerCase().includes(q) ||
      t.description.toLowerCase().includes(q) ||
      t.tags.some((tag) => tag.toLowerCase().includes(q)),
    );
  }, [search]);

  const handlePick = (template: PipelineTemplate) => {
    // New API: persist + return id.
    if (onCreated) {
      const fresh = template.build(userId || 'anonymous');
      const def = cloneAndRegenerateIds(fresh);
      savePipeline(def);
      onClose();
      onCreated(def.id);
      return;
    }
    // Legacy fallback: caller handles persistence.
    if (onSelect) {
      onSelect(template);
    }
  };

  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && filtered.length > 0) {
      e.preventDefault();
      handlePick(filtered[0]);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Pipeline templates"
      maxWidth={760}
      backdropTestId="templates-modal"
      rawChildren
    >
      <div style={{ fontSize: 13, color: colors.textSecondary, marginBottom: 12 }}>
        Pick a template to spawn a new pipeline with prebuilt nodes and edges.
      </div>
      <input
        ref={searchRef}
        type="search"
        data-testid="templates-search"
        placeholder="Search templates…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        onKeyDown={handleSearchKeyDown}
        style={{ ...fieldStyle, width: '100%', padding: '8px 12px', fontSize: 13, marginBottom: 14 }}
      />
      {filtered.length === 0 ? (
        <div
          data-testid="templates-empty"
          style={{ textAlign: 'center', padding: 32, fontSize: 13, color: colors.textTertiary }}
        >
          No templates match "{search}".
        </div>
      ) : (
        <div
          data-testid="templates-grid"
          style={{
            display: 'grid', gridTemplateColumns: 'repeat(3, 220px)',
            gap: 12, justifyContent: 'center',
            maxHeight: '60vh', overflowY: 'auto', padding: 4,
          }}
        >
          {filtered.map((template) => (
            <TemplateCard
              key={template.id}
              template={template}
              meta={thumbnails.get(template.id) ?? { nodeCount: 0, trigger: '—' }}
              onPick={handlePick}
            />
          ))}
        </div>
      )}
    </Modal>
  );
}
