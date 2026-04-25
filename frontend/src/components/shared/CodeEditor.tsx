// frontend/src/components/shared/CodeEditor.tsx
//
// Shared lightweight code editor for syntax-like / expression inputs used by
// pipeline config panels (Transform, Condition, LLM, etc.).
//
// Phase 1 design goals — intentionally dependency-free:
//  - Monospace textarea with line numbers in a gutter column
//  - Auto-grow between minLines and maxLines
//  - Tab key inserts two spaces instead of blurring the textarea
//  - Optional clickable "variable pills" row above the editor that inserts
//    a `{{ varName }}` token at the current cursor position
//  - Focus ring styled to match the app (2px solid colors.primary)
//  - `language` prop is a no-op hint for Phase 1; it's reserved for a future
//    Phase where we add syntax highlighting (Prism / Monaco). Keeping the
//    prop now means we don't have to touch every call site when we swap the
//    implementation.
//
// NOTE: No npm dependencies are introduced — see PIPELINES_PLAN.md.

import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent, ChangeEvent } from 'react';
import { colors } from '../../constants/styles';

export interface CodeEditorProps {
  value: string;
  onChange: (next: string) => void;
  /** Hint for future syntax highlighting. Phase 1: purely cosmetic / no-op. */
  language?: 'jsonpath' | 'javascript' | 'template' | 'plain';
  placeholder?: string;
  /** Minimum visible lines. Default 4. */
  minLines?: number;
  /** Maximum visible lines before the editor starts scrolling. Default 20. */
  maxLines?: number;
  readOnly?: boolean;
  /** Available context variables — rendered as clickable insert pills. */
  variables?: string[];
  'aria-label'?: string;
}

// ---------------------------------------------------------------------------
// Visual constants — kept at module scope to avoid re-allocation per render.
// ---------------------------------------------------------------------------

const FONT_FAMILY = "'SF Mono', Menlo, monospace";
const FONT_SIZE   = 12;
const LINE_HEIGHT = 1.5;          // unitless
const LINE_PX     = FONT_SIZE * LINE_HEIGHT; // 18px
const PADDING_Y   = 8;
const PADDING_X   = 10;
const GUTTER_W    = 36;

const wrapperBase: CSSProperties = {
  display: 'flex',
  border: `1px solid ${colors.borderField}`,
  borderRadius: 6,
  background: colors.surfaceInset,
  fontFamily: FONT_FAMILY,
  fontSize: FONT_SIZE,
  lineHeight: LINE_HEIGHT,
  overflow: 'hidden',
  boxSizing: 'border-box',
};

const wrapperFocused: CSSProperties = {
  borderColor: colors.primary,
  boxShadow: `0 0 0 1px ${colors.primary}`, // fills out the 2px ring with the 1px border
};

const gutterStyle: CSSProperties = {
  width: GUTTER_W,
  padding: `${PADDING_Y}px 6px`,
  background: colors.surfacePanel,
  color: colors.textTertiary,
  fontFamily: FONT_FAMILY,
  fontSize: 11,
  lineHeight: LINE_HEIGHT,
  textAlign: 'right',
  userSelect: 'none',
  borderRight: `1px solid ${colors.border}`,
  overflow: 'hidden',
  whiteSpace: 'pre',
};

const textareaBase: CSSProperties = {
  flex: 1,
  border: 'none',
  outline: 'none',
  resize: 'none',
  padding: `${PADDING_Y}px ${PADDING_X}px`,
  fontFamily: FONT_FAMILY,
  fontSize: FONT_SIZE,
  lineHeight: LINE_HEIGHT,
  background: 'transparent',
  color: colors.textPrimary,
  // overflow toggled dynamically when content exceeds maxLines
  tabSize: 2,
  boxSizing: 'border-box',
};

const pillRowStyle: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 4,
  marginBottom: 4,
};

