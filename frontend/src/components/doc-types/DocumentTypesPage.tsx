// frontend/src/components/doc-types/DocumentTypesPage.tsx
//
// Master-detail page for document type management.
// Left sidebar: list of existing types + New button.
// Right panel: wizard (create or edit mode) or empty/idle state.
// State machine: idle → create → idle  |  idle → edit → idle
// Delete flows through a confirmation modal.

import { useState } from 'react';
import { DocumentTypeWizard } from './DocumentTypeWizard';
import { useDocumentTypes } from '../../hooks/useDocumentTypes';
import type { DocumentType } from '../../types/documentType';
import Modal from '../shared/Modal';
import EmptyState from '../shared/EmptyState';

type Mode = 'idle' | 'create' | 'edit';

// ---------------------------------------------------------------------------
// Shared micro-styles
// ---------------------------------------------------------------------------

const menuBtn: React.CSSProperties = {
  display: 'block', width: '100%', textAlign: 'left',
  padding: '8px 14px', fontSize: 13, border: 'none',
  background: 'transparent', cursor: 'pointer', fontFamily: 'inherit',
};

// ---------------------------------------------------------------------------
// Delete confirmation modal
// ---------------------------------------------------------------------------

function DeleteConfirmModal({
  typeName,
  onConfirm,
  onCancel,
}: {
  typeName: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal
      open
      onClose={onCancel}
      maxWidth={380}
      backdropTestId="delete-modal"
      footer={<>
        <button
          data-testid="cancel-delete"
          onClick={onCancel}
          style={{
            padding: '7px 18px', fontSize: 13, fontWeight: 600,
            background: '#fff', border: '1px solid #d1d5db', borderRadius: 7,
            cursor: 'pointer', fontFamily: 'inherit',
          }}
        >
          Cancel
        </button>
        <button
          data-testid="confirm-delete"
          onClick={onConfirm}
          style={{
            padding: '7px 18px', fontSize: 13, fontWeight: 600,
            background: '#dc2626', color: '#fff', border: 'none', borderRadius: 7,
            cursor: 'pointer', fontFamily: 'inherit',
          }}
        >
          Delete
        </button>
      </>}
    >
      <div style={{ fontSize: 16, fontWeight: 600, color: '#0f172a', marginBottom: 10 }}>
        Delete document type?
      </div>
      <p style={{ fontSize: 13, color: '#64748b', margin: 0 }}>
        <strong>"{typeName}"</strong> will be permanently removed. Documents already
        created from this type are unaffected.
      </p>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Type list item
// ---------------------------------------------------------------------------

function TypeListItem({
  type,
  active,
  onSelect,
  onDeleteRequest,
}: {
  type: DocumentType;
  active: boolean;
  onSelect: () => void;
  onDeleteRequest: () => void;
}) {
  return (
    <div
      data-testid={`type-item-${type.id}`}
      style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '8px 10px', borderRadius: 7, marginBottom: 2,
        background: active ? '#ede9fe' : 'transparent',
        border: active ? '1px solid #c4b5fd' : '1px solid transparent',
        transition: 'background 100ms',
      }}
    >
      <span style={{ fontSize: 18, flexShrink: 0 }}>{type.icon}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 500, color: '#0f172a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {type.name}
        </div>
        <div style={{ fontSize: 11, color: '#94a3b8' }}>
          {type.fields.length} field{type.fields.length !== 1 ? 's' : ''}
        </div>
      </div>
      <button
        data-testid={`edit-type-${type.id}`}
        onClick={onSelect}
        title="Edit type"
        style={{
          background: active ? '#c4b5fd' : 'none',
          border: '1px solid transparent',
          color: active ? '#4c1d95' : '#94a3b8',
          cursor: 'pointer', fontSize: 12, padding: '3px 8px',
          flexShrink: 0, lineHeight: 1, borderRadius: 4,
          fontWeight: 600, fontFamily: 'inherit',
        }}
        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#ede9fe'; (e.currentTarget as HTMLElement).style.color = '#4c1d95'; }}
        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = active ? '#c4b5fd' : 'none'; (e.currentTarget as HTMLElement).style.color = active ? '#4c1d95' : '#94a3b8'; }}
      >
        Edit
      </button>
      <button
        data-testid={`delete-type-${type.id}`}
        onClick={e => { e.stopPropagation(); onDeleteRequest(); }}
        title="Delete type"
        style={{
          background: 'none', border: 'none', color: '#ef4444',
          cursor: 'pointer', fontSize: 16, padding: '2px 5px',
          flexShrink: 0, opacity: 0.55, lineHeight: 1,
          borderRadius: 4,
        }}
        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.opacity = '1'; }}
        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.opacity = '0.55'; }}
      >
        ×
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export function DocumentTypesPage() {
  const { types, createType, updateType, deleteType } = useDocumentTypes();

  const [mode, setMode] = useState<Mode>('idle');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [saveMessage, setSaveMessage] = useState<{ text: string; key: number } | null>(null);

  const editingType = editingId ? types.find(t => t.id === editingId) : undefined;

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------

  const handleCreateClick = () => {
    setEditingId(null);
    setMode('create');
    setSaveMessage(null);
  };

  const handleTypeSelect = (type: DocumentType) => {
    setEditingId(type.id);
    setMode('edit');
    setSaveMessage(null);
  };

  const handleSave = (data: Omit<DocumentType, 'id' | 'createdAt' | 'updatedAt'>) => {
    if (mode === 'edit' && editingId) {
      updateType(editingId, data);
      setSaveMessage({ text: `"${data.name}" updated`, key: Date.now() });
    } else {
      createType(data);
      setSaveMessage({ text: `"${data.name}" created`, key: Date.now() });
    }
    setMode('idle');
    setEditingId(null);
  };

  const handleCancel = () => {
    setMode('idle');
    setEditingId(null);
  };

  const handleDeleteRequest = (id: string) => {
    setConfirmDeleteId(id);
  };

  const handleDeleteConfirm = () => {
    if (!confirmDeleteId) return;
    deleteType(confirmDeleteId);
    if (editingId === confirmDeleteId) {
      setMode('idle');
      setEditingId(null);
    }
    setConfirmDeleteId(null);
  };

  const handleDeleteCancel = () => {
    setConfirmDeleteId(null);
  };

  const confirmDeleteType = confirmDeleteId
    ? types.find(t => t.id === confirmDeleteId)
    : null;

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden', fontFamily: 'inherit' }}>

      {/* ── Left sidebar ── */}
      <div style={{
        width: 264, flexShrink: 0, borderRight: '1px solid #e2e8f0',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
        background: '#fafbfc',
      }}>
        {/* Header */}
        <div style={{
          padding: '14px 16px', borderBottom: '1px solid #e2e8f0',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: '#374151' }}>
            Document Types
          </span>
          <button
            data-testid="create-type-btn"
            onClick={handleCreateClick}
            style={{
              padding: '5px 12px', fontSize: 12, fontWeight: 600,
              background: '#646cff', color: '#fff', border: 'none',
              borderRadius: 6, cursor: 'pointer', fontFamily: 'inherit',
            }}
          >
            + New
          </button>
        </div>

        {/* Type list */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '8px' }} data-testid="type-list">
          {types.length === 0 ? (
            <div style={{ padding: '20px 12px', textAlign: 'center', color: '#94a3b8', fontSize: 12 }}>
              No types yet.{' '}
              <button
                onClick={handleCreateClick}
                style={{ ...menuBtn, display: 'inline', padding: 0, color: '#646cff', fontSize: 12 }}
              >
                Create one →
              </button>
            </div>
          ) : (
            types.map(type => (
              <TypeListItem
                key={type.id}
                type={type}
                active={editingId === type.id}
                onSelect={() => handleTypeSelect(type)}
                onDeleteRequest={() => handleDeleteRequest(type.id)}
              />
            ))
          )}
        </div>

        {/* Save feedback banner */}
        {saveMessage && (
          <div
            key={saveMessage.key}
            data-testid="save-message"
            style={{
              padding: '8px 14px', borderTop: '1px solid #bbf7d0',
              background: '#f0fdf4', fontSize: 12, color: '#16a34a', fontWeight: 500,
            }}
          >
            ✓ {saveMessage.text}
          </div>
        )}
      </div>

      {/* ── Right panel ── */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '28px 36px' }} data-testid="right-panel">
        {mode === 'idle' && (
          <EmptyState
            testId="idle-panel"
            actionTestId="idle-create-btn"
            icon="📋"
            title={types.length > 0 ? 'Select a type to edit' : 'No document types yet'}
            body={types.length > 0
              ? 'Choose a type from the list to edit its fields and view modes.'
              : 'Document types define the structure and fields for your documents.'}
            actionLabel={types.length > 0 ? undefined : '+ Create Document Type'}
            onAction={types.length > 0 ? undefined : handleCreateClick}
          />
        )}

        {(mode === 'create' || mode === 'edit') && (
          <DocumentTypeWizard
            key={editingId ?? 'create'}
            initialType={editingType}
            onSave={handleSave}
            onCancel={handleCancel}
          />
        )}
      </div>

      {/* ── Delete confirmation modal ── */}
      {confirmDeleteId && confirmDeleteType && (
        <DeleteConfirmModal
          typeName={confirmDeleteType.name}
          onConfirm={handleDeleteConfirm}
          onCancel={handleDeleteCancel}
        />
      )}
    </div>
  );
}
