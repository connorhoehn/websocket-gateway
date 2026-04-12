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
    <div style={{ display: 'flex', gap: '0.25rem', flexWrap: 'wrap' }}>
      {EMOJIS.map((emoji) => (
        <button
          key={emoji}
          onClick={() => onReact(emoji)}
          disabled={disabled}
          style={{
            fontSize: '1.125rem',
            background: 'none',
            border: '1px solid #e2e8f0',
            borderRadius: 6,
            cursor: disabled ? 'not-allowed' : 'pointer',
            padding: '0.2rem 0.4rem',
            opacity: disabled ? 0.4 : 1,
            lineHeight: 1,
          }}
          title={emoji}
        >
          {emoji}
        </button>
      ))}
    </div>
  );
}
