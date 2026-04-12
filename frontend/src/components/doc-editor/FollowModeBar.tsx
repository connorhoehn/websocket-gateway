// frontend/src/components/doc-editor/FollowModeBar.tsx
//
// "Following [name]" banner with stop button.
// Auto-unlocks follow mode on any user interaction (mousedown, keydown, wheel).

import { useEffect, useRef } from 'react';
import type { Participant } from '../../types/document';

interface FollowModeBarProps {
  followingUserId: string | null;
  participants: Participant[];
  onStopFollow: () => void;
}

export default function FollowModeBar({
  followingUserId,
  participants,
  onStopFollow,
}: FollowModeBarProps) {
  const cleanupRef = useRef<(() => void) | null>(null);

  // Auto-unlock follow on local user interaction in the editor area
  // Delay listener registration to avoid the "Follow" click itself triggering it
  useEffect(() => {
    if (!followingUserId) return;
    const timerId = setTimeout(() => {
      const handler = () => onStopFollow();
      const events: (keyof WindowEventMap)[] = ['mousedown', 'keydown', 'wheel'];
      for (const evt of events) {
        window.addEventListener(evt, handler, { once: true, passive: true });
      }
      cleanupRef.current = () => {
        for (const evt of events) {
          window.removeEventListener(evt, handler);
        }
      };
    }, 500);
    return () => {
      clearTimeout(timerId);
      cleanupRef.current?.();
      cleanupRef.current = null;
    };
  }, [followingUserId, onStopFollow]);

  if (!followingUserId) return null;

  const followed = participants.find(
    (p) => (p.userId || p.clientId) === followingUserId,
  );
  if (!followed) return null;

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      padding: '6px 16px',
      background: '#eff6ff',
      borderBottom: '1px solid #bfdbfe',
      fontSize: 13,
      fontWeight: 500,
      color: '#1d4ed8',
      flexShrink: 0,
    }}>
      <span>Following {followed.displayName}</span>
      <button
        onClick={onStopFollow}
        style={{
          background: 'none',
          border: '1px solid #93c5fd',
          borderRadius: 4,
          padding: '2px 8px',
          fontSize: 12,
          fontWeight: 600,
          color: '#1d4ed8',
          cursor: 'pointer',
          fontFamily: 'inherit',
        }}
      >
        Stop
      </button>
    </div>
  );
}
