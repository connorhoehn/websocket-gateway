import '@testing-library/jest-dom';

// Node >=22 ships an experimental built-in `localStorage` global (gated by
// `--localstorage-file`). When vitest's jsdom environment populates the
// global scope it does NOT override `localStorage` / `sessionStorage`, so
// Node's broken stub leaks through and shadows the real jsdom Storage.
// Symptom: `TypeError: localStorage.setItem is not a function`.
//
// Fix: pull the real Storage objects off the jsdom window vitest exposes
// at `window.jsdom` and install them on globalThis. This restores a working
// localStorage / sessionStorage for every test, isolated per worker.
{
  const jsdom = (globalThis as { jsdom?: { window: Window } }).jsdom
    ?? (typeof window !== 'undefined' ? (window as unknown as { jsdom?: { window: Window } }).jsdom : undefined);
  if (jsdom?.window) {
    Object.defineProperty(globalThis, 'localStorage', {
      value: jsdom.window.localStorage,
      writable: true,
      configurable: true,
    });
    Object.defineProperty(globalThis, 'sessionStorage', {
      value: jsdom.window.sessionStorage,
      writable: true,
      configurable: true,
    });
  }
}

// jsdom doesn't implement window.matchMedia; stub it so hooks like
// usePrefersReducedMotion don't throw.
if (typeof window !== 'undefined' && !window.matchMedia) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).matchMedia = (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  });
}

// jsdom doesn't implement ResizeObserver; React Flow uses it to measure the
// canvas viewport. A no-op stub is enough for unit tests that don't depend on
// real layout measurements.
if (typeof globalThis !== 'undefined' && !(globalThis as { ResizeObserver?: unknown }).ResizeObserver) {
  class ResizeObserverStub {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).ResizeObserver = ResizeObserverStub;
}
