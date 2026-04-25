// frontend/src/components/pipelines/versions/VersionDiffModal.tsx
//
// Side-by-side diff between the current draft and the last published snapshot
// (populated by `publishPipeline` into `currentDef.publishedSnapshot`).
//
// Three columns: Added / Removed / Modified nodes (matched by id). Clicking a
// row dispatches `setSelectedNodeId` (passed by the parent) so the user jumps
// to the node on the canvas. Edges, version bump, and tag changes are shown
// at the bottom as summary lines.

import { useMemo } from 'react';
import type { CSSProperties } from 'react';

import Modal from '../../shared/Modal';
import { colors } from '../../../constants/styles';
import type {
  PipelineDefinition,
  PipelineNode,
} from '../../../types/pipeline';
import { diffDefinitions } from './diffDefinitions';
import type { NodeDiffRow } from './diffDefinitions';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface VersionDiffModalProps {
  open: boolean;
  onClose: () => void;
  currentDef: PipelineDefinition;
  publishedDef: PipelineDefinition | null;
  /** Invoked when the user clicks a node row. Closes the modal afterwards. */
  onJumpToNode?: (nodeId: string) => void;
}

// ---------------------------------------------------------------------------
// Re-export types for tests / external consumers
// ---------------------------------------------------------------------------

export type { NodeDiffRow } from './diffDefinitions';

// ---------------------------------------------------------------------------
// Display helpers
// ---------------------------------------------------------------------------

const TYPE_ICON: Record<string, string> = {
  trigger: '▶',
  llm: '🧠',
  transform: '⚙',
  condition: '❓',
  action: '⚡',
  fork: '🔀',
  join: '🔗',
  approval: '✋',
};

function shortLabel(node: PipelineNode): string {
  if (node.data.type === 'condition' && node.data.label) return node.data.label;
  if (node.data.type === 'llm') return node.data.model;
  if (node.data.type === 'action') return node.data.actionType;
  if (node.data.type === 'trigger') return node.data.triggerType;
  return node.type.charAt(0).toUpperCase() + node.type.slice(1);
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const columnStyle: CSSProperties = {
  flex: '1 1 0',
  minWidth: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
};

const columnHeaderStyle: CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: 0.5,
  textTransform: 'uppercase',
  color: colors.textSecondary,
  marginBottom: 2,
};

const rowBaseStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  padding: '6px 8px',
  borderRadius: 6,
  fontSize: 12,
  fontFamily: 'inherit',
  background: '#f8fafc',
  border: `1px solid ${colors.border}`,
  textAlign: 'left',
  width: '100%',
  cursor: 'pointer',
  color: colors.textPrimary,
};

const badgeStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  padding: '1px 6px',
  borderRadius: 4,
  fontSize: 10,
  fontWeight: 600,
  background: '#fef3c7',
  color: '#92400e',
};

