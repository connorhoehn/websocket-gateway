// frontend/src/hooks/useVideoSessions.ts
//
// Fetches past video session records for a document from the social-api.

import { useState, useCallback } from 'react';
import { SOCIAL_API_URL } from '../utils/socialApi';

export interface VideoSessionParticipant {
  userId: string;
  displayName: string;
  joinedAt: string;
}

export interface VideoSession {
  documentId: string;
  sessionId: string;
  vnlSessionId: string;
  status: 'active' | 'ended';
  startedAt: string;
  endedAt?: string;
  startedBy: string;
  participants: VideoSessionParticipant[];
  transcriptStatus?: 'pending' | 'processing' | 'available' | 'failed';
  transcript?: string;
  aiSummary?: string;
}

export function useVideoSessions(documentId: string, idToken: string | null) {
  const [sessions, setSessions] = useState<VideoSession[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchSessions = useCallback(async () => {
    setLoading(true);
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (idToken) headers.Authorization = `Bearer ${idToken}`;

      const res = await fetch(
        `${SOCIAL_API_URL}/api/video/sessions/document/${documentId}`,
        { headers },
      );
      if (!res.ok) return;
      const data = (await res.json()) as { sessions: VideoSession[] };
      setSessions(data.sessions);
    } catch {
      // Silent — past calls are non-critical
    } finally {
      setLoading(false);
    }
  }, [documentId, idToken]);

  return { sessions, loading, fetchSessions };
}
