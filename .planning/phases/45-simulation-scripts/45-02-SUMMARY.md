---
phase: 45-simulation-scripts
plan: 02
subsystem: scripts
tags: [typescript, simulation, scenario-seeder, cognito, social-api]

requires:
  - phase: 45-simulation-scripts-01
    provides: sim-helpers library (createSimUser, apiCall, logAction, loadEnvReal, sleep)
provides:
  - Deterministic scenario seeder (3 users, 2 rooms, conversation threads with reactions)
  - Shell wrapper for scenario execution
affects: [demo, testing, walkthrough]

tech-stack:
  added: []
  patterns: [declarative-scenario-steps, continue-on-failure-pattern]

key-files:
  created:
    - scripts/create-scenario.ts
    - scripts/create-scenario.sh
  modified: []

key-decisions:
  - "Used actual emoji characters for reactions instead of text names — API validates against VALID_EMOJI set of unicode characters"

patterns-established:
  - "Scenario seeder: step() wrapper provides per-action try/catch with structured error logging"

requirements-completed: [headless demo]

duration: 2min
completed: 2026-03-27
---

# Phase 45 Plan 02: Scenario Seeder Summary

**Deterministic scenario seeder with 3 mutual-friend users, 2 rooms, and multi-step conversation threads through real API calls**

## Performance

- **Duration:** 2 min
- **Started:** 2026-03-27T22:24:57Z
- **Completed:** 2026-03-27T22:27:08Z
- **Tasks:** 1
- **Files modified:** 2

## Accomplishments
- Created deterministic scenario seeder that provisions Alice, Bob, Charlie with profiles and mutual follows
- Seeds 2 rooms (General Chat, Project Alpha) with posts, comments, likes, and reactions
- Every action logged as structured JSON line matching simulate-activity format
- Continue-on-failure pattern: each step wrapped in try/catch so partial failures don't abort the scenario

## Task Commits

Each task was committed atomically:

1. **Task 1: Create deterministic scenario seeder script** - `30309b8` (feat)

## Files Created/Modified
- `scripts/create-scenario.ts` - Deterministic scenario seeder with 5 phases: user creation, social graph, rooms, General Chat conversation, Project Alpha content
- `scripts/create-scenario.sh` - Shell wrapper delegating to tsx

## Decisions Made
- Used actual emoji characters (unicode) for reaction calls instead of text names like 'fire' — the social-api VALID_EMOJI set validates actual emoji characters, not text names

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Used emoji characters instead of text names for reactions**
- **Found during:** Task 1 (reading reactions.ts route)
- **Issue:** Plan specified text names like 'fire', 'heart', 'thumbsup' but API validates against VALID_EMOJI set of unicode characters
- **Fix:** Used actual emoji characters in apiCall bodies
- **Files modified:** scripts/create-scenario.ts
- **Verification:** Matches VALID_EMOJI set in social-api/src/routes/reactions.ts
- **Committed in:** 30309b8 (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Essential for correctness — text emoji names would have been rejected by the API.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Both simulation scripts (simulate-activity + create-scenario) now available
- Ready for end-to-end demo workflows with LocalStack environment running

---
*Phase: 45-simulation-scripts*
*Completed: 2026-03-27*

## Self-Check: PASSED
