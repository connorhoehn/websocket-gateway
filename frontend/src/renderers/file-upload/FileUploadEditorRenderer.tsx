// Phase 51 / hub#71 — File Upload editor renderer.
//
// v1: stores the selected file as a data-URL in section.metadata so the
// content survives a save without an external storage pipeline. A future
// task can swap the data-URL for an S3-equivalent upload (LocalStack
// in dev). The reader component renders a download link from whatever
// is stored.

import { useState } from 'react';
import type { SectionRendererProps } from '../types';

interface FileMeta {
  fileName?: string;
  fileDataUrl?: string;
  fileSize?: number;
}

function readMeta(section: SectionRendererProps['section']): FileMeta {
  const m = (section.metadata ?? {}) as FileMeta;
  return m;
}

export default function FileUploadEditorRenderer({
  section, editable, onUpdateSection,
}: SectionRendererProps) {
  const meta = readMeta(section);
  const [busy, setBusy] = useState(false);

  const handleFile = (file: File): void => {
    setBusy(true);
    const reader = new FileReader();
    reader.onload = () => {
      onUpdateSection?.({
        metadata: {
          ...(section.metadata ?? {}),
          fileName: file.name,
          fileDataUrl: typeof reader.result === 'string' ? reader.result : '',
          fileSize: file.size,
        },
      });
      setBusy(false);
    };
    reader.onerror = () => setBusy(false);
    reader.readAsDataURL(file);
  };

  const clear = (): void => {
    onUpdateSection?.({
      metadata: {
        ...(section.metadata ?? {}),
        fileName: undefined,
        fileDataUrl: undefined,
        fileSize: undefined,
      },
    });
  };

  return (
    <div data-testid={`file-upload-editor-${section.id}`}>
      {meta.fileName ? (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '8px 12px', borderRadius: 6, background: '#f8fafc',
          border: '1px solid #e2e8f0', fontSize: 13,
        }}>
          <span style={{ fontSize: 16 }}>📎</span>
          <span style={{ flex: 1, fontWeight: 500, color: '#0f172a' }}>{meta.fileName}</span>
          {typeof meta.fileSize === 'number' && (
            <span style={{ fontSize: 11, color: '#94a3b8' }}>
              {(meta.fileSize / 1024).toFixed(1)} kB
            </span>
          )}
          {editable && (
            <button
              type="button"
              data-testid={`file-upload-remove-${section.id}`}
              onClick={clear}
              style={{
                border: 'none', background: 'none', color: '#ef4444',
                cursor: 'pointer', fontSize: 14, padding: '2px 6px',
              }}
            >
              ×
            </button>
          )}
        </div>
      ) : (
        <label
          data-testid={`file-upload-empty-${section.id}`}
          style={{
            display: 'block',
            padding: '14px 16px',
            border: '1px dashed #cbd5e1',
            borderRadius: 8,
            color: '#64748b',
            fontSize: 13,
            textAlign: 'center',
            cursor: editable ? 'pointer' : 'default',
            background: '#fafbfc',
          }}
        >
          {busy ? 'Reading file…' : (section.placeholder ?? 'Click to upload a file')}
          <input
            type="file"
            data-testid={`file-upload-input-${section.id}`}
            disabled={!editable}
            style={{ display: 'none' }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleFile(f);
            }}
          />
        </label>
      )}
    </div>
  );
}
