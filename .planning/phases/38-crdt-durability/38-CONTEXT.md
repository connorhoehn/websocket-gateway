# Phase 38: CRDT Durability - Context

**Gathered:** 2026-03-18
**Status:** Ready for planning

<domain>
## Phase Boundary

CRDT checkpoint writes flow through the EventBridge pipeline instead of synchronous DynamoDB writes; clients restore document state from the latest snapshot on reconnect; the UI surfaces a dismissible indicator when Y.js resolves a concurrent edit conflict. Three independent plans: 38-01 (backend publish), 38-02 (reconnect recovery), 38-03 (conflict indicator UI).

</domain>

<decisions>
## Implementation Decisions

### Publishing Strategy (CRDT-01)
- **Event type:** `crdt.checkpoint` — separate namespace from `social.*` to avoid routing conflicts with social SQS queues
- **Payload:** `{ channelId, snapshotData (base64), timestamp }` — Lambda consumer needs all three to write the DynamoDB row (PK: documentId, SK: timestamp, snapshot: binary)
- **Error strategy:** Log-and-continue — `writeSnapshot()` failure must not crash the gateway or block the caller; consistent with Phase 36 pattern
- **Lambda:** New `crdt-snapshot` Lambda with its own SQS queue and DLQ — separate concern, following Phase 37 precedent (one Lambda per domain)
- **Write direction:** EventBridge-only — remove the direct `dynamoClient.send(PutItemCommand)` from `writeSnapshot()` in `crdt-service.js`; the Lambda consumer owns the DynamoDB write (SC1: no direct synchronous write from gateway)
- **Source field:** `crdt-service` (matches the originating service name)

### Reconnect Recovery (CRDT-02)
- **Trigger:** Gateway sends snapshot automatically when a client subscribes to a CRDT channel, if a snapshot exists — no separate `getSnapshot` client request needed
- **Client-side:** `useCRDT.ts` already resets Y.Doc and re-subscribes on `connectionState → 'connected'`; the hook just needs to handle the incoming `crdt:snapshot` message that the subscribe response now triggers
- **Ops-delta gap:** No explicit delta replay — the snapshot is the full accumulated Y.js state up to checkpoint time; real-time ops arriving after reconnect are applied normally via the existing `crdt:update` flow
- **Snapshot message type:** Gateway sends `{ type: 'crdt', action: 'snapshot', channel, snapshot: base64, timestamp }` on subscribe — client hook already handles `crdt:snapshot` (line 64 of useCRDT.ts maps `msg.type === 'crdt:snapshot'`)

### Conflict Indicator UI (CRDT-03)
- **Detection:** `ydoc.on('afterTransaction', cb)` in `useCRDT.ts` — check if transaction `origin` is remote (not local) and doc already had content (concurrent edit situation); set a `hasConflict` state flag
- **Position:** Inline banner between toolbar and editor surface in `SharedTextEditor.tsx`
- **Message:** "Edits merged — your changes are preserved"
- **Dismiss:** Manual ✕ button only — no auto-dismiss timer; user should explicitly acknowledge
- **State flow:** `useCRDT` returns `hasConflict: boolean` and `dismissConflict: () => void`; `SharedTextEditor` renders the banner when `hasConflict` is true

### Claude's Discretion
- Exact SQS queue name and EventBridge rule pattern for `crdt.checkpoint` routing
- Lambda handler internal structure (can mirror `activity-log` handler pattern)
- Exact TypeScript interface additions to `UseCRDTReturn` for conflict indicator
- Styling of conflict banner (consistent with existing inline status messages in the editor)

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### CRDT Backend
- `src/services/crdt-service.js` — `writeSnapshot()` (line 347) is the method being replaced; `handleSubscribe()` (line 59) needs to push snapshot on subscribe; `retrieveLatestSnapshot()` (line 244) stays as-is
- `lambdas/activity-log/handler.ts` — reference implementation for SQS Lambda consumer pattern (batch error isolation, DynamoDB write)

### CRDT Frontend
- `frontend/src/hooks/useCRDT.ts` — hook that receives `crdt:snapshot` messages (line 64) and resets Y.Doc on reconnect (line 111); add `hasConflict` / `dismissConflict` here
- `frontend/src/components/SharedTextEditor.tsx` — editor component that receives `hasConflict` prop and renders the dismissible banner

### Event Bus Conventions
- `.planning/phases/36-social-event-publishing/36-CONTEXT.md` — log-and-continue error pattern, `EVENT_BUS_NAME` env var, `source` field conventions
- `.planning/phases/37-activity-log/37-CONTEXT.md` — Lambda consumer pattern, SQS batch error isolation, separate Lambda per concern

No external specs — requirements are fully captured in decisions above and REQUIREMENTS.md (CRDT-01, CRDT-02, CRDT-03).

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/services/crdt-service.js:writeSnapshot()` — replace the `PutItemCommand` call with an EventBridge `putEvents` call; keep the gzip compression and TTL calculation logic in place for the Lambda consumer to use
- `src/services/crdt-service.js:retrieveLatestSnapshot()` — unchanged; still called by `handleGetSnapshot()` for on-demand retrieval
- `lambdas/activity-log/handler.ts` — copy SQS batch loop and per-record try/catch pattern for the new `crdt-snapshot` Lambda
- `frontend/src/hooks/useCRDT.ts` — already handles `crdt:snapshot` messages at line 64; subscribe effect at line 103 resets Y.Doc correctly on reconnect
- `frontend/src/components/SharedTextEditor.tsx` — already has inline status message pattern (line 112, "Disconnected — reconnect to edit"); conflict banner follows same pattern

### Established Patterns
- EventBridge publish: `eventBridgeClient.send(new PutEventsCommand({ Entries: [{ ... }] }))` with `EVENT_BUS_NAME` env var — see Phase 36 helper
- SQS Lambda consumer: receives `event.Records`, iterates with per-record try/catch, writes to DynamoDB via `docClient` — see activity-log handler
- Y.js update flow: updates are gzip-compressed, base64-encoded for transport; Lambda must decompress before DynamoDB write or store compressed

### Integration Points
- `crdt-service.js:writeSnapshot()` → swap DynamoDB write for EventBridge publish; new `crdt-snapshot` SQS queue must be provisioned in LocalStack bootstrap
- `handleSubscribe()` in crdt-service.js → call `retrieveLatestSnapshot()` after subscribe and push result to client if non-null
- `useCRDT.ts:applyLocalEdit()` → no change needed; conflict detection is passive (observes Y.Doc transactions)
- `AppLayout.tsx` / `SharedTextEditor` call site → pass `hasConflict` and `dismissConflict` props down from `useCRDT`

</code_context>

<specifics>
## Specific Ideas

- The `writeSnapshot()` method in `crdt-service.js` already compresses with gzip and calculates TTL — the Lambda consumer should replicate this logic (compress + TTL) when writing to DynamoDB, since the event payload carries raw/base64 snapshot data
- `useCRDT.ts` uses `afterTransaction` rather than `observe` for conflict detection because `observe` fires on every update; `afterTransaction` lets us inspect `transaction.origin` to distinguish local vs remote edits

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 38-crdt-durability*
*Context gathered: 2026-03-18*
