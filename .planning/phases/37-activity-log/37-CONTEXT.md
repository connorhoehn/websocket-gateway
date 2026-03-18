# Phase 37: Activity Log - Context

**Gathered:** 2026-03-18
**Status:** Ready for planning

<domain>
## Phase Boundary

A Lambda consumer persists all social events (from SQS) to a `user-activity` DynamoDB table. A new `GET /api/activity` endpoint on social-api returns the authenticated user's events in reverse-chronological order. A new `ActivityPanel` React component displays these events in the app. This validates the full EventBridge → SQS → Lambda → DynamoDB → API → UI pipeline end-to-end.

</domain>

<decisions>
## Implementation Decisions

### Lambda Consumer
- **DynamoDB key schema:** PK: `userId`, SK: `timestamp#eventId` — supports `Query` by user in reverse-chronological order via `ScanIndexForward: false`
- **Batch error handling:** Log bad records, don't fail entire SQS batch — partial success, valid records persist, bad records are logged with `[activity-log]` prefix and dropped (not retried individually)
- **No TTL or item limit** in Phase 37 — keep all activity records, defer pruning/TTL to a later phase

### API Endpoint
- **Pagination:** `limit=20` default, `lastKey` cursor param (base64-encoded DynamoDB `LastEvaluatedKey`) for next-page traversal — consistent with DynamoDB Query pagination
- **Sort order:** Reverse-chronological (newest first) — `ScanIndexForward: false` on DynamoDB Query
- **No event type filter** in Phase 37 — return all event types, defer `?type=` filtering to a future phase

### React UI
- **Placement:** New `ActivityPanel` component added to the right column of `AppLayout`, below `SocialPanel` — consistent with `GroupPanel`/`SocialPanel` co-location pattern
- **Display format:** Icon + short human-readable description + relative timestamp per event (e.g. "👥 You followed @alice — 2 min ago"). Map each `detail-type` to an icon and description template.
- **Data loading:** Fetch on component mount — simple, consistent with `PostFeed` and `SocialPanel` patterns. No lazy loading.

### Claude's Discretion
- Exact TypeScript interface for activity item response shape
- Icon mapping per event type (emoji is fine)
- `ActivityPanel` internal component structure (single file, unexported internals — matching SocialPanel convention)
- Hook name (e.g. `useActivityLog`)
- How `lastKey` cursor pagination is exposed in the UI (load-more button or none in Phase 37)

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `lambdas/activity-log/handler.ts` — skeleton already exists from Phase 34; needs SQS batch handling + DynamoDB write with correct PK/SK schema
- `social-api/src/lib/aws-clients.ts` — `docClient` already exported; activity endpoint uses it directly
- `frontend/src/components/SocialPanel.tsx` — reference implementation for panel structure (single file, unexported internals, hook-driven)
- `frontend/src/components/PostFeed.tsx` — reference for fetch-on-mount list pattern

### Established Patterns
- Route files in `social-api/src/routes/` use `Router` + async/await + `res.status(N).json({...})`
- React components use hooks (`useState`, `useEffect`) for data fetching
- Auth: `req.user!.sub` on social-api backend; `idToken` prop passed to panels in AppLayout
- AppLayout right column: `SocialPanel` → `GroupPanel` → new `ActivityPanel`

### Integration Points
- `lambdas/activity-log/handler.ts` reads from SQS (event-source-mapping set up in Phase 35 bootstrap.sh)
- `social-api/src/routes/index.ts` — register new `/activity` router here
- `frontend/src/components/AppLayout.tsx` — add `<ActivityPanel idToken={idToken} />` below GroupPanel
- DynamoDB `user-activity` table already provisioned in Phase 34 bootstrap.sh

</code_context>

<specifics>
## Specific Ideas

Event type → display mapping (Claude should use these as a starting point):
- `social.room.join` → "🚪 Joined room [roomId]"
- `social.room.leave` → "🚪 Left room [roomId]"
- `social.follow` → "👥 Followed @[followeeId]"
- `social.unfollow` → "👥 Unfollowed @[followeeId]"
- `social.like` → "❤️ Liked [contentId]"
- `social.reaction` → "[emoji] Reacted to [contentId]"
- `social.post.created` → "📝 Posted in [roomId]"
- `social.comment.created` → "💬 Commented in [roomId]"

</specifics>

<deferred>
## Deferred Ideas

- Event type filtering via `?type=` query param (Phase 37 returns all types)
- TTL / activity record pruning (keep all records in Phase 37)
- Load-more pagination UI (Phase 37 shows first 20 only, no load-more button required)

</deferred>
