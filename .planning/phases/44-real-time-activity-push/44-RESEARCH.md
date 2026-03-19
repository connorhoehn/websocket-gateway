# Phase 44: Real-time Activity Push - Research

**Researched:** 2026-03-19
**Domain:** WebSocket fan-out, Redis pub/sub, Lambda→Redis publish, React real-time hooks
**Confidence:** HIGH

---

## Summary

Phase 44 closes the final gap in the activity log pipeline: events are now durably written (Phase 43 outbox) and persisted to DynamoDB (Phase 37 activity-log Lambda), but the ActivityPanel only fetches on mount. This phase makes the feed live by:

1. Adding an `activity` subscription channel to the gateway so clients can subscribe per-user.
2. Wiring the activity-log Lambda (or a thin fan-out Lambda) to publish `activity:event` messages into the gateway via Redis pub/sub after writing to DynamoDB.
3. Replacing the one-shot `useActivityLog` hook in ActivityPanel with a `useActivityFeed` hook that subscribes via WebSocket and appends events without duplicates.

The gateway already has the exact infrastructure needed: `SocialService` proves the pattern for user-scoped subscriptions, `BroadcastService` proves the Redis publish pattern, and `useChat` proves the React side of subscribe-on-mount/append-on-message.

**Primary recommendation:** Mirror the existing `social` service pattern for the gateway subscription service; mirror the `broadcastService` pattern for the Lambda → Redis publish; replace the REST-only `useActivityLog` with `useActivityFeed` that hydrates from REST on mount, then appends live events from `activity:event` WebSocket frames.

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| ALOG-02 | User can query their own activity log via a REST endpoint on social-api | Already implemented in Phase 37 (`GET /api/activity`). Phase 44 adds the live WebSocket layer on top — the REST endpoint remains as the hydration source on mount. |
| real-time UX | Activity feed updates live within 2 seconds without user interaction | Requires Lambda→Redis publish after DynamoDB write, gateway activity channel broadcast, and React hook that appends frames to the existing list. |
</phase_requirements>

---

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| redis (npm) | Already installed in gateway (see server.js) | Gateway pub/sub subscriber; publish from Lambda | All other cross-service fan-out in this project uses Redis |
| @aws-sdk/client-dynamodb | ^3.1010.0 (installed in activity-log Lambda) | Already used by activity-log Lambda for DynamoDB write | No new dep needed |
| react (useState, useEffect, useRef) | Already in frontend | Hook state management | Same pattern as useChat, useCRDT |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| createClient (redis npm) | Already installed | Lambda uses a plain redis client to publish after DynamoDB write | Needed only if fan-out is added to the activity-log Lambda |

No new npm packages are required for this phase. All dependencies are already present.

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Lambda publishes directly to Redis after DynamoDB write | New fan-out Lambda | Adding Redis publish to the existing activity-log Lambda is simpler; a second Lambda adds deploy complexity for no isolation benefit at this scale |
| User-scoped channel per userId | Single broadcast channel for all users | User-scoped channel (`activity:${userId}`) avoids delivering other users' events to the wrong client — mandatory for privacy |
| WebSocket-only live feed | Polling at 2s interval | WebSocket fan-out is < 50ms latency; polling is fragile, wastes connections, and conflicts with the "no polling" success criterion |

---

## Architecture Patterns

### Recommended Project Structure

No new directories needed. Changes touch:
```
src/services/            # New activity-service.js (mirrors social-service.js)
src/validators/message-validator.js   # Add 'activity' to allowedServices array
lambdas/activity-log/handler.ts       # Add Redis publish after DynamoDB PutCommand
frontend/src/hooks/                   # New useActivityFeed.ts (replaces inline hook)
frontend/src/components/ActivityPanel.tsx   # Switch to useActivityFeed
```

### Pattern 1: User-scoped Activity Channel

Each user subscribes to a channel named after their Cognito userId:

```
channel = `activity:${userId}`   // e.g., "activity:abc123def456"
```

The client sends `{ service: 'activity', action: 'subscribe', channelId: 'activity:<userId>' }` on mount. The gateway ActivityService registers this channel in the message-router (same as SocialService does with `messageRouter.subscribeToChannel`). The Lambda publishes to `websocket:route:activity:<userId>`.

