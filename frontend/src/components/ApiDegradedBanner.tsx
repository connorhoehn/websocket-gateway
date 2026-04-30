// frontend/src/components/ApiDegradedBanner.tsx
//
// Top-of-content banner shown when the social-api /health rollup reports a
// degraded state. Distinct from the WebSocket "Disconnected" indicator in
// ConnectionStatus — REST can fail while the WS gateway is fine, and vice
// versa. Reusable from any layout that already calls `useApiHealth()`.

import type { ApiHealthSnapshot } from '../hooks/useApiHealth';

interface ApiDegradedBannerProps {
  health: ApiHealthSnapshot;
}

export function ApiDegradedBanner({ health }: ApiDegradedBannerProps) {
  if (health.status !== 'degraded') return null;

  const detail = health.failing.length > 0
    ? `Affected: ${health.failing.join(', ')}.`
    : 'Some dependencies are unreachable.';

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="api-degraded-banner"
      style={{
        background: '#fef3c7',
        border: '1px solid #f59e0b',
        borderRadius: 6,
        color: '#78350f',
        padding: '8px 14px',
        fontSize: 13,
        fontFamily: 'system-ui, -apple-system, sans-serif',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
      }}
    >
      <span style={{ fontSize: 16 }} aria-hidden="true">⚠</span>
      <span style={{ fontWeight: 600 }}>Backend services degraded — some features unavailable.</span>
      <span style={{ color: '#92400e', fontWeight: 400 }}>{detail}</span>
    </div>
  );
}
