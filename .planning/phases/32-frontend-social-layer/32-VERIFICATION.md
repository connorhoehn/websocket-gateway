---
phase: 32-frontend-social-layer
verified: 2026-03-17T20:40:00Z
status: gaps_found
score: 7/10 must-haves verified
re_verification: false
gaps:
  - truth: "usePosts exposes getUserPosts(userId) which calls GET /api/posts/:userId and returns PostItem[] (CONT-05)"
    status: failed
    reason: "getUserPosts is absent from usePosts.ts — the function is not defined, not exported, and does not appear anywhere in the codebase. The UsePostsReturn interface and the hook implementation both omit it."
    artifacts:
      - path: "frontend/src/hooks/usePosts.ts"
        issue: "getUserPosts function and its GET /api/posts/:userId call are completely absent"
    missing:
      - "Add getUserPosts(userId: string): Promise<PostItem[]> to UsePosts­Return interface"
      - "Implement getUserPosts as useCallback: fetch GET ${baseUrl}/api/posts/${userId} with Bearer idToken, return (await res.json() as {posts: PostItem[]}).posts"
      - "Include getUserPosts in the hook return object"

  - truth: "useRooms exposes createGroupRoom(groupId, name) which calls POST /api/groups/:groupId/rooms and prepends the returned RoomItem (ROOM-02)"
    status: failed
    reason: "createGroupRoom is absent from useRooms.ts — neither the function nor the POST /api/groups/:groupId/rooms endpoint call appears anywhere in the hook. The UseRoomsReturn interface also omits it."
    artifacts:
      - path: "frontend/src/hooks/useRooms.ts"
        issue: "createGroupRoom function and POST /api/groups/:groupId/rooms call are completely absent"
    missing:
      - "Add createGroupRoom: (groupId: string, name: string) => Promise<void> to UseRoomsReturn interface"
      - "Implement createGroupRoom as useCallback: fetch POST ${baseUrl}/api/groups/${groupId}/rooms body {name}, prepend returned RoomItem to rooms state"
      - "Include createGroupRoom in the hook return object"
      - "GroupPanel and AppLayout may then expose group-scoped room creation via RoomList if needed"

  - truth: "useRooms exposes loadMembers(roomId) which calls GET /api/rooms/:roomId/members and stores the result in members state; setActiveRoom calls loadMembers when the room is non-null so the member list is always populated for the active room (ROOM-06)"
    status: failed
    reason: "loadMembers is absent from useRooms.ts. The setActiveRoom callback (line 124-127) only updates activeRoomRef and calls setActiveRoomState — it never fetches room members. Members state is only populated by social:member_joined WS events, not seeded from REST on room activation."
    artifacts:
      - path: "frontend/src/hooks/useRooms.ts"
        issue: "loadMembers function absent; setActiveRoom does not call GET /api/rooms/:roomId/members"
    missing:
      - "Add loadMembers: (roomId: string) => Promise<void> to UseRoomsReturn interface"
      - "Implement loadMembers as useCallback: fetch GET ${baseUrl}/api/rooms/${roomId}/members, store in members state"
      - "Inside setActiveRoom callback: when room is non-null, call void loadMembers(room.roomId) after setting activeRoomRef and activeRoomState"
      - "Include loadMembers in the hook return object"

  - truth: "PostFeed's PostCard PostActions row shows a compact 'Liked by' display using the whoLiked array from useLikes — users can see who liked a post (REAC-06)"
    status: failed
    reason: "PostFeed.tsx's LikeButton internal component only destructures {isLiked, likeCount, toggle} from useLikes — it discards whoLiked. No WhoLikedDisplay sub-component exists, and no 'Liked by:' text appears anywhere in PostFeed.tsx."
    artifacts:
      - path: "frontend/src/components/PostFeed.tsx"
        issue: "LikeButton destructures only isLiked/likeCount/toggle from useLikes; whoLiked is discarded and never rendered"
    missing:
      - "In LikeButton (or a sibling WhoLikedDisplay), also destructure whoLiked from useLikes"
      - "After the heart button/count, render: when whoLiked.length > 0, a <span style={{fontSize:12, color:'#64748b', marginLeft:4}}>Liked by: {first3Names}{maybeAndMore}</span>"
      - "This directly satisfies REAC-06 (user can view list of users who liked a post)"
