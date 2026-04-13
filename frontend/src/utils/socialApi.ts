// frontend/src/utils/socialApi.ts
//
// Shared helper for social API availability.
// When the social API URL is not configured or unreachable,
// hooks should silently no-op instead of spamming console errors.

const url = (import.meta.env as Record<string, string>).VITE_SOCIAL_API_URL ?? '';

/** The configured social API base URL. Empty string = same-origin (use proxy). */
export const SOCIAL_API_URL = url;

/** Whether the social API is available (always true — empty URL uses same-origin proxy). */
export const isSocialApiConfigured = true;

let _reachable: boolean | null = null;
let _checkPromise: Promise<boolean> | null = null;

/**
 * Probe the social API once. Returns true if reachable, false otherwise.
 * Result is cached for the lifetime of the page.
 */
export function checkSocialApiReachable(): Promise<boolean> {
  if (_reachable !== null) return Promise.resolve(_reachable);
  if (_checkPromise) return _checkPromise;

  if (!isSocialApiConfigured) {
    _reachable = false;
    return Promise.resolve(false);
  }

  _checkPromise = fetch(`${url}/api/rooms`, { method: 'HEAD', signal: AbortSignal.timeout(2000) })
    .then(() => { _reachable = true; return true; })
    .catch(() => { _reachable = false; return false; })
    .finally(() => { _checkPromise = null; });

  return _checkPromise;
}

/**
 * Wrapper for fetch that silently returns null when the social API is unreachable.
 * Use instead of raw fetch() in social hooks.
 */
export async function socialFetch(path: string, options?: RequestInit): Promise<Response | null> {
  if (!isSocialApiConfigured) return null;

  const reachable = await checkSocialApiReachable();
  if (!reachable) return null;

  try {
    return await fetch(`${url}${path}`, options);
  } catch {
    // Network error — mark as unreachable for subsequent calls
    _reachable = false;
    return null;
  }
}
