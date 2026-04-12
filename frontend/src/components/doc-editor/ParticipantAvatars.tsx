// frontend/src/components/doc-editor/ParticipantAvatars.tsx
//
// Interactive presence strip with clickable avatars, online dots, mode badges,
// section indicators, and tooltips.

import { useState, useEffect, useRef } from 'react';
import type { Participant } from '../../types/document';

interface ParticipantAvatarsProps {
  participants: Participant[];
  sections?: { id: string; title: string }[];
  onJumpToUser?: (participant: Participant) => void;
}

/* ---- helpers ------------------------------------------------------------ */

function getInitials(name: string): string {
  return name
    .split(' ')
    .map((w) => w[0] ?? '')
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

function darkenColor(hex: string, amount = 0.2): string {
  const h = hex.replace('#', '');
  const num = parseInt(h, 16);
  const r = Math.max(0, ((num >> 16) & 0xff) * (1 - amount));
  const g = Math.max(0, ((num >> 8) & 0xff) * (1 - amount));
  const b = Math.max(0, (num & 0xff) * (1 - amount));
  return `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)})`;
}

function modeText(mode: Participant['mode']): string {
  switch (mode) {
    case 'editor':
      return 'editing';
    case 'reviewer':
      return 'reviewing';
    case 'reader':
      return 'reading';
    default:
      return '';
  }
}

function lastSeenText(lastSeen?: number): string {
  if (!lastSeen) return '';
  const diff = Math.floor((Date.now() - lastSeen) / 1000);
  if (diff < 5) return '';  // Active right now — don't show timer
  if (diff < 60) return `, ${diff}s`;
  if (diff < 3600) return `, ${Math.floor(diff / 60)}m`;
  return `, ${Math.floor(diff / 3600)}h`;
}

function modeBadgeColor(mode: Participant['mode']): { bg: string; text: string } {
  switch (mode) {
    case 'editor':
      return { bg: '#dbeafe', text: '#1d4ed8' };
    case 'reviewer':
      return { bg: '#fef3c7', text: '#92400e' };
    case 'reader':
      return { bg: '#f1f5f9', text: '#64748b' };
    default:
      return { bg: '#f1f5f9', text: '#64748b' };
  }
}

/* ---- pulse keyframe injection (once) ------------------------------------ */

const PULSE_STYLE_ID = 'presence-pulse-keyframe';
function ensurePulseKeyframe() {
  if (typeof document === 'undefined') return;
  if (document.getElementById(PULSE_STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = PULSE_STYLE_ID;
  style.textContent = `
    @keyframes presencePulse {
      0%   { box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.5); }
      70%  { box-shadow: 0 0 0 4px rgba(16, 185, 129, 0); }
      100% { box-shadow: 0 0 0 0 rgba(16, 185, 129, 0); }
    }
    @keyframes presenceFadeIn {
      from { opacity: 0; transform: scale(0.7); }
      to   { opacity: 1; transform: scale(1); }
    }
  `;
  document.head.appendChild(style);
}

/* ---- styles ------------------------------------------------------------- */

const rowStyle: React.CSSProperties = {
  display: 'flex',
  gap: 10,
  alignItems: 'flex-start',
  padding: '4px 0',
};

const avatarWrap: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 3,
  position: 'relative',
  cursor: 'pointer',
  animation: 'presenceFadeIn 0.3s ease',
};

const tooltipStyle: React.CSSProperties = {
  position: 'absolute',
  bottom: '100%',
  left: '50%',
  transform: 'translateX(-50%)',
  marginBottom: 8,
  background: '#1e293b',
  color: '#fff',
  padding: '6px 10px',
  borderRadius: 6,
  fontSize: 12,
  whiteSpace: 'nowrap',
  zIndex: 100,
  pointerEvents: 'none',
  boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
  lineHeight: 1.4,
};

const separatorStyle: React.CSSProperties = {
  width: 1,
  height: 36,
  background: '#e2e8f0',
  margin: '0 4px',
  alignSelf: 'center',
};

/* ---- component ---------------------------------------------------------- */

function AvatarItem({
  participant,
  sectionTitle,
  onJumpToUser,
}: {
  participant: Participant;
  sectionTitle?: string;
  onJumpToUser?: (p: Participant) => void;
}) {
  const [hovered, setHovered] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const badge = modeBadgeColor(participant.mode);
  const baseColor = participant.color || '#3b82f6';

  return (
    <div
      ref={ref}
      style={avatarWrap}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={() => onJumpToUser?.(participant)}
      title=""
    >
      {/* Tooltip */}
      {hovered && (
        <div style={tooltipStyle}>
          <div style={{ fontWeight: 600, marginBottom: 2 }}>{participant.displayName}</div>
          <div style={{ color: '#94a3b8', fontSize: 11 }}>{modeText(participant.mode)}{lastSeenText(participant.lastSeen)}</div>
          {sectionTitle && (
            <div style={{ color: '#94a3b8', fontSize: 11, marginTop: 2 }}>
              &sect; {sectionTitle}
            </div>
          )}
        </div>
      )}

      {/* Avatar circle with gradient + online dot */}
      <div style={{ position: 'relative', display: 'inline-block' }}>
        <div
          style={{
            width: 32,
            height: 32,
            borderRadius: '50%',
            background: `linear-gradient(135deg, ${baseColor}, ${darkenColor(baseColor, 0.2)})`,
            color: '#fff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 12,
            fontWeight: 600,
            transition: 'transform 0.2s ease, box-shadow 0.2s ease',
            transform: hovered ? 'scale(1.1)' : 'scale(1)',
            boxShadow: hovered ? `0 0 0 2px ${baseColor}40` : 'none',
          }}
        >
          {getInitials(participant.displayName)}
        </div>

        {/* Online dot */}
        <div
          style={{
            position: 'absolute',
            bottom: 0,
            right: 0,
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: '#10b981',
            border: '2px solid #fff',
            animation: 'presencePulse 2s infinite',
          }}
        />
      </div>

      {/* Mode badge */}
      <span
        style={{
          fontSize: 11,
          fontWeight: 600,
          padding: '1px 8px',
          borderRadius: 9999,
          background: badge.bg,
          color: badge.text,
          lineHeight: '16px',
        }}
      >
        {modeText(participant.mode)}{lastSeenText(participant.lastSeen)}
      </span>

      {/* Section indicator */}
      {sectionTitle && (
        <span
          style={{
            fontSize: 10,
            color: '#64748b',
            maxWidth: 80,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            textAlign: 'center',
          }}
        >
          &sect; {sectionTitle}
        </span>
      )}
    </div>
  );
}

export default function ParticipantAvatars({
  participants,
  sections,
  onJumpToUser,
}: ParticipantAvatarsProps) {
  useEffect(() => {
    ensurePulseKeyframe();
  }, []);

  const sectionMap = new Map<string, string>();
  if (sections) {
    for (const s of sections) {
      sectionMap.set(s.id, s.title);
    }
  }

  if (participants.length === 0) return null;

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 0 }}>
      <div style={rowStyle}>
        {participants.filter((p, i, arr) => arr.findIndex(x => (x.userId || x.clientId) === (p.userId || p.clientId)) === i).map((p) => (
          <AvatarItem
            key={p.clientId}
            participant={p}
            sectionTitle={p.currentSectionId ? sectionMap.get(p.currentSectionId) : undefined}
            onJumpToUser={onJumpToUser}
          />
        ))}
      </div>
      <div style={separatorStyle} />
    </div>
  );
}
