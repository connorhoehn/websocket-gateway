---
phase: 32-frontend-social-layer
plan: 02
subsystem: ui
tags: [react, typescript, hooks, websocket, social-ui, inline-styles]

# Dependency graph
requires:
  - plan: 32-01
    provides: useSocialProfile, useFriends, useGroups, useRooms, usePosts, useComments, useLikes hooks
provides:
  - SocialPanel with live API hooks (no mock data)
  - GroupPanel component (create/delete groups, member management, GRUP-02 delete button)
  - RoomList component (create rooms, DM rooms, onMessage forwarded to useRooms, RTIM-04)
  - PostFeed component (create/edit/delete posts, LikeButton, EmojiReactionBar, inline CommentThread)
  - CommentThread component (nested replies indented 32px, fade-in animations, ReplyForm)
affects:
  - 32-03-AppLayout-wiring

# Tech tracking
tech-stack:
  added: []
  patterns:
    - _fadeIn boolean flag + useState(0/1) + useEffect setTimeout(10ms) for 200ms opacity fade-in
    - Inline confirm pattern (no modal) for destructive actions: delete post, delete comment, delete group
    - Owner-only UI guard via JWT sub decode (atob) compared to group.ownerId
    - onMessage prop forwarded directly to hook (RoomList -> useRooms) for RTIM-04 member events
    - All sub-components co-located as unexported internals in parent file (established SocialPanel pattern)

key-files:
  created:
    - frontend/src/components/GroupPanel.tsx
    - frontend/src/components/RoomList.tsx
    - frontend/src/components/PostFeed.tsx
    - frontend/src/components/CommentThread.tsx
  modified:
    - frontend/src/components/SocialPanel.tsx

key-decisions:
  - "SocialPanel.ProfileCard.onSave now calls updateProfile (async) with setSaving=true/false around await"
  - "SocialPanel accepts onMessage prop for API symmetry with GroupPanel/RoomList; void-casts it as SocialPanel does not subscribe to WS events"
  - "GroupCard Delete button scoped to group.ownerId === currentUserId guard using JWT sub decode (same pattern as useGroups hook)"
  - "RoomList DMRoomButton starts collapsed as a plain button; expands to inline form on click"
  - "EmojiReactionBar uses same 12-emoji EMOJIS array as ReactionButtons.tsx (copy-declared as const)"
  - "LikeButton and EmojiReactionBar each call useLikes independently per post — acceptable given low cost of two hook instances"

# Metrics
duration: 5min
completed: 2026-03-17
---

# Phase 32 Plan 02: Social UI Components Summary

**5 social UI components: SocialPanel connected to live hooks, GroupPanel with owner-delete (GRUP-02), RoomList forwarding onMessage to useRooms (RTIM-04), PostFeed with inline CommentThread and emoji reactions, CommentThread with nested replies and fade-in animation**

## Performance

- **Duration:** 5 min
- **Started:** 2026-03-17T20:19:06Z
- **Completed:** 2026-03-17T20:24:03Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments

- Refactored SocialPanel from mock data to live useSocialProfile and useFriends hooks; removed CURRENT_USER, MOCK_USERS, TAB_FOLLOWERS, TAB_FOLLOWING, TAB_FRIENDS, and MockDataBanner
- Created GroupPanel with CreateGroupForm, GroupCard (owner-only Delete button in #dc2626 calling deleteGroup — GRUP-02), MemberList, InviteForm sub-components
- Created RoomList forwarding onMessage prop directly to useRooms — social:member_joined and social:member_left events handled inside the hook (RTIM-04)
- Created PostFeed with CreatePostForm, PostCard (fade-in for _fadeIn posts), LikeButton (useLikes toggle), EmojiReactionBar (12-emoji reactWithEmoji), inline CommentThread expansion
- Created CommentThread with CommentItem (reply indent 32px, 200ms fade-in for _fadeIn comments), ReplyForm, top-level new comment form
- All 5 components compile with zero TypeScript errors; inline styles only, zero className or CSS imports

## Task Commits

Each task was committed atomically:

1. **Task 1: Refactor SocialPanel; create GroupPanel and RoomList** - `c676c61` (feat)
2. **Task 2: Create PostFeed and CommentThread** - `3bdaef9` (feat)

## Files Created/Modified

- `frontend/src/components/SocialPanel.tsx` - Removed mock data, wired useSocialProfile + useFriends; ProfileCard.onSave now async; loading skeleton while profile loads
- `frontend/src/components/GroupPanel.tsx` - New: create/delete groups, owner-only Delete guard, member list, invite form
- `frontend/src/components/RoomList.tsx` - New: create rooms, DM rooms, onMessage forwarded to useRooms for RTIM-04
- `frontend/src/components/PostFeed.tsx` - New: post feed with LikeButton, EmojiReactionBar, inline CommentThread, edit/delete post
- `frontend/src/components/CommentThread.tsx` - New: nested replies (32px indent), ReplyForm, delete comment, fade-in animation

## Decisions Made

- SocialPanel accepts onMessage for prop symmetry with sibling components; void-casts it since SocialPanel has no WS subscriptions
- ProfileCard.onSave updated to async — calls updateProfile and awaits before clearing saving state (removes the setTimeout(300ms) placeholder)
- GroupCard Delete button visibility gated on `group.ownerId === currentUserId` using same JWT sub decode pattern as hooks
- RoomList DMRoomButton rendered as collapsed button expanding to inline form (avoids permanent form clutter)
- LikeButton and EmojiReactionBar each instantiate useLikes — two hook instances per post card is acceptable; keeps sub-components independent
- EmojiReactionBar EMOJIS array copy-declared in PostFeed.tsx (same 12 values as ReactionButtons.tsx const)

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None.

## Next Phase Readiness

- All 5 components ready for import by Phase 32-03 (AppLayout wiring)
- SocialPanel, GroupPanel, RoomList each accept `{ idToken, onMessage }` props
- PostFeed accepts `{ idToken, roomId, onMessage }` — requires an activeRoomId from RoomList selection
- CommentThread is internal to PostFeed; not exported for direct use

## Self-Check: PASSED

- FOUND: frontend/src/components/SocialPanel.tsx
- FOUND: frontend/src/components/GroupPanel.tsx
- FOUND: frontend/src/components/RoomList.tsx
- FOUND: frontend/src/components/PostFeed.tsx
- FOUND: frontend/src/components/CommentThread.tsx
- FOUND: commit c676c61 (Task 1)
- FOUND: commit 3bdaef9 (Task 2)

---
*Phase: 32-frontend-social-layer*
*Completed: 2026-03-17*
