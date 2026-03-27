---
gsd_state_version: 1.0
milestone: v3.0
milestone_name: Durable Event Architecture
status: completed
stopped_at: Completed 46-02-PLAN.md
last_updated: "2026-03-27T23:30:08.858Z"
last_activity: "2026-03-27 — Phase 46 P01 complete: inline error messages, loading spinners, ChannelSelector removed"
progress:
  total_phases: 38
  completed_phases: 33
  total_plans: 74
  completed_plans: 69
  percent: 92
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-03-18)

**Core value:** Real-time collaborative platform with low-cost pub/sub and full social layer (profiles, groups, rooms, posts, reactions) — all Cognito-keyed for cross-app reuse.
**Current focus:** v4.0 — Simulation-Ready Platform (phases 42-47)

## Current Position

Phase: 46 of 47 (UI Polish & Big Brother View) — in progress
Plan: 1 / 2
Status: Phase 46 P01 complete
Last activity: 2026-03-27 — Phase 46 P01 complete: inline error messages, loading spinners, ChannelSelector removed

Progress: [█████████░] 92% (v4.0 phases — 68 of 74 plans complete)

## Performance Metrics

**Velocity (prior milestones):**

- Total plans completed: 37 (across v1.0–v2.1)
- Average duration: ~5 min
- Total execution time: ~3 hours

**By Phase (recent):**

| Phase | Plans | Avg/Plan |
|-------|-------|----------|
| 32. Frontend Social Layer | 4 | ~125s |
| 33. Social UX Integration | 2 | ~77s |
| Phase 34 P01 | 158s | 2 tasks | 18 files |
| Phase 35-event-bus-infrastructure P01 | 2 | 2 tasks | 3 files |
| Phase 35-event-bus-infrastructure P02 | 1 | 2 tasks | 3 files |
| Phase 36 P01 | 78s | 2 tasks | 4 files |
| Phase 36 P02 | 90s | 2 tasks | 5 files |
| Phase 37-activity-log P01 | 57 | 2 tasks | 3 files |
| Phase 37-activity-log P02 | 106 | 2 tasks | 2 files |
| Phase 38 P02 | 75s | 2 tasks | 2 files |
| Phase 38 P03 | 102 | 2 tasks | 4 files |
| Phase 38-crdt-durability P01 | 132 | 2 tasks | 5 files |
| Phase 39-crdt-integration-fix P01 | 4 | 2 tasks | 3 files |
| Phase 40-activity-log-pipeline-wiring P01 | 2 | 1 tasks | 1 files |
| Phase 41-crdt-live-update-relay-fix P01 | 56 | 2 tasks | 2 files |
| Phase 42 P01 | 125 | 2 tasks | 5 files |
| Phase 43 P01 | 3 | 2 tasks | 5 files |
| Phase 43 P02 | 113 | 2 tasks | 5 files |
| Phase 44 P01 | 136 | 2 tasks | 7 files |
| Phase 44 P02 | 97 | 1 tasks | 2 files |
| Phase 45 P01 | 161 | 2 tasks | 6 files |
| Phase 45 P02 | 131 | 1 tasks | 2 files |
| Phase 46 P01 | 290 | 2 tasks | 11 files |
| Phase 46 P02 | 127 | 2 tasks | 2 files |

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Key decisions affecting v3.0 work:

