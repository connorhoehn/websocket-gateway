// frontend/src/components/doc-editor/AckMode.tsx
//
// Sequential chunk review mode. User navigates through sections one at a time.

import { useState, useEffect } from 'react';
import type { Section, Participant } from '../../types/document';
import ReviewProgress from './ReviewProgress';
import ChunkViewer from './ChunkViewer';

interface AckModeProps {
  sections: Section[];
  onAckItem: (sectionId: string, itemId: string, notes?: string) => void;
  onRejectItem: (sectionId: string, itemId: string, reason: string) => void;
  participants: Participant[];
  onSectionFocus?: (sectionId: string) => void;
}

const navStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  marginTop: '1rem',
  padding: '0.75rem 0',
};

const navBtnStyle = (disabled: boolean): React.CSSProperties => ({
  padding: '8px 18px',
  fontSize: 14,
  fontWeight: 600,
  border: '1px solid #d1d5db',
  borderRadius: 6,
  background: disabled ? '#f9fafb' : '#fff',
  color: disabled ? '#9ca3af' : '#374151',
  cursor: disabled ? 'default' : 'pointer',
});

const emptyStyle: React.CSSProperties = {
  textAlign: 'center',
  padding: '3rem',
  color: '#6b7280',
  fontSize: 15,
};

export default function AckMode({ sections, onAckItem, onRejectItem, participants, onSectionFocus }: AckModeProps) {
  const [currentIndex, setCurrentIndex] = useState(0);

  const section = sections.length > 0 ? sections[currentIndex] : null;

  // Update awareness when the viewed section changes — must be before any early return
  useEffect(() => {
    if (section && onSectionFocus) {
      onSectionFocus(section.id);
    }
  }, [section?.id, onSectionFocus]);

  if (!section) {
    return <div style={emptyStyle}>No sections to review.</div>;
  }

  const sectionParticipants = participants?.filter(p => p.currentSectionId === section.id) ?? [];
  const prev = () => setCurrentIndex((i) => Math.max(0, i - 1));
  const next = () => setCurrentIndex((i) => Math.min(sections.length - 1, i + 1));

  return (
    <div>
      <ReviewProgress current={currentIndex + 1} total={sections.length} />

      {sectionParticipants.length > 0 && (
        <div style={{ display: 'flex', gap: 4, marginBottom: 8, alignItems: 'center' }}>
          <span style={{ fontSize: 12, color: '#6b7280', marginRight: 4 }}>Viewing:</span>
          {sectionParticipants.map(p => (
            <div key={p.clientId} title={`${p.displayName} (${p.mode})`} style={{
              width: 24, height: 24, borderRadius: '50%',
              background: p.color, color: '#fff',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 10, fontWeight: 600,
            }}>
              {p.displayName.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)}
            </div>
          ))}
        </div>
      )}

      <ChunkViewer
        section={section}
        onAckItem={(itemId, notes) => onAckItem(section.id, itemId, notes)}
        onRejectItem={(itemId, reason) => onRejectItem(section.id, itemId, reason)}
      />

      <div style={navStyle}>
        <button
          type="button"
          style={navBtnStyle(currentIndex === 0)}
          onClick={prev}
          disabled={currentIndex === 0}
        >
          Previous
        </button>
        <span style={{ fontSize: 13, color: '#6b7280' }}>
          {currentIndex + 1} / {sections.length}
        </span>
        <button
          type="button"
          style={navBtnStyle(currentIndex === sections.length - 1)}
          onClick={next}
          disabled={currentIndex === sections.length - 1}
        >
          Next
        </button>
      </div>
    </div>
  );
}
