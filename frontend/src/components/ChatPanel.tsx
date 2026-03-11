// frontend/src/components/ChatPanel.tsx
//
// Chat message panel — renders a scrollable list of attributed messages
// with an input field and Send button. Displays message author as
// displayName when available, falling back to the first 8 chars of clientId.

import { useState, useRef, useEffect } from 'react';
import type { ChatMessage } from '../hooks/useChat';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ChatPanelProps {
  messages: ChatMessage[];
  onSend: (content: string) => void;
  disabled?: boolean;
  onTyping?: (isTyping: boolean) => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Formats an ISO timestamp string to HH:MM local time. */
function formatTime(isoString: string): string {
  try {
    const d = new Date(isoString);
    const hh = d.getHours().toString().padStart(2, '0');
    const mm = d.getMinutes().toString().padStart(2, '0');
    return `${hh}:${mm}`;
  } catch {
    return '';
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ChatPanel({ messages, onSend, disabled = false, onTyping }: ChatPanelProps) {
  const [inputValue, setInputValue] = useState('');
  const listRef = useRef<HTMLDivElement>(null);
  const typingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Auto-scroll to bottom on new messages.
  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [messages.length]);

  // Clear typing timer on unmount.
  useEffect(() => {
    return () => {
      if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
    };
  }, []);

  function handleSend() {
    const content = inputValue.trim();
    if (!content || disabled) return;
    // Clear typing on send.
    if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
    typingTimerRef.current = null;
    onTyping?.(false);
    onSend(content);
    setInputValue('');
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!disabled) {
      // Broadcast typing; reset 2s idle timer.
      onTyping?.(true);
      if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
      typingTimerRef.current = setTimeout(() => onTyping?.(false), 2000);
    }
    if (e.key === 'Enter' && !disabled && inputValue.trim()) {
      handleSend();
    }
  }

  return (
    <div
      style={{
        border: '1px solid #e5e7eb',
        borderRadius: 4,
        padding: '0.75rem',
        marginTop: '1rem',
        fontFamily: 'monospace',
      }}
    >
      {/* Header */}
      <div
        style={{
          fontSize: '0.8rem',
          fontWeight: 'bold',
          marginBottom: '0.5rem',
          color: '#374151',
        }}
      >
        Chat ({messages.length})
      </div>

      {/* Message list */}
      <div
        ref={listRef}
        style={{
          maxHeight: 200,
          overflowY: 'auto',
          marginBottom: '0.5rem',
        }}
      >
        {messages.length === 0 ? (
          <div style={{ color: '#9ca3af', fontSize: '0.75rem' }}>
            No messages yet
          </div>
        ) : (
          messages.map((message, index) => {
            const author = message.displayName ?? message.clientId.slice(0, 8);
            const time = formatTime(message.timestamp);
            return (
              <div
                key={index}
                style={{
                  display: 'flex',
                  alignItems: 'baseline',
                  gap: '0.4rem',
                  padding: '0.15rem 0',
                  flexWrap: 'wrap',
                }}
              >
                <span
                  style={{
                    color: '#6b7280',
                    fontSize: '0.7rem',
                    flexShrink: 0,
                  }}
                >
                  {author}
                </span>
                <span
                  style={{
                    fontSize: '0.8rem',
                    color: '#374151',
                    flexGrow: 1,
                  }}
                >
                  {message.content}
                </span>
                <span
                  style={{
                    fontSize: '0.65rem',
                    color: '#9ca3af',
                    flexShrink: 0,
                  }}
                >
                  {time}
                </span>
              </div>
            );
          })
        )}
      </div>

      {/* Input row */}
      <div style={{ display: 'flex', flexDirection: 'row', gap: '0.5rem' }}>
        <input
          type="text"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={disabled}
          placeholder={disabled ? 'Not connected' : 'Type a message...'}
          style={{
            flex: 1,
            fontSize: '0.8rem',
            padding: '0.3rem 0.5rem',
            border: '1px solid #d1d5db',
            borderRadius: 4,
            fontFamily: 'monospace',
            color: '#374151',
            background: disabled ? '#f9fafb' : 'white',
          }}
        />
        <button
          onClick={handleSend}
          disabled={disabled || !inputValue.trim()}
          style={{
            fontSize: '0.8rem',
            padding: '0.3rem 0.75rem',
            border: '1px solid #d1d5db',
            borderRadius: 4,
            cursor: disabled || !inputValue.trim() ? 'default' : 'pointer',
            background: disabled || !inputValue.trim() ? '#f9fafb' : '#007bff',
            color: disabled || !inputValue.trim() ? '#9ca3af' : 'white',
            fontFamily: 'monospace',
          }}
        >
          Send
        </button>
      </div>
    </div>
  );
}
