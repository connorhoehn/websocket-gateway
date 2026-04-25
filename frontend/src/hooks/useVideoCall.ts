// frontend/src/hooks/useVideoCall.ts
//
// Manages the video call lifecycle: create session, join, leave.
// Persists activeCallSessionId in Y.js document meta so all editors
// see when a call is active.

import { useState, useCallback, useRef, useEffect } from 'react';
import type { DocumentMeta } from '../types/document';
import { SOCIAL_API_URL } from '../utils/socialApi';

export interface UseVideoCallOptions {
  documentId: string;
  idToken: string | null;
  /** Current document meta (from Y.js). */
  meta: DocumentMeta | null;
  /** Update document meta (writes to Y.js). */
  updateMeta: (partial: Partial<DocumentMeta>) => void;
  /** Send WebSocket message to gateway (for document list metadata sync). */
  sendMessage: (msg: Record<string, unknown>) => void;
  /** Display name for participant tracking. */
  displayName?: string;
}

export type CallState = 'idle' | 'creating' | 'joining' | 'active' | 'error';

export interface UseVideoCallReturn {
  callState: CallState;
  sessionId: string | null;
  stageToken: string | null;
  participantId: string | null;
  userId: string | null;
  error: string | null;
  /** Whether another user started a call (detected via Y.js meta). */
  hasActiveCall: boolean;
  /** Start a new call (creates session + joins). */
  startCall: () => Promise<void>;
  /** Join an existing call by sessionId. */
  joinCall: (sessionId: string) => Promise<void>;
  /** End/leave the call. */
  endCall: () => Promise<void>;
}

export function useVideoCall(options: UseVideoCallOptions): UseVideoCallReturn {
  const { documentId, idToken, meta, updateMeta, sendMessage, displayName } = options;

  const [callState, setCallState] = useState<CallState>('idle');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [stageToken, setStageToken] = useState<string | null>(null);
  const [participantId, setParticipantId] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const sessionIdRef = useRef(sessionId);
  useEffect(() => { sessionIdRef.current = sessionId; }, [sessionId]);

  // Clean up call on tab close / reload
  useEffect(() => {
    const handleUnload = () => {
      const sid = sessionIdRef.current;
      if (sid) {
        // End the VNL session — best-effort via sendBeacon
        navigator.sendBeacon(
          `${SOCIAL_API_URL}/api/video/sessions/${sid}/end`,
          new Blob([JSON.stringify({ documentId })], { type: 'application/json' }),
        );
        // Note: Y.js meta and Redis metadata can't be cleared via sendBeacon
        // (no REST endpoint). The VNL end handler will clean up server-side.
        // Stale activeCallSessionId is handled by the frontend checking session validity.
      }
    };
    window.addEventListener('beforeunload', handleUnload);
    return () => window.removeEventListener('beforeunload', handleUnload);
  }, []);

  // Detect if another user started a call via Y.js meta
  const activeCallFromMeta = meta?.activeCallSessionId || null;
  const hasActiveCall = !!activeCallFromMeta && !sessionId;

  // Use refs for values that change but shouldn't re-create callbacks
  const idTokenRef = useRef(idToken);
  useEffect(() => { idTokenRef.current = idToken; }, [idToken]);

  const getAuthHeaders = useCallback((): Record<string, string> => {
    const token = idTokenRef.current;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    return headers;
  }, []);

  const joinSession = useCallback(async (sid: string) => {
    setCallState('joining');
    setError(null);
    try {
      const res = await fetch(
        `${SOCIAL_API_URL}/api/video/sessions/${sid}/join`,
        { method: 'POST', headers: getAuthHeaders(), body: JSON.stringify({ documentId, displayName }) },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: 'Join failed' }));
        const status = res.status;
        // If session doesn't exist on VNL (404/410), clear stale meta
        if (status === 404 || status === 410) {
          console.warn('[useVideoCall] Session', sid, 'no longer exists, clearing stale meta');
          updateMeta({ activeCallSessionId: '' });
          sendMessage({
            service: 'crdt', action: 'updateDocumentMeta', documentId,
            meta: { activeCallSessionId: '' },
          });
          throw new Error('This call has ended. The page has been updated.');
        }
        throw new Error((body as { error: string }).error);
      }
      const data = (await res.json()) as { token: string; participantId: string; userId: string };
      setSessionId(sid);
      setStageToken(data.token);
      setParticipantId(data.participantId);
      setUserId(data.userId);
      setCallState('active');
    } catch (err) {
      setError((err as Error).message);
      setCallState('error');
    }
  }, [documentId, displayName, getAuthHeaders, updateMeta, sendMessage]);

  const startCall = useCallback(async () => {
    setCallState('creating');
    setError(null);
    try {
      // Create session on VNL
      const createRes = await fetch(
        `${SOCIAL_API_URL}/api/video/sessions`,
        { method: 'POST', headers: getAuthHeaders(), body: JSON.stringify({ documentId, displayName }) },
      );
      if (!createRes.ok) {
        const body = await createRes.json().catch(() => ({ error: 'Create failed' }));
        throw new Error((body as { error: string }).error);
      }
      const createData = (await createRes.json()) as { sessionId: string };
      const newSessionId = createData.sessionId;

      // Join FIRST — only persist activeCallSessionId after successful join
      // (prevents phantom calls if join fails due to permissions/network)
      await joinSession(newSessionId);

      // Only write meta after join succeeds (callState is now 'active')
      updateMeta({ activeCallSessionId: newSessionId });
      sendMessage({
        service: 'crdt',
        action: 'updateDocumentMeta',
        documentId,
        meta: { activeCallSessionId: newSessionId },
      });
    } catch (err) {
      setError((err as Error).message);
      setCallState('error');
    }
  }, [documentId, displayName, getAuthHeaders, updateMeta, sendMessage, joinSession]);

  const joinCall = useCallback(async (sid: string) => {
    await joinSession(sid);
  }, [joinSession]);

  const endCall = useCallback(async () => {
    const sid = sessionIdRef.current;
    if (sid) {
      // Best-effort end session — log failures for debugging
      fetch(`${SOCIAL_API_URL}/api/video/sessions/${sid}/end`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ documentId }),
      }).catch((err) => {
        console.error('[useVideoCall] Failed to end session on server:', err);
      });
    }

    // Clear Y.js meta
    updateMeta({ activeCallSessionId: '' });

    // Clear document list metadata
    sendMessage({
      service: 'crdt',
      action: 'updateDocumentMeta',
      documentId,
      meta: { activeCallSessionId: '' },
    });

    setSessionId(null);
    setStageToken(null);
    setParticipantId(null);
    setUserId(null);
    setCallState('idle');
    setError(null);
  }, [documentId, getAuthHeaders, updateMeta, sendMessage]);

  return {
    callState,
    sessionId,
    stageToken,
    participantId,
    userId,
    error,
    hasActiveCall,
    startCall,
    joinCall,
    endCall,
  };
}
