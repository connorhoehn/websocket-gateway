// Phase 51 / hub#71 — Diagram editor renderer.
//
// v1 stores the selected image as a data-URL in section.metadata. Same
// design as FileUpload but specialized to images: accepts image/* in
// the file input and renders a thumbnail preview when set.

import { useState } from 'react';
import type { SectionRendererProps } from '../types';

interface DiagramMeta {
  imageDataUrl?: string;
  alt?: string;
}

export default function DiagramEditorRenderer({
  section, editable, onUpdateSection,
}: SectionRendererProps) {
  const meta = (section.metadata ?? {}) as DiagramMeta;
  const [busy, setBusy] = useState(false);

  const handleFile = (file: File): void => {
    setBusy(true);
    const reader = new FileReader();
    reader.onload = () => {
      onUpdateSection?.({
        metadata: {
          ...(section.metadata ?? {}),
          imageDataUrl: typeof reader.result === 'string' ? reader.result : '',
          alt: meta.alt ?? file.name,
        },
      });
      setBusy(false);
    };
    reader.onerror = () => setBusy(false);
    reader.readAsDataURL(file);
  };

  const setAlt = (alt: string): void => {
    onUpdateSection?.({
      metadata: { ...(section.metadata ?? {}), alt },
    });
  };

  const clear = (): void => {
    onUpdateSection?.({
      metadata: { ...(section.metadata ?? {}), imageDataUrl: undefined, alt: undefined },
    });
  };

  return (
    <div data-testid={`diagram-editor-${section.id}`}>
      {meta.imageDataUrl ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <img
            data-testid={`diagram-image-${section.id}`}
            src={meta.imageDataUrl}
            alt={meta.alt ?? ''}
            style={{ maxWidth: '100%', maxHeight: 320, borderRadius: 6, border: '1px solid #e2e8f0' }}
          />
          {editable && (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input
                type="text"
                data-testid={`diagram-alt-${section.id}`}
                value={meta.alt ?? ''}
                placeholder="Alt text"
                onChange={(e) => setAlt(e.target.value)}
                style={{ flex: 1, padding: '4px 8px', fontSize: 12, border: '1px solid #cbd5e1', borderRadius: 4 }}
              />
              <button
                type="button"
                data-testid={`diagram-remove-${section.id}`}
                onClick={clear}
                style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: 13 }}
              >
                Remove
              </button>
            </div>
          )}
        </div>
      ) : (
        <label
          data-testid={`diagram-empty-${section.id}`}
          style={{
            display: 'block', padding: '14px 16px',
            border: '1px dashed #cbd5e1', borderRadius: 8,
            color: '#64748b', fontSize: 13, textAlign: 'center',
            cursor: editable ? 'pointer' : 'default', background: '#fafbfc',
          }}
        >
          {busy ? 'Reading image…' : (section.placeholder ?? 'Upload an image (PNG / JPG / SVG)')}
          <input
            type="file"
            accept="image/*"
            data-testid={`diagram-input-${section.id}`}
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
