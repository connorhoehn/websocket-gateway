// frontend/src/components/ReactionsOverlay.tsx
//
// Fixed overlay rendering ephemeral emoji reactions with per-emoji distinct animations.
// Each reaction appears at a random position and fades out after its animation completes.
// pointer-events: none ensures the overlay never blocks UI interaction.
// All @keyframes are embedded in a JSX <style> tag — no external CSS.

import type { EphemeralReaction } from '../hooks/useReactions';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface Props {
  reactions: EphemeralReaction[];
}

// ---------------------------------------------------------------------------
// Animation map — one entry per emoji type
// ---------------------------------------------------------------------------

const EMOJI_ANIMATIONS: Record<string, string> = {
  '❤️':  'reaction-heart 2.5s ease-out forwards',
  '😂':  'reaction-laugh 2.5s ease-out forwards',
  '👍':  'reaction-thumbsup 2.5s ease-out forwards',
  '👎':  'reaction-thumbsdown 2.5s ease-out forwards',
  '😮':  'reaction-wow 2.5s ease-out forwards',
  '😢':  'reaction-cry 2.5s ease-out forwards',
  '😡':  'reaction-angry 1.8s ease-out forwards',
  '🎉':  'reaction-party 2.5s ease-out forwards',
  '🔥':  'reaction-fire 2.5s ease-out forwards',
  '⚡':  'reaction-lightning 1.5s ease-out forwards',
  '💯':  'reaction-hundred 2.0s ease-out forwards',
  '🚀':  'reaction-rocket 2.0s ease-out forwards',
};

const DEFAULT_ANIMATION = 'reaction-fade-up 2.5s ease-out forwards';

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ReactionsOverlay({ reactions }: Props) {
  return (
    <>
      <style>{`
        @keyframes reaction-fade-up {
          0%   { opacity: 1; transform: translateY(0); }
          100% { opacity: 0; transform: translateY(-60px); }
        }

        @keyframes reaction-heart {
          0%   { opacity: 1; transform: scale(1); }
          50%  { opacity: 1; transform: scale(1.4); }
          100% { opacity: 0; transform: scale(0.8) translateY(-80px); }
        }

        @keyframes reaction-laugh {
          0%   { opacity: 1; transform: translateX(0) translateY(0); }
          20%  { transform: translateX(10px) translateY(-14px); }
          40%  { transform: translateX(-10px) translateY(-28px); }
          60%  { transform: translateX(10px) translateY(-42px); }
          80%  { transform: translateX(-10px) translateY(-56px); }
          100% { opacity: 0; transform: translateX(0) translateY(-70px); }
        }

        @keyframes reaction-thumbsup {
          0%   { opacity: 1; transform: translateX(0) translateY(0); }
          100% { opacity: 0; transform: translateX(30px) translateY(-70px); }
        }

        @keyframes reaction-thumbsdown {
          0%   { opacity: 1; transform: translateX(0) translateY(0); }
          60%  { opacity: 1; transform: translateX(-30px) translateY(20px); }
          100% { opacity: 0; transform: translateX(-30px) translateY(20px); }
        }

        @keyframes reaction-wow {
          0%   { opacity: 1; transform: scale(1) translateY(0); }
          30%  { opacity: 1; transform: scale(2) translateY(-20px); }
          60%  { opacity: 1; transform: scale(1) translateY(-40px); }
          100% { opacity: 0; transform: scale(0.8) translateY(-60px); }
        }

        @keyframes reaction-cry {
          0%   { opacity: 1; transform: translateY(0); }
          30%  { opacity: 1; transform: translateY(30px); }
          100% { opacity: 0; transform: translateY(-40px); }
        }

        @keyframes reaction-angry {
          0%   { opacity: 1; transform: translateX(0) translateY(0); }
          10%  { transform: translateX(8px) translateY(-5px); }
          20%  { transform: translateX(-8px) translateY(-10px); }
          30%  { transform: translateX(8px) translateY(-15px); }
          40%  { transform: translateX(-8px) translateY(-20px); }
          50%  { transform: translateX(8px) translateY(-25px); }
          60%  { transform: translateX(-8px) translateY(-30px); }
          100% { opacity: 0; transform: translateX(0) translateY(-50px); }
        }

        @keyframes reaction-party {
          0%   { opacity: 1; transform: rotate(0deg) translateY(0); }
          50%  { opacity: 1; transform: rotate(180deg) translateY(-40px); }
          100% { opacity: 0; transform: rotate(360deg) translateY(-80px); }
        }

        @keyframes reaction-fire {
          0%   { opacity: 1; transform: scale(1) translateY(0); }
          20%  { transform: scale(1.2) translateY(-14px); }
          40%  { transform: scale(0.9) translateY(-28px); }
          60%  { transform: scale(1.2) translateY(-42px); }
          80%  { transform: scale(0.9) translateY(-56px); }
          100% { opacity: 0; transform: scale(1) translateY(-70px); }
        }

        @keyframes reaction-lightning {
          0%   { opacity: 1; transform: translateY(0); }
          15%  { opacity: 0.1; }
          30%  { opacity: 1; }
          45%  { opacity: 0.1; }
          60%  { opacity: 1; transform: translateY(-30px); }
          100% { opacity: 0; transform: translateY(-60px); }
        }

        @keyframes reaction-hundred {
          0%   { opacity: 1; transform: rotate(0deg) scale(1); }
          50%  { opacity: 1; transform: rotate(360deg) scale(1.5); }
          100% { opacity: 0; transform: rotate(720deg) scale(0); }
        }

        @keyframes reaction-rocket {
          0%   { opacity: 1; transform: translateX(0) translateY(0); }
          100% { opacity: 0; transform: translateX(-20px) translateY(-120px); }
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
              animation: EMOJI_ANIMATIONS[reaction.emoji] ?? DEFAULT_ANIMATION,
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
