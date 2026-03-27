# Phase 44: Real-time Activity Push - Context

**Gathered:** 2026-03-27
**Status:** Ready for planning

<domain>
## Phase Boundary

This phase makes the activity feed live: events flow from the activity-log Lambda through Redis pub/sub to the WebSocket gateway and into the React ActivityPanel — no polling, no refresh required. Delivers the real-time backbone needed for the "big brother" simulation view.

</domain>

<decisions>
## Implementation Decisions

### Lambda Redis Connection & Publishing
- Module-level Redis client singleton (reuse on warm Lambda starts) — matches BroadcastService pattern in social-api
- Publish from the existing activity-log Lambda after DynamoDB write — no new fan-out Lambda; confirms write succeeded before publish
- Check `sMembers` for subscriber nodes first; skip Redis publish when no clients are subscribed

### React Hook & UI Behavior
- Subtle "Live" dot indicator on ActivityPanel when WebSocket subscription is active — low effort, useful UX signal
- Cap live feed at 50 items (prepend new events + slice) — prevents unbounded memory growth
- Dedup live events using timestamp+eventType guard on prepend — simple and sufficient
- No REST re-fetch on WebSocket reconnect (only hydrate on mount) — avoids duplicates

### Gateway Service Architecture
- New ActivityService mirroring SocialService exactly — subscribe/unsubscribe/disconnect pattern
- Always registered (not gated by ENABLED_SERVICES env var) — same as SocialService
- User-scoped channel naming: `activity:${userId}` — ensures privacy (users only receive their own events)

### Claude's Discretion
- Exact "Live" indicator styling (color, position, animation)
- Error handling for Redis publish failures in Lambda (log and continue vs retry)
- ActivityService internal logging verbosity

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/services/social-service.js` — exact pattern for subscribe/unsubscribe/disconnect channel management
- `social-api/src/services/broadcast.ts` — Redis publish envelope format (`channel_message` type with `targetNodes`)
- `frontend/src/hooks/useChat.ts` — React subscribe-on-mount / onMessage / cleanup pattern
- `frontend/src/components/ActivityPanel.tsx` — existing `useActivityLog` hook (REST-only, to be replaced)
- `lambdas/activity-log/handler.ts` — DynamoDB write location where Redis publish will be inserted

### Established Patterns
- Gateway services register in `server.js` `initializeServices()` via `this.services.set('name', instance)`
- Redis pub/sub channel key: `websocket:route:${channelId}` with node set at `websocket:channel:${channelId}:nodes`
- `channel_message` envelope: `{ type, channel, message, excludeClientId, fromNode, seq, timestamp, targetNodes }`
- Message validator whitelist at `src/validators/message-validator.js` line 23 — must add `'activity'`

### Integration Points
- `src/validators/message-validator.js` `allowedServices` array — add `'activity'`
- `src/server.js` `initializeServices()` — register ActivityService
- `src/server.js` `handleClientDisconnect()` — call `activityService.handleDisconnect()`
- `lambdas/activity-log/handler.ts` after `PutCommand` — insert `publishActivityEvent()`
- `frontend/src/components/ActivityPanel.tsx` — replace `useActivityLog` with `useActivityFeed`

</code_context>

<specifics>
## Specific Ideas

No specific requirements — open to standard approaches following established codebase patterns.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>
