// frontend/src/components/doc-editor/TableOfContents.tsx
//
// Mini table of contents sidebar that shows document sections as landmarks.
// Highlights the currently visible section as the user scrolls.

import { useState, useEffect, useCallback } from 'react';

interface Section {
  id: string;
  title: string;
}

interface TableOfContentsProps {
  sections: Section[];
  focusedSectionId: string | null;
}

export default function TableOfContents({ sections, focusedSectionId }: TableOfContentsProps) {
  const [activeSectionId, setActiveSectionId] = useState<string | null>(null);

  // Track which section is currently in view using IntersectionObserver
  useEffect(() => {
    if (sections.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        // Find the most visible section
        let bestEntry: IntersectionObserverEntry | null = null;
        for (const entry of entries) {
          if (entry.isIntersecting) {
            if (!bestEntry || entry.intersectionRatio > bestEntry.intersectionRatio) {
              bestEntry = entry;
            }
          }
        }
        if (bestEntry) {
          const id = bestEntry.target.id.replace('section-', '');
          setActiveSectionId(id);
        }
      },
      { threshold: [0, 0.25, 0.5, 0.75, 1], rootMargin: '-80px 0px -40% 0px' },
    );

    for (const section of sections) {
      const el = document.getElementById(`section-${section.id}`);
      if (el) observer.observe(el);
    }

    return () => observer.disconnect();
  }, [sections]);

  // Use focused section as fallback
  const currentId = activeSectionId || focusedSectionId;

  const handleClick = useCallback((sectionId: string) => {
    const el = document.getElementById(`section-${sectionId}`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, []);

  // Deduplicate sections by ID
  const uniqueSections = sections.filter((s, i, arr) => arr.findIndex(x => x.id === s.id) === i);

  if (uniqueSections.length === 0) return null;

  const currentIndex = uniqueSections.findIndex(s => s.id === currentId);

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      gap: 0,
      fontSize: 11,
      width: 140,
      maxHeight: 'calc(100vh - 160px)',
      overflowY: 'auto',
    }}>
      {/* Header */}
      <div style={{ fontSize: 10, fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>
        Contents
      </div>

      {uniqueSections.map((section, idx) => {
        const isActive = section.id === currentId;
        const isPast = currentIndex >= 0 && idx < currentIndex;

        return (
          <button
            key={section.id}
            type="button"
            onClick={() => handleClick(section.id)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '4px 0',
              border: 'none',
              background: 'none',
              cursor: 'pointer',
              textAlign: 'left',
              fontFamily: 'inherit',
            }}
          >
            {/* Timeline dot + line */}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: 12, flexShrink: 0 }}>
              <div style={{
                width: isActive ? 8 : 6,
                height: isActive ? 8 : 6,
                borderRadius: '50%',
                background: isActive ? '#3b82f6' : isPast ? '#94a3b8' : '#d1d5db',
                transition: 'all 0.2s',
                boxShadow: isActive ? '0 0 0 3px rgba(59, 130, 246, 0.2)' : 'none',
              }} />
            </div>

            {/* Label */}
            <span style={{
              fontSize: 11,
              fontWeight: isActive ? 600 : 400,
              color: isActive ? '#1e293b' : isPast ? '#64748b' : '#94a3b8',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              transition: 'color 0.2s',
            }}>
              {section.title || 'Untitled'}
            </span>
          </button>
        );
      })}

      {/* Progress indicator */}
      {currentIndex >= 0 && (
        <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 8 }}>
          {currentIndex + 1} / {uniqueSections.length}
        </div>
      )}
    </div>
  );
}
