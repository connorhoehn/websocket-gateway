// frontend/src/components/shared/EmptyState.tsx
//
// Centered empty-state card. Mirrors the IdlePanel style from
// DocumentTypesPage: 52px emoji, 17px/600 slate-600 headline, 13px/slate-400
// body capped at 340px, optional indigo primary CTA.

export interface EmptyStateProps {
  icon?: string;
  title: string;
  body?: string;
  actionLabel?: string;
  onAction?: () => void;
  /**
   * Optional testid for the container (defaults to "empty-state").
   * Callers with existing tests targeting a specific id can pass it here.
   */
  testId?: string;
  /**
   * Optional testid for the action button (defaults to "empty-state-action").
   */
  actionTestId?: string;
}

function EmptyState({
  icon, title, body, actionLabel, onAction,
  testId = 'empty-state', actionTestId = 'empty-state-action',
}: EmptyStateProps) {
  return (
    <div
      data-testid={testId}
      style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        justifyContent: 'center', height: '100%', color: '#94a3b8', gap: 8,
        padding: '32px', fontFamily: 'inherit',
      }}
    >
      {icon && <div style={{ fontSize: 52, marginBottom: 8 }}>{icon}</div>}
      <div style={{ fontSize: 17, fontWeight: 600, color: '#64748b' }}>{title}</div>
      {body && (
        <div style={{ fontSize: 13, textAlign: 'center', maxWidth: 340, color: '#94a3b8', lineHeight: 1.5 }}>
          {body}
        </div>
      )}
      {actionLabel && onAction && (
        <button
          data-testid={actionTestId}
          onClick={onAction}
          style={{
            marginTop: 10, padding: '9px 22px', fontSize: 14, fontWeight: 600,
            background: '#646cff', color: '#fff', border: 'none',
            borderRadius: 8, cursor: 'pointer', fontFamily: 'inherit',
          }}
        >
          {actionLabel}
        </button>
      )}
    </div>
  );
}

export default EmptyState;
