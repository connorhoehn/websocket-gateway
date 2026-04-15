// frontend/src/hooks/useStickyScroll.ts
//
// Returns position info for a fixed sidebar element.
// Reads the placeholder's bounding rect to determine left/width,
// and uses the actual element's position relative to viewport top.

import { useState, useEffect, useRef } from 'react';

interface UseStickyScrollReturn {
  ref: React.RefObject<HTMLDivElement | null>;
  style: React.CSSProperties;
}

export function useStickyScroll(topOffset = 8): UseStickyScrollReturn {
  const ref = useRef<HTMLDivElement | null>(null);
  const [style, setStyle] = useState<React.CSSProperties>({});

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    // Find scroll parent
    let scrollParent: HTMLElement | null = el.parentElement;
    while (scrollParent) {
      const s = getComputedStyle(scrollParent);
      if (s.overflow === 'auto' || s.overflow === 'scroll' ||
          s.overflowY === 'auto' || s.overflowY === 'scroll') break;
      scrollParent = scrollParent.parentElement;
    }

    const scroller = scrollParent || document.documentElement;
    // Store initial rect before any fixed positioning
    const initialRect = el.getBoundingClientRect();
    const scrollerRect = scroller.getBoundingClientRect();
    const offsetInScroller = initialRect.top - scrollerRect.top + scroller.scrollTop;

    const onScroll = () => {
      const currentRect = el.getBoundingClientRect();
      const scrollTop = scroller.scrollTop;

      // When scrolled past the element's initial position, go fixed
      if (scrollTop > offsetInScroller - topOffset) {
        setStyle({
          position: 'fixed',
          top: topOffset,
          left: currentRect.left,
          width: currentRect.width,
          zIndex: 30,
        });
      } else {
        setStyle({});
      }
    };

    scroller.addEventListener('scroll', onScroll, { passive: true });
    return () => scroller.removeEventListener('scroll', onScroll);
  }, [topOffset]);

  return { ref, style };
}
