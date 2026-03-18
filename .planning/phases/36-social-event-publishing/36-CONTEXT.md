# Phase 36: Social Event Publishing - Context

**Gathered:** 2026-03-18
**Status:** Ready for planning

<domain>
## Phase Boundary

Every social mutation in social-api (room join/leave, follow/unfollow, reaction/like, post created, comment created) publishes a typed event to the EventBridge custom bus with full payload and timestamp, replacing fire-and-forget direct writes. The EventBridge bus and SQS queues are already provisioned (Phase 35).

</domain>

<decisions>
## Implementation Decisions

### Publishing Pattern
- **Error strategy:** Log-and-continue — mutation HTTP response succeeds even if `putEvents` throws. EventBridge is observability, not the source of truth; event failure must not break the user-facing API.
- **Helper location:** Create a shared `publishSocialEvent()` function in `social-api/src/lib/aws-clients.ts`. Keeps all routes clean, one place for bus name config and error handling.
- **Bus name source:** `EVENT_BUS_NAME` environment variable with default `social-events` — consistent with LocalStack/prod parity pattern used throughout Phase 34-35.
- **Publish timing:** After successful DynamoDB write — prevents phantom events if the DB write fails.

### Event Coverage
- **Mutations that publish:** All 5 categories (matches all 4 success criteria):
  - `social.room.join` / `social.room.leave` — room membership changes
  - `social.follow` / `social.unfollow` — social graph mutations
  - `social.reaction` / `social.like` — engagement events
  - `social.post.created` — new posts
  - `social.comment.created` — new comments
- **Payload depth:** Minimal identifiers only — userId, targetId, roomId, contentId, timestamp. No full object bodies in the event payload.
- **Source field:** `social-api` for all events (not per-route source names).

### Claude's Discretion
- Exact TypeScript signature of `publishSocialEvent()` helper
- Detail-type string format (use `social.room.join` prefix matching consistent with Phase 35 EventBridge rules)
- Which specific handler functions within each route file get the publish call

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `social-api/src/lib/aws-clients.ts` — already exports `eventBridgeClient`; `publishSocialEvent()` helper goes here
- `social-api/src/routes/` — 11 route files; mutations to instrument: rooms.ts, room-members.ts, follows (in social.ts or profiles.ts), reactions.ts, likes.ts, posts.ts, comments.ts
- `config/localstack.env` — add `EVENT_BUS_NAME=social-events` here

### Established Patterns
- All routes import from `'../lib/aws-clients'` — same pattern for new helper
- Mutations use async/await with try/catch and `res.status(N).json({...})` response pattern
- DynamoDB writes use `docClient.send(new PutCommand({...}))`

### Integration Points
- EventBridge bus `social-events` (provisioned in Phase 35 bootstrap)
- EventBridge routing rules match on `detail-type` prefix (Phase 35) — event types must use `social.*` prefix
- Phase 37 (Activity Log Lambda) consumes from SQS; correct `detail-type` routing is critical

</code_context>

<specifics>
## Specific Ideas

No specific UI or format requirements. Implementation follows Phase 35 routing rule patterns: `social.room.*`, `social.follow`, `social.unfollow`, `social.reaction`, `social.like`, `social.post.created`, `social.comment.created`.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>