### Pattern 2: Gateway ActivityService (mirrors SocialService)

```javascript
// src/services/activity-service.js
// Source: mirrors social-service.js exactly
class ActivityService {
  constructor(messageRouter, logger) {
    this.messageRouter = messageRouter;
    this.logger = logger;
    this.clientChannels = new Map(); // clientId -> Set<channelId>
  }

  async handleAction(clientId, action, data) {
    switch (action) {
      case 'subscribe':   return this.handleSubscribe(clientId, data);
      case 'unsubscribe': return this.handleUnsubscribe(clientId, data);
      default: this.sendError(clientId, `Unknown activity action: ${action}`);
    }
  }

  async handleSubscribe(clientId, { channelId }) {
    await this.messageRouter.subscribeToChannel(clientId, channelId);
    // track + ack (same as social-service.js lines 43-58)
  }

  async handleDisconnect(clientId) {
    // cleanup (same as social-service.js lines 87-100)
  }
}
module.exports = ActivityService;
```

### Pattern 3: Lambda Redis Publish (mirrors BroadcastService)

After the existing DynamoDB PutCommand in `activity-log/handler.ts`, publish to Redis:

```typescript
// Source: mirrors social-api/src/services/broadcast.ts
import { createClient } from 'redis';

const REDIS_URL = `redis://${process.env.REDIS_ENDPOINT ?? 'redis'}:${process.env.REDIS_PORT ?? '6379'}`;

async function publishActivityEvent(userId: string, eventType: string, detail: Record<string, unknown>, timestamp: string) {
  const channelId = `activity:${userId}`;
  const nodesKey = `websocket:channel:${channelId}:nodes`;

  const redis = createClient({ url: REDIS_URL });
  await redis.connect();

  const targetNodes = await redis.sMembers(nodesKey);
  if (targetNodes.length === 0) return; // no subscribers, skip

  const envelope = {
    type: 'channel_message',
    channel: channelId,
    message: {
      type: 'activity:event',
      channel: channelId,
      payload: { eventType, detail, timestamp },
      timestamp: new Date().toISOString(),
    },
    excludeClientId: null,
    fromNode: 'activity-log-lambda',
    seq: 0,
    timestamp: new Date().toISOString(),
    targetNodes,
  };

  await redis.publish(`websocket:route:${channelId}`, JSON.stringify(envelope));
  await redis.quit();
}
```

**Critical note on the `channel_message` envelope format:** The gateway's `handleChannelMessage` (message-router.js lines 532-548) checks `data.type === 'channel_message'` and `data.targetNodes.includes(this.nodeManager.nodeId)`. The message inside `data.message` is delivered verbatim to clients. The envelope must match this shape exactly.

### Pattern 4: useActivityFeed React Hook (mirrors useChat)

```typescript
// frontend/src/hooks/useActivityFeed.ts
// Source: mirrors useChat.ts subscribe/onMessage/cleanup pattern
export function useActivityFeed(options: { sendMessage, onMessage, connectionState, idToken, userId }) {
  const [items, setItems] = useState<ActivityItem[]>([]);

  // 1. Hydrate from REST on mount (keep existing useActivityLog logic)
  useEffect(() => {
    if (!idToken) return;
    fetch(`${SOCIAL_API_URL}/api/activity?limit=20`, { headers: { Authorization: `Bearer ${idToken}` } })
      .then(r => r.json())
      .then((data: ActivityResponse) => setItems(data.items));
  }, [idToken]);

  // 2. Subscribe to WebSocket channel when connected
  useEffect(() => {
    if (connectionState !== 'connected' || !userId) return;
    const channelId = `activity:${userId}`;
    sendMessage({ service: 'activity', action: 'subscribe', channelId });
    return () => {
      sendMessage({ service: 'activity', action: 'unsubscribe', channelId });
    };
  }, [connectionState, userId]);

  // 3. Append live events — deduplicate by timestamp+eventType
  useEffect(() => {
    const unregister = onMessage((msg: GatewayMessage) => {
      if (msg.type !== 'activity:event') return;
      const payload = msg.payload as { eventType: string; detail: unknown; timestamp: string };
      setItems(prev => {
        // Dedup: skip if first item already has same timestamp+eventType
        if (prev[0]?.timestamp === payload.timestamp && prev[0]?.eventType === payload.eventType) return prev;
        return [{ eventType: payload.eventType, timestamp: payload.timestamp, detail: payload.detail }, ...prev].slice(0, 50);
      });
    });
    return unregister;
  }, [onMessage]);

  return { items };
}
```

### Pattern 5: Validator Whitelist Update

The `src/validators/message-validator.js` `allowedServices` array MUST include `'activity'`:

```javascript
// Current (line 23):
this.allowedServices = ['chat', 'presence', 'cursor', 'reaction', 'social'];

