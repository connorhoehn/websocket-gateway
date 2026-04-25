// frontend/src/components/shared/TagEditor.tsx
//
// Reusable tag input: a small text field plus a chip strip. Enter adds the
// current draft as a tag (trimmed, lowercased, duplicates dropped); clicking
// the × on a chip removes it. An optional `suggestions` prop renders a
// popover below the input showing the currently-unused suggestions that match
// the draft — click one to add it.

import {
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from 'react';
import { chipStyle, colors, fieldStyle } from '../../constants/styles';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TagEditorProps {
  value: string[];
  onChange: (tags: string[]) => void;
  placeholder?: string;
  suggestions?: string[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function normalize(raw: string): string {
  return raw.trim().toLowerCase();
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const wrapperStyle: CSSProperties = {
  position: 'relative',
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: 6,
};

const inputStyle: CSSProperties = {
  ...fieldStyle,
  padding: '4px 8px',
  fontSize: 12,
  flex: 'initial',
  width: 140,
  minWidth: 120,
};

const removeBtnStyle: CSSProperties = {
  marginLeft: 4,
  background: 'transparent',
  border: 'none',
  color: 'inherit',
  cursor: 'pointer',
  fontSize: 12,
  lineHeight: 1,
  padding: 0,
  fontFamily: 'inherit',
};

const popoverStyle: CSSProperties = {
  position: 'absolute',
  top: '100%',
  left: 0,
  marginTop: 4,
  background: colors.surface,
  border: `1px solid ${colors.border}`,
  borderRadius: 6,
  boxShadow: '0 6px 18px rgba(15,23,42,0.10)',
  padding: 6,
  display: 'flex',
  flexWrap: 'wrap',
  gap: 4,
  maxWidth: 320,
  zIndex: 30,
};

const suggestionBtnStyle: CSSProperties = {
  ...chipStyle('neutral'),
  cursor: 'pointer',
  border: `1px dashed ${colors.borderField}`,
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function TagEditor({
  value,
  onChange,
  placeholder = 'add tag...',
  suggestions,
}: TagEditorProps) {
  const [draft, setDraft] = useState('');
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const addTag = (raw: string) => {
    const normalized = normalize(raw);
    if (!normalized) return;
    if (value.includes(normalized)) {
      setDraft('');
      return;
    }
    onChange([...value, normalized]);
    setDraft('');
  };

  const removeTag = (tag: string) => {
    onChange(value.filter((t) => t !== tag));
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addTag(draft);
      return;
    }
    if (e.key === 'Backspace' && draft === '' && value.length > 0) {
      // Convenience: remove last tag when backspacing an empty input.
      e.preventDefault();
      removeTag(value[value.length - 1]);
    }
  };

  // Unused suggestions matching the current draft (case-insensitive substring).
  const shownSuggestions = useMemo(() => {
    if (!suggestions || suggestions.length === 0) return [];
    const q = draft.trim().toLowerCase();
    const used = new Set(value.map((t) => t.toLowerCase()));
    return suggestions
      .map((s) => s.trim().toLowerCase())
      .filter((s) => s.length > 0 && !used.has(s))
      .filter((s) => (q ? s.includes(q) : true))
      .slice(0, 12);
  }, [suggestions, value, draft]);

  const showPopover = focused && shownSuggestions.length > 0;

  return (
    <div style={wrapperStyle} data-testid="tag-editor">
      {value.map((tag) => (
        <span key={tag} style={chipStyle('neutral')} data-testid={`tag-chip-${tag}`}>
          {tag}
          <button
            type="button"
            aria-label={`Remove tag ${tag}`}
            onClick={() => removeTag(tag)}
            style={removeBtnStyle}
          >
            ×
          </button>
        </span>
      ))}
      <div style={{ position: 'relative' }}>
        <input
          ref={inputRef}
          data-testid="tag-editor-input"
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => setFocused(true)}
          onBlur={() => {
            // Small delay so suggestion clicks register before the popover hides.
            setTimeout(() => setFocused(false), 120);
          }}
          placeholder={placeholder}
          style={inputStyle}
        />
        {showPopover ? (
          <div style={popoverStyle} data-testid="tag-suggestions">
            {shownSuggestions.map((s) => (
              <button
                key={s}
                type="button"
                onMouseDown={(e) => {
                  // Prevent the blur from firing before we handle the click.
                  e.preventDefault();
                }}
                onClick={() => addTag(s)}
                style={suggestionBtnStyle}
              >
                + {s}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
