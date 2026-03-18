---
phase: 37-activity-log
plan: "02"
subsystem: frontend
tags: [react, activity-feed, social-events, ui]
dependency_graph:
  requires: ["37-01"]
  provides: ["ALOG-03"]
  affects: ["frontend/src/components/AppLayout.tsx"]
tech_stack:
  added: []
  patterns: ["single-file component with unexported internals", "hook-driven data fetching in useEffect", "inline style objects matching SocialPanel convention"]
key_files:
  created:
    - frontend/src/components/ActivityPanel.tsx
  modified:
    - frontend/src/components/AppLayout.tsx
decisions:
  - "Used VITE_SOCIAL_API_URL (no /api suffix) + /api/activity path, matching the pattern in useSocialProfile and other hooks rather than the plan's fallback constant"
metrics:
  duration: 106s
  completed: "2026-03-18"
  tasks: 2
  files: 2
---

# Phase 37 Plan 02: ActivityPanel Component Summary

ActivityPanel React component with useActivityLog hook fetching GET /api/activity, displaying 8 social event types with icons, descriptions, and relative timestamps — wired into AppLayout below PostFeed.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Create ActivityPanel component with useActivityLog hook | 448e140 | frontend/src/components/ActivityPanel.tsx |
| 2 | Wire ActivityPanel into AppLayout | a178094 | frontend/src/components/AppLayout.tsx |

## What Was Built

**ActivityPanel.tsx** — Single-file component following SocialPanel convention:
- `useActivityLog(idToken)` hook: fetches `GET /api/activity?limit=20` with `Authorization: Bearer` header; returns `{ items, loading }`
- `formatActivity(item)` — maps 8 event types to `{ icon, text }`: `social.room.join`, `social.room.leave`, `social.follow`, `social.unfollow`, `social.like`, `social.reaction`, `social.post.created`, `social.comment.created`
- `relativeTime(ts)` — "just now" / "Nm ago" / date fallback
- `ActivityPanel` (only export): renders a section card with header "Activity", loading/empty states, and a flex-row list of icon + description + timestamp per event

**AppLayout.tsx** — Added import and `<ActivityPanel idToken={idToken} />` rendered after PostFeed and before Dev Tools.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed SOCIAL_API_URL constant to match codebase pattern**
- **Found during:** Task 1
- **Issue:** Plan specified `import.meta.env.VITE_SOCIAL_API_URL ?? 'http://localhost:3002/api'` and fetch path `/activity`. But the env var is `http://localhost:3001` (no `/api` suffix) per `frontend/.env`. Other hooks use `${baseUrl}/api/...` pattern.
- **Fix:** Changed constant to `(import.meta.env as Record<string, string>).VITE_SOCIAL_API_URL ?? 'http://localhost:3001'` and fetch path to `/api/activity?limit=20` — matches `useSocialProfile`, `useGroups`, etc.
- **Files modified:** frontend/src/components/ActivityPanel.tsx
- **Commit:** 448e140

## Self-Check: PASSED

- frontend/src/components/ActivityPanel.tsx: FOUND
- frontend/src/components/AppLayout.tsx: FOUND
- Commit 448e140: FOUND
- Commit a178094: FOUND
