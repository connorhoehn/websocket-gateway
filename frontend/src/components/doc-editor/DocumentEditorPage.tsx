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
import { useMyMentionsAndTasks } from '../../hooks/useMyMentionsAndTasks';
import DocumentHeader from './DocumentHeader';
import VersionHistoryPanel from './VersionHistoryPanel';
import MyMentionsPanel from './MyMentionsPanel';
import AckMode from './AckMode';
import ReaderMode from './ReaderMode';
import SectionList from './SectionList';
import ActivityFeed from './ActivityFeed';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extract plain text from a Y.XmlFragment.
 * XmlFragment.toString() returns XML-like markup (e.g. `<paragraph>text</paragraph>`).
 * This strips the tags while preserving line breaks between block-level elements.
 */
function xmlFragmentToText(frag: { toString(): string }): string {
  const xml = frag.toString();
  return xml
    .replace(/<\/?(paragraph|heading|blockquote|codeBlock|bulletList|orderedList|listItem|taskList|taskItem|horizontalRule|hardBreak|doc)[^>]*>/g, '\n')
    .replace(/<[^>]+>/g, '')       // strip remaining inline tags (bold, italic, etc.)
    .replace(/\n{3,}/g, '\n\n')    // collapse excessive newlines
    .trim();
}

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
  onBack?: () => void;
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
  onBack,
}: DocumentEditorPageProps) {
  const [mode, setMode] = useState<ViewMode>(getInitialMode);
  const [showHistory, setShowHistory] = useState(false);
  const [showMyItems, setShowMyItems] = useState(false);

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
    resolveThread,
    unresolveThread,
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
  // For Review mode: jump to a specific section page
  const [jumpToSectionIndex, setJumpToSectionIndex] = useState<number | null>(null);

  const handleJumpToUser = useCallback((participant: Participant) => {
    const isActive = participant.lastSeen && (Date.now() - participant.lastSeen) < 30000; // active within 30s

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

    if (!participant.currentSectionId) return;

    // For Review mode: find section index and navigate to that page
    if (targetMode === 'ack') {
      const idx = sections.findIndex(s => s.id === participant.currentSectionId);
      if (idx >= 0) {
        setJumpToSectionIndex(idx);
      }
      return;
    }

    // For Editor/Read mode: scroll to section (only if user is active)
    setTimeout(() => {
      const el = document.getElementById(`section-${participant.currentSectionId}`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        if (isActive) {
          // Radial flash effect to draw attention
          el.style.transition = 'box-shadow 0.3s ease';
          el.style.boxShadow = `0 0 0 3px ${participant.color}40`;
          setTimeout(() => { el.style.boxShadow = ''; }, 2000);
        }
      }
    }, 150);
  }, [mode, sections]);

  // ------ Activity helpers --------------------------------------------------

  // Wrapped handlers that log activity
  const handleAckItem = useCallback((sectionId: string, itemId: string) => {
    const section = sections.find(s => s.id === sectionId);
    const item = section?.items.find(i => i.id === itemId);
    ackItem(sectionId, itemId, displayName);
    activityPublish('doc.ack', { itemText: item?.text, sectionId, documentId, documentTitle: meta?.title });
  }, [ackItem, displayName, sections, activityPublish, documentId, meta?.title]);

  const handleRejectItem = useCallback((sectionId: string, itemId: string) => {
    const section = sections.find(s => s.id === sectionId);
    const item = section?.items.find(i => i.id === itemId);
    rejectItem(sectionId, itemId, displayName);
    activityPublish('doc.reject', { itemText: item?.text, sectionId, documentId, documentTitle: meta?.title });
  }, [rejectItem, displayName, sections, activityPublish, documentId, meta?.title]);

  const handleAddItem = useCallback((sectionId: string, item: Omit<import('../../types/document').TaskItem, 'id'>) => {
    const id = crypto.randomUUID();
    addItem(sectionId, { ...item, id });
    const section = sections.find(s => s.id === sectionId);
    activityPublish('doc.add_item', { sectionTitle: section?.title, documentId, documentTitle: meta?.title });
  }, [addItem, sections, activityPublish, documentId, meta?.title]);

  const handleAddSection = useCallback(() => {
    addSection({
      id: crypto.randomUUID(),
      type: 'tasks',
      title: 'New Section',
      collapsed: false,
      items: [],
    });
    activityPublish('doc.add_section', { documentId, documentTitle: meta?.title });
  }, [addSection, activityPublish, documentId, meta?.title]);

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
    activityPublish('doc.comment', { sectionId, text: text.slice(0, 50), documentId, documentTitle: meta?.title });

    // Extract @mentions and publish targeted mention events
    const mentionMatches = text.match(/@[A-Z][a-zA-Z]*(?:\s[A-Z][a-zA-Z]*)*/g);
    if (mentionMatches && mentionMatches.length > 0) {
      const mentionedNames = mentionMatches.map(m => m.slice(1).trim());
      const section = sections.find(s => s.id === sectionId);
      activityPublish('doc.mention', {
        sectionId,
        sectionTitle: section?.title ?? '',
        mentionedNames,
        commentText: text.slice(0, 80),
        authorName: displayName,
        documentId,
        documentTitle: meta?.title,
      });
    }
  }, [addYjsComment, userId, displayName, color, activityPublish, sections, documentId, meta?.title]);

  const handleResolveThread = useCallback((sectionId: string, commentId: string) => {
    resolveThread(sectionId, commentId, displayName);
    activityPublish('doc.resolve_thread', { sectionId, commentId, documentId, documentTitle: meta?.title });
  }, [resolveThread, displayName, activityPublish, documentId, meta?.title]);

  const handleUnresolveThread = useCallback((sectionId: string, commentId: string) => {
    unresolveThread(sectionId, commentId);
    activityPublish('doc.unresolve_thread', { sectionId, commentId, documentId, documentTitle: meta?.title });
  }, [unresolveThread, activityPublish, documentId, meta?.title]);

  // ------ My mentions & tasks -----------------------------------------------

  const myItems = useMyMentionsAndTasks({ sections, comments, displayName, userId });

  const handleNavigateToSection = useCallback((sectionId: string) => {
    if (mode === 'ack') {
      const idx = sections.findIndex(s => s.id === sectionId);
      if (idx >= 0) setJumpToSectionIndex(idx);
      return;
    }
    setTimeout(() => {
      const el = document.getElementById(`section-${sectionId}`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.style.transition = 'box-shadow 0.3s ease';
        el.style.boxShadow = '0 0 0 3px #3b82f640';
        setTimeout(() => { el.style.boxShadow = ''; }, 2000);
      }
    }, 150);
  }, [mode, sections]);

  const handleToggleMyItems = useCallback(() => {
    setShowMyItems(v => !v);
    setShowHistory(false);
  }, []);

  const handleToggleHistory = useCallback(() => {
    setShowHistory(v => !v);
    setShowMyItems(false);
  }, []);

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

    // Enrich sections with rich-text content and comments
    for (const section of data.sections) {
      const frag = getSectionFragment(section.id);
      if (frag) {
        (section as any).contentText = xmlFragmentToText(frag);
      }
      const sectionComments = comments[section.id];
      if (sectionComments && sectionComments.length > 0) {
        (section as any).comments = sectionComments;
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
        onToggleHistory={handleToggleHistory}
        onClearDocument={handleClearDocument}
        onJumpToUser={handleJumpToUser}
        sections={sections.map(s => ({ id: s.id, title: s.title }))}
        onToggleMyItems={handleToggleMyItems}
        myItemCount={myItems.length}
        onBack={onBack}
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
              onResolveThread={handleResolveThread}
              onUnresolveThread={handleUnresolveThread}
            />
          </div>
        )}

        {/* Review (ack) mode */}
        {!isEmpty && mode === 'ack' && ydoc && (
          <AckMode
            sections={sections}
            onAckItem={handleAckItem}
            onRejectItem={handleRejectItem}
            participants={participants}
            onSectionFocus={handleSectionFocus}
            jumpToIndex={jumpToSectionIndex}
            onJumpComplete={() => setJumpToSectionIndex(null)}
            getSectionFragment={getSectionFragment}
            ydoc={ydoc}
            provider={provider}
            comments={comments}
            onAddComment={handleAddComment}
            onResolveThread={handleResolveThread}
            onUnresolveThread={handleUnresolveThread}
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
            sectionContentTexts={Object.fromEntries(
              sections.map(s => {
                const frag = getSectionFragment(s.id);
                return [s.id, frag ? xmlFragmentToText(frag) : ''];
              }),
            )}
            comments={comments}
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

      {/* My mentions & tasks sidebar */}
      {showMyItems && (
        <MyMentionsPanel
          items={myItems}
          onNavigateToSection={handleNavigateToSection}
          onClose={() => setShowMyItems(false)}
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
