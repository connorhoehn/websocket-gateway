---
phase: 37-activity-log
verified: 2026-03-18T18:30:00Z
status: passed
score: 6/6 must-haves verified
re_verification: false
---

# Phase 37: Activity Log Verification Report

**Phase Goal:** A Lambda consumer persists all social events to a user-activity DynamoDB table, and users can view their recent activity as a chronological list in the app — validating the full EventBridge pipeline end-to-end
**Verified:** 2026-03-18T18:30:00Z
**Status:** passed
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| #  | Truth                                                                                                     | Status     | Evidence                                                                                     |
|----|-----------------------------------------------------------------------------------------------------------|------------|----------------------------------------------------------------------------------------------|
| 1  | Lambda consumer persists social events to user-activity DynamoDB table with userId PK and timestamp#eventId SK | VERIFIED   | handler.ts line 50: `const sk = \`${timestamp}#${eventId}\`` used as PutCommand Item timestamp |
| 2  | Bad SQS records are logged and skipped without failing the batch                                          | VERIFIED   | handler.ts lines 72–78: per-record try/catch logs `[activity-log]` prefix, does not re-throw |
| 3  | GET /api/activity returns the authenticated user's activity log in reverse-chronological order with pagination | VERIFIED   | activity.ts line 24: `ScanIndexForward: false`; cursor pagination via base64 lastKey; mounted at /activity in index.ts |
| 4  | User can see their recent social events in reverse-chronological order in an Activity panel              | VERIFIED   | ActivityPanel.tsx renders list from useActivityLog hook; items ordered by API (newest first) |
| 5  | Each activity item shows an icon, human-readable description, and relative timestamp                     | VERIFIED   | ActivityPanel.tsx lines 130–151: icon span + text span + relativeTime(item.timestamp)        |
| 6  | Activity panel appears in AppLayout below PostFeed, consistent with existing layout                      | VERIFIED   | AppLayout.tsx line 506: `<ActivityPanel idToken={idToken} />` placed after PostFeed comment |

**Score:** 6/6 truths verified

---

### Required Artifacts

| Artifact                                      | Expected                                                             | Status   | Details                                                                     |
|-----------------------------------------------|----------------------------------------------------------------------|----------|-----------------------------------------------------------------------------|
| `lambdas/activity-log/handler.ts`             | SQS batch handler with per-record error isolation and correct PK/SK schema | VERIFIED | 87 lines; composite SK on line 50; try/catch loop lines 72–78; PutCommand item on line 54 |
| `social-api/src/routes/activity.ts`           | GET /activity endpoint with DynamoDB Query and cursor pagination     | VERIFIED | 44 lines; exports activityRouter; ScanIndexForward false; split('#')[0] strip |
| `social-api/src/routes/index.ts`              | Router mount for /activity                                           | VERIFIED | Line 13 imports activityRouter; line 31 mounts at '/activity'              |
| `frontend/src/components/ActivityPanel.tsx`   | Activity feed component with useActivityLog hook and event type display mapping (min 60 lines) | VERIFIED | 156 lines; only ActivityPanel exported; 8 event type cases in formatActivity; useActivityLog fetches /api/activity |
| `frontend/src/components/AppLayout.tsx`       | ActivityPanel mounted in main content area                           | VERIFIED | Line 36 imports ActivityPanel; line 506 renders `<ActivityPanel idToken={idToken} />` |

---

### Key Link Verification

| From                                          | To                             | Via                                                | Status   | Details                                                     |
|-----------------------------------------------|--------------------------------|----------------------------------------------------|----------|-------------------------------------------------------------|
| `lambdas/activity-log/handler.ts`             | user-activity DynamoDB table   | PutCommand with userId PK, timestamp#eventId SK    | WIRED    | Line 13 `TABLE = 'user-activity'`; PutCommand Item uses composite sk |
| `social-api/src/routes/activity.ts`           | user-activity DynamoDB table   | QueryCommand with ScanIndexForward: false          | WIRED    | Line 5 `TABLE = 'user-activity'`; QueryCommand line 20; ScanIndexForward false line 24 |
| `frontend/src/components/ActivityPanel.tsx`   | /api/activity                  | fetch in useEffect on mount                        | WIRED    | Line 81: `fetch(\`${SOCIAL_API_URL}/api/activity?limit=20\`, ...)` in useEffect; response sets items state |
| `frontend/src/components/AppLayout.tsx`       | frontend/src/components/ActivityPanel.tsx | import and render with idToken prop       | WIRED    | Line 36 import; line 506 `<ActivityPanel idToken={idToken} />` |

