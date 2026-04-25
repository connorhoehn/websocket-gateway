import type { SectionRendererProps } from '../types';
import type { TaskItem } from '../../types/document';

const STATUS_META: Record<string, { label: string; icon: string; color: string; bg: string }> = {
  pending:  { label: 'Open',    icon: '○', color: '#92400e', bg: '#fef3c7' },
  acked:    { label: 'Decided', icon: '✓', color: '#065f46', bg: '#d1fae5' },
  done:     { label: 'Decided', icon: '✓', color: '#065f46', bg: '#d1fae5' },
  rejected: { label: 'Vetoed',  icon: '✕', color: '#991b1b', bg: '#fee2e2' },
};

function DecisionRow({ item }: { item: TaskItem }) {
  const meta = STATUS_META[item.status] ?? STATUS_META.pending;
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '6px 0', borderBottom: '1px solid #f1f5f9' }}>
      <span style={{
        width: 18,
        height: 18,
        borderRadius: '50%',
        background: meta.bg,
        color: meta.color,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 10,
        fontWeight: 700,
        flexShrink: 0,
        marginTop: 2,
        userSelect: 'none',
      }}>
        {meta.icon}
      </span>
      <span style={{
        flex: 1,
        fontSize: 13,
        color: item.status === 'rejected' ? '#94a3b8' : '#1e293b',
        textDecoration: item.status === 'rejected' ? 'line-through' : 'none',
        lineHeight: 1.4,
      }}>
        {item.text || <span style={{ color: '#cbd5e1', fontStyle: 'italic' }}>Untitled decision</span>}
      </span>
      <span style={{
        fontSize: 10,
        fontWeight: 600,
        padding: '2px 8px',
        borderRadius: 10,
        background: meta.bg,
        color: meta.color,
        whiteSpace: 'nowrap',
        flexShrink: 0,
      }}>
        {meta.label}
      </span>
    </div>
  );
}

function StatusGroup({ label, color, items }: { label: string; color: string; items: TaskItem[] }) {
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ fontSize: 10, fontWeight: 700, color, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 2 }}>
        {label}
      </div>
      {items.map(item => <DecisionRow key={item.id} item={item} />)}
    </div>
  );
}

export default function DecisionsReaderRenderer({ section, onNavigateToEditor }: SectionRendererProps) {
  const items = section.items;

  if (items.length === 0) {
    return (
      <div style={{ color: '#94a3b8', fontStyle: 'italic', fontSize: 13, padding: '4px 0' }}>
        No decisions recorded.
      </div>
    );
  }

  const open    = items.filter(i => i.status === 'pending');
  const decided = items.filter(i => i.status === 'acked' || i.status === 'done');
  const vetoed  = items.filter(i => i.status === 'rejected');

  return (
    <div>
      {open.length > 0    && <StatusGroup label="Open"    color="#92400e" items={open} />}
      {decided.length > 0 && <StatusGroup label="Decided" color="#065f46" items={decided} />}
      {vetoed.length > 0  && <StatusGroup label="Vetoed"  color="#991b1b" items={vetoed} />}

      {onNavigateToEditor && (
        <button
          type="button"
          onClick={() => onNavigateToEditor(section.id)}
          style={{ marginTop: 6, background: 'none', border: 'none', color: '#3b82f6', fontSize: 12, cursor: 'pointer', padding: 0, fontFamily: 'inherit' }}
        >
          Edit in editor →
        </button>
      )}
    </div>
  );
}