human_verification:
  - test: "Open app in browser, sign in, select a room, like a post, confirm 'Liked by: [display name]' appears"
    expected: "Compact liked-by text renders below like button with first 3 display names"
    why_human: "Requires running social-api locally; visual rendering cannot be verified statically"
  - test: "Click a group room in GroupPanel, create group-scoped room via RoomList"
    expected: "POST /api/groups/:groupId/rooms is called and new room appears in list with type='group'"
    why_human: "createGroupRoom missing — needs implementation and then browser test"
  - test: "Select a room and confirm member list populates via REST before any WS events"
    expected: "Members list shows existing members immediately on room selection"
    why_human: "loadMembers missing — needs implementation and then browser test"
---

# Phase 32: Frontend Social Layer Verification Report

**Phase Goal:** Users can interact with all social features through a React UI — profiles, friends, groups, rooms, posts, comments, and likes — built with reusable hooks and components
**Verified:** 2026-03-17T20:40:00Z
**Status:** gaps_found
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | All 7 social hooks export their documented return shapes and compile with zero TypeScript errors | PARTIAL | All 7 files exist and tsc exits 0, but usePosts and useRooms return shapes omit documented members (getUserPosts, createGroupRoom, loadMembers) |
| 2 | Each hook calls the correct social-api endpoint using the Cognito idToken as a Bearer token | VERIFIED | Every hook reads VITE_SOCIAL_API_URL and sends `Authorization: Bearer ${idToken}` — confirmed in useSocialProfile.ts, useFriends.ts, useGroups.ts, useRooms.ts, usePosts.ts, useComments.ts, useLikes.ts |
| 3 | usePosts and useComments accept an onMessage prop and prepend/append items when matching WS events arrive | VERIFIED | usePosts (line 100): `social:post` prepends with `_fadeIn: true`; useComments (line 94): `social:comment` appends with `_fadeIn: true` — exact ref pattern from useReactions.ts |
| 4 | useLikes accepts onMessage and updates likeCount in-place when a social:like WS event arrives | VERIFIED | useLikes (line 95): `msg.type === 'social:like'` triggers `setLikeCount(msg.likeCount as number)` — integer swap, no animation |
| 5 | useGroups exposes deleteGroup(groupId) which calls DELETE /api/groups/:groupId and removes the group from state | VERIFIED | useGroups.ts (line 93-109): DELETE endpoint called; `setGroups(prev => prev.filter(g => g.groupId !== groupId))` on 200 |
| 6 | useRooms accepts onMessage and handles social:member_joined (append) / social:member_left (remove) for the active room | VERIFIED | useRooms.ts (lines 102-120): WS handler checks `msg.roomId === activeRoomRef.current`, appends on joined, filters on left |
| 7 | useRooms exposes createGroupRoom(groupId, name) which calls POST /api/groups/:groupId/rooms and prepends the returned RoomItem | FAILED | createGroupRoom is absent from useRooms.ts entirely — not in UseRoomsReturn interface, not implemented |
| 8 | useRooms exposes loadMembers(roomId) which calls GET /api/rooms/:roomId/members and seeds members state; setActiveRoom calls loadMembers when room is non-null | FAILED | loadMembers absent from useRooms.ts; setActiveRoom (lines 124-127) only updates activeRoomRef and state, never fetches members |
| 9 | usePosts exposes getUserPosts(userId) which calls GET /api/posts/:userId and returns PostItem[] | FAILED | getUserPosts absent from usePosts.ts entirely — not in UsePostsReturn interface, not implemented |
| 10 | PostFeed's PostCard PostActions row shows a compact 'Liked by' display using the whoLiked array from useLikes | FAILED | LikeButton in PostFeed.tsx (lines 128-150) destructures only `{isLiked, likeCount, toggle}` — whoLiked is discarded; no WhoLikedDisplay or "Liked by:" text in the file |

