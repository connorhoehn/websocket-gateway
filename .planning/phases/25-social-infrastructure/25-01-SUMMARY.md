---
phase: 25-social-infrastructure
plan: 01
subsystem: infra
tags: [cdk, dynamodb, express, cognito, jwt, jwks-rsa, jsonwebtoken, typescript]

# Dependency graph
requires: []
provides:
  - CDK SocialStack with 9 PAY_PER_REQUEST DynamoDB tables deployable via `cdk deploy social-stack`
  - social-api Express service skeleton with Cognito RS256 JWT auth middleware
  - GET /health (unauthenticated) returning 200 { status: 'ok', service: 'social-api' }
  - requireAuth middleware blocking all non-health routes without valid Bearer token (401)
affects: [26-profiles, 27-groups, 28-rooms, 29-posts, 30-reactions, 31-websocket-social, 32-frontend-social]

# Tech tracking
tech-stack:
  added:
    - express ^4.18.2 (social-api)
    - jwks-rsa ^3.2.2 (social-api)
    - jsonwebtoken ^9.0.3 (social-api)
    - @types/express ^4.17.21 (social-api dev)
    - @types/jsonwebtoken ^9.0.6 (social-api dev)
    - ts-node ^10.9.2 (social-api dev)
    - typescript ~5.6.3 (social-api dev)
  patterns:
    - CDK Stack per feature domain (SocialStack separate from WebsocketGatewayStack)
    - Express route order: public routes BEFORE auth middleware
    - Cognito JWKS RS256 verification via jwks-rsa + jsonwebtoken
    - Request augmentation via declare global namespace Express

key-files:
  created:
    - lib/social-stack.ts
    - social-api/package.json
    - social-api/tsconfig.json
    - social-api/src/app.ts
    - social-api/src/index.ts
    - social-api/src/middleware/auth.ts
    - social-api/src/routes/health.ts
    - social-api/src/routes/index.ts
    - social-api/src/types/express.d.ts
  modified:
    - bin/websocker_gateway.ts

key-decisions:
  - "SocialStack uses PAY_PER_REQUEST + RemovalPolicy.RETAIN for all 9 tables — no table will be accidentally deleted on stack update"
  - "express.d.ts force-added to git despite *.d.ts in .gitignore — module augmentation file must be tracked to work"
  - "health route mounted before requireAuth so /health is publicly accessible without credentials"

patterns-established:
  - "Route order pattern: app.use('/health', ...) BEFORE app.use(requireAuth) — health exempt, all else protected"
  - "Auth middleware pattern: decode without verify to extract kid, then fetch JWKS key, then verify RS256"
  - "CfnOutput naming: '{ConstructId}Name' for every table (SocialProfilesTableName, etc.)"

requirements-completed: []

# Metrics
duration: 2min
completed: 2026-03-16
---

# Phase 25 Plan 01: Social Infrastructure Summary

**CDK SocialStack with 9 DynamoDB tables + standalone social-api Express service with Cognito RS256 JWT auth middleware and public /health route**

## Performance

- **Duration:** ~2 min
- **Started:** 2026-03-16T20:23:13Z
- **Completed:** 2026-03-16T20:25:20Z
- **Tasks:** 2 executed + 1 auto-approved checkpoint
- **Files modified:** 10

## Accomplishments
- CDK SocialStack with all 9 PAY_PER_REQUEST DynamoDB tables synthesizes successfully via `npx cdk synth social-stack`
- Standalone `social-api/` Express service with its own package.json, tsconfig, and `npm run dev` entry point
- Cognito JWT Bearer-token auth middleware (`requireAuth`) using jwks-rsa + RS256 verification
- /health route exempt from auth; all other routes protected (401 for missing/invalid/expired tokens)
- TypeScript compiles cleanly (`npx tsc --noEmit` exits 0)

## Task Commits

Each task was committed atomically:

1. **Task 1: CDK social-stack with 9 DynamoDB tables** - `77d26c6` (feat)
2. **Task 2: social-api Express service with Cognito auth middleware** - `8816918` (feat)
3. **Task 3: checkpoint:human-verify** — auto-approved (auto_advance=true)

**Plan metadata:** _(docs commit follows)_

## Files Created/Modified
- `lib/social-stack.ts` - SocialStack CDK Stack with 9 DynamoDB tables and CfnOutputs
- `bin/websocker_gateway.ts` - Updated to instantiate SocialStack as 'social-stack'
- `social-api/package.json` - Standalone Node app: express, jwks-rsa, jsonwebtoken
- `social-api/tsconfig.json` - ES2022/commonjs TypeScript config
- `social-api/src/app.ts` - Express factory: /health before requireAuth, /api behind requireAuth
- `social-api/src/index.ts` - Entry point with COGNITO env-var validation
- `social-api/src/middleware/auth.ts` - requireAuth: decode → JWKS → RS256 verify → req.user
- `social-api/src/routes/health.ts` - GET / -> 200 { status: 'ok', service: 'social-api' }
- `social-api/src/routes/index.ts` - Stub router for phases 26-30 feature routes
- `social-api/src/types/express.d.ts` - Express.Request augmented with user?: UserContext

## Decisions Made
- PAY_PER_REQUEST + RemovalPolicy.RETAIN on all 9 tables — prevents accidental deletion, avoids provisioned capacity management
- `express.d.ts` force-added to git despite `*.d.ts` in root `.gitignore` — the module augmentation is a source file, not a build artifact
- /health mounted before `app.use(requireAuth)` so the health check is credential-free

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Force-added express.d.ts past .gitignore**
- **Found during:** Task 2 (git add before commit)
- **Issue:** Root `.gitignore` has `*.d.ts` entry, blocking `git add social-api/src/types/express.d.ts`
- **Fix:** Used `git add -f` to force-add the file; it is a source file, not a build artifact
- **Files modified:** social-api/src/types/express.d.ts
- **Verification:** File appears in `git status` as tracked
- **Committed in:** 8816918 (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Necessary for TypeScript module augmentation to be tracked by git. No scope creep.

## Issues Encountered
- `.gitignore` `*.d.ts` rule blocked the Express type augmentation file — resolved with `git add -f`

## User Setup Required
None — no external service configuration required. To start the service:
```bash
cd social-api
COGNITO_REGION=us-east-1 COGNITO_USER_POOL_ID=us-east-1_YOURPOOLID PORT=3001 npm run dev
```

## Next Phase Readiness
- CDK SocialStack is ready for `cdk deploy social-stack` when AWS credentials are available
- social-api Express skeleton is ready for Phase 26 (profiles routes) to be mounted under `/api`
- All 9 DynamoDB tables are defined and will be available after deploy
- No blockers for Phase 26

---
*Phase: 25-social-infrastructure*
*Completed: 2026-03-16*