const summaryLineStyle: CSSProperties = {
  fontSize: 12,
  color: colors.textSecondary,
  marginTop: 4,
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

function renderRow(
  row: NodeDiffRow,
  kind: 'added' | 'removed' | 'modified',
  onJump: ((nodeId: string) => void) | undefined,
): React.ReactNode {
  const node = row.node;
  const icon = TYPE_ICON[node.type] ?? '■';
  const canJump = kind !== 'removed' && !!onJump;
  return (
    <button
      key={`${kind}-${row.node.id}`}
      type="button"
      disabled={!canJump}
      onClick={canJump ? () => onJump!(row.node.id) : undefined}
      style={{
        ...rowBaseStyle,
        cursor: canJump ? 'pointer' : 'default',
        opacity: kind === 'removed' ? 0.85 : 1,
      }}
      data-testid={`diff-row-${kind}`}
    >
      <span style={{ fontSize: 14 }}>{icon}</span>
      <span style={{ fontWeight: 600 }}>{node.type}</span>
      <span style={{ color: colors.textSecondary, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {shortLabel(node)}
      </span>
      {kind === 'modified' && row.positionChanged ? (
        <span style={badgeStyle}>moved</span>
      ) : null}
    </button>
  );
}

function VersionDiffModal({
  open,
  onClose,
  currentDef,
  publishedDef,
  onJumpToNode,
}: VersionDiffModalProps): React.ReactElement | null {
  const diff = useMemo(
    () => diffDefinitions(currentDef, publishedDef),
    [currentDef, publishedDef],
  );

  const handleJump = (nodeId: string) => {
    if (onJumpToNode) onJumpToNode(nodeId);
    onClose();
  };

  const hasSnapshot = publishedDef !== null;
  const currentVersion = currentDef.version;
  const publishedVersion = currentDef.publishedVersion;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Changes since publish"
      maxWidth={820}
      footer={
        <button
          onClick={onClose}
          style={{
            padding: '7px 16px',
            fontSize: 13,
            fontWeight: 600,
            background: colors.primary,
            color: '#fff',
            border: 'none',
            borderRadius: 7,
            cursor: 'pointer',
            fontFamily: 'inherit',
          }}
        >
          Close
        </button>
      }
    >
      {/* Version header */}
      <div
        style={{
          fontSize: 13,
          color: colors.textPrimary,
          marginBottom: 12,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          flexWrap: 'wrap',
        }}
      >
        <strong>v{currentVersion}</strong>
        <span style={{ color: colors.textTertiary }}>vs</span>
        {typeof publishedVersion === 'number' ? (
          <strong>published v{publishedVersion}</strong>
        ) : (
          <strong style={{ color: colors.textSecondary }}>never published</strong>
        )}
      </div>

      {currentDef.publishedVersion === undefined ? (
        <p style={{ margin: 0, fontSize: 13, color: colors.textSecondary }}>
          This pipeline has never been published.
        </p>
      ) : !hasSnapshot ? (
        <p style={{ margin: 0, fontSize: 13, color: colors.textSecondary }}>
          v{currentDef.version} · Published v{currentDef.publishedVersion} · No
          snapshot stored — diff will be available after the next publish
          (Phase&nbsp;2 once archived snapshots back-fill).
        </p>
      ) : (
        <>
          {/* Three columns — responsive wrap so narrow modals stack */}
          <div
            style={{
              display: 'flex',
              gap: 12,
              flexWrap: 'wrap',
            }}
          >
            <div style={columnStyle}>
              <div style={columnHeaderStyle}>
                Added ({diff.addedNodes.length})
              </div>
              {diff.addedNodes.length === 0 ? (
                <div style={{ fontSize: 12, color: colors.textTertiary }}>None</div>
              ) : (
                diff.addedNodes.map((row) => renderRow(row, 'added', handleJump))
              )}
            </div>

            <div style={columnStyle}>
              <div style={columnHeaderStyle}>
                Removed ({diff.removedNodes.length})
              </div>
              {diff.removedNodes.length === 0 ? (
                <div style={{ fontSize: 12, color: colors.textTertiary }}>None</div>
              ) : (
                diff.removedNodes.map((row) => renderRow(row, 'removed', undefined))
              )}
            </div>

            <div style={columnStyle}>
              <div style={columnHeaderStyle}>
                Modified ({diff.modifiedNodes.length})
              </div>
              {diff.modifiedNodes.length === 0 ? (
                <div style={{ fontSize: 12, color: colors.textTertiary }}>None</div>
              ) : (
                diff.modifiedNodes.map((row) => renderRow(row, 'modified', handleJump))
              )}
            </div>
          </div>

          {/* Summary metadata */}
          <div
            style={{
              marginTop: 16,
              paddingTop: 12,
              borderTop: `1px solid ${colors.border}`,
            }}
          >
            <div style={summaryLineStyle}>
              <strong>{diff.addedEdges}</strong> edge
              {diff.addedEdges === 1 ? '' : 's'} added ·{' '}
              <strong>{diff.removedEdges}</strong> edge
              {diff.removedEdges === 1 ? '' : 's'} removed
            </div>
            {diff.nameChanged ? (
              <div style={summaryLineStyle}>
                Name: <em>"{diff.previousName ?? ''}"</em> →{' '}
                <strong>"{currentDef.name}"</strong>
              </div>
            ) : null}
            {diff.iconChanged ? (
              <div style={summaryLineStyle}>
                Icon: {diff.previousIcon ?? '—'} → {currentDef.icon ?? '—'}
              </div>
            ) : null}
            {diff.tagsChanged ? (
              <div style={summaryLineStyle}>
                Tags changed: added [{diff.tagsAdded.join(', ') || '—'}], removed [
                {diff.tagsRemoved.join(', ') || '—'}]
              </div>
            ) : null}
          </div>
        </>
      )}
    </Modal>
  );
}

export default VersionDiffModal;
