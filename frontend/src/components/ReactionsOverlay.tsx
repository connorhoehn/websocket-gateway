// frontend/src/components/ReactionsOverlay.tsx
//
// Fixed overlay rendering ephemeral emoji reactions with fade-up animation.
// Each reaction appears at a random position and fades out over 2.5 seconds.
// pointer-events: none ensures the overlay never blocks UI interaction.

import type { EphemeralReaction } from '../hooks/useReactions';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface Props {
  reactions: EphemeralReaction[];
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ReactionsOverlay({ reactions }: Props) {
  return (
    <>
      <style>{`
        @keyframes reaction-fade-up {
          0% {
            opacity: 1;
            transform: translateY(0);
          }
          100% {
            opacity: 0;
            transform: translateY(-60px);
          }
        }
      `}</style>
      <div
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          pointerEvents: 'none',
          zIndex: 9999,
        }}
      >
        {reactions.map((reaction) => (
          <span
            key={reaction.id}
            style={{
              position: 'absolute',
              left: `${reaction.x}%`,
              top: `${reaction.y}%`,
              fontSize: '2rem',
              animation: 'reaction-fade-up 2.5s ease-out forwards',
              userSelect: 'none',
            }}
          >
            {reaction.emoji}
          </span>
        ))}
      </div>
    </>
  );
}
