/**
 * Shared simulation helpers for activity simulation scripts.
 * Provides Cognito user provisioning, API call wrappers, and structured logging.
 */

import {
  CognitoIdentityProviderClient,
  AdminCreateUserCommand,
  AdminSetUserPasswordCommand,
  InitiateAuthCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { readFileSync } from 'fs';
import { join } from 'path';

// ── Types ────────────────────────────────────────────────────────────────────

export interface CognitoConfig {
  region: string;
  poolId: string;
  clientId: string;
}

export interface SimUser {
  email: string;
  password: string;
  userId: string;
  token: string;
  displayName: string;
}

export interface ActionLog {
  timestamp: string;
  actor: string;
  action: string;
  resource: string;
  result: 'ok' | 'error' | 'skip';
  error?: string;
  statusCode?: number;
  stats?: Record<string, unknown>;
}

// ── Environment Loading ──────────────────────────────────────────────────────

export function loadEnvReal(repoRoot: string): CognitoConfig {
  const envPath = join(repoRoot, '.env.real');
  let content: string;
  try {
    content = readFileSync(envPath, 'utf8');
  } catch {
    throw new Error(`.env.real not found at ${envPath}`);
  }

  const get = (key: string): string => {
    const match = content.match(new RegExp(`^${key}=(.+)$`, 'm'));
    return match ? match[1].replace(/["']/g, '').trim() : '';
  };

  const region = get('COGNITO_REGION');
  const poolId = get('COGNITO_USER_POOL_ID');
  const clientId = get('COGNITO_CLIENT_ID');

  const missing: string[] = [];
  if (!region) missing.push('COGNITO_REGION');
  if (!poolId) missing.push('COGNITO_USER_POOL_ID');
  if (!clientId) missing.push('COGNITO_CLIENT_ID');

  if (missing.length > 0) {
    throw new Error(`Missing values in .env.real: ${missing.join(', ')}`);
  }

  return { region, poolId, clientId };
}

// ── Cognito User Provisioning ────────────────────────────────────────────────

export async function createSimUser(
  config: CognitoConfig,
  index: number,
): Promise<SimUser> {
  const email = `sim-user-${index}-${Date.now()}@sim.local`;
  const password = `SimPass1!${index}`;
  const displayName = `Sim User ${index}`;

  const client = new CognitoIdentityProviderClient({ region: config.region });

  // Step 1: Create user with temporary password
  await client.send(
    new AdminCreateUserCommand({
      UserPoolId: config.poolId,
      Username: email,
      TemporaryPassword: password,
      MessageAction: 'SUPPRESS',
    }),
  );

  // Step 2: Set permanent password
  await client.send(
    new AdminSetUserPasswordCommand({
      UserPoolId: config.poolId,
      Username: email,
      Password: password,
      Permanent: true,
    }),
  );

  // Step 3: Authenticate to get JWT
  const authResult = await client.send(
    new InitiateAuthCommand({
      AuthFlow: 'USER_PASSWORD_AUTH',
      AuthParameters: {
        USERNAME: email,
        PASSWORD: password,
      },
      ClientId: config.clientId,
    }),
  );

  const idToken = authResult.AuthenticationResult?.IdToken;
  if (!idToken) {
    throw new Error(`No IdToken returned for ${email}`);
  }

  // Parse JWT payload to extract sub (userId)
  const payloadSegment = idToken.split('.')[1];
  const payload = JSON.parse(
    Buffer.from(payloadSegment, 'base64url').toString(),
  );
  const userId = payload.sub as string;

  if (!userId) {
    throw new Error(`No sub claim in JWT for ${email}`);
  }

  return { email, password, userId, token: idToken, displayName };
}

// ── Structured Logging ───────────────────────────────────────────────────────

export function logAction(log: ActionLog): void {
  process.stdout.write(JSON.stringify(log) + '\n');
}

// ── API Call Wrapper ─────────────────────────────────────────────────────────

export async function apiCall(
  method: string,
  path: string,
  token: string,
  body?: unknown,
): Promise<{ ok: boolean; status: number; data: any }> {
  const resp = await fetch(`http://localhost:3001${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = await resp.json().catch(() => null);
  return { ok: resp.ok, status: resp.status, data };
}

// ── Argument Parsing ─────────────────────────────────────────────────────────

export function parseArgs(argv: string[]): { users: number; duration: number } {
  let users = 5;
  let duration = 60;

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--users' && i + 1 < argv.length) {
      users = parseInt(argv[i + 1], 10);
      if (isNaN(users) || users < 1) users = 5;
    }
    if (argv[i] === '--duration' && i + 1 < argv.length) {
      duration = parseInt(argv[i + 1], 10);
      if (isNaN(duration) || duration < 1) duration = 60;
    }
  }

  return { users, duration };
}

// ── Utilities ────────────────────────────────────────────────────────────────

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
