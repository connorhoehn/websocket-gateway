---
gsd_state_version: 1.0
milestone: v2.0
milestone_name: Social Platform
status: planning
stopped_at: Completed 29-02-PLAN.md
last_updated: "2026-03-17T18:01:26.860Z"
last_activity: 2026-03-16 — v2.0 roadmap created (phases 25-32), v1.5 deferred
progress:
  total_phases: 8
  completed_phases: 5
  total_plans: 10
  completed_plans: 10
  percent: 0
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-03-16)

**Core value:** Real-time collaborative platform with low-cost pub/sub and full social layer (profiles, groups, rooms, posts, reactions) — all Cognito-keyed for cross-app reuse.
**Current focus:** v2.0 — Social Platform, Phase 25: Social Infrastructure

## Current Position

Phase: 25 of 32 (Social Infrastructure)
Plan: 0 of 1 in current phase
Status: Ready to plan
Last activity: 2026-03-16 — v2.0 roadmap created (phases 25-32), v1.5 deferred

Progress: [░░░░░░░░░░░░░░░░░░░░░] 0% (v2.0 phases)

## Performance Metrics

**Velocity (prior milestones):**
- Total plans completed: 25 (across v1.0–v1.4)
- Average duration: ~5 min
- Total execution time: ~2 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 01-04 | 13 | — | ~143-476s |
| 05 | 4 | 1451s | 363s |
| 06-10 | 13 | — | ~97-212s |
| 11-14 | 8 | — | ~21-217s |
| 15-19 | 7 | — | ~2-109s |
| Phase 25-social-infrastructure P01 | 127 | 2 tasks | 10 files |
| Phase 26-user-profiles-social-graph P01 | 300 | 2 tasks | 3 files |
| Phase 26 P03 | 491 | 2 tasks | 2 files |
| Phase 26-user-profiles-social-graph P02 | 725 | 2 tasks | 2 files |
| Phase 27-groups P01 | 124 | 2 tasks | 4 files |
| Phase 27-groups P02 | 62 | 2 tasks | 2 files |
| Phase 28-rooms P01 | 65 | 2 tasks | 2 files |
| Phase 28-rooms P02 | 64 | 2 tasks | 2 files |
| Phase 29-posts-comments P01 | 84 | 1 tasks | 4 files |
| Phase 29-posts-comments P02 | 67 | 2 tasks | 2 files |

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Key decisions affecting v2.0 work:

- [v2.0 start]: v1.5 Production Hardening (phases 20-24) deferred — social layer ships first
- [v2.0 arch]: New `social-api` Express service in separate CDK stack (`lib/social-stack.ts`)
- [v2.0 arch]: Cognito auth middleware reused from existing gateway — no new auth implementation
- [v2.0 arch]: All social DynamoDB tables keyed on Cognito `sub` for cross-app referential integrity
- [v2.0 arch]: Rooms map to WebSocket channel IDs — gateway extended with social event types, not replaced
- [v2.0 frontend]: Borrow patterns from `../threaded_discussions` UI for React hooks and components
- [Phase 25-social-infrastructure]: SocialStack: PAY_PER_REQUEST + RemovalPolicy.RETAIN for all 9 DynamoDB tables
- [Phase 25-social-infrastructure]: social-api: express.d.ts force-added past *.d.ts gitignore — module augmentation is a source file
- [Phase 25-social-infrastructure]: social-api: /health route mounted before requireAuth — health endpoint publicly accessible
- [Phase 26]: DynamoDBDocumentClient used for automatic JS-to-DynamoDB type marshalling
- [Phase 26]: PUT /api/profiles uses dynamic UpdateExpression to preserve unspecified fields
- [Phase 26]: GET /api/profiles/:userId returns 403 (not 404) for private profiles to distinguish access denial from not-found
- [Phase 26]: SocialPanel uses named hook imports matching project convention; all sub-components co-located as unexported internals in SocialPanel.tsx
- [Phase 26]: GET /followers uses ScanCommand (no GSI on followeeId in social-relationships table)
- [Phase 26]: 409 returned on duplicate follow — callers distinguish already-following from new follow
- [Phase 27-groups]: uuid installed at execution time (was missing from social-api) — added to package.json as Rule 3 deviation
- [Phase 27-groups]: DELETE /groups/:groupId does NOT cascade-delete members — cleanup deferred to plan 27-02 per plan spec
- [Phase 27-groups]: GET /groups/:groupId returns 403 for non-members of private groups to conceal group existence
- [Phase 27-groups]: groupMembersRouter mounted at /groups/:groupId (not /groups) to expose groupId via mergeParams
- [Phase 27-groups]: status absence treated as 'active' throughout — owner records from 27-01 have no status field
- [Phase 28-rooms]: POST /api/rooms/dm defined before /:roomId to prevent Express matching 'dm' as roomId param
- [Phase 28-rooms]: groupRoomsRouter uses mergeParams: true to expose :groupId from parent mount
- [Phase 28-rooms]: ExpressionAttributeNames '#t' guards DynamoDB reserved word 'type' in all room FilterExpressions
- [Phase 28-rooms]: myRoomsRouter exported separately — GET /api/rooms cannot live in roomMembersRouter (mounted at /rooms/:roomId); separate mount at /rooms before roomsRouter preserves correct routing order
- [Phase 29-posts-comments]: ULID used for postId — lexicographic sort = chronological order, enabling ScanIndexForward:false for newest-first without secondary index
- [Phase 29-posts-comments]: postsRouter and userPostsRouter wired into index.ts as Rule 2 auto-fix — endpoints unreachable without mounting
- [Phase 29-posts-comments]: commentsRouter uses mergeParams:true — receives :roomId and :postId from parent mount path segments
- [Phase 29-posts-comments]: GET /comments returns flat array; clients group by parentCommentId to reconstruct thread hierarchy
- [Phase 29-posts-comments]: parentCommentId omitted entirely for top-level comments (not null) — absence of field means top-level

### Pending Todos

None yet.

### Blockers/Concerns

None yet.

## Session Continuity

Last session: 2026-03-17T17:58:50.725Z
Stopped at: Completed 29-02-PLAN.md
Resume file: None