**Score:** 6/10 truths fully verified (1 partial, 3 failed)

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `frontend/src/hooks/useSocialProfile.ts` | useSocialProfile hook | VERIFIED | Exports `useSocialProfile`, full fetch/update/viewProfile implementation, Bearer auth |
| `frontend/src/hooks/useFriends.ts` | useFriends hook | VERIFIED | Exports `useFriends`, parallel fetch of 3 lists, follow/unfollow with refresh |
| `frontend/src/hooks/useGroups.ts` | useGroups hook | VERIFIED | Exports `useGroups`, full CRUD including deleteGroup (GRUP-02), loadMembers |
| `frontend/src/hooks/useRooms.ts` | useRooms hook | STUB | Exports `useRooms` but missing `createGroupRoom` (ROOM-02) and `loadMembers` (ROOM-06) — hook return shape is incomplete |
| `frontend/src/hooks/usePosts.ts` | usePosts hook | STUB | Exports `usePosts` but missing `getUserPosts` (CONT-05) — hook return shape is incomplete |
| `frontend/src/hooks/useComments.ts` | useComments hook | VERIFIED | Exports `useComments`, full fetch/create/delete, social:comment WS handler |
| `frontend/src/hooks/useLikes.ts` | useLikes hook | VERIFIED | Exports `useLikes`, toggle with optimistic update, social:like WS handler, comment likes endpoint, reactWithEmoji |
| `frontend/src/components/SocialPanel.tsx` | SocialPanel with live hooks | VERIFIED | Uses useSocialProfile and useFriends; no MockDataBanner, MOCK_USERS, or CURRENT_USER |
| `frontend/src/components/GroupPanel.tsx` | GroupPanel exported component | VERIFIED | Exports `GroupPanel`, calls `useGroups`, owner-only Delete button (dc2626 color, ownerId === currentUserId guard) |
| `frontend/src/components/RoomList.tsx` | RoomList exported component | VERIFIED | Exports `RoomList`, calls `useRooms({ idToken, onMessage })` — onMessage forwarded so RTIM-04 works |
| `frontend/src/components/PostFeed.tsx` | PostFeed exported component | STUB | Exports `PostFeed`, uses usePosts/useLikes, CommentThread inline — but LikeButton discards `whoLiked`; no WhoLikedDisplay (REAC-06 missing) |
| `frontend/src/components/CommentThread.tsx` | CommentThread exported component | VERIFIED | Exports `CommentThread`, uses useComments, reply indentation at paddingLeft:32, fade-in animation |
| `frontend/src/components/AppLayout.tsx` | AppLayout with social section wired | VERIFIED | Imports GroupPanel/RoomList/PostFeed; idToken+onMessage props added; SocialPanel updated to receive props |
| `frontend/src/app/App.tsx` | GatewayDemo with social props passed | VERIFIED | `idToken={auth.idToken}` and `onMessage={onMessage}` passed to AppLayout (lines 264-265) |
| `frontend/.env.example` | VITE_SOCIAL_API_URL entry | VERIFIED | Line 16: `VITE_SOCIAL_API_URL=http://localhost:3001` |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| useSocialProfile.ts | social-api /api/profiles | Authorization: Bearer idToken | WIRED | Line 55: `Authorization: \`Bearer ${idToken}\`` in authHeaders; line 75: `fetch(${baseUrl}/api/profiles/${sub}` |
| usePosts.ts | onMessage handler | social:post prepend | WIRED | Lines 98-113: WS handler, `msg.type === 'social:post'` prepends with _fadeIn |
| usePosts.ts | GET /api/posts/:userId (getUserPosts) | getUserPosts(userId) | NOT WIRED | Function absent — no fetch to /api/posts/:userId anywhere in usePosts.ts |
| useLikes.ts | onMessage handler | social:like integer swap | WIRED | Lines 93-102: `msg.type === 'social:like'` calls `setLikeCount(msg.likeCount)` |
| useGroups.ts | DELETE /api/groups/:groupId | deleteGroup(groupId) removes from state | WIRED | Lines 93-109: DELETE endpoint + state filter on success |
| useRooms.ts | POST /api/groups/:groupId/rooms (createGroupRoom) | createGroupRoom prepends RoomItem | NOT WIRED | createGroupRoom absent entirely |
| useRooms.ts | GET /api/rooms/:roomId/members (loadMembers) | loadMembers called inside setActiveRoom | NOT WIRED | loadMembers absent; setActiveRoom never fetches members |
| useRooms.ts | onMessage handler | social:member_joined/left | WIRED | Lines 102-120: both events handled against activeRoomRef |
| SocialPanel.tsx | useSocialProfile.ts | import useSocialProfile | WIRED | Line 7: `import { useSocialProfile } from '../hooks/useSocialProfile'` |
| GroupPanel.tsx | useGroups.ts | useGroups, deleteGroup for GRUP-02 | WIRED | Lines 7-8 import, line 311 destructures deleteGroup, line 412 passes to GroupCard |
| RoomList.tsx | useRooms.ts | useRooms({ idToken, onMessage }) forwarding onMessage | WIRED | Line 7 import; onMessage forwarded to hook in component body |
| PostFeed.tsx | useLikes.ts | whoLiked array for REAC-06 | NOT WIRED | LikeButton (lines 128-150) destructures only `{isLiked, likeCount, toggle}` — whoLiked discarded |
| PostFeed.tsx | CommentThread.tsx | inline CommentThread expansion | WIRED | Lines 343-351: `<CommentThread ... />` rendered when showComments is true |
| AppLayout.tsx | RoomList.tsx | onMessage={onMessage} forwarded for RTIM-04 | WIRED | Lines 322-323: `onMessage={onMessage}` passed to RoomList |
| AppLayout.tsx | GroupPanel.tsx | import GroupPanel, rendered in content | WIRED | Line 32 import; line 318: `<GroupPanel idToken={idToken} />` |
| AppLayout.tsx | PostFeed.tsx | import PostFeed, pass activeRoomId | WIRED | Line 34 import; line 329: `<PostFeed idToken={idToken} roomId={activeRoomId} onMessage={onMessage} />` |
| App.tsx | AppLayout.tsx | auth.idToken and onMessage passed | WIRED | Lines 264-265: `idToken={auth.idToken}` and `onMessage={onMessage}` |