// Required for Phase 44:
this.allowedServices = ['chat', 'presence', 'cursor', 'reaction', 'social', 'activity'];
```

Without this, the gateway rejects `{ service: 'activity', action: 'subscribe' }` with `INVALID_MESSAGE_SERVICE`.

### Pattern 6: Service Registration in server.js

```javascript
// In initializeServices() — add after socialService registration:
const ActivityService = require('./services/activity-service');
const activityService = new ActivityService(this.messageRouter, this.logger);
this.services.set('activity', activityService);
```

Also add `'activity'` to `handleClientDisconnect` teardown if services expose `handleDisconnect` (social-service does — same pattern applies).

### Pattern 7: ENABLED_SERVICES env var

`docker-compose.localstack.yml` currently sets:
```
ENABLED_SERVICES=chat,presence,cursor,reaction,crdt
```
The social service is registered unconditionally (not gated by ENABLED_SERVICES). Activity service should follow the same pattern — always registered, not gated.

### Anti-Patterns to Avoid

- **Polling for live updates:** The success criterion explicitly bans polling. Do not use `setInterval` fetch in `useActivityFeed`.
- **Sending activity events to a room channel:** Activity events are user-scoped, not room-scoped. Using `activity:${userId}` as the channel key ensures users only receive their own events.
- **Re-using the social channel for activity events:** The `social` service channel is room-scoped; activity is user-scoped. They must be separate channels and services.
- **Publishing from the outbox-relay Lambda instead of activity-log Lambda:** The outbox-relay writes to SQS and marks PROCESSED — it does not know if activity-log succeeded. Only the activity-log Lambda (which actually wrote to DynamoDB) should publish to Redis, ensuring at-least-once delivery with a DynamoDB write already confirmed.
- **Forgetting to `redis.quit()` in Lambda:** Lambda reuses execution contexts; if the Redis client is not disconnected after publish, subsequent invocations share a stale/broken connection. Either reuse a module-level client with proper reconnect, or `quit()` after each invocation.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Per-user channel fan-out | Custom notification routing table | Redis `websocket:channel:${channelId}:nodes` SET + gateway message-router | Gateway already maintains this SET; BroadcastService shows the exact publish pattern |
| Dedup of live events | Complex client-side event store | Prepend + slice(0, 50) with timestamp+eventType guard | Simple array prepend with a length cap is sufficient; no CRDT or event sourcing needed |
| Lambda Redis client lifecycle | Reconnect logic | Module-level client singleton with `lazyConnect: true` + per-call connect check | Same pattern as BroadcastService in social-api |

---

## Common Pitfalls

### Pitfall 1: `channel_message` envelope shape mismatch

**What goes wrong:** Lambda publishes a Redis message that does not match the `channel_message` envelope shape. The gateway's `handleChannelMessage` silently drops it (the `if (data.type === 'channel_message')` guard fails).

**Why it happens:** Copying from the wrong place — the gateway publishes `channel_message` envelopes internally but the Lambda must publish the same outer envelope shape that the gateway's subscriber expects.

**How to avoid:** Copy the envelope structure verbatim from `social-api/src/services/broadcast.ts` lines 83-97. The envelope has `type: 'channel_message'`, `channel`, `message` (the actual payload), `fromNode`, `targetNodes`, `seq`, `timestamp`.

**Warning signs:** Gateway log shows no `handleChannelMessage` calls; client never receives `activity:event` frames.

### Pitfall 2: Empty `targetNodes` skips publish silently

**What goes wrong:** Lambda publishes to Redis but no clients receive the event. `sMembers(nodesKey)` returns an empty array because no clients have subscribed yet or the channel key is wrong.

**Why it happens:** The channel key in the Lambda (`activity:${userId}`) must exactly match the channel the client subscribes to. If the client subscribes to `activity:abc123` but the Lambda looks up `websocket:channel:activity:xyz999:nodes`, the SET is always empty.

**How to avoid:** The userId used as the channel suffix in the Lambda must come from the same field as what the React hook constructs its channelId from. In the frontend, `userId` comes from the Cognito JWT `sub` claim (via `useAuth` hook). In the Lambda, `userId` comes from `detail.userId ?? detail.followerId ?? detail.authorId` — the same field used in the DynamoDB PutCommand. Both sides must agree on the same value.

**Warning signs:** Lambda logs show `targetNodes.length === 0` on every invocation even when the UI is open.

### Pitfall 3: `useActivityFeed` receives duplicates on reconnect

**What goes wrong:** When WebSocket reconnects, the hook re-subscribes and the server may push a snapshot or the REST fetch re-hydrates, creating duplicate items in the list.

**Why it happens:** The REST hydration runs on mount; reconnect does not trigger a re-mount so REST does not re-run. But if the hook were re-mounted (e.g., HMR in dev), both the initial REST fetch and any accumulated live events would be in state.

**How to avoid:** Use a `useRef` seen-set keyed on `${timestamp}#${eventType}` for dedup in the WebSocket message handler. On REST hydration, replace the full array (not append). On live event arrival, only prepend if the event is not already in the list.

