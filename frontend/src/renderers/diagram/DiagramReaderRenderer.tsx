// Phase 51 / hub#71 — Diagram reader renderer (read-only viewer).

import type { SectionRendererProps } from '../types';

export default function DiagramReaderRenderer({ section }: SectionRendererProps) {
  const m = (section.metadata ?? {}) as { imageDataUrl?: string; alt?: string };
  if (!m.imageDataUrl) {
    return (
      <div data-testid={`diagram-reader-empty-${section.id}`} style={{ color: '#94a3b8', fontSize: 13, fontStyle: 'italic' }}>
        No diagram uploaded.
      </div>
    );
  }
  return (
    <figure data-testid={`diagram-reader-${section.id}`} style={{ margin: 0 }}>
      <img
        src={m.imageDataUrl}
        alt={m.alt ?? ''}
        style={{ maxWidth: '100%', maxHeight: 480, borderRadius: 6, border: '1px solid #e2e8f0' }}
      />
      {m.alt && (
        <figcaption style={{ fontSize: 11, color: '#94a3b8', marginTop: 4, textAlign: 'center' }}>
          {m.alt}
        </figcaption>
      )}
    </figure>
  );
}