### Requirements Coverage

| Requirement | Description | Status | Evidence |
|-------------|-------------|--------|----------|
| PROF-01 | User can create a social profile | SATISFIED | useSocialProfile.ts handles POST /api/profiles; SocialPanel renders profile form |
| PROF-02 | User can update their profile | SATISFIED | updateProfile() in useSocialProfile.ts calls PUT /api/profiles; ProfileCard.onSave wired |
| PROF-03 | User can view their own profile | SATISFIED | On-mount fetch GET /api/profiles/:sub in useSocialProfile.ts |
| PROF-04 | User can view another user's public profile | SATISFIED | viewProfile(userId) in useSocialProfile.ts calls GET /api/profiles/:userId |
| PROF-05 | User can set profile visibility | SATISFIED | updateProfile accepts `{visibility}` partial; PUT /api/profiles wired |
| SOCL-01 | User can follow another user | SATISFIED | follow(userId) in useFriends.ts calls POST /api/social/follow/:userId |
| SOCL-02 | User can unfollow a user | SATISFIED | unfollow(userId) in useFriends.ts calls DELETE /api/social/follow/:userId |
| SOCL-03 | Mutual follows surface as friends | SATISFIED | useFriends.ts fetches GET /api/social/friends; SocialPanel renders friends list |
| SOCL-04 | User can view followers | SATISFIED | useFriends.ts fetches GET /api/social/followers |
| SOCL-05 | User can view following | SATISFIED | useFriends.ts fetches GET /api/social/following |
| SOCL-06 | User can view mutual friends | SATISFIED | useFriends.ts fetches GET /api/social/friends; rendered in SocialPanel |
| GRUP-01 | User can create a group | SATISFIED | createGroup() in useGroups.ts calls POST /api/groups; CreateGroupForm in GroupPanel |
| GRUP-02 | User can delete a group they own | SATISFIED | deleteGroup() in useGroups.ts calls DELETE /api/groups/:groupId; GroupPanel shows Delete button only when ownerId === currentUserId |
| GRUP-03 | Group owner/admin can invite users | SATISFIED | inviteUser() in useGroups.ts calls POST /api/groups/:groupId/invite; InviteForm in GroupPanel |
| GRUP-04 | User can accept/decline invitation | SATISFIED | acceptInvite() in useGroups.ts calls POST /api/groups/:groupId/accept |
| GRUP-05 | User can set group visibility | SATISFIED | createGroup accepts visibility param; GroupPanel CreateGroupForm has visibility radio |
| GRUP-06 | User can join a public group | SATISFIED | joinGroup() in useGroups.ts calls POST /api/groups/:groupId/join |
| GRUP-07 | User can leave a group | SATISFIED | leaveGroup() in useGroups.ts calls DELETE /api/groups/:groupId/leave; removes from state |
| GRUP-08 | Group members have roles | SATISFIED | MemberItem type has role field; GroupPanel MemberList shows role badges |
| GRUP-09 | User can view group members | SATISFIED | loadMembers() in useGroups.ts calls GET /api/groups/:groupId/members; MemberList renders |
| ROOM-01 | User can create a standalone room | SATISFIED | createRoom() in useRooms.ts calls POST /api/rooms; CreateRoomForm in RoomList |
| ROOM-02 | Group owner/admin can create group-scoped rooms | BLOCKED | createGroupRoom() absent from useRooms.ts — POST /api/groups/:groupId/rooms never called from frontend |
| ROOM-03 | Two mutual friends can open DM room | SATISFIED | createDM() in useRooms.ts calls POST /api/rooms/dm; DMRoomButton in RoomList |
| ROOM-04 | Room membership persisted in DynamoDB | NEEDS HUMAN | Backend concern verified in Phase 28; frontend hook calls correct endpoints |
| ROOM-05 | Each room maps to a WebSocket channel | NEEDS HUMAN | Backend concern; RoomItem has channelId field in type definition |
| ROOM-06 | User can view room member list | BLOCKED | loadMembers() absent from useRooms.ts — members are never seeded from REST; setActiveRoom does not call GET /api/rooms/:roomId/members |
| ROOM-07 | Room has persistent post history | NEEDS HUMAN | Backend concern; usePosts fetches paginated history from GET /api/rooms/:roomId/posts |
| ROOM-08 | User can list rooms they belong to | SATISFIED | On-mount fetch GET /api/rooms in useRooms.ts; RoomList renders all rooms |
| CONT-01 | User can create a text post | SATISFIED | createPost() in usePosts.ts calls POST /api/rooms/:roomId/posts; CreatePostForm in PostFeed |
| CONT-02 | User can edit their own post | SATISFIED | editPost() in usePosts.ts calls PUT; PostCard shows Edit/Save for own posts |
| CONT-03 | User can delete their own post | SATISFIED | deletePost() in usePosts.ts calls DELETE; PostCard shows Delete confirm for own posts |
| CONT-04 | User can view paginated post feed | SATISFIED | usePosts.ts fetches with lastKey pagination; hasMore/loadMore exposed; PostFeed renders |
| CONT-05 | User can view all posts by a user | BLOCKED | getUserPosts() absent from usePosts.ts — no GET /api/posts/:userId call exists in frontend |
| CONT-06 | User can comment on a post | SATISFIED | createComment() in useComments.ts calls POST; CommentThread has ReplyForm |
| CONT-07 | User can reply to a comment (threaded) | SATISFIED | createComment accepts parentCommentId; CommentItem rendered with paddingLeft:32 for replies |
| CONT-08 | User can delete their own comment | SATISFIED | deleteComment() in useComments.ts calls DELETE; CommentItem shows Delete confirm for own |
| REAC-01 | User can like a post | SATISFIED | toggle() in useLikes.ts calls POST /api/rooms/:roomId/posts/:postId/likes; LikeButton in PostFeed |
| REAC-02 | User can unlike a post | SATISFIED | toggle() calls DELETE when isLiked; optimistic revert on failure |
| REAC-03 | User can like a comment | SATISFIED | useLikes targets comment likes endpoint when commentId non-null |
| REAC-04 | User can unlike a comment | SATISFIED | toggle() calls DELETE for comment likes endpoint |
| REAC-05 | User can react with emoji | SATISFIED | reactWithEmoji() in useLikes.ts calls POST /api/rooms/:roomId/posts/:postId/reactions; EmojiReactionBar renders 12 emoji buttons |
| REAC-06 | User can view total like count and who liked | BLOCKED | whoLiked array exists in useLikes.ts state but PostFeed.tsx's LikeButton discards it — no "Liked by:" display rendered |
| RTIM-01 | New posts broadcast via WS | SATISFIED | usePosts.ts WS handler prepends social:post to feed with fade-in |
| RTIM-02 | New comments broadcast via WS | SATISFIED | useComments.ts WS handler appends social:comment with fade-in |
| RTIM-03 | New likes broadcast via WS | SATISFIED | useLikes.ts WS handler integer-swaps likeCount on social:like |
| RTIM-04 | Room member join/leave events broadcast | SATISFIED | useRooms.ts WS handler appends on social:member_joined, removes on social:member_left; RoomList forwards onMessage to hook |

