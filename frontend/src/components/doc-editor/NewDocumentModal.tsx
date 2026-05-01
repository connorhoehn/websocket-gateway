// frontend/src/components/doc-editor/NewDocumentModal.tsx
//
// Modal for creating a new document. The type picker is driven by user-defined
// document types from the wizard (stored in localStorage). If no types exist
// yet, an empty-state prompt guides the user to create one first.

import { useState, useEffect, useRef } from 'react';
import { loadTypes } from '../../hooks/useDocumentTypes';
import type { DocumentType } from '../../types/documentType';
import Modal from '../shared/Modal';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface NewDocumentModalProps {
  open: boolean;
  onClose: () => void;
  onCreate: (meta: { title: string; type: string; description?: string; icon: string; documentTypeId: string }) => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function NewDocumentModal({ open, onClose, onCreate }: NewDocumentModalProps) {
  const [types, setTypes] = useState<DocumentType[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const titleRef = useRef<HTMLInputElement>(null);

  // Reload types from localStorage each time the modal opens
  useEffect(() => {
    if (!open) return;
    const loaded = loadTypes();
    setTypes(loaded);
    setSelectedId(loaded[0]?.id ?? null);
    setTitle('');
    setDescription('');
    setTimeout(() => titleRef.current?.focus(), 50);
  }, [open]);

  if (!open) return null;

  const selected = types.find(t => t.id === selectedId);

  const handleSubmit = () => {
    const trimmed = title.trim();
    if (!trimmed || !selected) return;
    onCreate({
      title: trimmed,
      type: selected.name,
      description: description.trim() || undefined,
      icon: selected.icon,
      documentTypeId: selected.id,
    });
    onClose();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey && title.trim() && selected) handleSubmit();
  };

  const canSubmit = !!title.trim() && !!selected;

  return (
    <Modal
      open={open}
      onClose={onClose}
      maxWidth={560}
      zIndex={9999}
      rawChildren
      backdropStyle={{ background: 'rgba(15,23,42,0.5)', backdropFilter: 'blur(2px)' }}
      cardStyle={{
        border: '1px solid #e2e8f0', borderRadius: 8,
        maxHeight: '90vh', width: '90vw',
        boxShadow: '0 20px 60px rgba(0,0,0,0.18)',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
        padding: 0,
      }}
    >
      <div onKeyDown={handleKeyDown} style={{ display: 'contents' }}>
        {/* Header */}
        <h2 style={{ margin: 0, padding: '24px 24px 16px', fontSize: 18, fontWeight: 700, color: '#1e293b', flexShrink: 0 }}>
          Create New Document
        </h2>

        {/* Scrollable body */}
        <div style={{ flex: '1 1 auto', overflowY: 'auto', padding: '0 24px', minHeight: 0 }}>

          {/* ── No types defined yet ── */}
          {types.length === 0 ? (
            <div style={{
              textAlign: 'center', padding: '32px 16px',
              border: '1px dashed #d1d5db', borderRadius: 8, marginBottom: 20,
              color: '#64748b',
            }}>
              <div style={{ fontSize: 40, marginBottom: 12 }}>📋</div>
              <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 8, color: '#374151' }}>
                No document types defined yet
              </div>
              <div style={{ fontSize: 13, color: '#94a3b8', maxWidth: 320, margin: '0 auto 16px' }}>
                Document types define the sections and structure of your documents.
                Create one first in <strong>☰ → Document Types</strong>.
              </div>
              <button
                onClick={onClose}
                style={{
                  padding: '8px 20px', fontSize: 13, fontWeight: 600,
                  background: '#646cff', color: '#fff', border: 'none',
                  borderRadius: 7, cursor: 'pointer', fontFamily: 'inherit',
                }}
              >
                Close
              </button>
            </div>
          ) : (
            <>
              {/* Type picker */}
              <div style={{ marginBottom: 20 }}>
                <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#475569', marginBottom: 8 }}>
                  Document Type
                </label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  {types.map((t) => {
                    const isSelected = selectedId === t.id;
                    return (
                      <button
                        key={t.id}
                        data-testid={`type-option-${t.id}`}
                        onClick={() => setSelectedId(t.id)}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 10,
                          minHeight: 72, padding: '10px 14px',
                          background: isSelected ? '#eff6ff' : '#ffffff',
                          border: `2px solid ${isSelected ? '#3b82f6' : '#e2e8f0'}`,
                          borderRadius: 8, cursor: 'pointer', textAlign: 'left',
                          position: 'relative', fontFamily: 'inherit',
                          transition: 'background 0.12s, border-color 0.12s',
                        }}
                        onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = '#f8fafc'; }}
                        onMouseLeave={e => { if (!isSelected) e.currentTarget.style.background = '#ffffff'; }}
                      >
                        <span style={{ fontSize: 24, flexShrink: 0 }}>{t.icon}</span>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontSize: 14, fontWeight: 600, color: '#1e293b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {t.name}
                          </div>
                          {t.description && (
                            <div style={{ fontSize: 11, color: '#64748b', lineHeight: 1.3, marginTop: 2, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
                              {t.description}
                            </div>
                          )}
                          <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 3 }}>
                            {t.fields.length} section{t.fields.length !== 1 ? 's' : ''}
                          </div>
                        </div>
                        {isSelected && (
                          <span style={{ position: 'absolute', top: 6, right: 8, fontSize: 14, color: '#3b82f6', fontWeight: 700 }}>
                            ✓
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Title */}
              <div style={{ marginBottom: 16 }}>
                <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#475569', marginBottom: 4 }}>
                  Title <span style={{ color: '#ef4444' }}>*</span>
                </label>
                <input
                  ref={titleRef}
                  data-testid="new-doc-title"
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder={selected ? `e.g. Q2 ${selected.name}` : 'Document title…'}
                  style={{
                    width: '100%', padding: '8px 12px', fontSize: 14,
                    border: '1px solid #e2e8f0', borderRadius: 8, outline: 'none',
                    background: '#ffffff', color: '#1e293b', boxSizing: 'border-box',
                    fontFamily: 'inherit',
                  }}
                  onFocus={e => { e.currentTarget.style.borderColor = '#3b82f6'; }}
                  onBlur={e => { e.currentTarget.style.borderColor = '#e2e8f0'; }}
                />
              </div>

              {/* Description */}
              <div style={{ marginBottom: 20 }}>
                <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#475569', marginBottom: 4 }}>
                  Description <span style={{ color: '#94a3b8', fontWeight: 400 }}>(optional)</span>
                </label>
                <textarea
                  data-testid="new-doc-description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Brief description of this document…"
                  rows={3}
                  style={{
                    width: '100%', padding: '8px 12px', fontSize: 14,
                    border: '1px solid #e2e8f0', borderRadius: 8, outline: 'none',
                    background: '#ffffff', color: '#1e293b', resize: 'vertical',
                    boxSizing: 'border-box', fontFamily: 'inherit',
                  }}
                  onFocus={e => { e.currentTarget.style.borderColor = '#3b82f6'; }}
                  onBlur={e => { e.currentTarget.style.borderColor = '#e2e8f0'; }}
                />
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        {types.length > 0 && (
          <div style={{
            display: 'flex', justifyContent: 'flex-end', gap: 8,
            padding: '16px 24px', borderTop: '1px solid #e2e8f0',
            background: '#ffffff', flexShrink: 0,
          }}>
            <button
              data-testid="new-doc-cancel"
              onClick={onClose}
              style={{
                padding: '8px 16px', fontSize: 14, fontWeight: 500,
                border: '1px solid #e2e8f0', borderRadius: 8,
                background: '#ffffff', color: '#475569',
                cursor: 'pointer', fontFamily: 'inherit',
              }}
            >
              Cancel
            </button>
            <button
              data-testid="new-doc-submit"
              onClick={handleSubmit}
              disabled={!canSubmit}
              style={{
                padding: '8px 20px', fontSize: 14, fontWeight: 600,
                border: 'none', borderRadius: 8,
                background: canSubmit ? '#3b82f6' : '#94a3b8',
                color: '#ffffff',
                cursor: canSubmit ? 'pointer' : 'not-allowed',
                fontFamily: 'inherit',
              }}
            >
              Create Document
            </button>
          </div>
        )}
      </div>
    </Modal>
  );
}
