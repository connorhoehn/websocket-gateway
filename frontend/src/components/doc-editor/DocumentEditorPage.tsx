// frontend/src/components/doc-editor/DocumentEditorPage.tsx
//
// Top-level page component for the collaborative document editor.
// Switches between editor, ack (review), and reader modes.
// Accepts WebSocket and identity props from the parent layout.

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import type { ViewMode, DocumentMeta, Participant } from '../../types/document';
import type { UseWebSocketReturn } from '../../hooks/useWebSocket';
import type { GatewayMessage } from '../../types/gateway';
import { useCollaborativeDoc } from '../../hooks/useCollaborativeDoc';
import { useDocumentComments } from '../../hooks/useDocumentComments';
import { useDocumentReviews } from '../../hooks/useDocumentReviews';
import { useDocumentItems } from '../../hooks/useDocumentItems';
import { useIdentityContext } from '../../contexts/IdentityContext';
import { useVersionHistory } from '../../hooks/useVersionHistory';
import { DOCUMENT_TEMPLATES } from '../../data/documentTemplates';
import { useMyMentionsAndTasks } from '../../hooks/useMyMentionsAndTasks';
import { useVideoSessions } from '../../hooks/useVideoSessions';
import { useDocumentActions } from './useDocumentActions';
import DocumentHeader from './DocumentHeader';
import FollowModeBar from './FollowModeBar';
import VersionHistoryPanel from './VersionHistoryPanel';
import WorkflowPanel from './WorkflowPanel';
import VideoCallPanel from './VideoCallPanel';
import VideoHistoryPanel from './VideoHistoryPanel';
import MyMentionsPanel from './MyMentionsPanel';
import ReviewMode from './ReviewMode';
import ReaderMode from './ReaderMode';
import SectionList from './SectionList';
import SectionComments from './SectionComments';
import TableOfContents from './TableOfContents';

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
  /** Whether the video call is docked to the left sidebar (managed by AppLayout) */
  isVideoDocked?: boolean;
  /** Dock the video panel to the left sidebar */
  onDockVideo?: () => void;
  /** Undock the video panel from the left sidebar */
  onUndockVideo?: () => void;
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
  isVideoDocked,
  onDockVideo,
  onUndockVideo,
}: DocumentEditorPageProps) {
  const [mode, setMode] = useState<ViewMode>(getInitialMode);
  const [showHistory, setShowHistory] = useState(false);
  const [showMyItems, setShowMyItems] = useState(false);
  const [showWorkflows, setShowWorkflows] = useState(false);
  const [showVideoCall, setShowVideoCall] = useState(isVideoDocked ?? false);
  const [showVideoHistory, setShowVideoHistory] = useState(false);

  // Track window width for responsive TOC/video hiding
  const [windowWidth, setWindowWidth] = useState(typeof window !== 'undefined' ? window.innerWidth : 1400);
  useEffect(() => {
    const onResize = () => setWindowWidth(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  const showTOC = windowWidth >= 1200;
  const showInlineVideo = windowWidth >= 900;

  // Sticky scroll for video and TOC — starts in flow, switches to fixed on scroll
  const [sidebarFixed, setSidebarFixed] = useState(false);
  const videoSpacerRef = useRef<HTMLDivElement>(null);
  const tocSpacerRef = useRef<HTMLDivElement>(null);
  const [videoLeft, setVideoLeft] = useState(0);
  const [tocLeft, setTocLeft] = useState(0);
  // Remember the initial top offset of the spacer divs (measured once on first scroll)
  const spacerInitialTopRef = useRef<number | null>(null);
  // Fixed top = AppLayout header (53px) + sticky doc header (~93px)
  const FIXED_TOP = 146;

  const updatePositions = useCallback(() => {
    // Measure the initial offset once from whichever spacer is present
    if (spacerInitialTopRef.current === null) {
      const spacer = videoSpacerRef.current ?? tocSpacerRef.current;
      if (spacer) {
        spacerInitialTopRef.current = spacer.getBoundingClientRect().top + window.scrollY;
      }
    }
    const threshold = spacerInitialTopRef.current ?? 250;
    const shouldFix = window.scrollY > threshold - FIXED_TOP;
    setSidebarFixed(shouldFix);
    // Capture left positions from the spacer divs
    if (videoSpacerRef.current) setVideoLeft(videoSpacerRef.current.getBoundingClientRect().left);
    if (tocSpacerRef.current) setTocLeft(tocSpacerRef.current.getBoundingClientRect().left);
  }, []);

  useEffect(() => {
    const onResize = () => {
      spacerInitialTopRef.current = null;
      updatePositions();
    };
    window.addEventListener('scroll', updatePositions, { passive: true });
    window.addEventListener('resize', onResize, { passive: true });
    return () => {
      window.removeEventListener('scroll', updatePositions);
      window.removeEventListener('resize', onResize);
    };
  }, [updatePositions]);

  // Re-evaluate fixed positioning when video panel toggles
  useEffect(() => {
    // Small delay to let the spacer div mount
    const t = setTimeout(() => {
      spacerInitialTopRef.current = null;
      updatePositions();
    }, 50);
    return () => clearTimeout(t);
  }, [showVideoCall, updatePositions]);
  const [followingUserId, setFollowingUserId] = useState<string | null>(null);
  const [commentSidebarOpen, setCommentSidebarOpen] = useState(false);
  const [commentSectionId, setCommentSectionId] = useState<string | null>(null);

  const { idToken } = useIdentityContext();
  const videoSessions = useVideoSessions(documentId, idToken);

  const {
    meta,
    sections,
    synced,
    updateMeta,
    addSection,
    updateSection,
    getSectionFragment,
    ydoc,
    provider,
    exportJSON,
    participants,
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

  // ---- REST-backed hooks (decoupled from Y.js) ----------------------------
  const {
    comments,
    addComment: restAddComment,
    resolveThread: restResolveThread,
    unresolveThread: restUnresolveThread,
  } = useDocumentComments({
    documentId,
    idToken,
    sendMessage: ws.sendMessage,
    onMessage,
    connectionState: ws.connectionState,
  });

  const {
    sectionReviews,
    reviewSection: restReviewSection,
  } = useDocumentReviews({
    documentId,
    idToken,
    sendMessage: ws.sendMessage,
    onMessage,
    connectionState: ws.connectionState,
  });

  const sectionIds = useMemo(() => sections.map(s => s.id), [sections]);

  const {
    items: restItems,
    addItem: restAddItem,
    updateItem: restUpdateItem,
    removeItem: restRemoveItem,
  } = useDocumentItems({
    documentId,
    sectionIds,
    idToken,
    sendMessage: ws.sendMessage,
    onMessage,
    connectionState: ws.connectionState,
  });

  // ------ Centralized document-events subscription --------------------------
  // All REST hooks (comments, reviews, items, workflows) listen for events on
  // these channels but none of them manage the subscription. This single effect
  // subscribes once and unsubscribes on unmount, avoiding race conditions.
  useEffect(() => {
    if (ws.connectionState !== 'connected' || !documentId) return;
    ws.sendMessage({
      service: 'document-events',
      action: 'subscribe',
      documentId,
    });
    return () => {
      ws.sendMessage({
        service: 'document-events',
        action: 'unsubscribe',
        documentId,
      });
    };
  }, [documentId, ws.connectionState, ws.sendMessage]);

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
          // Remote awareness state logged for debugging — disabled in production
        }
      });
    }
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
    restAddItem(sectionId, item);
    const section = sections.find(s => s.id === sectionId);
    activityPublish('doc.add_item', { sectionTitle: section?.title, documentId, documentTitle: meta?.title });
  }, [restAddItem, sections, activityPublish, documentId, meta?.title]);

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
    }, 500);
    return () => clearTimeout(timer);
  }, [sections, focusedSectionId, awareness]);

  // ------ Section focus (awareness) ----------------------------------------

  const handleSectionFocus = useCallback((sectionId: string) => {
    setFocusedSectionId(sectionId);
    awareness.updateSection(sectionId);
  }, [awareness]);

  // ------ Comment sidebar ---------------------------------------------------

  const sectionListRef = useRef<HTMLDivElement>(null);
  const [commentSidebarTop, setCommentSidebarTop] = useState(0);

  const handleOpenComments = useCallback((sectionId: string) => {
    setCommentSectionId(sectionId);
    setCommentSidebarOpen(true);
    // Calculate the section's offset relative to the section list container
    requestAnimationFrame(() => {
      const sectionEl = document.getElementById(`section-${sectionId}`);
      const containerEl = sectionListRef.current;
      if (sectionEl && containerEl) {
        const sectionRect = sectionEl.getBoundingClientRect();
        const containerRect = containerEl.getBoundingClientRect();
        setCommentSidebarTop(sectionRect.top - containerRect.top);
      }
    });
  }, []);

  const handleCloseComments = useCallback(() => {
    setCommentSidebarOpen(false);
  }, []);

  // ------ Section comments (Y.js-persisted) --------------------------------

  const handleAddComment = useCallback((sectionId: string, text: string, parentCommentId?: string | null) => {
    restAddComment(sectionId, text, parentCommentId);
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
  }, [restAddComment, activityPublish, sections, displayName, documentId, meta?.title]);

  const handleResolveThread = useCallback((sectionId: string, commentId: string) => {
    restResolveThread(sectionId, commentId);
    activityPublish('doc.resolve_thread', { sectionId, commentId, documentId, documentTitle: meta?.title });
  }, [restResolveThread, activityPublish, documentId, meta?.title]);

  const handleUnresolveThread = useCallback((sectionId: string, commentId: string) => {
    restUnresolveThread(sectionId, commentId);
    activityPublish('doc.unresolve_thread', { sectionId, commentId, reopenedBy: displayName, documentId, documentTitle: meta?.title });
  }, [restUnresolveThread, activityPublish, displayName, documentId, meta?.title]);

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
    setShowWorkflows(false);
  }, []);

  const handleToggleHistory = useCallback(() => {
    setShowHistory(v => !v);
    setShowMyItems(false);
    setShowWorkflows(false);
  }, []);

  const handleToggleWorkflows = useCallback(() => {
    setShowWorkflows(v => !v);
    setShowHistory(false);
    setShowMyItems(false);
    setShowVideoCall(false);
  }, []);

  const handleToggleVideoCall = useCallback(() => {
    setShowVideoCall(v => !v);
    setShowHistory(false);
    setShowMyItems(false);
    setShowWorkflows(false);
    setShowVideoHistory(false);
  }, []);

  const handleToggleVideoHistory = useCallback(() => {
    setShowVideoHistory(v => !v);
    setShowHistory(false);
    setShowMyItems(false);
    setShowWorkflows(false);
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
  // Guard: wait for Y.js sync, then check the Y.js meta flag (not React state)
  // to prevent duplicate application on HMR/remount. The flag persists with the doc.
  useEffect(() => {
    if (!synced || !documentType || !ydoc) return;

    // Check Y.js directly — React state may lag behind
    const yMeta = ydoc.getMap('meta');
    if (yMeta.get('templateApplied')) return;

    const ySections = ydoc.getArray('sections');
    if (ySections.length > 0) return;

    const tmpl = DOCUMENT_TEMPLATES.find(t => t.type === documentType);
    if (!tmpl) return;

    // Apply template in a single transaction
    ydoc.transact(() => {
      yMeta.set('templateApplied', true);
    });

    updateMeta({
      id: documentId, title: meta?.title || tmpl.name,
      sourceType: documentType === 'meeting' ? 'meeting' : 'notes',
      sourceId: '', createdBy: userId, createdByName: displayName,
      createdAt: new Date().toISOString(),
      aiModel: '', status: 'draft',
    });
    for (const s of tmpl.defaultSections) {
      addSection({ id: crypto.randomUUID(), type: s.type, title: s.title, collapsed: false, items: [] });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [synced, documentType, ydoc]);

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

  // ------ Finalize / unlock -----------------------------------------------

  const isFinalized = headerMeta.status === 'final';

  const handleFinalize = useCallback(() => {
    if (window.confirm('Finalize this document? It will become read-only.')) {
      updateMeta({ status: 'final' });
      activityPublish('doc.finalize', { documentId, documentTitle: meta?.title });
    }
  }, [updateMeta, activityPublish, documentId, meta?.title]);

  const handleUnlock = useCallback(() => {
    updateMeta({ status: 'draft' });
    activityPublish('doc.unlock', { documentId, documentTitle: meta?.title });
  }, [updateMeta, activityPublish, documentId, meta?.title]);

  // ------ Auto-dock video on navigate away --------------------------------
  const handleBack = useCallback(() => {
    if (showVideoCall && !isVideoDocked) {
      // Auto-dock the video to sidebar so the call persists
      onDockVideo?.();
    }
    onBack?.();
  }, [showVideoCall, isVideoDocked, onDockVideo, onBack]);

  // ------ Render ---------------------------------------------------------

  const isEmpty = sections.length === 0 && !demoLoaded;

  // Portal: docked video to sidebar container — rendered at top level so it
  // persists regardless of editor mode, empty state, or ydoc readiness.
  const dockedVideoPortal = showVideoCall && isVideoDocked ? (() => {
    const container = document.getElementById('sidebar-video-slot');
    if (!container) return null;
    return createPortal(
      <VideoCallPanel
        documentId={documentId}
        userId={userId}
        idToken={idToken}
        meta={meta}
        updateMeta={updateMeta}
        sendMessage={ws.sendMessage}
        onClose={() => { setShowVideoCall(false); onUndockVideo?.(); }}
        isDocked
        onUndock={() => { onUndockVideo?.(); }}
        onCallEnd={() => { setShowVideoCall(false); onUndockVideo?.(); }}
      />,
      container,
    );
  })() : null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {dockedVideoPortal}
      <DocumentHeader
        meta={headerMeta}
        mode={mode}
        onModeChange={handleModeChange}
        participants={participants}
        onUpdateMeta={updateMeta}
        onExport={handleExport}
        onToggleHistory={handleToggleHistory}
        onToggleWorkflows={handleToggleWorkflows}
        onToggleVideoCall={handleToggleVideoCall}
        onToggleVideoHistory={handleToggleVideoHistory}
        isCallActive={!!meta?.activeCallSessionId}
        onClearDocument={handleClearDocument}
        onJumpToUser={handleJumpToUser}
        sections={sections.map(s => ({ id: s.id, title: s.title }))}
        onToggleMyItems={handleToggleMyItems}
        myItemCount={myItems.length}
        commentCount={Object.values(comments).reduce((sum, threads) => sum + threads.length, 0)}
        onBack={handleBack}
        onFollowUser={handleFollowUser}
        followingUserId={followingUserId}
        onFinalize={handleFinalize}
        onUnlock={handleUnlock}
      />
      <FollowModeBar
        followingUserId={followingUserId}
        participants={participants}
        onStopFollow={handleStopFollow}
      />

      <div style={{ flex: 1, overflow: 'auto', padding: '1rem' }}>
        {/* Read-only banner for finalized documents */}
        {isFinalized && mode === 'editor' && (
          <div style={{
            background: '#fefce8',
            border: '1px solid #fde68a',
            borderRadius: 8,
            padding: '10px 16px',
            marginBottom: 12,
            fontSize: 13,
            fontWeight: 500,
            color: '#92400e',
            textAlign: 'center',
          }}>
            This document has been finalized and is read-only
          </div>
        )}

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
          <div ref={sectionListRef} style={{ display: 'flex', gap: '1rem', position: 'relative', minWidth: 0 }}>

            {/* Left: video sidebar — spacer div reserves width in flex, inner content goes fixed on scroll */}
            {showVideoCall && !isVideoDocked && showInlineVideo && (
              <div ref={videoSpacerRef} style={{ width: 240, flexShrink: 0 }}>
                <div style={sidebarFixed ? { position: 'fixed', top: FIXED_TOP, left: videoLeft, width: 240, zIndex: 30 } : {}}>
                  <VideoCallPanel
                    documentId={documentId}
                    userId={userId}
                    idToken={idToken}
                    meta={meta}
                    updateMeta={updateMeta}
                    sendMessage={ws.sendMessage}
                    onClose={() => setShowVideoCall(false)}
                    onDockToSidebar={() => { onDockVideo?.(); }}
                  />
                </div>
              </div>
            )}
            {/* (docked video portal is rendered outside this conditional — see below) */}

            {/* Center: section content */}
            <div style={{ flex: 1, minWidth: 0, paddingRight: commentSidebarOpen ? 0 : 48 }}>
              <SectionList
                sections={sections.map(s => ({ ...s, items: restItems[s.id] ?? s.items ?? [] }))}
                getSectionFragment={getSectionFragment}
                ydoc={ydoc}
                provider={provider}
                user={{ name: displayName, color }}
                editable={!isFinalized}
                onUpdateSection={updateSection}
                onAddItem={handleAddItem}
                onUpdateItem={restUpdateItem}
                onRemoveItem={restRemoveItem}
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

            {/* TOC rendered as fixed bottom-right overlay — see below */}

            {/* Right: inline comment sidebar */}
            {commentSidebarOpen && commentSectionId && (
              <div style={{
                width: 420,
                flexShrink: 0,
                                marginTop: commentSidebarTop,
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
            reviewSection={(sectionId, status, comment) => {
              restReviewSection(sectionId, status, comment);
              const section = sections.find(s => s.id === sectionId);
              activityPublish(`doc.review_${status}`, {
                sectionTitle: section?.title,
                status,
                documentId,
                documentTitle: meta?.title,
              });
            }}
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

        {/* Activity feed removed — shown in the global left sidebar instead */}
      </div>

      {/* Version history sidebar */}
      {showHistory && (
        <VersionHistoryPanel
          versions={versionHistory.versions}
          loading={versionHistory.loading}
          previewTimestamp={versionHistory.previewTimestamp}
          onFetch={versionHistory.fetchVersions}
          onPreview={versionHistory.previewVersion}
          onClearPreview={versionHistory.clearPreview}
          onClose={() => setShowHistory(false)}
          onSaveVersion={versionHistory.saveVersion}
          onCompare={versionHistory.compareVersion}
          onClearCompare={versionHistory.clearCompare}
          compareSections={versionHistory.compareSections}
          compareTimestamp={versionHistory.compareTimestamp}
          currentSections={ydoc ? versionHistory.extractSections(ydoc) : []}
          onRestore={versionHistory.restoreVersion}
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

      {/* Workflow sidebar */}
      {showWorkflows && (
        <WorkflowPanel
          documentId={documentId}
          userId={userId}
          idToken={idToken}
          sendMessage={ws.sendMessage}
          onMessage={onMessage}
          connectionState={ws.connectionState}
          onClose={() => setShowWorkflows(false)}
        />
      )}

      {/* Past video conversations panel */}
      {showVideoHistory && (
        <VideoHistoryPanel
          sessions={videoSessions.sessions}
          loading={videoSessions.loading}
          onFetch={videoSessions.fetchSessions}
          onClose={() => setShowVideoHistory(false)}
        />
      )}

      {/* Table of contents — fixed bottom-right */}
      {showTOC && !commentSidebarOpen && sections.length > 1 && mode === 'editor' && (
        <div style={{
          position: 'fixed',
          bottom: 16,
          right: 16,
          width: 160,
          maxHeight: 280,
          overflowY: 'auto',
          background: '#fff',
          border: '1px solid #e2e8f0',
          borderRadius: 10,
          padding: '10px 12px',
          boxShadow: '0 4px 16px rgba(0,0,0,0.08)',
          zIndex: 30,
        }}>
          <TableOfContents sections={sections.map(s => ({ id: s.id, title: s.title }))} focusedSectionId={focusedSectionId} />
        </div>
      )}

    </div>
  );
}