### Anti-Patterns Found

| File | Location | Pattern | Severity | Impact |
|------|----------|---------|----------|--------|
| `frontend/src/hooks/useRooms.ts` | Line 212-224 (return object) | Missing documented return members: createGroupRoom, loadMembers | BLOCKER | ROOM-02 and ROOM-06 features not accessible to any component |
| `frontend/src/hooks/usePosts.ts` | Line 200-210 (return object) | Missing documented return member: getUserPosts | BLOCKER | CONT-05 user post history not accessible |
| `frontend/src/components/PostFeed.tsx` | Line 129 (LikeButton) | whoLiked destructured from useLikes but immediately discarded | BLOCKER | REAC-06 who-liked display never rendered |

### Human Verification Required

#### 1. Visual rendering of "Liked by" display (REAC-06)

**Test:** After implementing whoLiked display in LikeButton/PostFeed, open a room, like a post, confirm the "Liked by: [name]" text appears below the heart button
**Expected:** Compact span with first 3 liked-by names visible; if none have liked yet, span is absent
**Why human:** Requires running social-api + frontend locally; visual CSS rendering cannot be verified statically

#### 2. Group-scoped room creation flow (ROOM-02)

**Test:** After implementing createGroupRoom in useRooms, create a group, then select the group and attempt to create a group-scoped room
**Expected:** POST /api/groups/:groupId/rooms is called; new room appears in RoomList with type badge showing "group"
**Why human:** createGroupRoom is currently missing — needs implementation first, then browser flow verification

