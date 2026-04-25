// frontend/src/components/shared/Toast.tsx
//
// Single toast visual — styled to match the NotificationBanner style in
// AppLayout (white card, left accent border, soft shadow, system font). Color
// accent and default duration are driven by toast type. Consumers should not
// render this directly; use <ToastProvider> and `useToast()` instead.

import type { CSSProperties } from 'react';
import { usePrefersReducedMotion } from '../../hooks/usePrefersReducedMotion';

export type ToastType = 'info' | 'success' | 'warning' | 'error';

export interface ToastProps {
  id: string;
  message: string;
  type: ToastType;
  /** Exit state drives fade-out animation before removal from the DOM. */
  exiting?: boolean;
  actionLabel?: string;
  onAction?: () => void;
  onDismiss: (id: string) => void;
}

const ACCENT_COLOR: Record<ToastType, string> = {
  info:    '#2563eb',
  success: '#16a34a',
  warning: '#d97706',
  error:   '#dc2626',
};

function Toast({ id, message, type, exiting, actionLabel, onAction, onDismiss }: ToastProps) {
  const accent = ACCENT_COLOR[type];
  const reduceMotion = usePrefersReducedMotion();

  const style: CSSProperties = {
    background: '#ffffff',
    border: '1px solid #e2e8f0',
    borderLeft: `3px solid ${accent}`,
    borderRadius: 8,
    padding: '12px 16px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    fontFamily: 'system-ui, -apple-system, sans-serif',
    boxShadow: '0 4px 12px rgba(0,0,0,0.12)',
    minWidth: 260,
    maxWidth: 360,
    // §18.12 reduced-motion: toasts still appear and are removed, but the
    // 200ms slide-in / 160ms fade-out become instant. We also zero the
    // opacity on `exiting` so the entry disappears immediately instead of
    // lingering for the fade-out animation duration.
    animation: reduceMotion
      ? 'none'
      : exiting
        ? 'toastFadeOut 160ms ease-in forwards'
        : 'toastSlideIn 200ms ease-out',
    opacity: reduceMotion && exiting ? 0 : undefined,
  };

  return (
    <div role="alert" aria-live={type === 'error' || type === 'warning' ? 'assertive' : 'polite'} style={style}>
      <span style={{ fontSize: 14, color: '#374151', fontWeight: 400, flex: 1, lineHeight: 1.35 }}>
        {message}
      </span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
        {actionLabel && onAction && (
          <button
            onClick={() => { onAction(); onDismiss(id); }}
            style={{
              background: 'none',
              border: 'none',
              color: accent,
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
              padding: '2px 6px',
              fontFamily: 'inherit',
            }}
          >
            {actionLabel}
          </button>
        )}
        <button
          onClick={() => onDismiss(id)}
          aria-label="Dismiss notification"
          style={{
            fontSize: 16,
            color: '#94a3b8',
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            padding: '0 4px',
            lineHeight: 1,
          }}
        >
          ×
        </button>
      </div>
    </div>
  );
}

export default Toast;
