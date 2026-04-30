// Phase 51 / hub#71 — File Upload reader renderer (read-only viewer).

import type { SectionRendererProps } from '../types';

export default function FileUploadReaderRenderer({ section }: SectionRendererProps) {
  const m = (section.metadata ?? {}) as { fileName?: string; fileDataUrl?: string; fileSize?: number };
  if (!m.fileName) {
    return (
      <div data-testid={`file-upload-reader-empty-${section.id}`} style={{ color: '#94a3b8', fontSize: 13, fontStyle: 'italic' }}>
        No file uploaded.
      </div>
    );
  }
  return (
    <div data-testid={`file-upload-reader-${section.id}`} style={{
      display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px',
      borderRadius: 6, background: '#f8fafc', border: '1px solid #e2e8f0', fontSize: 13,
    }}>
      <span style={{ fontSize: 16 }}>📎</span>
      <a
        href={m.fileDataUrl ?? '#'}
        download={m.fileName}
        data-testid={`file-upload-link-${section.id}`}
        style={{ color: '#646cff', fontWeight: 500, textDecoration: 'none' }}
      >
        Download {m.fileName}
      </a>
      {typeof m.fileSize === 'number' && (
        <span style={{ fontSize: 11, color: '#94a3b8' }}>
          ({(m.fileSize / 1024).toFixed(1)} kB)
        </span>
      )}
    </div>
  );
}