#### 3. Room member list seeding (ROOM-06)

**Test:** After implementing loadMembers in useRooms (called inside setActiveRoom), click a room to select it and confirm the member list populates immediately from the REST response
**Expected:** Members visible before any WS events; existing members shown upon selection
**Why human:** loadMembers is currently missing — needs implementation first

#### 4. Cross-tab real-time post delivery (RTIM-01)

**Test:** Open two browser tabs with different Cognito test users, both in the same room; post from tab 1, confirm post appears in tab 2 within 1 second
**Expected:** Post fades in on tab 2 via social:post WS event; 200ms opacity transition visible
**Why human:** Requires two authenticated sessions and a running WebSocket gateway

### Gaps Summary

Four gaps block full goal achievement. They share a common pattern: functions were documented in the PLAN's must_haves, required by specific requirement IDs, but were not implemented.

**Gap 1 — useRooms missing createGroupRoom (ROOM-02):** The `UseRoomsReturn` interface and `useRooms` implementation both omit `createGroupRoom`. No component in the UI can trigger POST /api/groups/:groupId/rooms. Group-scoped room creation is entirely absent from the frontend. The RoomList component also has no UI surface for it (though adding the hook function is the critical fix).

**Gap 2 — useRooms missing loadMembers (ROOM-06):** The `loadMembers` function that should call GET /api/rooms/:roomId/members and seed the members state is absent. `setActiveRoom` never triggers a REST fetch, so the members list is always empty on room selection — it only populates via WS delta events (social:member_joined), meaning existing members at the time of selection are invisible.

**Gap 3 — usePosts missing getUserPosts (CONT-05):** The `getUserPosts(userId)` function that fetches GET /api/posts/:userId is absent. No component can display a user's post history. This is a standalone fetch helper (does not mutate posts state) that components like a "user profile posts" tab would use.

**Gap 4 — PostFeed missing whoLiked display (REAC-06):** `useLikes` correctly fetches `whoLiked: PublicProfile[]` from GET /api/rooms/:roomId/posts/:postId/likes and keeps it in state. However, `PostFeed.tsx`'s `LikeButton` sub-component only destructures `{isLiked, likeCount, toggle}`, discarding `whoLiked`. No "Liked by: name1, name2…" display is rendered anywhere in PostFeed, making REAC-06 unachievable from the UI.

All four gaps are small, focused additions. Gaps 1-3 are hook-only (no component changes needed beyond what already exists). Gap 4 is a component-only change (the hook data is already present).

---

_Verified: 2026-03-17T20:40:00Z_
_Verifier: Claude (gsd-verifier)_
