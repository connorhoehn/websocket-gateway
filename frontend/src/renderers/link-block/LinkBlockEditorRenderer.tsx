// Phase 51 / hub#71 — Link Block editor renderer.
//
// Stores an array of { label, url } pairs in section.metadata.links.
// The editor lets the user add/remove rows, edit label and url inline.

import type { SectionRendererProps } from '../types';

interface LinkRow { label: string; url: string }
interface LinksMeta { links?: LinkRow[] }

function readLinks(section: SectionRendererProps['section']): LinkRow[] {
  const m = (section.metadata ?? {}) as LinksMeta;
  return Array.isArray(m.links) ? m.links : [];
}

export default function LinkBlockEditorRenderer({
  section, editable, onUpdateSection,
}: SectionRendererProps) {
  const links = readLinks(section);

  const setLinks = (next: LinkRow[]): void => {
    onUpdateSection?.({
      metadata: { ...(section.metadata ?? {}), links: next },
    });
  };

  const addLink = (): void => setLinks([...links, { label: '', url: '' }]);
  const updateLink = (idx: number, patch: Partial<LinkRow>): void => {
    setLinks(links.map((l, i) => i === idx ? { ...l, ...patch } : l));
  };
  const removeLink = (idx: number): void => {
    setLinks(links.filter((_, i) => i !== idx));
  };

  return (
    <div data-testid={`link-block-editor-${section.id}`} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {links.length === 0 && (
        <div
          data-testid={`link-block-empty-${section.id}`}
          style={{ color: '#94a3b8', fontSize: 12, fontStyle: 'italic', padding: '4px 0' }}
        >
          No links yet.
        </div>
      )}
      {links.map((l, idx) => (
        <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <input
            type="text"
            data-testid={`link-block-label-${section.id}-${idx}`}
            value={l.label}
            placeholder="Label"
            onChange={(e) => updateLink(idx, { label: e.target.value })}
            disabled={!editable}
            style={{ flex: 1, padding: '4px 8px', fontSize: 13, border: '1px solid #cbd5e1', borderRadius: 4 }}
          />
          <input
            type="url"
            data-testid={`link-block-url-${section.id}-${idx}`}
            value={l.url}
            placeholder="https://example.com"
            onChange={(e) => updateLink(idx, { url: e.target.value })}
            disabled={!editable}
            style={{ flex: 2, padding: '4px 8px', fontSize: 13, border: '1px solid #cbd5e1', borderRadius: 4 }}
          />
          {editable && (
            <button
              type="button"
              data-testid={`link-block-remove-${section.id}-${idx}`}
              onClick={() => removeLink(idx)}
              style={{ border: 'none', background: 'none', color: '#ef4444', cursor: 'pointer', fontSize: 14, padding: '2px 6px' }}
            >
              ×
            </button>
          )}
        </div>
      ))}
      {editable && (
        <button
          type="button"
          data-testid={`link-block-add-${section.id}`}
          onClick={addLink}
          style={{
            alignSelf: 'flex-start', marginTop: 4, padding: '4px 12px', fontSize: 12,
            background: 'none', border: '1px dashed #cbd5e1', color: '#646cff', borderRadius: 6, cursor: 'pointer',
          }}
        >
          + Add link
        </button>
      )}
    </div>
  );
}
