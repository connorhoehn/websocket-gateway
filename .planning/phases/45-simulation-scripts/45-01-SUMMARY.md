---
phase: 45-simulation-scripts
plan: 01
status: complete
started: "2026-03-27T22:20:39Z"
completed: "2026-03-27T22:23:20Z"
subsystem: scripts
tags: [simulation, cognito, social-api, json-lines]
dependency_graph:
  requires: [social-api routes, Cognito user pool, .env.real config]
  provides: [sim-helpers library, random activity simulator]
  affects: [scripts/]
tech_stack:
  added: ["@aws-sdk/client-cognito-identity-provider"]
  patterns: [weighted random selection, JSON-lines structured logging, continue-on-failure]
key_files:
  created:
    - scripts/lib/sim-helpers.ts
    - scripts/simulate-activity.ts
    - scripts/simulate-activity.sh
    - scripts/tsconfig.scripts.json
  modified:
    - package.json
    - package-lock.json
decisions:
  - "Used @aws-sdk/client-cognito-identity-provider (new dependency) for typed Cognito admin operations rather than shelling out to aws CLI"
  - "ActionLog result type includes 'skip' in addition to 'ok'/'error' for cases where preconditions not met (e.g. no posts exist yet for comment/reaction)"
  - "postIdsByRoom tracks posts per room (capped at 50 each) rather than flat array, enabling correct roomId/postId pairing for comment/reaction/like actions"
metrics:
  duration: 161s
  completed: "2026-03-27T22:23:20Z"
  tasks: 2
  files: 6
---

# Phase 45 Plan 01: Simulation Helpers and Random Activity Script Summary

Reusable Cognito user provisioning, API call wrapper, and JSON-lines logger in sim-helpers.ts; weighted random activity loop driving posts, comments, reactions, likes, follows, and room creation through real social-api endpoints.

## Tasks Completed

| Task | Name | Status | Commit | Key Files |
|------|------|--------|--------|-----------|
| 1 | Create shared simulation helpers library | Complete | f7904b8 | scripts/lib/sim-helpers.ts, scripts/tsconfig.scripts.json |
| 2 | Create random activity simulation script and shell wrapper | Complete | 55532d7 | scripts/simulate-activity.ts, scripts/simulate-activity.sh |

## Files Created

- `scripts/lib/sim-helpers.ts` (167 lines) -- Exports: loadEnvReal, createSimUser, logAction, apiCall, parseArgs, sleep, SimUser, ActionLog, CognitoConfig
- `scripts/simulate-activity.ts` (283 lines) -- Main simulation: user provisioning, profile creation, room setup, weighted activity loop
- `scripts/simulate-activity.sh` (10 lines) -- Shell wrapper delegating to npx tsx
- `scripts/tsconfig.scripts.json` -- TypeScript config targeting ES2022 with bundler module resolution

## Files Modified

- `package.json` -- Added @aws-sdk/client-cognito-identity-provider dependency
- `package-lock.json` -- Lock file updated

## Verification

- sim-helpers.ts imports verified via npx tsx (import ok)
- simulate-activity.sh is executable, delegates to npx tsx
- Script produces valid JSON-lines output with timestamp, actor, action, resource, result fields
- Script continues on individual action failure (Cognito auth errors logged, not thrown)
- logAction called 15+ times across the codebase (setup, each action type, error handling, summary)
- Weighted action distribution: post.create=30, comment.create=20, reaction.add=20, like.add=15, follow=10, room.create=5

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Installed missing @aws-sdk/client-cognito-identity-provider**
- **Found during:** Task 1
- **Issue:** Plan specified using CognitoIdentityProviderClient but the SDK package was not in project dependencies
- **Fix:** npm install --save @aws-sdk/client-cognito-identity-provider
- **Files modified:** package.json, package-lock.json

## Decisions Made

1. Added 'skip' to ActionLog result union type -- needed for actions that cannot execute due to empty preconditions (no posts yet for comment/reaction/like)
2. postIdsByRoom uses Map<string, string[]> keyed by roomId -- ensures correct roomId/postId pairing when selecting targets for comments, reactions, and likes

## Self-Check: PASSED

All 4 created files verified on disk. Both task commits (f7904b8, 55532d7) verified in git log. Line counts: sim-helpers.ts=188 (min 80), simulate-activity.ts=434 (min 150), simulate-activity.sh=10 (min 10).
