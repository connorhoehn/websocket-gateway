import type { SectionRendererProps } from '../types';
import type { TaskItem } from '../../types/document';
import TiptapEditor from '../../components/doc-editor/TiptapEditor';

export default function ChecklistReaderRenderer({
  section,
  fragment,
  ydoc,
  provider,
  onUpdateItem,
  onNavigateToEditor,
}: SectionRendererProps) {
  const items = section.items;
  const total = items.length;
  const doneCount = items.filter(i => i.status === 'done').length;
  const pct = total > 0 ? Math.round((doneCount / total) * 100) : 0;

  return (
    <div>
      {fragment && ydoc && (
        <div style={{ marginBottom: 10 }}>
          <TiptapEditor
            fragment={fragment}
            ydoc={ydoc}
            provider={provider ?? null}
            user={{ name: '', color: '#6b7280' }}
            editable={false}
            sectionId={section.id}
          />
        </div>
      )}

      {total > 0 && (
        <div style={{ marginBottom: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
            <span style={{ fontSize: 11, color: '#64748b', fontWeight: 600 }}>{doneCount} / {total} done</span>
            <span style={{ fontSize: 11, color: pct === 100 ? '#10b981' : '#64748b', fontWeight: 600 }}>{pct}%</span>
          </div>
          <div style={{ height: 4, background: '#e2e8f0', borderRadius: 2, overflow: 'hidden' }}>
            <div style={{
              height: '100%',
              width: `${pct}%`,
              background: pct === 100 ? '#10b981' : '#3b82f6',
              borderRadius: 2,
              transition: 'width 0.3s ease',
            }} />
          </div>
        </div>
      )}

      {total === 0 ? (
        <div style={{ color: '#94a3b8', fontStyle: 'italic', fontSize: 13 }}>No items.</div>
      ) : (
        <div>
          {items.map((item: TaskItem) => {
            const done = item.status === 'done';
            return (
              <div
                key={item.id}
                style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0', borderBottom: '1px solid #f1f5f9' }}
              >
                <input
                  type="checkbox"
                  checked={done}
                  onChange={() => onUpdateItem?.(item.id, { status: done ? 'pending' : 'done' })}
                  style={{ width: 14, height: 14, accentColor: '#10b981', cursor: onUpdateItem ? 'pointer' : 'default', flexShrink: 0 }}
                  readOnly={!onUpdateItem}
                />
                <span style={{
                  fontSize: 13,
                  color: done ? '#94a3b8' : '#1e293b',
                  textDecoration: done ? 'line-through' : 'none',
                  flex: 1,
                  lineHeight: 1.4,
                }}>
                  {item.text || <span style={{ color: '#cbd5e1', fontStyle: 'italic' }}>Untitled</span>}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {onNavigateToEditor && (
        <button
          type="button"
          onClick={() => onNavigateToEditor(section.id)}
          style={{ marginTop: 8, background: 'none', border: 'none', color: '#3b82f6', fontSize: 12, cursor: 'pointer', padding: 0, fontFamily: 'inherit' }}
        >
          Edit in editor →
        </button>
      )}
    </div>
  );
}
