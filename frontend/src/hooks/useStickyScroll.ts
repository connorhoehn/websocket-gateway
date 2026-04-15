// frontend/src/hooks/useStickyScroll.ts
//
// Makes an element "sticky" by switching to position:fixed when the user
// scrolls past its original position. Works in nested flex/overflow contexts
// where CSS position:sticky fails.

import { useState, useEffect, useRef, useCallback } from 'react';

interface UseStickyScrollOptions {
  /** The scrollable container element (defaults to document scroll). */
  scrollContainer?: HTMLElement | null;
  /** Offset from top when fixed (px). */
  topOffset?: number;
}

interface UseStickyScrollReturn {
  /** Ref to attach to the placeholder element (reserves space in layout). */
  placeholderRef: React.RefObject<HTMLDivElement | null>;
  /** Whether the element should be fixed. */
  isFixed: boolean;
  /** The left position when fixed (matches placeholder's left). */
  fixedLeft: number;
  /** The width when fixed (matches placeholder's width). */
  fixedWidth: number;
}

export function useStickyScroll(options: UseStickyScrollOptions = {}): UseStickyScrollReturn {
  const { topOffset = 0 } = options;
  const placeholderRef = useRef<HTMLDivElement | null>(null);
  const [isFixed, setIsFixed] = useState(false);
  const [fixedLeft, setFixedLeft] = useState(0);
  const [fixedWidth, setFixedWidth] = useState(0);

  const handleScroll = useCallback(() => {
    const el = placeholderRef.current;
    if (!el) return;

    const rect = el.getBoundingClientRect();
    // Switch to fixed when the placeholder scrolls above the viewport
    if (rect.top < topOffset) {
      setIsFixed(true);
      setFixedLeft(rect.left);
      setFixedWidth(rect.width);
    } else {
      setIsFixed(false);
    }
  }, [topOffset]);

  useEffect(() => {
    // Find the scrollable ancestor
    const container = options.scrollContainer || findScrollParent(placeholderRef.current);
    if (!container) return;

    container.addEventListener('scroll', handleScroll, { passive: true });
    window.addEventListener('resize', handleScroll, { passive: true });
    handleScroll(); // Initial check

    return () => {
      container.removeEventListener('scroll', handleScroll);
      window.removeEventListener('resize', handleScroll);
    };
  }, [handleScroll, options.scrollContainer]);

  return { placeholderRef, isFixed, fixedLeft, fixedWidth };
}

function findScrollParent(el: HTMLElement | null): HTMLElement | null {
  let node = el?.parentElement;
  while (node) {
    const style = getComputedStyle(node);
    if (style.overflow === 'auto' || style.overflow === 'scroll' ||
        style.overflowY === 'auto' || style.overflowY === 'scroll') {
      return node;
    }
    node = node.parentElement;
  }
  return document.documentElement;
}
