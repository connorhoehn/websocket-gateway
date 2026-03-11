# Phase 12: Identity Integration - Context

**Gathered:** 2026-03-11
**Status:** Ready for planning

<domain>
## Phase Boundary

Replace raw clientId with real user display name/email in presence, cursors, and chat. Every gateway feature
that currently shows a truncated UUID now shows a human-readable name and consistent initials/color.
Session management and token refresh are Phase 13.

</domain>

<decisions>
## Implementation Decisions

### Display name source
- Decode the Cognito ID token (JWT) client-side to extract `given_name` claim; fallback to email prefix if absent
- JWT decode is pure JS (Base64 split — no library needed): `JSON.parse(atob(idToken.split('.')[1]))`
- Display name priority: `given_name` → `email.split('@')[0]` → `clientId` (last-resort fallback)
- Source: `useAuth.idToken` (already in App.tsx) — extract claims once, pass as `displayName` prop

### Identity propagation (no server changes)
- Client sends its own `displayName` in the `metadata` field of every presence heartbeat
- `metadata: Record<string, unknown>` already flows through the server unchanged and appears in all
  outbound presence/cursor messages — remote clients read `metadata.displayName` to render names
- Server is NOT modified — this stays purely in the frontend layer
- `usePresence` heartbeat: `metadata: { displayName, isTyping }` (add displayName alongside isTyping)
- `useCursors` cursor updates: `metadata: { mode, displayName, ...modeSpecificFields }`
- `useChat` messages: pass `displayName` via the message `data` payload so the sender's name is included
  (server echoes the `data` object back to other subscribers as-is)

### Color consistency (stable across reconnections)
- Hash the user's **email** (not clientId) to determine avatar color
- Email is stable per Cognito user, available in `useAuth.email`, no JWT decode needed
- Rename helpers: `clientIdToColor(clientId)` → `identityToColor(email)` (same hash algorithm, different input)
- Remote users: read `cursor.metadata.displayName` or `user.metadata.displayName` and use the embedded email
  (or fall back to clientId hash for older messages without displayName)

### Initials format
- Parse `displayName` to extract initials:
  - If contains space: take first char of first word + first char of last word → "Jane Doe" → "JD"
  - If no space (email prefix or single name): take first two chars → "jane" → "JA"
- Enforce uppercase, max 2 chars

### Shared identity utility
- Extract `clientIdToColor` / `clientIdToInitials` from all 4 components into a shared utility:
  `frontend/src/utils/identity.ts`
- Export: `identityToColor(identifier: string): string` and `identityToInitials(displayName: string): string`
- All 4 components (PresencePanel, CursorCanvas, TableCursorGrid, TextCursorEditor) import from this utility
- Color uses email as input; initials use displayName as input

### Chat attribution
- `useChat` hook sends a `data.displayName` field alongside each chat message
- Server passes `data` payload through to subscribers verbatim — `ChatMessage.clientId` stays (for keying),
  add optional `displayName?: string` to the `ChatMessage` interface
- Chat UI: render `message.displayName ?? message.clientId.slice(0,8)` as the author label

### Claude's Discretion
- Exact JWT decode implementation (inline vs helper function)
- Chat UI layout for author label (positioning, typography — follow existing inline-style convention)
- Fallback label when displayName is absent but clientId exists (truncation length)

</decisions>

<specifics>
## Specific Ideas

- ROADMAP example: "JD" for "Jane Doe" — this is the target initials format
- AUTH-06: "given_name or email prefix" — both are valid; given_name is preferred
- The server already stores `userContext = { userId: sub, email }` on each connection but does NOT inject
  it into outbound service messages — this is why client-side metadata propagation is the right approach
  for this phase (avoids touching server-side Node.js gateway code)

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- `useAuth.ts`: `idToken` (for JWT decode) and `email` (for color hashing) already in `UseAuthReturn`
- `PresencePanel.tsx`: `clientIdToColor(clientId)` + `clientIdToInitials(clientId)` — refactor to accept displayName/email
- `CursorCanvas.tsx`: Same helpers (exported) — consolidate into `identity.ts` utility
- `TableCursorGrid.tsx`: Same helpers (local) — consolidate into `identity.ts` utility
- `TextCursorEditor.tsx`: Same helpers (local) — consolidate into `identity.ts` utility
- `usePresence.ts`: `PresenceUser.metadata: Record<string, unknown>` — no type change needed, displayName goes here
- `useCursors.ts`: `CursorState.metadata: Record<string, unknown>` — no type change needed
- `useChat.ts`: `ChatMessage` interface needs `displayName?: string` field added
- `App.tsx`: Already has `auth.idToken` and `auth.email` — decode JWT here, pass `displayName` to hooks

### Established Patterns
- Inline styles only (no CSS modules or Tailwind) — consistent with all Phase 6-11 components
- Pure presentational components receive all data via props — no internal `useAuth` calls in components
- `useRef` for values that message handler closures need to read without being torn down (see usePresence)
- Separate handler effect from subscribe effect so handler survives channel changes (usePresence, useChat pattern)
- `sendMessageRef`/`currentChannelRef` pattern for stable callbacks (usePresence, useChat, useReactions)

### Integration Points
- `App.tsx` → decode JWT after `auth.status === 'authenticated'`, derive `displayName`, pass to all hooks
- `usePresence` → add `displayName` to heartbeat metadata
- `useCursors` → add `displayName` to every cursor update metadata
- `useChat` → add `displayName` to message send payload; add `displayName?: string` to `ChatMessage` type
- `PresencePanel.tsx` → render `user.metadata.displayName ?? user.clientId.slice(0,8)` instead of truncated clientId
- `CursorCanvas.tsx`, `TableCursorGrid.tsx`, `TextCursorEditor.tsx` → read `cursor.metadata.displayName`
  for initials; use email (or `cursor.clientId` as fallback) for color

</code_context>

<deferred>
## Deferred Ideas

- None — discussion stayed within phase scope.
- Server-side displayName injection (modifying presence-service.js to read userContext and stamp displayName
  on all outbound messages) is intentionally deferred — cleaner long-term but out of scope for Phase 12.

</deferred>

---

*Phase: 12-identity-integration*
*Context gathered: 2026-03-11*
