// frontend/src/components/shared/ShortcutsHelp.tsx
//
// Global keyboard-shortcut help overlay. Opens when the user presses `?`
// (shift+/) anywhere outside a text input. Sections mirror the shortcut map
// in PIPELINES_PLAN.md §18.13.

import type { CSSProperties } from 'react';
import Modal from './Modal';

export interface ShortcutsHelpProps {
  open: boolean;
  onClose: () => void;
}

interface Shortcut {
  keys: string;
  action: string;
}

interface Section {
  title: string;
  rows: Shortcut[];
}

// Note: `⌘/Ctrl` shorthand follows the plan document — macOS users read the
// ⌘ side, Windows/Linux read the Ctrl side. We display the raw shorthand
// here; refining per platform is a follow-up.
const SECTIONS: Section[] = [
  {
    title: 'Global',
    rows: [
      { keys: '⌘/Ctrl + K', action: 'Command palette (placeholder)' },
      { keys: '?',          action: 'Show shortcut help' },
      { keys: 'g p',        action: 'Go to Pipelines' },
      { keys: 'g o',        action: 'Go to Observability dashboard' },
    ],
  },
  {
    title: 'List view (/pipelines)',
    rows: [
      { keys: '⌘/Ctrl + N',       action: 'New pipeline' },
      { keys: '/',                action: 'Focus search' },
      { keys: 'Enter',            action: 'Open focused pipeline in editor' },
      { keys: 'R',                action: 'Run focused pipeline (if published)' },
    ],
  },
  {
    title: 'Editor (/pipelines/:id)',
    rows: [
      { keys: '⌘/Ctrl + S',              action: 'Save now' },
      { keys: '⌘/Ctrl + Enter',          action: 'Run (if published)' },
      { keys: '⌘/Ctrl + .',              action: 'Cancel running' },
      { keys: '⌘/Ctrl + Shift + P',      action: 'Publish' },
      { keys: '⌘/Ctrl + Z  /  ⌘/Ctrl + Shift + Z', action: 'Undo / Redo' },
      { keys: '⌘/Ctrl + C / X / V / D',  action: 'Copy / Cut / Paste / Duplicate' },
      { keys: '⌘/Ctrl + A',              action: 'Select all nodes' },
      { keys: '⌘/Ctrl + F',              action: 'Focus palette search' },
      { keys: 'Backspace / Delete',      action: 'Delete selection' },
      { keys: '1 – 8',                   action: 'Insert node type by palette order' },
      { keys: 'Arrow keys',              action: 'Nudge 4px' },
      { keys: 'Shift + Arrow',           action: 'Nudge 16px' },
      { keys: 'F',                       action: 'Fit view' },
      { keys: 'Shift + F',               action: 'Zoom to selection' },
      { keys: '⌘/Ctrl + 0',              action: 'Reset zoom to 1.0×' },
      { keys: 'M',                       action: 'Toggle minimap' },
      { keys: 'G',                       action: 'Toggle grid snap' },
      { keys: '⌘/Ctrl + /',              action: 'Toggle execution log' },
      { keys: 'Space + drag',            action: 'Pan canvas' },
      { keys: 'Esc',                     action: 'Deselect / close config panel / close modal' },
    ],
  },
  {
    title: 'Replay view',
    rows: [
      { keys: 'Space',            action: 'Play / pause' },
      { keys: 'j  /  ←',          action: 'Back 1 event' },
      { keys: 'k  /  →',          action: 'Forward 1 event' },
      { keys: 'Shift + J / ←',    action: 'Back 10 events' },
      { keys: 'Shift + K / →',    action: 'Forward 10 events' },
      { keys: 'Home',             action: 'Seek to start' },
      { keys: 'End',              action: 'Seek to end' },
      { keys: '0 – 9',            action: 'Seek to 0% / 10% / … / 90%' },
    ],
  },
  {
    title: 'Observability events view',
    rows: [
      { keys: '/',                action: 'Focus filter search' },
      { keys: 'L',                action: 'Toggle Live / Paused' },
      { keys: '⌘/Ctrl + E',       action: 'Export JSONL' },
      { keys: 'Arrow keys',       action: 'Navigate event list' },
      { keys: 'Enter',            action: 'Open in detail pane' },
    ],
  },
];

// ---------------------------------------------------------------------------
// Styles (inline, matching app conventions)
// ---------------------------------------------------------------------------

const sectionHeadingStyle: CSSProperties = {
  fontSize: 12,
  fontWeight: 700,
  color: '#0f172a',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  margin: '16px 0 6px',
  paddingTop: 6,
  borderTop: '1px solid #f1f5f9',
};

const firstSectionHeadingStyle: CSSProperties = {
  ...sectionHeadingStyle,
  marginTop: 0,
  paddingTop: 0,
  borderTop: 'none',
};

const rowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'baseline',
  justifyContent: 'space-between',
  padding: '4px 0',
  fontSize: 13,
  gap: 16,
};

const keyStyle: CSSProperties = {
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  color: '#0f172a',
  background: '#f1f5f9',
  border: '1px solid #e2e8f0',
  borderRadius: 4,
  padding: '2px 6px',
  fontSize: 12,
  whiteSpace: 'nowrap',
  flexShrink: 0,
};

const actionStyle: CSSProperties = {
  color: '#64748b',
  textAlign: 'right',
  flex: 1,
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function ShortcutsHelp({ open, onClose }: ShortcutsHelpProps) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Keyboard shortcuts"
      maxWidth={560}
      cardStyle={{ maxHeight: '85vh', display: 'flex', flexDirection: 'column' }}
      rawChildren
    >
      <div style={{ fontSize: 16, fontWeight: 600, color: '#0f172a', marginBottom: 10 }}>
        Keyboard shortcuts
      </div>
      <div style={{ overflowY: 'auto', paddingRight: 4 }}>
        {SECTIONS.map((section, sectionIdx) => (
          <div key={section.title}>
            <div style={sectionIdx === 0 ? firstSectionHeadingStyle : sectionHeadingStyle}>
              {section.title}
            </div>
            <div>
              {section.rows.map((row, rowIdx) => (
                <div key={`${section.title}-${rowIdx}`} style={rowStyle}>
                  <span style={keyStyle}>{row.keys}</span>
                  <span style={actionStyle}>{row.action}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 18 }}>
        <button
          onClick={onClose}
          style={{
            padding: '6px 14px',
            fontSize: 13,
            fontWeight: 600,
            border: '1px solid #e2e8f0',
            borderRadius: 6,
            background: '#fff',
            color: '#374151',
            cursor: 'pointer',
            fontFamily: 'inherit',
          }}
        >
          Close
        </button>
      </div>
    </Modal>
  );
}