const pillStyle: CSSProperties = {
  display: 'inline-block',
  padding: '1px 6px',
  fontSize: 11,
  fontFamily: FONT_FAMILY,
  background: '#eef2ff',
  color: '#4338ca',
  border: '1px solid #c7d2fe',
  borderRadius: 4,
  cursor: 'pointer',
  lineHeight: 1.4,
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function CodeEditor({
  value,
  onChange,
  language: _language = 'plain', // Phase 1: accepted but not applied yet
  placeholder,
  minLines = 4,
  maxLines = 20,
  readOnly = false,
  variables,
  'aria-label': ariaLabel,
}: CodeEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [focused, setFocused] = useState(false);

  // Explicitly consume `language` so TS/ESLint don't complain about unused
  // props while still keeping it in the public API for future highlighting.
  void _language;

  // ---- line count + numbers -------------------------------------------------
  const lineCount = useMemo(() => {
    // `split('\n').length` counts a trailing newline as an empty last line,
    // which matches typical editor gutter behavior.
    return Math.max(1, value.split('\n').length);
  }, [value]);

  const lineNumbers = useMemo(() => {
    const n = Math.max(lineCount, minLines);
    const lines: string[] = [];
    for (let i = 1; i <= n; i++) lines.push(String(i));
    return lines.join('\n');
  }, [lineCount, minLines]);

  // ---- auto-height ----------------------------------------------------------
  // We size by line count directly rather than via scrollHeight measurement
  // to keep the layout stable (no ResizeObserver churn during typing).
  const visibleLines = Math.min(Math.max(lineCount, minLines), maxLines);
  const contentHeight = visibleLines * LINE_PX + PADDING_Y * 2;
  const scrollable = lineCount > maxLines;

  // ---- insertion helper -----------------------------------------------------
  // Used by both the Tab handler and the variable pills. Mutates via
  // onChange() so the parent stays the source of truth.
  const insertAtCursor = (insert: string) => {
    const el = textareaRef.current;
    const current = value ?? '';
    if (!el) {
      onChange(current + insert);
      return;
    }
    const start = el.selectionStart ?? current.length;
    const end   = el.selectionEnd   ?? current.length;
    const next = current.slice(0, start) + insert + current.slice(end);
    onChange(next);
    // Restore cursor after React re-renders the controlled value.
    queueMicrotask(() => {
      if (textareaRef.current) {
        const pos = start + insert.length;
        textareaRef.current.focus();
        textareaRef.current.setSelectionRange(pos, pos);
      }
    });
  };

  // ---- handlers -------------------------------------------------------------
  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (readOnly) return;
    if (e.key === 'Tab') {
      e.preventDefault();
      insertAtCursor('  ');
    }
  };

  const handleChange = (e: ChangeEvent<HTMLTextAreaElement>) => {
    onChange(e.target.value);
  };

  // ---- gutter sync: keep line numbers aligned with textarea scroll ---------
  // When the textarea overflows vertically, its scrollTop needs to map onto
  // the gutter so line numbers don't drift relative to the text.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el || !scrollable) return;
    const gutter = el.parentElement?.querySelector<HTMLDivElement>('[data-gutter]');
    if (!gutter) return;
    const onScroll = () => {
      gutter.scrollTop = el.scrollTop;
    };
    el.addEventListener('scroll', onScroll);
    return () => el.removeEventListener('scroll', onScroll);
  }, [scrollable]);

  // ---------------------------------------------------------------------------
  return (
    <div>
      {variables && variables.length > 0 && (
        <div style={pillRowStyle}>
          {variables.map(v => (
            <button
              key={v}
              type="button"
              onClick={() => insertAtCursor(`{{ ${v} }}`)}
              style={pillStyle}
              title={`Insert {{ ${v} }}`}
              disabled={readOnly}
            >
              {v}
            </button>
          ))}
        </div>
      )}

      <div
        style={{
          ...wrapperBase,
          ...(focused ? wrapperFocused : null),
          height: contentHeight,
        }}
      >
        <div
          data-gutter
          style={{
            ...gutterStyle,
            overflow: scrollable ? 'hidden' : 'hidden',
          }}
        >
          {lineNumbers}
        </div>

        <textarea
          ref={textareaRef}
          value={value}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder={placeholder}
          readOnly={readOnly}
          aria-label={ariaLabel}
          spellCheck={false}
          autoCorrect="off"
          autoCapitalize="off"
          style={{
            ...textareaBase,
            height: contentHeight,
            overflow: scrollable ? 'auto' : 'hidden',
          }}
        />
      </div>
    </div>
  );
}
