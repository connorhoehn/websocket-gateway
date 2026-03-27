# Phase 45: Simulation Scripts - Context

**Gathered:** 2026-03-27
**Status:** Ready for planning

<domain>
## Phase Boundary

This phase delivers CLI simulation scripts that generate authentic social activity through real API calls against the LocalStack dev environment. Two scripts: a random activity generator and a deterministic scenario seeder. Both produce JSON-lines structured logs.

</domain>

<decisions>
## Implementation Decisions

### Script Architecture & Language
- Node.js (TypeScript) scripts — can reuse existing API types, fetch built-in, structured JSON output is natural
- Users self-provisioned via Cognito admin API (AWS SDK) — reuse pattern from scripts/create-test-user.sh
- Target LocalStack docker-compose environment — social-api at http://localhost:3001
- Continue on individual action failure — log error, proceed to next action; don't abort entire simulation

### Activity Patterns & Output
- Weighted random activity distribution: more posts/reactions, fewer follows/group creates — mimics real usage patterns
- JSON lines log format (one JSON object per line) — easy to pipe to jq, grep, monitoring tools
- Deterministic scenario script uses declarative steps in code (array of actions) — readable, no YAML parsing needed

### Claude's Discretion
- Exact weight distribution for random activity types
- User naming convention for auto-provisioned users
- How to obtain auth tokens for API calls (Cognito InitiateAuth or admin token)
- Script entry points (package.json scripts vs standalone .sh wrappers)

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `scripts/create-test-user.sh` — Cognito admin user creation pattern (admin-create-user + admin-set-user-password)
- `scripts/test-social-publishing.sh` — example of calling social-api endpoints from shell
- `social-api/src/routes/` — all REST endpoints: profiles, groups, rooms, posts, comments, reactions, likes, activity
- `.env.real` — Cognito pool config (COGNITO_REGION, COGNITO_USER_POOL_ID, COGNITO_CLIENT_ID)

### Established Patterns
- Social API base URL: `http://localhost:3001` in docker-compose
- Auth: Bearer token from Cognito (JWT)
- All social routes at `/api/social/*` and `/api/posts/*`

### Integration Points
- `scripts/` directory — new scripts go here
- Cognito user pool — admin API for user creation
- social-api REST endpoints — all CRUD operations
- docker-compose.localstack.yml — must be running for scripts to work

</code_context>

<specifics>
## Specific Ideas

- `scripts/simulate-activity.sh --users 5 --duration 60` as the primary entry point (per success criteria)
- `scripts/create-scenario.sh` for deterministic demo seeding (per success criteria)
- Log format: `{"timestamp":"...","actor":"user1","action":"post.create","resource":"room-abc","result":"ok"}`

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>
