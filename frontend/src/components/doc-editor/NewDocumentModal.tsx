// frontend/src/components/doc-editor/NewDocumentModal.tsx
//
// Modal dialog for creating a new document.
// Shows a type selector grid, title input, and optional description.

import { useState, useEffect, useRef } from 'react';
import { DOCUMENT_TEMPLATES } from '../../data/documentTemplates';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface NewDocumentModalProps {
  open: boolean;
  onClose: () => void;
  onCreate: (meta: { title: string; type: string; description?: string }) => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function NewDocumentModal({ open, onClose, onCreate }: NewDocumentModalProps) {
  const [selectedType, setSelectedType] = useState('meeting');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const titleRef = useRef<HTMLInputElement>(null);

  // Auto-focus the title input when the modal opens
  useEffect(() => {
    if (open) {
      setSelectedType('meeting');
      setTitle('');
      setDescription('');
      // Delay slightly so the DOM is rendered
      setTimeout(() => titleRef.current?.focus(), 50);
    }
  }, [open]);

  if (!open) return null;

  const handleSubmit = () => {
    const trimmed = title.trim();
    if (!trimmed) return;
    onCreate({
      title: trimmed,
      type: selectedType,
      description: description.trim() || undefined,
    });
    onClose();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') onClose();
    if (e.key === 'Enter' && !e.shiftKey && title.trim()) handleSubmit();
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backdropFilter: 'blur(4px)',
        background: 'rgba(0,0,0,0.35)',
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      onKeyDown={handleKeyDown}
    >
      <div
        style={{
          background: '#ffffff',
          border: '1px solid #e2e8f0',
          borderRadius: 8,
          maxWidth: 560,
          width: '90vw',
          boxShadow: '0 20px 60px rgba(0,0,0,0.18)',
          padding: '24px',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Title */}
        <h2 style={{ margin: '0 0 20px', fontSize: 18, fontWeight: 700, color: '#1e293b' }}>
          Create New Document
        </h2>

        {/* Type selector grid */}
        <div style={{ marginBottom: 20 }}>
          <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#475569', marginBottom: 8 }}>
            Document Type
          </label>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: 8,
            }}
          >
            {DOCUMENT_TEMPLATES.map((tpl) => {
              const isSelected = selectedType === tpl.type;
              return (
                <button
                  key={tpl.type}
                  onClick={() => setSelectedType(tpl.type)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    height: 80,
                    padding: '0 14px',
                    background: isSelected ? '#eff6ff' : '#ffffff',
                    border: `2px solid ${isSelected ? '#3b82f6' : '#e2e8f0'}`,
                    borderRadius: 8,
                    cursor: 'pointer',
                    textAlign: 'left',
                    position: 'relative',
                    transition: 'background 0.15s, border-color 0.15s',
                    fontFamily: 'inherit',
                  }}
                  onMouseEnter={(e) => {
                    if (!isSelected) e.currentTarget.style.background = '#f8fafc';
                  }}
                  onMouseLeave={(e) => {
                    if (!isSelected) e.currentTarget.style.background = '#ffffff';
                  }}
                >
                  <span style={{ fontSize: 24, flexShrink: 0 }}>{tpl.icon}</span>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: '#1e293b' }}>{tpl.name}</div>
                    <div style={{ fontSize: 11, color: '#64748b', lineHeight: 1.3 }}>{tpl.description}</div>
                  </div>
                  {isSelected && (
                    <span
                      style={{
                        position: 'absolute',
                        top: 6,
                        right: 8,
                        fontSize: 14,
                        color: '#3b82f6',
                        fontWeight: 700,
                      }}
                    >
                      &#10003;
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Title input */}
        <div style={{ marginBottom: 16 }}>
          <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#475569', marginBottom: 4 }}>
            Title <span style={{ color: '#ef4444' }}>*</span>
          </label>
          <input
            ref={titleRef}
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Q2 Sprint Planning"
            style={{
              width: '100%',
              padding: '8px 12px',
              fontSize: 14,
              border: '1px solid #e2e8f0',
              borderRadius: 8,
              outline: 'none',
              background: '#ffffff',
              color: '#1e293b',
              boxSizing: 'border-box',
              fontFamily: 'inherit',
            }}
            onFocus={(e) => { e.currentTarget.style.borderColor = '#3b82f6'; }}
            onBlur={(e) => { e.currentTarget.style.borderColor = '#e2e8f0'; }}
          />
        </div>

        {/* Description textarea */}
        <div style={{ marginBottom: 24 }}>
          <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#475569', marginBottom: 4 }}>
            Description <span style={{ color: '#94a3b8', fontWeight: 400 }}>(optional)</span>
          </label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Brief description of this document..."
            rows={3}
            style={{
              width: '100%',
              padding: '8px 12px',
              fontSize: 14,
              border: '1px solid #e2e8f0',
              borderRadius: 8,
              outline: 'none',
              background: '#ffffff',
              color: '#1e293b',
              resize: 'vertical',
              boxSizing: 'border-box',
              fontFamily: 'inherit',
            }}
            onFocus={(e) => { e.currentTarget.style.borderColor = '#3b82f6'; }}
            onBlur={(e) => { e.currentTarget.style.borderColor = '#e2e8f0'; }}
          />
        </div>

        {/* Buttons */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button
            onClick={onClose}
            style={{
              padding: '8px 16px',
              fontSize: 14,
              fontWeight: 500,
              border: '1px solid #e2e8f0',
              borderRadius: 8,
              background: '#ffffff',
              color: '#475569',
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={!title.trim()}
            style={{
              padding: '8px 20px',
              fontSize: 14,
              fontWeight: 600,
              border: 'none',
              borderRadius: 8,
              background: title.trim() ? '#3b82f6' : '#94a3b8',
              color: '#ffffff',
              cursor: title.trim() ? 'pointer' : 'not-allowed',
              fontFamily: 'inherit',
            }}
          >
            Create Document
          </button>
        </div>
      </div>
    </div>
  );
}
