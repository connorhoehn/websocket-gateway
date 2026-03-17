---
phase: 27-groups
plan: 02
subsystem: api
tags: [dynamodb, express, groups, membership, invitation, roles]

# Dependency graph
requires:
  - phase: 27-groups plan 01
    provides: social-groups and social-group-members DynamoDB tables, groupsRouter with CRUD

provides:
  - Group membership lifecycle endpoints (invite, accept, decline, join, leave, list members)
  - Role-based permission enforcement (owner/admin can invite; owner cannot leave)
  - Invitation flow using status field ('invited' | 'active') on membership records
  - Private group access gating on GET /members

affects: [28-posts, 29-rooms, frontend-group-ui]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "mergeParams: true on sub-routers to inherit :groupId from parent mount"
    - "status field ('invited'|'active') on membership records for invitation state machine"
    - "getCallerMembership helper reused across all five handlers"
    - "FilterExpression with attribute_not_exists to handle legacy records without status field"

key-files:
  created:
    - social-api/src/routes/group-members.ts
  modified:
    - social-api/src/routes/index.ts

key-decisions:
  - "groupMembersRouter mounted at /groups/:groupId (not /groups) to expose groupId via mergeParams"
  - "status absence treated as 'active' throughout — owner records from 27-01 have no status field"
  - "GET /members filters with attribute_not_exists(status) OR status=active to handle legacy owner records"
  - "Private group visibility check on GET /members uses same active-member definition"

patterns-established:
  - "mergeParams: true for sub-routers that need parent route params"
  - "status-based state machine for invite flow: invited -> active (accept) or deleted (decline)"

requirements-completed: [GRUP-03, GRUP-04, GRUP-06, GRUP-07, GRUP-08, GRUP-09]

# Metrics
duration: 1min
completed: 2026-03-17
---

# Phase 27 Plan 02: Group Membership Routes Summary

**Five membership lifecycle endpoints with role-based permissions and invitation state machine using status field on DynamoDB records**

## Performance

- **Duration:** ~1 min
- **Started:** 2026-03-17T16:59:58Z
- **Completed:** 2026-03-17T17:01:00Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments

- Created group-members.ts with five route handlers covering the full membership lifecycle
- Implemented invitation flow: invite writes 'invited' status, accept transitions to 'active', decline deletes record
- Role-based access: only owner/admin can invite; owner blocked from leaving (must delete group)
- Mounted groupMembersRouter at /groups/:groupId with mergeParams:true for param inheritance
- Private group gating on GET /members excludes non-members

## Task Commits

Each task was committed atomically:

1. **Task 1: Implement group-members.ts with membership route handlers** - `6d697c7` (feat)
2. **Task 2: Mount groupMembersRouter in central router** - `c7e9c41` (feat)

**Plan metadata:** (see final commit)

## Files Created/Modified

- `social-api/src/routes/group-members.ts` - Five route handlers: POST /invite, POST /invitations/:action, POST /join, DELETE /leave, GET /members
- `social-api/src/routes/index.ts` - Added import and mount for groupMembersRouter at /groups/:groupId

## Decisions Made

- Mounted groupMembersRouter at `/groups/:groupId` rather than `/groups` so that `mergeParams: true` correctly exposes `req.params.groupId` to all handlers
- Owner records written by plan 27-01 have no `status` field — treating absence of `status` as `'active'` throughout all permission and membership checks
- `FilterExpression: '#s = :active OR attribute_not_exists(#s)'` on GET /members ensures legacy owner records (no status field) are included in results

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## Next Phase Readiness

- Full group feature set (GRUP-01 through GRUP-09) is now complete
- Groups support public join and private invitation flows with role enforcement
- Ready for Phase 28 (posts/feed) which may reference group membership for group-scoped posts

---
*Phase: 27-groups*
*Completed: 2026-03-17*
