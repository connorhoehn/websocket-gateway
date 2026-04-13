// frontend/src/components/doc-editor/DocumentEditorPage.tsx
//
// Top-level page component for the collaborative document editor.
// Switches between editor, ack (review), and reader modes.
// Accepts WebSocket and identity props from the parent layout.

import { useState, useEffect, useCallback, useRef } from 'react';
import type { ViewMode, DocumentMeta, Participant } from '../../types/document';
import type { UseWebSocketReturn } from '../../hooks/useWebSocket';
import type { GatewayMessage } from '../../types/gateway';
import { useCollaborativeDoc } from '../../hooks/useCollaborativeDoc';
import { useVersionHistory } from '../../hooks/useVersionHistory';
import { DOCUMENT_TEMPLATES } from '../../data/documentTemplates';
import { useMyMentionsAndTasks } from '../../hooks/useMyMentionsAndTasks';
import { useDocumentActions } from './useDocumentActions';
import DocumentHeader from './DocumentHeader';
import FollowModeBar from './FollowModeBar';
import VersionHistoryPanel from './VersionHistoryPanel';
import MyMentionsPanel from './MyMentionsPanel';
import ReviewMode from './ReviewMode';
import ReaderMode from './ReaderMode';
import SectionList from './SectionList';
import SectionComments from './SectionComments';
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
  documentType?: string;  // template type for auto-populating sections
  ws: UseWebSocketReturn;
  userId: string;
  displayName: string;
  color?: string;
  onMessage: (handler: (msg: GatewayMessage) => void) => () => void;
  activityPublish: (eventType: string, detail: Record<string, unknown>) => void;
  activityEvents: import('../../hooks/useActivityBus').ActivityEvent[];
  onBack?: () => void;
}

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
  documentType,
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
  const [followingUserId, setFollowingUserId] = useState<string | null>(null);
  const [commentSidebarOpen, setCommentSidebarOpen] = useState(false);
  const [commentSectionId, setCommentSectionId] = useState<string | null>(null);

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
    exportJSON,
    participants,
    comments,
    addComment: addYjsComment,
    resolveThread,
    unresolveThread,
    sectionReviews,
    reviewSection,
    awareness,
  } = useCollaborativeDoc({
    documentId,
    mode,
    ws,
    userId,
    displayName,
    color,
    onMessage,
  });

  // ------ Document actions (demo, clear, export) ----------------------------

  const { demoLoaded, handleLoadDemo, handleClearDocument, handleExport } = useDocumentActions({
    documentId,
    userId,
    ws,
    updateMeta,
    addSection,
    exportJSON,
    getSectionFragment,
    comments,
  });

  // ------ Focus tracking + jump-to-user ------------------------------------

  const [focusedSectionId, setFocusedSectionId] = useState<string | null>(null);
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

    // Scroll to section (all modes use continuous scroll now)
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

  // ------ Follow mode -------------------------------------------------------

  const handleFollowUser = useCallback((participant: Participant) => {
    const targetId = participant.userId || participant.clientId;
    setFollowingUserId((prev) => (prev === targetId ? null : targetId));
  }, []);

  // Auto-scroll to the followed user's current section when it changes
  const followedSectionRef = useRef<string | null>(null);
  useEffect(() => {
    if (!followingUserId) {
      followedSectionRef.current = null;
      return;
    }
    const followed = participants.find(
      (p) => (p.userId || p.clientId) === followingUserId,
    );
    // Debug: log the raw awareness states to see what the remote user has
    if (provider?.awareness) {
      const states = provider.awareness.getStates();
      states.forEach((state: Record<string, unknown>, cid: number) => {
        if (cid !== provider!.awareness.clientID) {
          console.log('[follow] Remote awareness state:', cid, JSON.stringify(state));
        }
      });
    }
    console.log('[follow] Looking for user:', followingUserId, 'found:', followed?.displayName, 'section:', followed?.currentSectionId);
    if (!followed || !followed.currentSectionId) {
      // Fallback: if no section is set, scroll to the first section
      if (followed && sections.length > 0) {
        const firstEl = document.getElementById(`section-${sections[0].id}`);
        if (firstEl && !followedSectionRef.current) {
          firstEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
          followedSectionRef.current = '__initial__';
        }
      }
      return;
    }
    if (followed.currentSectionId === followedSectionRef.current) return;

    followedSectionRef.current = followed.currentSectionId;

    // Switch mode to match followed user if needed
    const targetMode: ViewMode =
      followed.mode === 'reviewer' ? 'ack' :
      followed.mode === 'reader' ? 'reader' : 'editor';

    if (mode !== targetMode) {
      setMode(targetMode);
      if (typeof window !== 'undefined') {
        const url = new URL(window.location.href);
        url.searchParams.set('mode', targetMode);
        window.history.replaceState({}, '', url.toString());
      }
    }

    // Scroll to the followed user's section (all modes use continuous scroll)
    setTimeout(() => {
      const el = document.getElementById(`section-${followed.currentSectionId}`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.style.transition = 'box-shadow 0.3s ease';
        el.style.boxShadow = `0 0 0 3px ${followed.color}40`;
        setTimeout(() => { el.style.boxShadow = ''; }, 1500);
      }
    }, 100);
  }, [followingUserId, participants, mode, sections]);

  const handleStopFollow = useCallback(() => {
    setFollowingUserId(null);
  }, []);

  // ------ Activity helpers --------------------------------------------------

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

  // ------ Auto-focus first section on load ----------------------------------
  // Sets currentSectionId in awareness so other users know where we are.
  // Runs whenever sections load and no section is focused yet.
  useEffect(() => {
    if (sections.length === 0 || focusedSectionId) return;
    // Delay to ensure provider is ready (Y.Doc sync may still be in progress)
    const timer = setTimeout(() => {
      const firstId = sections[0].id;
      setFocusedSectionId(firstId);
      awareness.updateSection(firstId);
      console.log('[auto-focus] Set initial section:', firstId);
    }, 500);
    return () => clearTimeout(timer);
  }, [sections, focusedSectionId, awareness]);

  // ------ Section focus (awareness) ----------------------------------------

  const handleSectionFocus = useCallback((sectionId: string) => {
    setFocusedSectionId(sectionId);
    awareness.updateSection(sectionId);
  }, [awareness]);

  // ------ Comment sidebar ---------------------------------------------------

  const handleOpenComments = useCallback((sectionId: string) => {
    setCommentSectionId(sectionId);
    setCommentSidebarOpen(true);
  }, []);

  const handleCloseComments = useCallback(() => {
    setCommentSidebarOpen(false);
  }, []);

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
    activityPublish('doc.unresolve_thread', { sectionId, commentId, reopenedBy: displayName, documentId, documentTitle: meta?.title });
  }, [unresolveThread, activityPublish, displayName, documentId, meta?.title]);

  // ------ My mentions & tasks -----------------------------------------------

  const myItems = useMyMentionsAndTasks({ sections, comments, displayName, userId });

  const handleNavigateToSection = useCallback((sectionId: string) => {
    setTimeout(() => {
      const el = document.getElementById(`section-${sectionId}`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.style.transition = 'box-shadow 0.3s ease';
        el.style.boxShadow = '0 0 0 3px #3b82f640';
        setTimeout(() => { el.style.boxShadow = ''; }, 2000);
      }
    }, 150);
  }, []);

  const handleToggleMyItems = useCallback(() => {
    setShowMyItems(v => !v);
    setShowHistory(false);
  }, []);

  const handleToggleHistory = useCallback(() => {
    setShowHistory(v => !v);
    setShowMyItems(false);
  }, []);

  // Cmd+M / Ctrl+M to toggle My Items panel
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'm') {
        e.preventDefault();
        handleToggleMyItems();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [handleToggleMyItems]);

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

  // ------ Auto-populate from template when new document is empty ----------
  const templateAppliedRef = useRef(false);
  useEffect(() => {
    if (templateAppliedRef.current || !documentType || sections.length > 0) return;
    const tmpl = DOCUMENT_TEMPLATES.find(t => t.type === documentType);
    if (!tmpl) return;
    templateAppliedRef.current = true;
    updateMeta({
      id: documentId, title: meta?.title || tmpl.name,
      sourceType: documentType === 'meeting' ? 'meeting' : 'notes',
      sourceId: '', createdBy: userId, createdAt: new Date().toISOString(),
      aiModel: '', status: 'draft',
    });
    for (const s of tmpl.defaultSections) {
      addSection({ id: crypto.randomUUID(), type: s.type, title: s.title, collapsed: false, items: [] });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentType, sections.length]);

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
        commentCount={Object.values(comments).reduce((sum, threads) => sum + threads.length, 0)}
        onBack={onBack}
        onFollowUser={handleFollowUser}
        followingUserId={followingUserId}
      />
      <FollowModeBar
        followingUserId={followingUserId}
        participants={participants}
        onStopFollow={handleStopFollow}
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

        {/* Editor mode — centered content with inline comment sidebar */}
        {!isEmpty && mode === 'editor' && ydoc && (
          <div style={{ display: 'flex', gap: '1.5rem', alignItems: 'flex-start', maxWidth: 1200, margin: '0 auto' }}>
            {/* Left: section content */}
            <div style={{ flex: 1, minWidth: 0, paddingRight: commentSidebarOpen ? 0 : 48 }}>
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
                onUpdateCursorInfo={awareness.updateCursorInfo}
                onOpenComments={handleOpenComments}
              />
            </div>

            {/* Right: inline comment sidebar */}
            {commentSidebarOpen && commentSectionId && (
              <div style={{
                width: 420,
                flexShrink: 0,
                position: 'sticky',
                top: 16,
                alignSelf: 'flex-start',
                background: '#fafbfc',
                border: '1px solid #e2e8f0',
                borderRadius: 8,
                display: 'flex',
                flexDirection: 'column',
                maxHeight: 'calc(100vh - 180px)',
                overflow: 'hidden',
              }}>
                {/* Sidebar header */}
                <div style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '12px 14px', borderBottom: '1px solid #e2e8f0', flexShrink: 0,
                }}>
                  <div style={{
                    fontSize: 13, fontWeight: 600, color: '#475569',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    flex: 1, marginRight: 8,
                  }}>
                    {sections.find(s => s.id === commentSectionId)?.title ?? 'Comments'}
                  </div>
                  <button
                    type="button"
                    onClick={handleCloseComments}
                    style={{
                      border: 'none', background: 'none', cursor: 'pointer',
                      fontSize: 16, color: '#64748b', padding: '2px 6px',
                      borderRadius: 4, lineHeight: 1, flexShrink: 0,
                    }}
                    title="Close comments"
                  >
                    ✕
                  </button>
                </div>

                {/* Sidebar body */}
                <div style={{ flex: 1, overflowY: 'auto', padding: '14px 12px' }}>
                  <SectionComments
                    comments={comments[commentSectionId] ?? []}
                    onAddComment={(text, parentCommentId) => handleAddComment(commentSectionId, text, parentCommentId)}
                    participants={participants}
                    onResolveThread={(commentId) => handleResolveThread(commentSectionId, commentId)}
                    onUnresolveThread={(commentId) => handleUnresolveThread(commentSectionId, commentId)}
                  />
                </div>
              </div>
            )}
          </div>
        )}

        {/* Review (ack) mode */}
        {!isEmpty && mode === 'ack' && ydoc && (
          <ReviewMode
            sections={sections}
            participants={participants}
            userId={userId}
            getSectionFragment={getSectionFragment}
            ydoc={ydoc}
            provider={provider}
            sectionReviews={sectionReviews}
            reviewSection={reviewSection}
            comments={comments}
            onAddComment={handleAddComment}
            onResolveThread={handleResolveThread}
            onUnresolveThread={handleUnresolveThread}
            onSectionFocus={handleSectionFocus}
          />
        )}

        {/* Reader mode */}
        {!isEmpty && mode === 'reader' && ydoc && (
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
            getSectionFragment={getSectionFragment}
            ydoc={ydoc}
            provider={provider}
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
          onSaveVersion={versionHistory.saveVersion}
          onCompare={versionHistory.compareVersion}
          onClearCompare={versionHistory.clearCompare}
          compareSections={versionHistory.compareSections}
          compareTimestamp={versionHistory.compareTimestamp}
          currentSections={ydoc ? versionHistory.extractSections(ydoc) : []}
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
