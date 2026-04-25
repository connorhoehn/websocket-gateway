// frontend/src/components/shared/Modal.tsx
//
// Reusable modal shell. Matches the DeleteConfirmModal style used across the
// app: rgba(0,0,0,0.45) backdrop, white card with 12px radius, 28px/24px
// padding, 0 8px 32px rgba(0,0,0,0.18) shadow. Closes on backdrop click and
// Escape keypress.

import { useEffect } from 'react';

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
   * Optional z-index for the backdrop. Defaults to 1000.
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

function Modal({
  open, onClose, title, maxWidth = 380, children, footer,
  backdropTestId = 'modal-backdrop', backdropStyle, cardStyle, zIndex = 1000,
  rawChildren = false,
}: ModalProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
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
    </div>
  );
}

export default Modal;
