// frontend/src/config/gateway.ts
import type { GatewayConfig } from '../types/gateway';

/**
 * Read gateway connection config from Vite env vars.
 * Throws a descriptive error if required vars are missing so developers
 * get an actionable message instead of a silent connection failure.
 *
 * VITE_COGNITO_TOKEN is optional — when using the in-app login form (the
 * default), cognitoToken is supplied at runtime via useAuth.idToken and
 * callers spread it over this config. The env var remains for legacy
 * local-dev token bypass only.
 */
export function getGatewayConfig(): GatewayConfig {
  const wsUrl = import.meta.env.VITE_WS_URL as string | undefined;
  const cognitoToken = (import.meta.env.VITE_COGNITO_TOKEN as string | undefined) ?? '';
  const defaultChannel = (import.meta.env.VITE_DEFAULT_CHANNEL as string | undefined) ?? 'general';

  if (!wsUrl) {
    throw new Error(
      'Missing VITE_WS_URL. Copy frontend/.env.example to frontend/.env and fill in the WebSocket URL.'
    );
  }

  return { wsUrl, cognitoToken, defaultChannel };
}
