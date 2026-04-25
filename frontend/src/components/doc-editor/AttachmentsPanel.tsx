// frontend/src/components/doc-editor/AttachmentsPanel.tsx
//
// Per-document attachments: file references and linked documents.
// Stored in localStorage keyed by documentId.
// This intentionally stays simple: no real upload — just name + URL references.

import { useState } from 'react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface FileAttachment {
  id: string;
  kind: 'file';
  name: string;
  url: string;
  addedAt: string;
}

interface DocumentLink {
  id: string;
  kind: 'document';
  title: string;
  addedAt: string;
}

type Attachment = FileAttachment | DocumentLink;

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

function storageKey(documentId: string) {
  return `ws_attachments_${documentId}`;
}

function loadAttachments(documentId: string): Attachment[] {
  try {
    const raw = localStorage.getItem(storageKey(documentId));
    return raw ? (JSON.parse(raw) as Attachment[]) : [];
  } catch {
    return [];
  }
}

function useDocumentAttachments(documentId: string) {
  const [attachments, setAttachments] = useState<Attachment[]>(() =>
    loadAttachments(documentId),
  );

  const persist = (next: Attachment[]) => {
    localStorage.setItem(storageKey(documentId), JSON.stringify(next));
    setAttachments(next);
  };

  const addFile = (name: string, url: string) => {
    persist([
      ...attachments,
      { id: crypto.randomUUID(), kind: 'file', name: name.trim(), url: url.trim(), addedAt: new Date().toISOString() },
    ]);
  };

  const addDocumentLink = (title: string) => {
    persist([
      ...attachments,
      { id: crypto.randomUUID(), kind: 'document', title: title.trim(), addedAt: new Date().toISOString() },
    ]);
  };

  const remove = (id: string) => {
    persist(attachments.filter(a => a.id !== id));
  };

  return { attachments, addFile, addDocumentLink, remove };
}

// ---------------------------------------------------------------------------
// Add form
// ---------------------------------------------------------------------------

type AddMode = null | 'file' | 'document';

function AddFileForm({ onAdd, onCancel }: { onAdd: (name: string, url: string) => void; onCancel: () => void }) {
  const [name, setName] = useState('');
  const [url, setUrl]   = useState('');

  const valid = name.trim().length > 0 && url.trim().length > 0;

  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', flexWrap: 'wrap' }}>
      <input
        autoFocus
        placeholder="File name"
        value={name}
        onChange={e => setName(e.target.value)}
        style={fieldStyle}
      />
      <input
        placeholder="URL or path"
        value={url}
        onChange={e => setUrl(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter' && valid) { onAdd(name, url); } }}
        style={{ ...fieldStyle, flex: 2 }}
      />
      <button
        type="button"
        disabled={!valid}
        onClick={() => { if (valid) onAdd(name, url); }}
        style={saveBtnStyle(!valid)}
      >
        Attach
      </button>
      <button type="button" onClick={onCancel} style={cancelBtnStyle}>Cancel</button>
    </div>
  );
}

function AddDocumentForm({ onAdd, onCancel }: { onAdd: (title: string) => void; onCancel: () => void }) {
  const [title, setTitle] = useState('');
  const valid = title.trim().length > 0;

  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
      <input
        autoFocus
        placeholder="Document name"
        value={title}
        onChange={e => setTitle(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter' && valid) onAdd(title); }}
        style={{ ...fieldStyle, flex: 1 }}
      />
      <button
        type="button"
        disabled={!valid}
        onClick={() => { if (valid) onAdd(title); }}
        style={saveBtnStyle(!valid)}
      >
        Link
      </button>
      <button type="button" onClick={onCancel} style={cancelBtnStyle}>Cancel</button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Attachment row
// ---------------------------------------------------------------------------

function AttachmentRow({ attachment, onRemove, editable }: {
  attachment: Attachment;
  onRemove: () => void;
  editable: boolean;
}) {
  const isFile = attachment.kind === 'file';

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10,
      padding: '7px 10px', borderRadius: 6,
      background: '#f8fafc', border: '1px solid #e2e8f0',
    }}>
      <span style={{ fontSize: 14, flexShrink: 0, color: '#64748b' }}>
        {isFile ? '📎' : '📄'}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        {isFile ? (
          <a
            href={(attachment as FileAttachment).url}
            target="_blank"
            rel="noopener noreferrer"
            style={{ fontSize: 13, color: '#2563eb', fontWeight: 500, textDecoration: 'none' }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.textDecoration = 'underline'; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.textDecoration = 'none'; }}
          >
            {(attachment as FileAttachment).name}
          </a>
        ) : (
          <span style={{ fontSize: 13, color: '#0f172a', fontWeight: 500 }}>
            {(attachment as DocumentLink).title}
          </span>
        )}
        <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 1 }}>
          {isFile ? (attachment as FileAttachment).url : 'Linked document'}
        </div>
      </div>
      {editable && (
        <button
          type="button"
          onClick={onRemove}
          title="Remove"
          style={{
            background: 'none', border: 'none', cursor: 'pointer',
            color: '#ef4444', fontSize: 14, padding: '2px 5px',
            opacity: 0.5, lineHeight: 1, borderRadius: 4, flexShrink: 0,
          }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.opacity = '1'; }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.opacity = '0.5'; }}
        >
          ×
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared micro-styles
// ---------------------------------------------------------------------------

