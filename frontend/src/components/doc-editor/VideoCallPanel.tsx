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

const basePanelStyle: React.CSSProperties = {
  background: '#111827',
  border: '1px solid #374151',
  borderRadius: 12,
  overflow: 'hidden',
};

const headerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '4px 8px',
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

const iconBtnStyle: React.CSSProperties = {
  width: 36,
  height: 36,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  border: 'none',
  borderRadius: '50%',
  cursor: 'pointer',
  fontSize: 16,
  padding: 0,
  fontFamily: 'inherit',
  transition: 'background 0.15s',
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
      background: '#111827',
      borderRadius: 8,
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

function ScreenShareTile({ stream, userId, cameraStream, isLocal }: {
  stream: MediaStream;
  userId: string;
  cameraStream?: MediaStream;
  isLocal: boolean;
}) {
  const screenRef = useRef<HTMLVideoElement>(null);
  const pipRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const el = screenRef.current;
    if (el && el.srcObject !== stream) el.srcObject = stream;
  }, [stream]);

  useEffect(() => {
    const el = pipRef.current;
    if (el && cameraStream && el.srcObject !== cameraStream) el.srcObject = cameraStream;
  }, [cameraStream]);

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
        ref={screenRef}
        autoPlay
        playsInline
        muted
        style={{ width: '100%', height: '100%', objectFit: 'contain' }}
      />
      {/* PiP camera overlay for the screen sharer */}
      {isLocal && cameraStream && (
        <video
          ref={pipRef}
          autoPlay
          playsInline
          muted
          style={{
            position: 'absolute',
            bottom: 8,
            right: 8,
            width: 144,
            aspectRatio: '16 / 9',
            objectFit: 'cover',
            borderRadius: 8,
            border: '2px solid rgba(255,255,255,0.3)',
          }}
        />
      )}
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
  const [showControls, setShowControls] = useState(false);

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
    <div
      style={{ display: 'flex', flexDirection: 'column' }}
      onMouseEnter={() => setShowControls(true)}
      onMouseLeave={() => setShowControls(false)}
    >
      {/* Screen share — large pinned tile when someone is sharing */}
      {screenSharer?.screenStream && (
        <div style={{ padding: 6, paddingBottom: 0 }}>
          <ScreenShareTile
            stream={screenSharer.screenStream}
            userId={screenSharer.userId}
            cameraStream={screenSharer.streams[0]}
            isLocal={screenSharer.isLocal}
          />
        </div>
      )}

      {/* Video tiles — responsive grid: 1x1, 1x2, 2x2 */}
      <div style={{
        flex: 1,
        display: 'grid',
        gridTemplateColumns: participantsWithSpeaking.length <= 1 ? '1fr' : '1fr 1fr',
        gap: 4,
        padding: 6,
        alignContent: 'start',
      }}>
        {participantsWithSpeaking.map(p => (
          <ParticipantTile key={p.participantId} participant={p} isSpeaking={p.isSpeaking} />
        ))}
      </div>

      {/* Controls — icon buttons, visible on hover */}
      <div style={{
        display: 'flex',
        justifyContent: 'center',
        gap: 4,
        padding: '6px 8px',
        borderTop: '1px solid #374151',
        opacity: showControls ? 1 : 0,
        transition: 'opacity 0.2s',
        flexShrink: 0,
      }}>
        <button type="button" onClick={() => { setIsMuted(!isMuted); toggleMute(!isMuted); }}
          title={isMuted ? 'Unmute' : 'Mute'}
          style={{ ...iconBtnStyle, background: isMuted ? '#dc2626' : 'rgba(255,255,255,0.1)', color: '#fff' }}>
          {isMuted ? '\u{1F507}' : '\u{1F50A}'}
        </button>
        <button type="button" onClick={() => { setIsCameraOff(!isCameraOff); toggleCamera(isCameraOff); }}
          title={isCameraOff ? 'Camera On' : 'Camera Off'}
          style={{ ...iconBtnStyle, background: isCameraOff ? '#dc2626' : 'rgba(255,255,255,0.1)', color: '#fff' }}>
          {isCameraOff ? '\u{1F6AB}' : '\u{1F4F7}'}
        </button>
        <button type="button" onClick={() => isScreenSharing ? stopScreenShare() : startScreenShare()}
          title={isScreenSharing ? 'Stop Sharing' : 'Share Screen'}
          style={{ ...iconBtnStyle, background: isScreenSharing ? '#3b82f6' : 'rgba(255,255,255,0.1)', color: '#fff' }}>
          {'\u{1F4BB}'}
        </button>
        <button type="button" onClick={handleEndCall} title="Leave Call"
          style={{ ...iconBtnStyle, background: '#dc2626', color: '#fff' }}>
          {'\u{1F4DE}'}
        </button>
      </div>

      {/* Participant count */}
      <div style={{ textAlign: 'center', fontSize: 10, color: '#6b7280', padding: '2px 0 4px' }}>
        {participants.length} in call
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
    <div style={basePanelStyle}>
      {/* Header */}
      <div style={headerStyle}>
        <span style={{ fontSize: 11, fontWeight: 600, color: '#9ca3af', margin: 0 }}>Video</span>
        <button type="button" onClick={onClose} title="Close video" style={{
          width: 22, height: 22, display: 'flex', alignItems: 'center', justifyContent: 'center',
          border: 'none', borderRadius: 4, background: 'transparent', color: '#9ca3af',
          cursor: 'pointer', fontSize: 14, lineHeight: 1, padding: 0,
        }}>{'\u2715'}</button>
      </div>

      {/* Content */}
      <div>
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
