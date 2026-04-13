import React, { useState, useEffect, useCallback, useRef, useImperativeHandle, forwardRef } from 'react';
import ReactDOM from 'react-dom';
import type { MentionUser } from '../../hooks/useMentionUsers';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MentionDropdownProps {
  query: string;
  users: MentionUser[];
  position: { top: number; left: number };
  onSelect: (user: MentionUser) => void;
  onDismiss: () => void;
}

export interface MentionDropdownHandle {
  /** Forward a keydown event from the parent input. Returns true if the dropdown consumed it. */
  handleKeyDown: (e: React.KeyboardEvent | KeyboardEvent) => boolean;
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = {
  container: (pos: { top: number; left: number }): React.CSSProperties => ({
    position: 'fixed',
    top: pos.top,
    left: pos.left,
    zIndex: 1000,
    background: '#ffffff',
    border: '1px solid #e2e8f0',
    borderRadius: 8,
    boxShadow: '0 4px 12px rgba(0, 0, 0, 0.12)',
    maxHeight: 240,
    overflowY: 'auto',
    minWidth: 200,
  }),
  row: (highlighted: boolean): React.CSSProperties => ({
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '8px 12px',
    cursor: 'pointer',
    background: highlighted ? '#eff6ff' : 'transparent',
    transition: 'background 0.1s',
  }),
  avatar: (color: string): React.CSSProperties => ({
    width: 24,
    height: 24,
    borderRadius: '50%',
    background: color,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    fontSize: 11,
    fontWeight: 600,
    color: '#ffffff',
    lineHeight: 1,
  }),
  nameContainer: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    flex: 1,
    minWidth: 0,
  } as React.CSSProperties,
  name: {
    fontSize: 13,
    fontWeight: 500,
    color: '#1e293b',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  } as React.CSSProperties,
  onlineDot: (online: boolean): React.CSSProperties => ({
    width: 8,
    height: 8,
    borderRadius: '50%',
    background: online ? '#10b981' : '#cbd5e1',
    flexShrink: 0,
  }),
  mode: {
    fontSize: 11,
    color: '#94a3b8',
    flexShrink: 0,
  } as React.CSSProperties,
  empty: {
    padding: '12px 16px',
    fontSize: 13,
    color: '#94a3b8',
    textAlign: 'center',
  } as React.CSSProperties,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const MentionDropdown = forwardRef<MentionDropdownHandle, MentionDropdownProps>(
  function MentionDropdown({ query, users, position, onSelect, onDismiss }, ref) {
    const [activeIndex, setActiveIndex] = useState(0);
    const listRef = useRef<HTMLDivElement>(null);

    // Filter users by query (case-insensitive)
    const filtered = users.filter(u =>
      u.displayName.toLowerCase().includes(query.toLowerCase()),
    ).slice(0, 6);

    // Reset active index when query or filtered list changes
    useEffect(() => {
      setActiveIndex(0);
    }, [query]);

    // Scroll the active row into view
    useEffect(() => {
      const container = listRef.current;
      if (!container) return;
      const row = container.children[activeIndex] as HTMLElement | undefined;
      if (row) {
        row.scrollIntoView({ block: 'nearest' });
      }
    }, [activeIndex]);

    const handleKeyDown = useCallback(
      (e: React.KeyboardEvent | KeyboardEvent): boolean => {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          setActiveIndex(prev => (prev + 1) % Math.max(filtered.length, 1));
          return true;
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          setActiveIndex(prev => (prev - 1 + Math.max(filtered.length, 1)) % Math.max(filtered.length, 1));
          return true;
        }
        if (e.key === 'Enter' || e.key === 'Tab') {
          e.preventDefault();
          if (filtered.length > 0) {
            onSelect(filtered[activeIndex]);
          }
          return true;
        }
        if (e.key === 'Escape') {
          e.preventDefault();
          onDismiss();
          return true;
        }
        return false;
      },
      [filtered, activeIndex, onSelect, onDismiss],
    );

    // Expose handleKeyDown to parent via ref
    useImperativeHandle(ref, () => ({ handleKeyDown }), [handleKeyDown]);

    return ReactDOM.createPortal(
      <div style={styles.container(position)} ref={listRef} role="listbox">
        {filtered.length === 0 ? (
          <div style={styles.empty}>No users found</div>
        ) : (
          filtered.map((user, i) => (
            <div
              key={user.userId}
              role="option"
              aria-selected={i === activeIndex}
              style={styles.row(i === activeIndex)}
              onMouseEnter={() => setActiveIndex(i)}
              onMouseDown={(e) => {
                e.preventDefault(); // prevent blur on the parent input
                onSelect(user);
              }}
            >
              <div style={styles.avatar(user.color)}>
                {user.type === 'group' ? '#' : getInitials(user.displayName)}
              </div>
              <div style={styles.nameContainer as React.CSSProperties}>
                <span style={styles.name}>
                  {user.type === 'group' ? `@${user.displayName.toLowerCase()}` : user.displayName}
                </span>
                {user.type === 'user' && <span style={styles.onlineDot(user.online)} />}
                {user.type === 'user' && user.mode && <span style={styles.mode}>{user.mode}</span>}
                {user.type === 'group' && user.memberCount != null && (
                  <span style={styles.mode}>{user.memberCount} members</span>
                )}
              </div>
            </div>
          ))
        )}
      </div>,
      document.body,
    );
  },
);

export type { MentionUser };
