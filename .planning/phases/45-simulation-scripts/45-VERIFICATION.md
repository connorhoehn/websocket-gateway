---
phase: 45-simulation-scripts
verified: 2026-03-27T23:15:00Z
status: gaps_found
score: 3/4 success criteria verified
gaps:
  - truth: "simulate-activity.sh reaction.add actions succeed through real API calls"
    status: partial
    reason: "EMOJIS array uses text names ('fire','heart','thumbsup') but social-api VALID_EMOJI set only accepts unicode characters. All reaction.add actions (20% weight) will return 400 errors."
    artifacts:
      - path: "scripts/simulate-activity.ts"
        issue: "Line 65: EMOJIS array contains text names instead of unicode emoji characters"
    missing:
      - "Replace text emoji names with unicode characters matching VALID_EMOJI set in social-api/src/routes/reactions.ts"
---

# Phase 45: Simulation Scripts Verification Report

**Phase Goal:** A single command can simulate N users performing authentic social activity -- joining rooms, posting, reacting, following -- through real APIs, with structured stdout logs suitable for piping to monitoring tools

**Verified:** 2026-03-27T23:15:00Z
**Status:** gaps_found
**Re-verification:** No -- initial verification

## Goal Achievement

### Observable Truths (from Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | `scripts/simulate-activity.sh --users 5 --duration 60` creates 5 test users, has them join rooms, post content, and react over 60 seconds using real API calls | PARTIAL | Script exists and is fully wired, but reaction.add actions (20% weight) will always fail -- EMOJIS array uses text names ('fire','heart') instead of unicode characters required by VALID_EMOJI set in social-api/src/routes/reactions.ts line 17 |
| 2 | Each script action logs a structured line: timestamp, actor, action, resource, result | VERIFIED | logAction() in sim-helpers.ts line 139-141 writes JSON.stringify to stdout. ActionLog interface (line 31-39) defines all required fields. Called 22+ times in simulate-activity.ts and 25+ times in create-scenario.ts |
| 3 | Scripts are headless -- no browser required; runs in CI | VERIFIED | Both scripts are pure Node.js/TypeScript using fetch for HTTP and AWS SDK for Cognito. Shell wrappers use `npx tsx`. No browser dependencies |
| 4 | `scripts/create-scenario.sh` pre-seeds a specific scenario (3 friends, 2 rooms, a conversation thread) for deterministic demo walkthroughs | VERIFIED | create-scenario.ts provisions Alice/Bob/Charlie (line 75-79), creates 6 mutual follows (line 133-140), creates General Chat and Project Alpha rooms (line 168-198), seeds 10-step General Chat conversation and 5-step Project Alpha content with posts/comments/likes/reactions. Uses correct unicode emoji characters. |

**Score:** 3/4 success criteria fully verified (1 partial due to emoji bug in simulate-activity.ts)

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `scripts/lib/sim-helpers.ts` | Shared helpers: Cognito user creation, token acquisition, API call wrapper, JSON-lines logger | VERIFIED | 188 lines. Exports: loadEnvReal, createSimUser, logAction, apiCall, parseArgs, sleep, SimUser, ActionLog, CognitoConfig. Uses AdminCreateUserCommand, AdminSetUserPasswordCommand, InitiateAuthCommand. |
| `scripts/simulate-activity.ts` | Main simulation with user provisioning, auth, and weighted random activity loop | VERIFIED (with bug) | 434 lines. 4 phases: provision users, create profiles, create rooms/join, weighted activity loop. Weights: post.create=30, comment.create=20, reaction.add=20, like.add=15, follow=10, room.create=5. Bug: EMOJIS array line 65 uses text names. |
| `scripts/simulate-activity.sh` | Shell wrapper that compiles and runs the TypeScript script | VERIFIED | 10 lines. Executable. Contains `npx tsx --tsconfig`. Passes through `$@` args. |
| `scripts/create-scenario.ts` | Deterministic scenario seeder with declarative step array | VERIFIED | 554 lines. 5 phases (A-E). 3 users, mutual follows, 2 rooms, conversation threads. Uses unicode emoji. step() wrapper for continue-on-failure. |
| `scripts/create-scenario.sh` | Shell wrapper for scenario seeder | VERIFIED | 6 lines. Executable. Contains `npx tsx --tsconfig`. |
| `scripts/tsconfig.scripts.json` | TypeScript config for tsx compilation | VERIFIED | Exists. |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| simulate-activity.ts | lib/sim-helpers.ts | `import { createSimUser, logAction, apiCall, ... } from './lib/sim-helpers'` | WIRED | Line 16-23: imports createSimUser, logAction, apiCall, loadEnvReal, parseArgs, sleep, SimUser |
| simulate-activity.ts | localhost:3001/api/* | apiCall() calls | WIRED | 9 apiCall invocations for profiles, rooms, posts, comments, reactions, likes, follows |
| simulate-activity.sh | simulate-activity.ts | npx tsx execution | WIRED | Line 10: `exec npx tsx --tsconfig ... simulate-activity.ts "$@"` |
| create-scenario.ts | lib/sim-helpers.ts | `import { ... } from './lib/sim-helpers'` | WIRED | Line 18-26: imports createSimUser, logAction, apiCall, loadEnvReal, sleep, SimUser, CognitoConfig |
| create-scenario.ts | localhost:3001/api/* | apiCall() calls | WIRED | 20 apiCall invocations across phases A-E |
| create-scenario.sh | create-scenario.ts | npx tsx execution | WIRED | Line 6: `exec npx tsx --tsconfig ... create-scenario.ts "$@"` |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| scripts/simulate-activity.ts | 65 | Incorrect emoji format: text names instead of unicode characters | Blocker (partial) | reaction.add actions (20% of weighted actions) will always fail with 400. Script continues but reactions never succeed. |

### Human Verification Required

### 1. End-to-end simulate-activity run

**Test:** Start LocalStack environment, run `./scripts/simulate-activity.sh --users 3 --duration 15`
**Expected:** JSON lines appear on stdout with user creation, profile creation, room setup, then random activity. Reaction actions will show result:"error" due to emoji bug.
**Why human:** Requires running LocalStack docker-compose environment with Cognito and social-api.

### 2. End-to-end create-scenario run

**Test:** Start LocalStack environment, run `./scripts/create-scenario.sh`
**Expected:** JSON lines for 3 users, 6 follows, 2 rooms, multi-step conversations. All results should be "ok". Seeded data visible in UI.
**Why human:** Requires running infrastructure and visual confirmation of seeded data.

### Gaps Summary

One gap found: `scripts/simulate-activity.ts` line 65 defines EMOJIS as text names (`['fire', 'heart', 'thumbsup', 'laugh', 'wow', 'sad']`) but the social-api reaction endpoint (`social-api/src/routes/reactions.ts` line 17) validates against a VALID_EMOJI set of unicode characters. This means the `reaction.add` action type (weight 20, roughly 20% of all random actions) will always return a 400 error. The script handles this gracefully (logs error, continues) but reactions never actually succeed, which undermines the "authentic social activity" goal.

The fix is straightforward: replace the text names with matching unicode characters from the VALID_EMOJI set. The `create-scenario.ts` already does this correctly (uses unicode emoji on lines 309, 329, 408, 511).

All other aspects of the phase are fully implemented and correctly wired.

---

_Verified: 2026-03-27T23:15:00Z_
_Verifier: Claude (gsd-verifier)_
