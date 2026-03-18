---
gsd_state_version: 1.0
milestone: v3.0
milestone_name: Durable Event Architecture
status: planning
stopped_at: Completed 37-01-PLAN.md
last_updated: "2026-03-18T19:07:19.491Z"
last_activity: "2026-03-18 — Phase 34 P02 complete: Lambda handler, invoke script, debug compose, VS Code launch config"
progress:
  total_phases: 14
  completed_phases: 12
  total_plans: 30
  completed_plans: 29
  percent: 29
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-03-18)

**Core value:** Real-time collaborative platform with low-cost pub/sub and full social layer (profiles, groups, rooms, posts, reactions) — all Cognito-keyed for cross-app reuse.
**Current focus:** v3.0 — Durable Event Architecture (phases 34-38)

## Current Position

Phase: 34 of 38 (LocalStack Dev Environment) — complete
Plan: 2 of 2 — complete
Status: Ready to plan Phase 35
Last activity: 2026-03-18 — Phase 34 P02 complete: Lambda handler, invoke script, debug compose, VS Code launch config

Progress: [####░░░░░░░░░░░░░░░░░] 29% (v3.0 phases — 2 of 7 plans complete)

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

### Pending Todos

None yet.

### Blockers/Concerns

None yet.

## Session Continuity

Last session: 2026-03-18T19:07:19.488Z
Stopped at: Completed 37-01-PLAN.md
Resume file: None