### Pitfall 4: Redis connection leak in Lambda

**What goes wrong:** Lambda creates a new Redis connection per invocation and never calls `quit()`. After thousands of invocations, Redis max-connection limit is hit.

**Why it happens:** Lambda execution contexts are frozen between invocations. A dangling TCP connection is not closed automatically.

**How to avoid:** Either (a) use a module-level Redis client with a reconnect strategy and skip `quit()` — this is the BroadcastService pattern (connection reused across calls in the same execution context), or (b) call `redis.quit()` in a `finally` block after publish. Option (a) is preferred for throughput.

### Pitfall 5: `activity` service missing from validator whitelist

**What goes wrong:** Client sends `{ service: 'activity', action: 'subscribe', channelId: 'activity:...' }` and receives `INVALID_MESSAGE_SERVICE` error from the gateway.

**Why it happens:** `src/validators/message-validator.js` has a hardcoded `allowedServices` array. New services must be added explicitly.

**How to avoid:** Update `allowedServices` in `message-validator.js` to include `'activity'` before writing the gateway service. This is a two-file change: validator + service.

---

## Code Examples

### BroadcastService Envelope (reference for Lambda publish)
```javascript
// Source: social-api/src/services/broadcast.ts lines 83-99
const envelope = {
  type: 'channel_message',      // MUST be this exact string
  channel: channelId,
  message: {                     // This object is delivered verbatim to the WS client
    type: eventType,             // 'activity:event' for Phase 44
    channel: channelId,
    payload,
    timestamp: new Date().toISOString(),
  },
  excludeClientId: null,
  fromNode: 'activity-log-lambda',
  seq: 0,
  timestamp: new Date().toISOString(),
  targetNodes,                   // array from redis.sMembers(`websocket:channel:${channelId}:nodes`)
};
await redis.publish(`websocket:route:${channelId}`, JSON.stringify(envelope));
```

### SocialService Subscribe Pattern (reference for ActivityService)
```javascript
// Source: src/services/social-service.js lines 36-58
async handleSubscribe(clientId, { channelId }) {
  if (!channelId || typeof channelId !== 'string' || channelId.length === 0 || channelId.length > 100) {
    this.sendError(clientId, 'channelId is required (string, max 100 chars)');
    return;
  }
  await this.messageRouter.subscribeToChannel(clientId, channelId);
  if (!this.clientChannels.has(clientId)) {
    this.clientChannels.set(clientId, new Set());
  }
  this.clientChannels.get(clientId).add(channelId);
  this.sendToClient(clientId, { type: 'activity', action: 'subscribed', channelId, timestamp: new Date().toISOString() });
}
```

