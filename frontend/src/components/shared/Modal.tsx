// frontend/src/components/shared/Modal.tsx
//
// Reusable modal shell. Matches the DeleteConfirmModal style used across the
// app: rgba(0,0,0,0.45) backdrop, white card with 12px radius, 28px/24px
// padding, 0 8px 32px rgba(0,0,0,0.18) shadow. Closes on backdrop click and
// Escape keypress.
//
// Accessibility: when the modal opens it captures the previously-focused
// element, moves focus inside the dialog (preferring `[data-autofocus]` when
// present), and traps Tab/Shift+Tab so keyboard navigation cannot escape the
// modal. On close the previously-focused element is re-focused. The whole
// dance is ~30 lines so we don't pull in `focus-trap-react`. See task brief.

import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  maxWidth?: number;
  children: React.ReactNode;
  footer?: React.ReactNode;
  /**
   * Optional overrides for the backdrop testid (defaults to "modal-backdrop").
   * Callers that need a specific testid on the backdrop — e.g. existing tests
   * that assert `getByTestId('delete-modal')` and click it to trigger
   * backdrop-close — can pass it through here.
   */
  backdropTestId?: string;
  /**
   * Optional override for the backdrop background. Defaults to the standard
   * rgba(0,0,0,0.45) overlay used across the app.
   */
  backdropStyle?: React.CSSProperties;
  /**
   * Optional override for the inner card container style. Spread over the
   * default 12px-radius, 28px/24px-padded, shadowed white card.
   */
  cardStyle?: React.CSSProperties;
  /**
   * Optional z-index for the backdrop. Defaults to 10000.
   */
  zIndex?: number;
  /**
   * When true, render children directly inside the card without the default
   * `fontSize: 13, color: '#64748b'` wrapper div. Useful for modals that
   * manage their own full-layout (header / scrollable body / footer) and
   * need the card to be a flex container.
   */
  rawChildren?: boolean;
}

// CSS selector matching everything that can hold focus. Buttons, links with
// `href`, form controls (when not disabled), `[tabindex]` (excluding -1),
// and contenteditable elements all qualify per WAI-ARIA practice.
const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
  '[contenteditable="true"]',
].join(',');

function getFocusableElements(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (el) => {
      // Skip elements that are visually hidden or aria-hidden — they can't
      // legitimately receive focus.
      if (el.getAttribute('aria-hidden') === 'true') return false;
      // jsdom doesn't compute layout, so offsetParent is null even for visible
      // elements; tolerate that by accepting any element with no inline display:none.
      if (el.style.display === 'none' || el.style.visibility === 'hidden') return false;
      return true;
    },
  );
}

function Modal({
  open, onClose, title, maxWidth = 380, children, footer,
  backdropTestId = 'modal-backdrop', backdropStyle, cardStyle, zIndex = 10000,
  rawChildren = false,
}: ModalProps) {
  const cardRef = useRef<HTMLDivElement | null>(null);
  // Captures the element that had focus before the modal opened, so we can
  // restore it when the modal closes. Lives in a ref so the unmount-cleanup
  // closure reads the latest value.
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);

  // ── Open/close lifecycle: capture+restore focus, autofocus on open ─────
  useEffect(() => {
    if (!open) return;
    // Capture the previously focused element for restore-on-close.
    const active = (typeof document !== 'undefined' ? document.activeElement : null) as
      | HTMLElement
      | null;
    previouslyFocusedRef.current = active;

    // Defer the focus move to the next microtask so the modal DOM is mounted
    // before we try to query it. React commits before useEffect runs, but the
    // ref is only attached once the card has rendered.
    const card = cardRef.current;
    if (card) {
      const autofocus = card.querySelector<HTMLElement>('[data-autofocus]');
      if (autofocus) {
        autofocus.focus();
      } else {
        const focusables = getFocusableElements(card);
        if (focusables.length > 0) {
          focusables[0].focus();
        } else {
          // Nothing focusable inside — focus the card itself so screen readers
          // announce the dialog. Add a tabindex so .focus() works.
          card.setAttribute('tabindex', '-1');
          card.focus();
        }
      }
    }

    return () => {
      // Restore focus to whatever was focused before the modal opened. Guard
      // against the element being removed from the DOM in the meantime.
      const prev = previouslyFocusedRef.current;
      if (prev && typeof prev.focus === 'function' && document.contains(prev)) {
        prev.focus();
      }
      previouslyFocusedRef.current = null;
    };
  }, [open]);

  // ── Esc + Tab/Shift+Tab focus trap ─────────────────────────────────────
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      if (e.key !== 'Tab') return;
      const card = cardRef.current;
      if (!card) return;
      const focusables = getFocusableElements(card);
      if (focusables.length === 0) {
        // No focusable children — keep focus on the card itself.
        e.preventDefault();
        return;
      }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement as HTMLElement | null;
      // If focus has somehow escaped the card, pull it back to the first
      // focusable element so Tab/Shift+Tab always cycle within the modal.
      if (!active || !card.contains(active)) {
        e.preventDefault();
        first.focus();
        return;
      }
      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  // Portal into document.body so the backdrop escapes any ancestor stacking
  // context (e.g. AppLayout's main-content area has `zIndex: 1` which would
  // otherwise cap the modal's effective z-index and let the sidebar / header
  // punch through the overlay).
  return createPortal(
    <div
      data-testid={backdropTestId}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex,
        ...backdropStyle,
      }}
      onClick={onClose}
    >
      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        style={{
          background: '#fff', borderRadius: 12, padding: '28px 24px',
          maxWidth, width: '90%', boxShadow: '0 8px 32px rgba(0,0,0,0.18)',
          fontFamily: 'inherit',
          ...cardStyle,
        }}
        onClick={e => e.stopPropagation()}
      >
        {title && (
          <div style={{ fontSize: 16, fontWeight: 600, color: '#0f172a', marginBottom: 10 }}>
            {title}
          </div>
        )}
        {rawChildren
          ? children
          : <div style={{ fontSize: 13, color: '#64748b' }}>{children}</div>}
        {footer && (
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 22 }}>
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

export default Modal;
