/**
 * Phase 12 identity utility — shared color and initials helpers.
 *
 * identityToColor: maps an identifier (email preferred for cross-session
 * stability, clientId as fallback) to a deterministic color from the palette.
 * Uses the same djb2 hash algorithm that was duplicated across all cursor
 * components so that colors remain consistent after the migration.
 *
 * identityToInitials: derives a two-character display abbreviation from a
 * displayName string. Parses "First Last" → "FL", single word → first two
 * chars, empty → "?".
 */

// ---------------------------------------------------------------------------
// Internal constants
// ---------------------------------------------------------------------------

const COLOR_PALETTE = [
  '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FECA57',
  '#FF9FF3', '#54A0FF', '#5F27CD', '#00D2D3', '#FF9F43',
  '#1DD1A1', '#F368E0', '#3742FA', '#2F3542', '#FF3838',
];

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

/**
 * Returns a deterministic color for an identifier (email or clientId).
 * Stable across sessions as long as the identifier is the same.
 */
export function identityToColor(identifier: string): string {
  let hash = 0;
  for (let i = 0; i < identifier.length; i++) {
    hash = identifier.charCodeAt(i) + ((hash << 5) - hash);
  }
  return COLOR_PALETTE[Math.abs(hash) % COLOR_PALETTE.length];
}

/**
 * Returns a two-character uppercase initials string from a display name.
 *
 * Rules:
 * - Empty string → "?"
 * - Name with space → first char of first word + first char of last word
 * - Single word → first two characters (or just first if only one char)
 * - Always uppercase, max 2 chars
 *
 * Examples: "Jane Doe" → "JD", "jane" → "JA", "j" → "J", "" → "?"
 */
export function identityToInitials(displayName: string): string {
  if (!displayName) return '?';

  const parts = displayName.trim().split(/\s+/);
  if (parts.length >= 2) {
    const first = parts[0][0] ?? '';
    const last = parts[parts.length - 1][0] ?? '';
    return (first + last).toUpperCase();
  }

  // Single word: take first two characters
  return displayName.slice(0, 2).toUpperCase();
}
