# Phase 39: CRDT Integration Fix - Context

**Gathered:** 2026-03-19
**Status:** Ready for planning

<domain>
## Phase Boundary

Fix three integration bugs that prevent the CRDT pipeline from working end-to-end in the LocalStack dev environment: the message type protocol mismatch between gateway and client, the DynamoDB timestamp attribute type mismatch between Lambda writer and gateway reader, and an implicit EVENT_BUS_NAME dependency in crdt-service.js.

Note: MISS-1 (crdt absent from ENABLED_SERVICES) has already been resolved in the working tree — docker-compose.localstack.yml line 56 now includes `crdt` in ENABLED_SERVICES.

</domain>

<decisions>
## Implementation Decisions

### Claude's Discretion
All implementation choices are at Claude's discretion — pure infrastructure bug-fix phase.

Specific fixes required:
1. **MISS-2**: Gateway sends `{type: 'crdt', action: 'snapshot'}`, client expects `msg.type === 'crdt:snapshot'`. Fix: update `crdt-service.js` snapshot send calls to use `type: 'crdt:snapshot'` directly (remove `action` field pattern). Affects lines 123-124 and 258-259 in crdt-service.js.
2. **MISS-4**: `lambdas/crdt-snapshot/handler.ts` line 58 writes `timestamp: String(Date.now())` (DynamoDB S type). `crdt-service.js` line 299 reads `item.timestamp.N` (expects N type). Fix: change Lambda to write `timestamp: Number(Date.now())`.
3. **Tech debt**: `docker-compose.localstack.yml` websocket-gateway service lacks explicit `EVENT_BUS_NAME` env var — add `EVENT_BUS_NAME=social-events` to the websocket-gateway env block.

</decisions>

<code_context>
## Existing Code Insights

### Files to Modify
- `src/services/crdt-service.js` — lines 123-124 and 258-259: snapshot send calls using `{type:'crdt', action:'snapshot'}` pattern
- `lambdas/crdt-snapshot/handler.ts` — line 58: `timestamp: String(Date.now())`
- `docker-compose.localstack.yml` — websocket-gateway env block: add `EVENT_BUS_NAME=social-events`

### Established Patterns
- useCRDT.ts uses `msg.type === 'crdt:snapshot'` (colon-separated type, no action field) — consistent with how other services format their messages
- crdt-service.js reads timestamp via `item.timestamp.N` and parseInt — expects DynamoDB Number type

### Integration Points
- These fixes unblock CRDT-01 (checkpoint pipeline), CRDT-02 (reconnect recovery), CRDT-03 (conflict indicator) working in LocalStack

</code_context>

<specifics>
## Specific Ideas

No design decisions — these are exact bug fixes with a single correct answer per issue.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>
