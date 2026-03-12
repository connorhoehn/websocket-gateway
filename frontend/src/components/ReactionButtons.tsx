// frontend/src/components/ReactionButtons.tsx
//
// Grid of 12 emoji reaction buttons. Clicking a button calls onReact(emoji).
// Buttons are disabled (with reduced opacity) when the disabled prop is true.
// No external CSS — inline styles only, consistent with rest of app.

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface Props {
  onReact: (emoji: string) => void;
  disabled?: boolean;  // true when connectionState !== 'connected'
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const EMOJIS = ['❤️', '😂', '👍', '👎', '😮', '😢', '😡', '🎉', '🔥', '⚡', '💯', '🚀'] as const;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ReactionButtons({ onReact, disabled = false }: Props) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(4, 1fr)',
        gap: '0.25rem',
      }}
    >
      {EMOJIS.map((emoji) => (
        <button
          key={emoji}
          onClick={() => onReact(emoji)}
          disabled={disabled}
          style={{
            fontSize: '1.25rem',
            background: 'none',
            border: 'none',
            cursor: disabled ? 'not-allowed' : 'pointer',
            padding: '0.25rem 0.5rem',
            opacity: disabled ? 0.5 : 1,
            transition: 'opacity 0.2s',
          }}
          title={emoji}
        >
          {emoji}
        </button>
      ))}
    </div>
  );
}
