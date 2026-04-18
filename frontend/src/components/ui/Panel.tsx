import React from 'react';
import { createPortal } from 'react-dom';
import { colors, spacing, fontSize, borderRadius } from '../../styles/tokens';

/* ------------------------------------------------------------------ */
/*  Panel                                                             */
/* ------------------------------------------------------------------ */

interface PanelProps {
  children: React.ReactNode;
  variant?: 'light' | 'dark';
  width?: number;
  style?: React.CSSProperties;
}

export const Panel: React.FC<PanelProps> = ({
  children,
  variant = 'light',
  width = 320,
  style,
}) => {
  const bg = variant === 'dark' ? '#111827' : colors.surface;
  // Render into document.body so the panel escapes any ancestor stacking
  // context (AppLayout's main content area creates one via `zIndex: 1`,
  // which would otherwise trap Panel's z-index below the sticky header).
  // See frontend/e2e/sidebar-panels.spec.ts for the regression.
  if (typeof document === 'undefined') return null;
  return createPortal(
    <div
      style={{
        position: 'fixed',
        right: 0,
        top: 0,
        height: '100%',
        width,
        zIndex: 60,
        display: 'flex',
        flexDirection: 'column',
        background: bg,
        boxShadow: '-4px 0 12px rgba(0,0,0,0.08)',
        ...style,
      }}
    >
      {children}
    </div>,
    document.body,
  );
};

/* ------------------------------------------------------------------ */
/*  PanelHeader                                                       */
/* ------------------------------------------------------------------ */

interface PanelHeaderProps {
  title: string;
  onClose: () => void;
  actions?: React.ReactNode;
  variant?: 'light' | 'dark';
}

export const PanelHeader: React.FC<PanelHeaderProps> = ({
  title,
  onClose,
  actions,
  variant = 'light',
}) => {
  const isDark = variant === 'dark';
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: `${spacing.sm}px ${spacing.md}px`,
        borderBottom: `1px solid ${isDark ? 'rgba(255,255,255,0.1)' : colors.border}`,
      }}
    >
      <span
        style={{
          fontSize: fontSize.sm,
          fontWeight: 600,
          color: isDark ? '#ffffff' : colors.textPrimary,
        }}
      >
        {title}
      </span>

      <div style={{ display: 'flex', alignItems: 'center', gap: spacing.xs }}>
        {actions}
        <button
          type="button"
          onClick={onClose}
          style={{
            width: 22,
            height: 22,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'transparent',
            border: 'none',
            borderRadius: borderRadius.sm,
            cursor: 'pointer',
            color: isDark ? colors.textMuted : colors.textSecondary,
            fontSize: fontSize.md,
            padding: 0,
            lineHeight: 1,
          }}
          aria-label="Close panel"
        >
          ×
        </button>
      </div>
    </div>
  );
};

/* ------------------------------------------------------------------ */
/*  PanelBody                                                         */
/* ------------------------------------------------------------------ */

interface PanelBodyProps {
  children: React.ReactNode;
  padding?: string;
}

export const PanelBody: React.FC<PanelBodyProps> = ({
  children,
  padding = '14px 12px',
}) => (
  <div
    style={{
      flex: 1,
      overflowY: 'auto',
      padding,
    }}
  >
    {children}
  </div>
);

/* ------------------------------------------------------------------ */
/*  Button                                                            */
/* ------------------------------------------------------------------ */

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'primary' | 'danger';
  size?: 'sm' | 'md';
}

const buttonVariants: Record<string, React.CSSProperties> = {
  default: {
    background: colors.surface,
    color: colors.textPrimary,
    border: `1px solid ${colors.border}`,
  },
  primary: {
    background: '#16a34a',
    color: '#ffffff',
    border: '1px solid #16a34a',
  },
  danger: {
    background: colors.danger,
    color: '#ffffff',
    border: `1px solid ${colors.danger}`,
  },
};

const buttonSizes: Record<string, React.CSSProperties> = {
  sm: { padding: '4px 10px', fontSize: fontSize.xs + 1 },
  md: { padding: '6px 12px', fontSize: fontSize.sm },
};

export const Button: React.FC<ButtonProps> = ({
  variant = 'default',
  size = 'md',
  style,
  type = 'button',
  ...rest
}) => (
  <button
    type={type}
    style={{
      borderRadius: borderRadius.sm,
      cursor: 'pointer',
      fontWeight: 500,
      lineHeight: 1.4,
      ...buttonVariants[variant],
      ...buttonSizes[size],
      ...style,
    }}
    {...rest}
  />
);

/* ------------------------------------------------------------------ */
/*  IconButton                                                        */
/* ------------------------------------------------------------------ */

interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  active?: boolean;
  activeColor?: string;
  size?: number;
}

export const IconButton: React.FC<IconButtonProps> = ({
  active = false,
  activeColor = 'rgba(255,255,255,0.1)',
  size = 36,
  style,
  type = 'button',
  ...rest
}) => (
  <button
    type={type}
    style={{
      width: size,
      height: size,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: active ? activeColor : 'transparent',
      border: 'none',
      borderRadius: borderRadius.full,
      cursor: 'pointer',
      padding: 0,
      color: 'inherit',
      ...style,
    }}
    {...rest}
  />
);
