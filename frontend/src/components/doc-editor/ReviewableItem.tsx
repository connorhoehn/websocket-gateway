// frontend/src/components/doc-editor/ReviewableItem.tsx
//
// A single task item in ack mode with review controls.

import { useState, useEffect, useRef } from 'react';
import type { TaskItem } from '../../types/document';

// Inject keyframes for the status transition effects
const REVIEW_ANIM_STYLE_ID = 'reviewable-item-animations';
if (typeof document !== 'undefined' && !document.getElementById(REVIEW_ANIM_STYLE_ID)) {
  const style = document.createElement('style');
  style.id = REVIEW_ANIM_STYLE_ID;
  style.textContent = `
    @keyframes ackPulse {
      0% { box-shadow: 0 0 0 0 rgba(34, 197, 94, 0.5); }
      50% { box-shadow: 0 0 0 12px rgba(34, 197, 94, 0); }
      100% { box-shadow: 0 0 0 0 rgba(34, 197, 94, 0); }
    }
    @keyframes rejectPulse {
      0% { box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.5); }
      50% { box-shadow: 0 0 0 12px rgba(239, 68, 68, 0); }
      100% { box-shadow: 0 0 0 0 rgba(239, 68, 68, 0); }
    }
    @keyframes slideCollapse {
      0% { opacity: 1; max-height: 200px; transform: scale(1); margin-bottom: 0.5rem; }
      60% { opacity: 0.5; max-height: 200px; transform: scale(0.98); }
      100% { opacity: 0; max-height: 0; transform: scale(0.95); margin-bottom: 0; padding: 0; border-width: 0; overflow: hidden; }
    }
  `;
  document.head.appendChild(style);
}

interface ReviewableItemProps {
  item: TaskItem;
  onAck: (notes?: string) => void;
  onReject: (reason: string) => void;
}

const statusColors: Record<TaskItem['status'], { bg: string; text: string }> = {
  pending: { bg: '#fef3c7', text: '#92400e' },
  acked: { bg: '#d1fae5', text: '#065f46' },
  done: { bg: '#dbeafe', text: '#1e40af' },
  rejected: { bg: '#fee2e2', text: '#991b1b' },
};

const priorityColors: Record<TaskItem['priority'], string> = {
  low: '#6b7280',
  medium: '#f59e0b',
  high: '#ef4444',
};

const cardStyle: React.CSSProperties = {
  background: '#fff',
  border: '1px solid #e5e7eb',
  borderRadius: 8,
  padding: '0.75rem 1rem',
  marginBottom: '0.5rem',
};

const badgeBase: React.CSSProperties = {
  display: 'inline-block',
  fontSize: 11,
  fontWeight: 600,
  padding: '2px 8px',
  borderRadius: 9999,
  marginLeft: 8,
};

const btnStyle = (color: string): React.CSSProperties => ({
  padding: '6px 14px',
  fontSize: 13,
  fontWeight: 600,
  border: 'none',
  borderRadius: 6,
  cursor: 'pointer',
  background: color,
  color: '#fff',
});

export default function ReviewableItem({ item, onAck, onReject }: ReviewableItemProps) {
  const [showNotes, setShowNotes] = useState(false);
  const [noteText, setNoteText] = useState('');
  const [transition, setTransition] = useState<'none' | 'ack' | 'reject'>('none');
  const prevStatus = useRef(item.status);
  const sc = statusColors[item.status];

  // Detect when status changes from 'pending' to 'acked' or 'rejected' (e.g. from another user)
  useEffect(() => {
    if (prevStatus.current === 'pending' && item.status === 'acked') {
      setTransition('ack');
    } else if (prevStatus.current === 'pending' && item.status === 'rejected') {
      setTransition('reject');
    }
    prevStatus.current = item.status;
  }, [item.status]);

  const handleAck = () => {
    setTransition('ack');
    setTimeout(() => {
      onAck(noteText || undefined);
      setNoteText('');
      setShowNotes(false);
    }, 150);
  };

  const handleReject = () => {
    if (!noteText.trim()) {
      setShowNotes(true);
      return;
    }
    setTransition('reject');
    setTimeout(() => {
      onReject(noteText);
      setNoteText('');
      setShowNotes(false);
    }, 150);
  };

  const transitionStyle: React.CSSProperties = transition === 'ack'
    ? { animation: 'ackPulse 0.6s ease-out', borderColor: '#22c55e', background: '#f0fdf4' }
    : transition === 'reject'
    ? { animation: 'rejectPulse 0.6s ease-out', borderColor: '#ef4444', background: '#fef2f2' }
    : {};

  return (
    <div style={{ ...cardStyle, ...transitionStyle, transition: 'all 0.3s ease' }}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 6 }}>
        <span style={{ fontSize: 14, fontWeight: 500, flex: 1, color: '#1e293b' }}>{item.text}</span>
        <span style={{ ...badgeBase, background: sc.bg, color: sc.text }}>
          {item.status}
        </span>
        <span
          style={{
            ...badgeBase,
            background: 'transparent',
            color: priorityColors[item.priority],
            border: `1px solid ${priorityColors[item.priority]}`,
          }}
        >
          {item.priority}
        </span>
      </div>

      {item.status === 'acked' && (
        <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 4 }}>
          Acked by {item.ackedBy} at {item.ackedAt}
          {item.notes && <span> &mdash; {item.notes}</span>}
        </div>
      )}

      {item.status === 'rejected' && (
        <div style={{ fontSize: 12, color: '#991b1b', marginBottom: 4 }}>
          Rejected{item.notes && <>: {item.notes}</>}
        </div>
      )}

      {item.status === 'pending' && (
        <div>
          <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
            <button type="button" style={btnStyle('#22c55e')} onClick={handleAck}>
              Acknowledge
            </button>
            <button type="button" style={btnStyle('#ef4444')} onClick={handleReject}>
              Reject
            </button>
            {!showNotes && (
              <button
                type="button"
                style={{ ...btnStyle('#6b7280'), background: 'transparent', color: '#6b7280', border: '1px solid #d1d5db' }}
                onClick={() => setShowNotes(true)}
              >
                Add note
              </button>
            )}
          </div>

          {showNotes && (
            <div style={{ marginTop: 8 }}>
              <textarea
                value={noteText}
                onChange={(e) => setNoteText(e.target.value)}
                placeholder="Add notes or rejection reason..."
                style={{
                  width: '100%',
                  minHeight: 60,
                  padding: 8,
                  fontSize: 13,
                  border: '1px solid #d1d5db',
                  borderRadius: 6,
                  resize: 'vertical',
                  fontFamily: 'inherit',
                }}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