### useChat Subscribe Effect (reference for useActivityFeed)
```typescript
// Source: frontend/src/hooks/useChat.ts lines 102-124
useEffect(() => {
  if (connectionState !== 'connected' || !currentChannel) return;
  sendMessage({ service: 'chat', action: 'subscribe', channel: currentChannel });
  setMessages([]);
  return () => {
    sendMessageRef.current({ service: 'chat', action: 'unsubscribe', channel: currentChannel });
  };
}, [currentChannel, connectionState]);
```

### Activity Lambda publish location (where to insert Redis publish)
```typescript
// Source: lambdas/activity-log/handler.ts lines 54-64
await docClient.send(new PutCommand({ ... }));  // existing write
// INSERT HERE: publishActivityEvent(userId, detailType, detail, timestamp)
console.log(`[activity-log] Wrote activity record...`);
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| ActivityPanel polls REST on mount | useActivityFeed: REST hydrate + live WebSocket append | Phase 44 | < 2s latency for live events; no polling |
| Event delivery: outbox → SQS → activity-log → DynamoDB only | Same + Redis publish after DynamoDB write | Phase 44 | ActivityPanel updates live; "big brother" view works |

---

## Open Questions

1. **Lambda Redis connection strategy: module-level vs per-invocation**
   - What we know: BroadcastService (social-api) uses module-level singleton with lazy connect and error-reconnect
   - What's unclear: activity-log Lambda runs in its own container; module-level client works across warm invocations but cold starts add ~50ms connect time
   - Recommendation: Use module-level client (same pattern as BroadcastService) — allows connection reuse on warm invocations. Accept ~50ms cold-start overhead.

2. **Should ActivityPanel show a "live" indicator?**
   - What we know: success criteria only require the feed to update within 2 seconds; no visual indicator specified
   - What's unclear: user delight vs scope creep
   - Recommendation: Defer to Claude's discretion — a subtle dot or "Live" badge is acceptable but not required for the success criteria.

3. **`onMessage` handler signature in useActivityFeed**
   - What we know: `useChat` accepts `onMessage: (handler) => () => void` (returns unregister function) — see useChatOptions
   - What's unclear: ActivityPanel currently does not take `onMessage` as a prop; it needs access to the WebSocket's `onMessage` registrar
   - Recommendation: Pass `sendMessage`, `onMessage`, `connectionState`, and `userId` as props to `ActivityPanel` (or to the new `useActivityFeed` hook called inside ActivityPanel). The component tree already passes these to `useChat`, `usePresence`, etc. — same pattern applies.

---

## Validation Architecture

Validation is disabled (`nyquist.enabled: false` in `.planning/config.json`). Skip this section.

---

## Sources

### Primary (HIGH confidence)
- `src/services/social-service.js` — subscription service pattern; channel tracking; handleDisconnect
- `social-api/src/services/broadcast.ts` — Redis publish pattern; envelope format; targetNodes lookup
- `src/core/message-router.js` — `subscribeToChannel`, `handleChannelMessage`, Redis channel key format `websocket:route:${channel}`
- `src/validators/message-validator.js` — `allowedServices` whitelist (line 23)
- `frontend/src/hooks/useChat.ts` — React subscribe/onMessage/cleanup pattern
- `frontend/src/components/ActivityPanel.tsx` — existing hook structure; ActivityItem type; formatActivity
- `lambdas/activity-log/handler.ts` — `processEventBridgeEvent`; userId extraction; DynamoDB write location
- `src/server.js` — service registration in `initializeServices()`; `services.set('social', ...)` pattern
- `.planning/phases/43-transactional-outbox/43-02-PLAN.md` — outbox-relay shape; SQS message body format

### Secondary (MEDIUM confidence)
- `src/validators/message-validator.js` note: `crdt` is NOT in `allowedServices` but CRDT works — investigation needed (may be a pre-existing gap in validator coverage, or validator may be bypassed in some path). For Phase 44, explicitly add `'activity'` to be safe.

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all required libs already installed; no new deps
- Architecture: HIGH — exact patterns copied from existing working services (social-service.js, broadcast.ts, useChat.ts)
- Pitfalls: HIGH — envelope format, targetNodes, validator whitelist all identified from direct code inspection

**Research date:** 2026-03-19
**Valid until:** 2026-04-19 (stable codebase; no external API changes expected)
