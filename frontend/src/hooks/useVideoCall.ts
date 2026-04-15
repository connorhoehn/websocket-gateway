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
  const { documentId, idToken, meta, updateMeta, sendMessage } = options;

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
        // Use sendBeacon for reliable cleanup on tab close
        navigator.sendBeacon(
          `${SOCIAL_API_URL}/api/video/sessions/${sid}/end`,
          new Blob([JSON.stringify({})], { type: 'application/json' }),
        );
      }
    };
    window.addEventListener('beforeunload', handleUnload);
    return () => window.removeEventListener('beforeunload', handleUnload);
  }, []);

  // Detect if another user started a call via Y.js meta
  const activeCallFromMeta = meta?.activeCallSessionId || null;
  const hasActiveCall = !!activeCallFromMeta && !sessionId;

  const authHeaders = idToken
    ? { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' }
    : { 'Content-Type': 'application/json' };

  const joinSession = useCallback(async (sid: string) => {
    setCallState('joining');
    setError(null);
    try {
      const res = await fetch(
        `${SOCIAL_API_URL}/api/video/sessions/${sid}/join`,
        { method: 'POST', headers: authHeaders },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: 'Join failed' }));
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
  }, [authHeaders]);

  const startCall = useCallback(async () => {
    setCallState('creating');
    setError(null);
    try {
      // Create session
      const createRes = await fetch(
        `${SOCIAL_API_URL}/api/video/sessions`,
        { method: 'POST', headers: authHeaders },
      );
      if (!createRes.ok) {
        const body = await createRes.json().catch(() => ({ error: 'Create failed' }));
        throw new Error((body as { error: string }).error);
      }
      const createData = (await createRes.json()) as { sessionId: string };
      const newSessionId = createData.sessionId;

      // Write to Y.js meta so other editors see the call
      updateMeta({ activeCallSessionId: newSessionId });

      // Also sync to document list metadata (Redis) so the doc list shows call indicator
      sendMessage({
        service: 'crdt',
        action: 'updateDocumentMeta',
        documentId,
        meta: { activeCallSessionId: newSessionId },
      });

      // Join the session
      await joinSession(newSessionId);
    } catch (err) {
      setError((err as Error).message);
      setCallState('error');
    }
  }, [authHeaders, updateMeta, joinSession]);

  const joinCall = useCallback(async (sid: string) => {
    await joinSession(sid);
  }, [joinSession]);

  const endCall = useCallback(async () => {
    const sid = sessionIdRef.current;
    if (sid) {
      // Best-effort end session
      fetch(`${SOCIAL_API_URL}/api/video/sessions/${sid}/end`, {
        method: 'POST',
        headers: authHeaders,
      }).catch(() => {});
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
  }, [authHeaders, updateMeta]);

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
