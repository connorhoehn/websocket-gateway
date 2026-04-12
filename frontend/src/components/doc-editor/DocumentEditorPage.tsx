// frontend/src/components/doc-editor/DocumentEditorPage.tsx
//
// Top-level page component for the collaborative document editor.
// Switches between editor, ack (review), and reader modes.
// Accepts WebSocket and identity props from the parent layout.

import { useState, useEffect, useCallback } from 'react';
import type { ViewMode, DocumentMeta, Participant } from '../../types/document';
import type { UseWebSocketReturn } from '../../hooks/useWebSocket';
import type { GatewayMessage } from '../../types/gateway';
import { useCollaborativeDoc } from '../../hooks/useCollaborativeDoc';
import { useVersionHistory } from '../../hooks/useVersionHistory';
import { parseMarkdownToSections } from '../../utils/markdownParser';
import { exportToMarkdown } from '../../utils/documentExport';
import { DEMO_MARKDOWN } from '../../utils/demoDocument';
import DocumentHeader from './DocumentHeader';
import VersionHistoryPanel from './VersionHistoryPanel';
import AckMode from './AckMode';
import ReaderMode from './ReaderMode';
import SectionList from './SectionList';
import ActivityFeed from './ActivityFeed';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface DocumentEditorPageProps {
  documentId: string;
  ws: UseWebSocketReturn;
  userId: string;
  displayName: string;
  color?: string;
  onMessage: (handler: (msg: GatewayMessage) => void) => () => void;
  activityPublish: (eventType: string, detail: Record<string, unknown>) => void;
  activityEvents: import('../../hooks/useActivityBus').ActivityEvent[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getInitialMode(): ViewMode {
  if (typeof window !== 'undefined') {
    const params = new URLSearchParams(window.location.search);
    const m = params.get('mode');
    if (m === 'editor' || m === 'ack' || m === 'reader') return m;
  }
  return 'editor';
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function DocumentEditorPage({
  documentId,
  ws,
  userId,
  displayName,
  color = '#3b82f6',
  onMessage,
  activityPublish,
  activityEvents,
}: DocumentEditorPageProps) {
  const [mode, setMode] = useState<ViewMode>(getInitialMode);
  const [showHistory, setShowHistory] = useState(false);

  const {
    meta,
    sections,
    updateMeta,
    addSection,
    updateSection,
    addItem,
    updateItem,
    removeItem,
    getSectionFragment,
    ydoc,
    provider,
    ackItem,
    rejectItem,
    exportJSON,
    participants,
    comments,
    addComment: addYjsComment,
  } = useCollaborativeDoc({
    documentId,
    mode,
    ws,
    userId,
    displayName,
    color,
    onMessage,
  });

  // ------ Focus tracking + jump-to-user ------------------------------------

  const [focusedSectionId, setFocusedSectionId] = useState<string | null>(null);

  const handleJumpToUser = useCallback((participant: Participant) => {
    // Switch to the same mode the participant is in
    const targetMode: ViewMode =
      participant.mode === 'reviewer' ? 'ack' :
      participant.mode === 'reader' ? 'reader' : 'editor';

    if (mode !== targetMode) {
      setMode(targetMode);
      if (typeof window !== 'undefined') {
        const url = new URL(window.location.href);
        url.searchParams.set('mode', targetMode);
        window.history.replaceState({}, '', url.toString());
      }
    }

    // Scroll to their section after a short delay (allow mode switch to render)
    if (participant.currentSectionId) {
      setTimeout(() => {
        const el = document.getElementById(`section-${participant.currentSectionId}`);
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          el.style.transition = 'box-shadow 0.3s ease';
          el.style.boxShadow = `0 0 0 3px ${participant.color}40`;
          setTimeout(() => { el.style.boxShadow = ''; }, 2000);
        }
      }, 100);
    }
  }, [mode]);

  // ------ Activity helpers --------------------------------------------------

  // Wrapped handlers that log activity
  const handleAckItem = useCallback((sectionId: string, itemId: string) => {
    const section = sections.find(s => s.id === sectionId);
    const item = section?.items.find(i => i.id === itemId);
    ackItem(sectionId, itemId, displayName);
    activityPublish('doc.ack', { itemText: item?.text, sectionId });
  }, [ackItem, displayName, sections, activityPublish]);

  const handleRejectItem = useCallback((sectionId: string, itemId: string) => {
    const section = sections.find(s => s.id === sectionId);
    const item = section?.items.find(i => i.id === itemId);
    rejectItem(sectionId, itemId, displayName);
    activityPublish('doc.reject', { itemText: item?.text, sectionId });
  }, [rejectItem, displayName, sections, activityPublish]);

  const handleAddItem = useCallback((sectionId: string, item: Omit<import('../../types/document').TaskItem, 'id'>) => {
    const id = crypto.randomUUID();
    addItem(sectionId, { ...item, id });
    const section = sections.find(s => s.id === sectionId);
    activityPublish('doc.add_item', { sectionTitle: section?.title });
  }, [addItem, sections, activityPublish]);

  const handleAddSection = useCallback(() => {
    addSection({
      id: crypto.randomUUID(),
      type: 'tasks',
      title: 'New Section',
      collapsed: false,
      items: [],
    });
    activityPublish('doc.add_section', {});
  }, [addSection, activityPublish]);

  // ------ Section focus (awareness) ----------------------------------------

  const handleSectionFocus = useCallback((sectionId: string) => {
    setFocusedSectionId(sectionId);
    if (provider?.awareness) {
      provider.awareness.setLocalStateField('user', {
        userId,
        displayName,
        color,
        mode: mode === 'ack' ? 'ack' : mode,
        currentSectionId: sectionId,
        lastSeen: Date.now(),
      });
    }
  }, [provider, userId, displayName, color, mode]);

  // ------ Section comments (Y.js-persisted) --------------------------------

  const handleAddComment = useCallback((sectionId: string, text: string, parentCommentId?: string | null) => {
    addYjsComment(sectionId, {
      text,
      userId,
      displayName,
      color,
      parentCommentId: parentCommentId ?? null,
    });
    activityPublish('doc.comment', { sectionId, text: text.slice(0, 50) });
  }, [addYjsComment, userId, displayName, color, activityPublish]);

  // ------ Version history --------------------------------------------------

  const versionChannel = `doc:${documentId}`;
  const versionHistory = useVersionHistory({
    channel: versionChannel,
    sendMessage: ws.sendMessage,
    onMessage,
  });

  // Fetch version list when the panel is opened
  useEffect(() => {
    if (showHistory) {
      versionHistory.fetchVersions();
    } else {
      versionHistory.clearPreview();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showHistory]);

  // ------ Demo document loading -------------------------------------------

  const [demoLoaded, setDemoLoaded] = useState(false);

  const handleLoadDemo = () => {
    const parsed = parseMarkdownToSections(DEMO_MARKDOWN);

    // Set document metadata
    updateMeta({
      id: documentId,
      title: parsed.meta.title || 'Untitled',
      sourceType: 'notes',
      sourceId: '',
      createdBy: userId,
      createdAt: new Date().toISOString(),
      aiModel: '',
      status: 'draft',
    });

    // Add each parsed section to the Y.Doc
    for (const section of parsed.sections) {
      addSection({
        id: section.id,
        type: section.type,
        title: section.title,
        collapsed: false,
        items: section.items,
      });
    }

    setDemoLoaded(true);
  };

  // ------ Clear document --------------------------------------------------

  const handleClearDocument = useCallback(() => {
    ws.sendMessage({
      service: 'crdt',
      action: 'clearDocument',
      channel: `doc:${documentId}`,
    });
    setDemoLoaded(false);
  }, [ws, documentId]);

  // ------ Export ----------------------------------------------------------

  const handleExport = (format: 'markdown' | 'pdf' | 'json') => {
    const data = exportJSON();
    if (!data) return;

    // Enrich sections with rich-text content from Y.XmlFragment
    for (const section of data.sections) {
      const frag = getSectionFragment(section.id);
      if (frag) {
        (section as any).contentText = frag.toString();
      }
    }

    if (format === 'json') {
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      downloadBlob(blob, `${data.meta.title || 'document'}.json`);
    } else if (format === 'markdown') {
      const md = exportToMarkdown(data);
      const blob = new Blob([md], { type: 'text/markdown' });
      downloadBlob(blob, `${data.meta.title || 'document'}.md`);
    }
    // PDF export would require a library; skip for now
  };

  // ------ Mode switching -------------------------------------------------

  const handleModeChange = (newMode: ViewMode) => {
    setMode(newMode);
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      url.searchParams.set('mode', newMode);
      window.history.replaceState({}, '', url.toString());
    }
  };

  // ------ Fallback meta for the header -----------------------------------

  const headerMeta: DocumentMeta = meta ?? {
    id: documentId,
    title: '',
    sourceType: 'notes',
    sourceId: '',
    createdBy: '',
    createdAt: '',
    aiModel: '',
    status: 'draft',
  };

  // ------ Render ---------------------------------------------------------

  const isEmpty = sections.length === 0 && !demoLoaded;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <DocumentHeader
        meta={headerMeta}
        mode={mode}
        onModeChange={handleModeChange}
        participants={participants}
        onUpdateMeta={updateMeta}
        onExport={handleExport}
        onToggleHistory={() => setShowHistory((v) => !v)}
        onClearDocument={handleClearDocument}
        onJumpToUser={handleJumpToUser}
        sections={sections.map(s => ({ id: s.id, title: s.title }))}
      />
      <div style={{ flex: 1, overflow: 'auto', padding: '1rem' }}>
        {/* Show demo loader when document is empty */}
        {isEmpty && (
          <div style={{
            textAlign: 'center',
            padding: '3rem 1rem',
            color: '#6b7280',
          }}>
            <p style={{ fontSize: '1.125rem', marginBottom: '1rem' }}>
              No document content yet.
            </p>
            <button
              onClick={handleLoadDemo}
              style={{
                padding: '0.625rem 1.5rem',
                fontSize: '0.9375rem',
                fontWeight: 600,
                border: 'none',
                borderRadius: 8,
                background: '#3b82f6',
                color: '#ffffff',
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              Load Demo Document
            </button>
            <p style={{ fontSize: '0.8125rem', marginTop: '0.75rem', color: '#94a3b8' }}>
              Loads a sample Q2 Sprint Planning document with tasks, decisions, and notes.
            </p>
          </div>
        )}

        {/* Editor mode */}
        {!isEmpty && mode === 'editor' && ydoc && (
          <div style={{ maxWidth: 800, margin: '0 auto' }}>
            <SectionList
              sections={sections}
              getSectionFragment={getSectionFragment}
              ydoc={ydoc}
              provider={provider}
              user={{ name: displayName, color }}
              editable
              onUpdateSection={updateSection}
              onAddItem={handleAddItem}
              onUpdateItem={updateItem}
              onRemoveItem={removeItem}
              onAddSection={handleAddSection}
              participants={participants}
              onSectionFocus={handleSectionFocus}
              focusedSectionId={focusedSectionId}
              comments={comments}
              onAddComment={handleAddComment}
            />
          </div>
        )}

        {/* Review (ack) mode */}
        {!isEmpty && mode === 'ack' && (
          <AckMode
            sections={sections}
            onAckItem={handleAckItem}
            onRejectItem={handleRejectItem}
            participants={participants}
            onSectionFocus={handleSectionFocus}
          />
        )}

        {/* Reader mode */}
        {!isEmpty && mode === 'reader' && (
          <ReaderMode
            sections={sections}
            participants={participants}
            meta={headerMeta}
            commentCounts={Object.fromEntries(
              Object.entries(comments).map(([id, arr]) => [id, arr.length]),
            )}
          />
        )}

        {/* Activity feed — visible in all modes when document has content */}
        {!isEmpty && (
          <div style={{ maxWidth: 800, margin: '1.5rem auto 0' }}>
            <ActivityFeed events={activityEvents} participants={participants} />
          </div>
        )}
      </div>

      {/* Version history sidebar */}
      {showHistory && (
        <VersionHistoryPanel
          versions={versionHistory.versions}
          loading={versionHistory.loading}
          previewTimestamp={versionHistory.previewTimestamp}
          onFetch={versionHistory.fetchVersions}
          onPreview={versionHistory.previewVersion}
          onRestore={versionHistory.restoreVersion}
          onClearPreview={versionHistory.clearPreview}
          onClose={() => setShowHistory(false)}
        />
      )}
    </div>
  );
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
