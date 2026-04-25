// frontend/src/hooks/usePrefersReducedMotion.ts
//
// Reactive wrapper around the `(prefers-reduced-motion: reduce)` media query
// per PIPELINES_PLAN.md §18.12 ("Motion system") and §18.15 ("Accessibility").
// Components consume this to swap animated transitions / pulses / sweeps for
// their instant or static equivalents while preserving the underlying state.

import { useEffect, useState } from 'react';

export function usePrefersReducedMotion(): boolean {
  const [prefers, setPrefers] = useState(
    () =>
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const handler = () => setPrefers(mq.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  return prefers;
}

export default usePrefersReducedMotion;
