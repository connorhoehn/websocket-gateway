// Phase 51 / hub#71 — Link Block reader renderer (read-only viewer).

import type { SectionRendererProps } from '../types';

interface LinkRow { label: string; url: string }
interface LinksMeta { links?: LinkRow[] }

export default function LinkBlockReaderRenderer({ section }: SectionRendererProps) {
  const m = (section.metadata ?? {}) as LinksMeta;
  const links = Array.isArray(m.links) ? m.links.filter((l) => l.url) : [];

  if (links.length === 0) {
    return (
      <div
        data-testid={`link-block-reader-empty-${section.id}`}
        style={{ color: '#94a3b8', fontSize: 13, fontStyle: 'italic' }}
      >
        No links.
      </div>
    );
  }

  return (
    <ul
      data-testid={`link-block-reader-${section.id}`}
      style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 4 }}
    >
      {links.map((l, idx) => (
        <li key={idx} style={{ fontSize: 13 }}>
          <a
            href={l.url}
            target="_blank"
            rel="noreferrer noopener"
            style={{ color: '#646cff', fontWeight: 500, textDecoration: 'none' }}
          >
            {l.label || l.url}
          </a>
        </li>
      ))}
    </ul>
  );
}
