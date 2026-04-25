// frontend/src/components/pipelines/replay/useReplayKeyboard.ts
//
// Keyboard shortcuts for the pipeline run replay scrubber. Mounted from
// `PipelineRunReplayPage` so the page can drive its `ReplayDriver` via the
// keyboard while the canvas is focused.
//
// Bail conditions (so we don't swallow text input):
//   - target is an <input>, <textarea>, or <select>
//   - target has `contenteditable` set
//
// Shortcut table (kept in sync with ShortcutsHelp.tsx → "Replay view"):
//   Space               Toggle play / pause
//   j or ArrowLeft      Back 1 event
//   k or ArrowRight     Forward 1 event
//   Shift+J / Shift+←   Back 10 events
//   Shift+K / Shift+→   Forward 10 events
//   Home                Seek to start
//   End                 Seek to end
//   0–9                 Seek to 0% / 10% / … / 90%
//
// `?` (open shortcut help) is intentionally handled globally in
// `AppLayout.tsx` — we don't duplicate it here, otherwise both handlers fire.

import { useEffect } from 'react';

import type { ReplayDriver } from './useReplayDriver';

/**
 * Returns `true` if `el` is an editable surface that should swallow keys
 * before our shortcut handler sees them.
 */
function isEditableTarget(el: EventTarget | null): boolean {
  if (!el || !(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (el.isContentEditable) return true;
  return false;
}

/**
 * Attaches a `keydown` listener that drives the supplied `ReplayDriver`.
 * The listener is mounted on `window` and torn down on unmount or whenever
 * `enabled` flips false (e.g. while the page is showing a modal that should
 * own the keys).
 */
export function useReplayKeyboard(
  driver: ReplayDriver,
  enabled: boolean = true,
): void {
  useEffect(() => {
    if (!enabled) return;

    const onKey = (e: KeyboardEvent) => {
      if (isEditableTarget(e.target)) return;
      // Honour modifier-bearing shortcuts only when Shift is the only modifier
      // (or there's no modifier). Don't fight ⌘/Ctrl/Alt combos — those belong
      // to the editor / browser.
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      const total = driver.state.totalEvents;
      const cursor = driver.state.cursor;

      switch (e.key) {
        case ' ':
        case 'Spacebar': {
          // Space → toggle play / pause.
          e.preventDefault();
          if (driver.state.playing) driver.pause();
          else driver.play();
          return;
        }

        case 'ArrowLeft': {
          e.preventDefault();
          const step = e.shiftKey ? 10 : 1;
          driver.seek(Math.max(0, cursor - step));
          return;
        }

        case 'ArrowRight': {
          e.preventDefault();
          const step = e.shiftKey ? 10 : 1;
          driver.seek(Math.min(total, cursor + step));
          return;
        }

        case 'j': {
          // lowercase j — back 1
          e.preventDefault();
          driver.seek(Math.max(0, cursor - 1));
          return;
        }

        case 'J': {
          // Shift+J — back 10
          e.preventDefault();
          driver.seek(Math.max(0, cursor - 10));
          return;
        }

        case 'k': {
          // lowercase k — forward 1
          e.preventDefault();
          driver.seek(Math.min(total, cursor + 1));
          return;
        }

        case 'K': {
          // Shift+K — forward 10
          e.preventDefault();
          driver.seek(Math.min(total, cursor + 10));
          return;
        }

        case 'Home': {
          e.preventDefault();
          driver.seek(0);
          return;
        }

        case 'End': {
          e.preventDefault();
          driver.seek(total);
          return;
        }

        default: {
          // 0–9 → seek to that decile (0 = 0%, 9 = 90%).
          if (e.key.length === 1 && e.key >= '0' && e.key <= '9') {
            e.preventDefault();
            const decile = Number.parseInt(e.key, 10);
            const target = Math.round((decile / 10) * total);
            driver.seek(Math.max(0, Math.min(total, target)));
            return;
          }
        }
      }
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [driver, enabled]);
}