- [v3.0 arch]: LocalStack (not AWS) for all local dev — EventBridge, SQS, Lambda, DynamoDB run in Docker
- [v3.0 arch]: Redis runs as ECS container locally (no ElastiCache dependency for dev)
- [v3.0 arch]: Social events published from social-api to EventBridge; Lambda consumers handle persistence
- [v3.0 arch]: CRDT checkpoints route through EventBridge pipeline instead of direct synchronous DynamoDB writes
- [v3.0 sequence]: Phase 34 (LocalStack) → Phase 35 (Bus) → Phase 36 (Publishing) → Phases 37/38 parallel
- [Phase 34]: All 9 existing social DynamoDB tables included in bootstrap script so docker compose up is fully self-contained for v3.0 development (addresses Pitfall 3 from research)
- [Phase 34]: LAMBDA_DOCKER_FLAGS omitted from base compose to avoid inspect-brk blocking all invocations; debug overlay can be added separately
- [Phase 34 P02]: Lambda handler uses standalone DynamoDB client (not shared aws-clients.ts) — Lambda runs in its own container with isolated env vars
- [Phase 34 P02]: .vscode/launch.json tracked in git via .gitignore exception (.vscode/* + !.vscode/launch.json) — shared debug config, not personal settings
- [Phase 35-01]: VisibilityTimeout=60s set in both bootstrap.sh and CDK EventBusStack for LocalStack/production parity
- [Phase 35-01]: EventBridge prefix matching routes all variants of a social event type to one queue (e.g., social.post.created and social.post.deleted both go to social-posts)
- [Phase 35-01]: social.comment.* events route to social-posts (logically post content); social.like.* routes to social-reactions
- [Phase 35-02]: Dual-mode Lambda handler dispatches on isSQSEvent guard — SQS batch events unwrap Records[].body, direct invoke falls through to raw EventBridge handler
- [Phase 35-02]: Bootstrap deploys JS stub Lambda (not TypeScript build) — avoids npm/tsc in container init; invoke-lambda.sh deploys real handler during development
- [Phase 35-02]: event-source-mapping batch-size=1 for local dev simplicity; CDK stack uses batch-size=10 for production
- [Phase 36]: publishSocialEvent uses void fire-and-forget identical to broadcastService.emit pattern
- [Phase 36]: Publish calls placed after HTTP response to ensure DynamoDB mutation succeeded before event fires
- [Phase 36]: Publish calls placed after HTTP 201 response and after successful DynamoDB write — identical pattern to plan 01
- [Phase 36]: Only creation events published — no DELETE handlers instrumented per CONTEXT.md
- [Phase 37-01]: Composite SK timestamp#eventId prevents DynamoDB collision for same-millisecond events; SQS batch error isolation via per-record try/catch with [activity-log] prefix
- [Phase 37-02]: ActivityPanel uses VITE_SOCIAL_API_URL (no /api suffix) + /api/activity path, consistent with useSocialProfile and other hooks in the frontend
- [Phase 38]: Snapshot push in handleSubscribe is non-fatal: own try/catch ensures subscribe completes even if DynamoDB is unavailable
- [Phase 38]: No new crdt message type needed for reconnect recovery: existing crdt:snapshot handler in useCRDT.ts already processes server-pushed snapshots
- [Phase 38]: afterTransaction origin !== null used to identify remote Y.js transactions for conflict detection
- [Phase 38]: CRDT conflict banner uses manual dismiss only (no auto-dismiss) per CRDT-03 spec
- [Phase 38-01]: CRDT checkpoints route through EventBridge pipeline (crdt.checkpoint) — gateway publishes, crdt-snapshot Lambda persists to DynamoDB; decouples snapshot writes from real-time gateway process
- [Phase 38-01]: crdt-snapshot Lambda follows identical dual-mode pattern as activity-log; snapshot data gzip-compressed in gateway, stored as-is (Binary) in DynamoDB by Lambda
- [Phase 39-crdt-integration-fix]: MISS-2: crdt-service.js snapshot messages changed from {type:'crdt',action:'snapshot'} to {type:'crdt:snapshot'} — no action field, matches useCRDT.ts client check
- [Phase 39-crdt-integration-fix]: MISS-4: crdt-snapshot Lambda writes timestamp as Date.now() Number (not String) so DynamoDBDocumentClient marshalls {N:...} matching gateway parseInt(item.timestamp.N,10) reader
- [Phase 39-crdt-integration-fix]: EVENT_BUS_NAME=social-events made explicit in websocket-gateway docker-compose environment block rather than relying on code default
- [Phase 40-01]: MISS-3 (v3.0 audit): 3 missing SQS-to-Lambda event-source-mappings added for social-rooms, social-posts, social-reactions
- [Phase 41-01]: broadcastBatch() sends {type:'crdt:update', channel, update:'<base64>'} merging batched operations via Y.mergeUpdates() — matches useCRDT.ts consumer contract
- [Phase 41-01]: EVENT_BUS_NAME=social-events made explicit in social-api docker-compose environment block, eliminating implicit reliance on aws-clients.ts code fallback
- [Phase 42]: Follow dedup checks attribute_not_exists(followeeId) (sort key) — checking PK would always pass since any item by that user has followerId; SK uniqueness check correctly prevents duplicate follow relationships
- [Phase 42]: Group creation uses TransactWriteCommand — atomic write ensures group + owner membership are either both created or both rolled back; ConditionExpression on groupId prevents duplicate groups
- [Phase 42]: DM rooms use deterministic key dm#userA#userB (sorted) + ConditionExpression attribute_not_exists(roomId) — eliminates TOCTOU race, no table scan needed; 409 response includes roomId for idempotent retry
- [Phase 42]: Trim-before-validate pattern: trimmedContent declared once before validation so whitespace-only strings fail validation and stored content is always trimmed (posts and comments)
- [Phase 43]: Transactional outbox: every social write atomically creates social-outbox record (status=UNPROCESSED, eventType, queueName, payload JSON) via TransactWriteCommand — eliminates event loss on process crash between DynamoDB write and EventBridge publish
- [Phase 43]: social-outbox status-index GSI (PK: status, SK: createdAt) enables relay processor to query UNPROCESSED items in arrival order; queueName field encodes SQS routing so relay needs no re-derivation logic
- [Phase 43]: outbox-relay marks PROCESSED only after successful SQS publish; polls social-outbox GSI directly (no event-source-mapping); 60s timeout; container-internal queue URLs
- [Phase 44]: ActivityService mirrors SocialService exactly; module-level Redis singleton in Lambda; sMembers check before publish; REDIS_ENDPOINT=localstack-redis for Docker network
- [Phase 44]: useActivityFeed hook kept inline in ActivityPanel.tsx with REST-hydrate + WS-live-append pattern; dedup by timestamp+eventType; 50-item cap
- [Phase 45]: Used @aws-sdk/client-cognito-identity-provider for typed Cognito admin operations in simulation scripts
- [Phase 45]: Used actual emoji characters for reactions instead of text names — API validates against VALID_EMOJI set of unicode characters
- [Phase 46]: Re-throw errors in hooks after setError so component try/catch receives them
- [Phase 46]: BigBrotherPanel uses inline useActivityFeed hook (duplicated from ActivityPanel) with MAX_ITEMS=100; tab switcher in AppLayout toggles panels vs dashboard view

### Pending Todos

None yet.

### Blockers/Concerns

None yet.

## Session Continuity

Last session: 2026-03-27T23:30:08.855Z
Stopped at: Completed 46-02-PLAN.md
Resume file: None
