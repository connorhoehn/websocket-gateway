// frontend/src/config/gateway.ts
import type { GatewayConfig } from '../types/gateway';

/**
 * Read gateway connection config from Vite env vars.
 * Throws a descriptive error if required vars are missing so developers
 * get an actionable message instead of a silent connection failure.
 */
export function getGatewayConfig(): GatewayConfig {
  const wsUrl = import.meta.env.VITE_WS_URL as string | undefined;
  const cognitoToken = import.meta.env.VITE_COGNITO_TOKEN as string | undefined;
  const defaultChannel = (import.meta.env.VITE_DEFAULT_CHANNEL as string | undefined) ?? 'general';

  if (!wsUrl) {
    throw new Error(
      'Missing VITE_WS_URL. Copy frontend/.env.example to frontend/.env and fill in the WebSocket URL.'
    );
  }
  if (!cognitoToken) {
    throw new Error(
      'Missing VITE_COGNITO_TOKEN. Add your Cognito JWT to frontend/.env (obtain via aws cognito-idp initiate-auth).'
    );
  }

  return { wsUrl, cognitoToken, defaultChannel };
}
