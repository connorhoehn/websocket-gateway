// frontend/src/components/doc-editor/VideoCallPanel.tsx
//
// Side panel for video calling within the document editor.
// Uses IVS RealTime Stages via the useHangoutEmbed hook.

import { useState, useMemo, useRef, useEffect } from 'react';
import type { DocumentMeta } from '../../types/document';
import { useVideoCall } from '../../hooks/useVideoCall';
import { useHangoutEmbed } from '../../lib/video/useHangoutEmbed';
import { useActiveSpeaker } from '../../lib/video/useActiveSpeaker';
import type { HangoutParticipant } from '../../lib/video/types';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface VideoCallPanelProps {
  documentId: string;
  userId: string;
  idToken: string | null;
  meta: DocumentMeta | null;
  updateMeta: (partial: Partial<DocumentMeta>) => void;
  sendMessage: (msg: Record<string, unknown>) => void;
  onClose: () => void;
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const panelStyle: React.CSSProperties = {
  background: '#111827',
  border: '1px solid #374151',
  borderRadius: 12,
  marginBottom: 16,
  overflow: 'hidden',
  maxWidth: 1200,
  margin: '0 auto 16px',
};

const headerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '8px 12px',
  borderBottom: '1px solid #374151',
  flexShrink: 0,
};

const btnStyle: React.CSSProperties = {
  padding: '6px 12px',
  fontSize: 13,
  fontWeight: 500,
  border: '1px solid #d1d5db',
  borderRadius: 6,
  background: '#fff',
  color: '#374151',
  cursor: 'pointer',
  fontFamily: 'inherit',
};

const primaryBtnStyle: React.CSSProperties = {
  ...btnStyle,
  background: '#16a34a',
  color: '#fff',
  border: '1px solid #16a34a',
};

const dangerBtnStyle: React.CSSProperties = {
  ...btnStyle,
  background: '#dc2626',
  color: '#fff',
  border: '1px solid #dc2626',
};

// ---------------------------------------------------------------------------
// ParticipantTile (inline, adapted for narrow panel)
// ---------------------------------------------------------------------------