---

### Requirements Coverage

| Requirement | Source Plan | Description                                                                                   | Status    | Evidence                                                                                    |
|-------------|-------------|-----------------------------------------------------------------------------------------------|-----------|---------------------------------------------------------------------------------------------|
| ALOG-01     | 37-01       | Lambda consumer persists all social event categories (join, follow, reaction, post) to a user-activity DynamoDB table | SATISFIED | handler.ts writes PutCommand to user-activity for every event type received via SQS/EventBridge |
| ALOG-02     | 37-01       | User can query their own activity log via a REST endpoint on social-api                       | SATISFIED | activity.ts exports activityRouter with GET / using req.user!.sub; mounted at /activity in index.ts |
| ALOG-03     | 37-02       | User can view their recent activity as a chronological list in the app                        | SATISFIED | ActivityPanel.tsx fetches /api/activity and renders chronological list with icons, descriptions, timestamps; wired into AppLayout |

All three requirement IDs declared in PLAN frontmatter are present in REQUIREMENTS.md and satisfied by verified implementation. No orphaned requirements found.

---

### Anti-Patterns Found

None. Scanned `lambdas/activity-log/handler.ts`, `social-api/src/routes/activity.ts`, and `frontend/src/components/ActivityPanel.tsx` for TODO/FIXME/PLACEHOLDER comments, empty implementations, and stub return values. All clear.

---

### TypeScript Compilation

| Project     | Result |
|-------------|--------|
| social-api  | Clean — zero errors |
| frontend    | Clean — zero errors |

---

### Commit Verification

All four commits claimed in SUMMARY files confirmed present in git log:

| Commit  | Description                                                  |
|---------|--------------------------------------------------------------|
| d19f8d5 | feat(37-01): update Lambda handler with timestamp#eventId SK and batch error isolation |
| 9576268 | feat(37-01): add GET /api/activity endpoint with cursor pagination |
| 448e140 | feat(37-02): create ActivityPanel component with useActivityLog hook |
| a178094 | feat(37-02): wire ActivityPanel into AppLayout below PostFeed |

---

### Human Verification Required

#### 1. End-to-End EventBridge Pipeline

**Test:** Perform a social action (follow a user, like a post, join a room) in the app while LocalStack is running. Wait ~2 seconds, then navigate to the Activity section in AppLayout and confirm the event appears.
**Expected:** The new activity item appears with the correct icon, a human-readable description, and a "just now" timestamp.
**Why human:** Requires live LocalStack + SQS event-source-mapping + Lambda execution + DynamoDB write + frontend fetch — not verifiable by static analysis.

#### 2. Cursor Pagination

**Test:** Trigger more than 20 social events for a single user. Scroll to the Activity panel and check whether a mechanism exists for loading older events (currently the component fetches only the first 20 and has no "load more" button).
**Expected:** First 20 events shown. Note: the API supports `nextKey` cursor but the current ActivityPanel does not expose a "Load More" control. This is a known scope boundary (ALOG-03 only requires viewing recent activity), not a gap.
**Why human:** Requires live data and visual inspection of the panel.

---

### Gaps Summary

No gaps. All phase-37 must-haves are verified at all three levels (exists, substantive, wired). Both TypeScript projects compile clean. All four commits exist. ALOG-01, ALOG-02, and ALOG-03 are fully satisfied.

One noteworthy deviation from the plan (documented in 37-02-SUMMARY) was auto-corrected during execution: the `SOCIAL_API_URL` constant was adjusted to match the codebase convention (`VITE_SOCIAL_API_URL` without `/api` suffix, fetch path `/api/activity`). The resulting implementation is correct.

---

_Verified: 2026-03-18T18:30:00Z_
_Verifier: Claude (gsd-verifier)_