const fieldStyle: React.CSSProperties = {
  flex: 1, minWidth: 120,
  border: '1px solid #d1d5db', borderRadius: 6, padding: '6px 10px',
  fontSize: 13, fontFamily: 'inherit', background: '#f9fafb', color: '#0f172a',
  outline: 'none',
};

const saveBtnStyle = (disabled: boolean): React.CSSProperties => ({
  padding: '6px 14px', fontSize: 13, fontWeight: 600,
  background: '#646cff', color: '#fff', border: 'none',
  borderRadius: 6, cursor: disabled ? 'not-allowed' : 'pointer',
  fontFamily: 'inherit', opacity: disabled ? 0.5 : 1, flexShrink: 0,
});

const cancelBtnStyle: React.CSSProperties = {
  padding: '6px 12px', fontSize: 13,
  background: 'none', border: 'none', color: '#64748b',
  cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0,
};

// ---------------------------------------------------------------------------
// Panel
// ---------------------------------------------------------------------------

export interface AttachmentsPanelProps {
  documentId: string;
  editable: boolean;
}

export default function AttachmentsPanel({ documentId, editable }: AttachmentsPanelProps) {
  const { attachments, addFile, addDocumentLink, remove } = useDocumentAttachments(documentId);
  const [addMode, setAddMode] = useState<AddMode>(null);

  const hasItems = attachments.length > 0;

  return (
    <div style={{
      marginTop: 16,
      border: '1px solid #e2e8f0',
      borderRadius: 10,
      overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '10px 14px',
        background: '#f8fafc',
        borderBottom: hasItems || addMode ? '1px solid #e2e8f0' : 'none',
      }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: '#374151' }}>
          Attachments
          {hasItems && (
            <span style={{ marginLeft: 6, fontSize: 11, color: '#94a3b8', fontWeight: 400 }}>
              {attachments.length}
            </span>
          )}
        </span>
        {editable && addMode === null && (
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              type="button"
              onClick={() => setAddMode('file')}
              style={{
                fontSize: 12, padding: '4px 10px', fontWeight: 600,
                background: '#fff', border: '1px solid #d1d5db',
                borderRadius: 5, cursor: 'pointer', fontFamily: 'inherit', color: '#374151',
              }}
            >
              + File
            </button>
            <button
              type="button"
              onClick={() => setAddMode('document')}
              style={{
                fontSize: 12, padding: '4px 10px', fontWeight: 600,
                background: '#fff', border: '1px solid #d1d5db',
                borderRadius: 5, cursor: 'pointer', fontFamily: 'inherit', color: '#374151',
              }}
            >
              + Document
            </button>
          </div>
        )}
      </div>

      {/* Attachment list */}
      {hasItems && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '10px 14px' }}>
          {attachments.map(a => (
            <AttachmentRow
              key={a.id}
              attachment={a}
              onRemove={() => remove(a.id)}
              editable={editable}
            />
          ))}
        </div>
      )}

      {/* Add forms */}
      {addMode === 'file' && (
        <div style={{ padding: '10px 14px', borderTop: hasItems ? '1px solid #e2e8f0' : 'none' }}>
          <AddFileForm
            onAdd={(name, url) => { addFile(name, url); setAddMode(null); }}
            onCancel={() => setAddMode(null)}
          />
        </div>
      )}
      {addMode === 'document' && (
        <div style={{ padding: '10px 14px', borderTop: hasItems ? '1px solid #e2e8f0' : 'none' }}>
          <AddDocumentForm
            onAdd={(title) => { addDocumentLink(title); setAddMode(null); }}
            onCancel={() => setAddMode(null)}
          />
        </div>
      )}

      {/* Empty state */}
      {!hasItems && !addMode && (
        <div style={{
          padding: '14px 14px', fontSize: 12, color: '#94a3b8',
          textAlign: 'center',
        }}>
          {editable ? 'No attachments yet — add a file or link a document above.' : 'No attachments.'}
        </div>
      )}
    </div>
  );
}