function ParticipantTile({ participant, isSpeaking }: { participant: HangoutParticipant; isSpeaking: boolean }) {
  const videoRef = useRef<HTMLVideoElement>(null);

  // Only set srcObject when the stream instance actually changes
  useEffect(() => {
    const el = videoRef.current;
    const stream = participant.streams[0] ?? null;
    if (el && stream && el.srcObject !== stream) {
      el.srcObject = stream;
    }
  }, [participant.streams]);

  return (
    <div style={{
      position: 'relative',
      aspectRatio: '16 / 9',
      background: '#111827',
      borderRadius: 10,
      overflow: 'hidden',
      transition: 'box-shadow 0.3s ease',
      boxShadow: isSpeaking
        ? '0 0 0 3px #10b981, 0 8px 20px rgba(16, 185, 129, 0.2)'
        : '0 0 0 1px rgba(55, 65, 81, 0.4)',
    }}>
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted={participant.isLocal}
        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
      />
      <div style={{
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        height: 36,
        background: 'linear-gradient(transparent, rgba(0,0,0,0.5))',
        pointerEvents: 'none',
      }} />
      <div style={{
        position: 'absolute',
        bottom: 6,
        left: 6,
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        background: 'rgba(0,0,0,0.6)',
        color: '#fff',
        fontSize: 11,
        fontWeight: 500,
        padding: '3px 8px',
        borderRadius: 999,
      }}>
        {isSpeaking && (
          <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#34d399' }} />
        )}
        <span>{participant.userId}</span>
        {participant.isLocal && <span style={{ opacity: 0.5 }}>(You)</span>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ScreenShareTile
// ---------------------------------------------------------------------------

function ScreenShareTile({ stream, userId }: { stream: MediaStream; userId: string }) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const el = videoRef.current;
    if (el && el.srcObject !== stream) {
      el.srcObject = stream;
    }
  }, [stream]);

  return (
    <div style={{
      position: 'relative',
      aspectRatio: '16 / 9',
      background: '#000',
      borderRadius: 10,
      overflow: 'hidden',
      border: '2px solid #3b82f6',
    }}>
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        style={{ width: '100%', height: '100%', objectFit: 'contain' }}
      />
      <div style={{
        position: 'absolute',
        bottom: 6,
        left: 6,
        background: 'rgba(59, 130, 246, 0.8)',
        color: '#fff',
        fontSize: 11,
        fontWeight: 500,
        padding: '3px 8px',
        borderRadius: 999,
      }}>
        {userId}'s screen
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Active Call View
// ---------------------------------------------------------------------------

function ActiveCallView({ stageToken, participantId, userId, onEndCall }: {
  stageToken: string;
  participantId: string;
  userId: string;
  onEndCall: () => void;
}) {
  const { participants, isJoined, isScreenSharing, error, toggleMute, toggleCamera, startScreenShare, stopScreenShare, leave } = useHangoutEmbed({
    stageToken,
    userId,
    participantId,
  });

  const { activeSpeakerId } = useActiveSpeaker({ participants });

  const [isMuted, setIsMuted] = useState(false);
  const [isCameraOff, setIsCameraOff] = useState(false);

  const participantsWithSpeaking = useMemo(() =>
    participants.map(p => ({
      ...p,
      isSpeaking: p.participantId === activeSpeakerId,
    })),
    [participants, activeSpeakerId],
  );

  // Check if anyone is sharing their screen
  const screenSharer = participantsWithSpeaking.find(p => p.screenStream);

  const handleEndCall = () => {
    leave();
    onEndCall();
  };

  if (error) {
    return (
      <div style={{ padding: 16, textAlign: 'center', color: '#dc2626', fontSize: 13 }}>
        {error}
        <br />
        <button type="button" onClick={onEndCall} style={{ ...btnStyle, marginTop: 12 }}>Close</button>
      </div>
    );
  }

  if (!isJoined) {
    return (
      <div style={{ padding: 20, textAlign: 'center', color: '#6b7280', fontSize: 13 }}>
        Connecting to video...
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Screen share — large pinned tile when someone is sharing */}
      {screenSharer?.screenStream && (
        <div style={{ padding: 8, paddingBottom: 0 }}>
          <ScreenShareTile stream={screenSharer.screenStream} userId={screenSharer.userId} />
        </div>
      )}

      {/* Video tiles — horizontal row */}
      <div style={{ display: 'flex', gap: 8, padding: 8, overflow: 'auto' }}>
        {participantsWithSpeaking.map(p => (
          <div key={p.participantId} style={{ flex: '1 1 0', minWidth: screenSharer ? 120 : 180, maxWidth: screenSharer ? 200 : 360 }}>
            <ParticipantTile participant={p} isSpeaking={p.isSpeaking} />
          </div>
        ))}
      </div>

      {/* Controls */}
      <div style={{
        display: 'flex',
        justifyContent: 'center',
        gap: 8,
        padding: '8px 12px',
        borderTop: '1px solid #374151',
        flexShrink: 0,
      }}>
        <button
          type="button"
          onClick={() => { setIsMuted(!isMuted); toggleMute(!isMuted); }}
          style={{
            ...btnStyle,
            background: isMuted ? '#fef2f2' : '#fff',
            color: isMuted ? '#dc2626' : '#374151',
            border: isMuted ? '1px solid #dc2626' : '1px solid #d1d5db',
          }}
        >
          {isMuted ? 'Unmute' : 'Mute'}
        </button>
        <button
          type="button"
          onClick={() => { setIsCameraOff(!isCameraOff); toggleCamera(isCameraOff); }}
          style={{
            ...btnStyle,
            background: isCameraOff ? '#fef2f2' : '#fff',
            color: isCameraOff ? '#dc2626' : '#374151',
            border: isCameraOff ? '1px solid #dc2626' : '1px solid #d1d5db',
          }}
        >
          {isCameraOff ? 'Camera On' : 'Camera Off'}
        </button>
        <button
          type="button"
          onClick={() => isScreenSharing ? stopScreenShare() : startScreenShare()}
          style={{
            ...btnStyle,
            background: isScreenSharing ? '#dbeafe' : '#fff',
            color: isScreenSharing ? '#1d4ed8' : '#374151',
            border: isScreenSharing ? '1px solid #3b82f6' : '1px solid #d1d5db',
          }}
        >
          {isScreenSharing ? 'Stop Share' : 'Share'}
        </button>
        <button type="button" onClick={handleEndCall} style={dangerBtnStyle}>
          Leave
        </button>
      </div>

      {/* Participant count */}
      <div style={{ textAlign: 'center', fontSize: 11, color: '#6b7280', padding: '4px 0 8px' }}>
        {participants.length} participant{participants.length !== 1 ? 's' : ''}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Panel
// ---------------------------------------------------------------------------

export default function VideoCallPanel({
  documentId,
  userId,
  idToken,
  meta,
  updateMeta,
  sendMessage,
  onClose,
}: VideoCallPanelProps) {
  const {
    callState,
    stageToken,
    participantId,
    userId: callUserId,
    error,
    hasActiveCall,
    startCall,
    joinCall,
    endCall,
  } = useVideoCall({ documentId, idToken, meta, updateMeta, sendMessage });

  const activeCallSessionId = meta?.activeCallSessionId;

  return (
    <div style={panelStyle}>
      {/* Header */}
      <div style={headerStyle}>
        <h3 style={{ fontSize: 13, fontWeight: 600, color: '#e5e7eb', margin: 0 }}>Video Call</h3>
        <button type="button" onClick={onClose} style={{ ...btnStyle, background: 'transparent', color: '#9ca3af', border: '1px solid #4b5563' }}>Close</button>
      </div>

      {/* Content */}
      <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* Active call */}
        {callState === 'active' && stageToken && participantId && callUserId && (
          <ActiveCallView
            stageToken={stageToken}
            participantId={participantId}
            userId={callUserId}
            onEndCall={endCall}
          />
        )}

        {/* Creating / joining */}
        {(callState === 'creating' || callState === 'joining') && (
          <div style={{ padding: 16, textAlign: 'center', color: '#9ca3af', fontSize: 13 }}>
            {callState === 'creating' ? 'Starting call...' : 'Joining call...'}
          </div>
        )}

        {/* Error */}
        {callState === 'error' && (
          <div style={{ padding: 16, textAlign: 'center' }}>
            <div style={{ color: '#f87171', fontSize: 13, marginBottom: 12 }}>{error}</div>
            <button type="button" onClick={() => startCall()} style={primaryBtnStyle}>Try Again</button>
          </div>
        )}

        {/* Idle — start or join */}
        {callState === 'idle' && (
          <div style={{ padding: 16, textAlign: 'center' }}>
            {hasActiveCall && activeCallSessionId ? (
              <>
                <div style={{ fontSize: 13, color: '#d1d5db', marginBottom: 12 }}>
                  A call is in progress on this document.
                </div>
                <button type="button" onClick={() => joinCall(activeCallSessionId)} style={primaryBtnStyle}>
                  Join Call
                </button>
              </>
            ) : (
              <>
                <div style={{ fontSize: 13, color: '#9ca3af', marginBottom: 12 }}>
                  Start a video call with collaborators on this document.
                </div>
                <button type="button" onClick={startCall} style={primaryBtnStyle}>
                  Start Call
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
