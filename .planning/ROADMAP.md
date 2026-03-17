# Roadmap: WebSocket Gateway - AWS Migration & Hardening

## Milestones

- ✅ **v1.0 MVP - Production-Ready WebSocket Gateway** — Phases 1-4 (shipped 2026-03-03)
- ✅ **v1.1 Enhanced Reliability** — Phase 5 (shipped 2026-03-03)
- ✅ **v1.2 Frontend Layer** — Phases 6-10 (shipped 2026-03-10)
- ✅ **v1.3 User Auth & Identity** — Phases 11-14 (shipped 2026-03-11)
- ✅ **v1.4 UI Polish & Feature Completeness** — Phases 15-19 (shipped 2026-03-14)
- 🔧 **v1.5 Production Hardening** — Phases 20-24 (Deferred — skipped in favor of v2.0)
- 🚧 **v2.0 Social Platform** — Phases 25-32 (in progress)

## Phases

<details>
<summary>✅ v1.0 MVP - Production-Ready WebSocket Gateway (Phases 1-4) — SHIPPED 2026-03-03</summary>

See: `.planning/milestones/v1.0-ROADMAP.md` for full details

</details>

<details>
<summary>✅ v1.1 Enhanced Reliability (Phase 5) — SHIPPED 2026-03-03</summary>

See: `.planning/milestones/v1.1-ROADMAP.md` for full details

</details>

<details>
<summary>✅ v1.2 Frontend Layer (Phases 6-10) — SHIPPED 2026-03-10</summary>

- [x] Phase 6: Foundation — React+Vite scaffold, useWebSocket hook, connection status UI (3/3 plans) — completed 2026-03-04
- [x] Phase 7: Presence & Cursors — usePresence + PresencePanel, useCursors all 4 modes (4/4 plans) — completed 2026-03-10
- [x] Phase 8: Chat — useChat hook + ChatPanel with scrollback history (1/1 plan) — completed 2026-03-10
- [x] Phase 9: CRDT Editor — useCRDT + SharedTextEditor with Y.js + snapshot restore (2/2 plans) — completed 2026-03-10
- [x] Phase 10: Reactions & Dev Tools — useReactions + overlay, EventLog, ErrorPanel, disconnect/reconnect (3/3 plans) — completed 2026-03-10

See: `.planning/milestones/v1.2-ROADMAP.md` for full details

</details>

<details>
<summary>✅ v1.3 User Auth & Identity (Phases 11-14) — SHIPPED 2026-03-11</summary>

- [x] Phase 11: Auth Foundation — useAuth hook (TDD), LoginForm/SignupForm, App.tsx auth gating (3/3 plans) — completed 2026-03-11
- [x] Phase 12: Identity Integration — identity.ts utility, displayName propagation, ChatPanel attribution (2/2 plans) — completed 2026-03-11
- [x] Phase 13: Session Management — token refresh, multi-tab sync, create/list-test-users.sh scripts (2/2 plans) — completed 2026-03-11
- [x] Phase 14: Gap Closure — AUTH-09 token reconnect, PRES-03 typing wiring (1/1 plan) — completed 2026-03-11

See: `.planning/milestones/v1.3-ROADMAP.md` for full details

</details>

<details>
<summary>✅ v1.4 UI Polish & Feature Completeness (Phases 15-19) — SHIPPED 2026-03-14</summary>

- [x] Phase 15: Cleanup — Delete HTML test clients, SDK files, and stale build artifacts (1/1 plan) — completed 2026-03-12
- [x] Phase 16: Reaction Animations — Port 12-emoji system with distinct animations (1/1 plan) — completed 2026-03-12
- [x] Phase 17: UI Layout & Polish — Restructure app into clean 2-column layout (2/2 plans) — completed 2026-03-12
- [x] Phase 18: Typing Indicators & Presence Polish — Surface typing in chat + presence (1/1 plan) — completed 2026-03-12
- [x] Phase 19: Per-Service Dev Tools — TabbedEventLog with per-service filtering (2/2 plans) — completed 2026-03-14

See: `.planning/milestones/v1.4-ROADMAP.md` for full details

</details>


### 🔧 v1.5 Production Hardening (Phases 20-24) — DEFERRED

> Deferred in favor of v2.0 Social Platform. Address in a future dedicated hardening pass once the social layer ships.

- [ ] Phase 20: Error Handling & Observability — Promise rejection handling, metrics health tracking, correlation ID propagation, validation error context (1 plan)
- [ ] Phase 21: Connection & Subscription Resilience — Atomic subscription restore with rollback, guaranteed disconnect cleanup, JWT secure transport (1 plan)
- [ ] Phase 22: Broadcast & Ordering — Non-blocking batched broadcast, per-channel sequence numbers for ordering (1 plan)
- [ ] Phase 23: Resource Management — Bounded session store (LRU), presence race fix, timer tracking, O(n) channel cleanup (1 plan)
- [ ] Phase 24: Input Validation & Telemetry — Metadata size/key limits, reconnection metrics (1 plan)

**Execution waves:**
- Wave 1 (parallel): Phase 20, Phase 22 (independent)
- Wave 2 (parallel, depends on 20/21): Phase 21, Phase 23, Phase 24


### 🚧 v2.0 Social Platform (Phases 25-32)

**Milestone Goal:** Add a full social layer on top of the existing real-time gateway — user profiles, follow/friend graph, groups, rooms (standalone + group + DM), posts, threaded comments, likes with attribution, and real-time broadcast of social events to room members — all keyed on Cognito `sub` for referential integrity and cross-app reuse.

- [x] **Phase 25: Social Infrastructure** — New CDK social-stack, all 9 DynamoDB tables, Express social-api base with Cognito auth middleware (completed 2026-03-16)
- [x] **Phase 26: User Profiles & Social Graph** — Profile CRUD endpoints and follow/unfollow/friends REST API (completed 2026-03-17)
- [x] **Phase 27: Groups** — Group CRUD, membership management, roles, visibility, and invitations (completed 2026-03-17)
- [x] **Phase 28: Rooms** — Standalone, group-scoped, and DM room CRUD, membership, and WS channel mapping (completed 2026-03-17)
- [x] **Phase 29: Posts & Comments** — Text posts in rooms, threaded comments, post feed, and user post history (completed 2026-03-17)
- [x] **Phase 30: Reactions & Likes** — Like with attribution, unlike, emoji reactions, and who-liked (completed 2026-03-17)
- [x] **Phase 31: Real-time Integration** — Extend WebSocket gateway with social event types broadcast to room members (completed 2026-03-17)
- [ ] **Phase 32: Frontend Social Layer** — React hooks and UI components for the complete social feature set

## Phase Details

### Phase 25: Social Infrastructure
**Goal**: A deployable social-api service with all DynamoDB tables and Cognito-authenticated base routing exists and is reachable — the foundation every subsequent phase builds on
**Depends on**: Phase 19 (existing gateway and Cognito auth middleware)
**Requirements**: None (infrastructure foundation — enables PROF, SOCL, GRUP, ROOM, CONT, REAC, RTIM)
**Success Criteria** (what must be TRUE):
  1. `cdk deploy social-stack` succeeds and all 9 DynamoDB tables (social-profiles, social-relationships, social-groups, social-group-members, social-rooms, social-room-members, social-posts, social-comments, social-likes) are visible in the AWS console
  2. The social-api Express service starts locally and responds to `GET /health` with 200
  3. A request to any social-api route without a valid Cognito JWT is rejected with 401
  4. A request with a valid Cognito JWT passes auth middleware and reaches the route handler
**Plans**: 1 plan

Plans:
- [ ] 25-01-PLAN.md — CDK social-stack with 9 DynamoDB tables + social-api Express service with Cognito auth middleware

### Phase 26: User Profiles & Social Graph
**Goal**: Users can manage their own social profile and build a social graph by following and unfollowing other users, with mutual follows surfacing as friendships
**Depends on**: Phase 25
**Requirements**: PROF-01, PROF-02, PROF-03, PROF-04, PROF-05, SOCL-01, SOCL-02, SOCL-03, SOCL-04, SOCL-05, SOCL-06
**Success Criteria** (what must be TRUE):
  1. User can create a profile with display name, bio, and avatar URL; the profile is stored under their Cognito `sub`
  2. User can update their own profile fields and retrieve the updated values immediately
  3. User can view another user's public profile; a private profile returns 404 or 403 for non-friends
  4. User can follow another user and the follow relationship is persisted; unfollowing removes it
  5. Two users who follow each other both appear in each other's friends list
**Plans**: 3 plans

Plans:
- [ ] 26-01: Profile CRUD REST endpoints (POST/GET/PUT /profiles, visibility toggle)
- [ ] 26-02: Follow/unfollow/friends REST endpoints (followers, following, mutual friends)
- [ ] 26-03: Demo UI — Social section card with mock data (ProfileCard, FollowButton, SocialGraphPanel)

### Phase 27: Groups
**Goal**: Users can create and manage groups with role-based membership, visibility controls, and invitation flows
**Depends on**: Phase 26
**Requirements**: GRUP-01, GRUP-02, GRUP-03, GRUP-04, GRUP-05, GRUP-06, GRUP-07, GRUP-08, GRUP-09
**Success Criteria** (what must be TRUE):
  1. User can create a group, becoming its owner; the owner can delete the group
  2. Owner or admin can invite a user by Cognito userId; the invited user can accept or decline
  3. A public group is joinable without invitation; a private group requires invitation
  4. A member can leave a group; their membership is removed from the member list
  5. Group member list shows each member's role (owner / admin / member) and enforces that only owner/admin can invite
**Plans**: 2 plans

Plans:
- [ ] 27-01-PLAN.md — Group CRUD and visibility REST endpoints (create, delete, get, update visibility)
- [ ] 27-02-PLAN.md — Membership management REST endpoints (invite, accept/decline, join, leave, list members with roles)

### Phase 28: Rooms
**Goal**: Users can create standalone rooms, group sub-rooms, and DM rooms; membership and WebSocket channel mapping are persisted so real-time events can be delivered to members
**Depends on**: Phase 27
**Requirements**: ROOM-01, ROOM-02, ROOM-03, ROOM-04, ROOM-05, ROOM-06, ROOM-07, ROOM-08
**Success Criteria** (what must be TRUE):
  1. User can create a standalone room by name; the room record appears in DynamoDB keyed on Cognito `sub`
  2. Group owner/admin can create a room scoped to their group; non-admins cannot
  3. Two mutual friends can open a DM room; the room is not created if they are not mutual friends
  4. Each room record contains a WebSocket channel ID that the gateway can route events to
  5. User can list all rooms they are a member of and view the member list for any room they belong to
**Plans**: 2 plans

Plans:
- [ ] 28-01-PLAN.md — rooms.ts + group-rooms.ts: standalone/DM/group-scoped room CRUD with channelId mapping (ROOM-01, ROOM-02, ROOM-03, ROOM-05, ROOM-07)
- [ ] 28-02-PLAN.md — room-members.ts + index.ts mount: join, list members, list my rooms (ROOM-04, ROOM-06, ROOM-08)

### Phase 29: Posts & Comments
**Goal**: Users can create, edit, delete, and read text posts in rooms, and hold threaded comment conversations on those posts
**Depends on**: Phase 28
**Requirements**: CONT-01, CONT-02, CONT-03, CONT-04, CONT-05, CONT-06, CONT-07, CONT-08
**Success Criteria** (what must be TRUE):
  1. User can create a text post in a room they are a member of; non-members are rejected
  2. User can edit or delete their own post; they cannot edit or delete another user's post
  3. User can retrieve a paginated post feed for a room, with the most recent posts first
  4. User can view all posts authored by a specific user
  5. User can comment on a post and reply to an existing comment (nested thread); user can delete their own comment
**Plans**: 2 plans

Plans:
- [ ] 29-01-PLAN.md — posts.ts: post CRUD, paginated room feed (ULID sort), user post history (CONT-01, CONT-02, CONT-03, CONT-04, CONT-05)
- [ ] 29-02-PLAN.md — comments.ts + index.ts wiring: threaded comments, replies, delete (CONT-06, CONT-07, CONT-08)

### Phase 30: Reactions & Likes
**Goal**: Users can like and unlike posts and comments with attribution, react with emoji, and see who has liked a post
**Depends on**: Phase 29
**Requirements**: REAC-01, REAC-02, REAC-03, REAC-04, REAC-05, REAC-06
**Success Criteria** (what must be TRUE):
  1. User can like a post; the like is stored with their Cognito `sub` as attribution
  2. User can unlike a post they previously liked; the like record is removed
  3. User can like and unlike a comment with the same attribution behavior
  4. User can react to a post with one of the 12 supported emoji types
  5. User can retrieve the total like count and the list of user display names who liked a post
**Plans**: 2 plans

Plans:
- [ ] 30-01-PLAN.md — likes.ts: like/unlike posts and comments with attribution, who-liked endpoint (REAC-01, REAC-02, REAC-03, REAC-04, REAC-06)
- [x] 30-02-PLAN.md — reactions.ts + index.ts wiring: emoji reactions on posts, all Phase 30 router mounts (REAC-05) (completed 2026-03-17)

### Phase 31: Real-time Integration
**Goal**: Social events (new posts, comments, likes, member join/leave) are broadcast in real-time via the existing WebSocket gateway to all room members
**Depends on**: Phase 30
**Requirements**: RTIM-01, RTIM-02, RTIM-03, RTIM-04
**Success Criteria** (what must be TRUE):
  1. When a user posts in a room, all other connected room members receive a `social:post` WebSocket event within 50ms
  2. When a comment is created on a post, connected room members receive a `social:comment` event
  3. When a like is recorded, connected room members receive a `social:like` event
  4. When a user joins or leaves a room, existing connected members receive a `social:member_joined` or `social:member_left` event
**Plans**: 3 plans

Plans:
- [ ] 31-01-PLAN.md — BroadcastService in social-api + wire into posts, comments, likes, reactions, room-members routes (RTIM-01, RTIM-02, RTIM-03, RTIM-04)
- [ ] 31-02-PLAN.md — SocialService in gateway + validator whitelist: clients subscribe to room channels via WS (RTIM-01, RTIM-02, RTIM-03, RTIM-04)
- [ ] 31-03-PLAN.md — End-to-end integration test script validating social event delivery (RTIM-01, RTIM-02, RTIM-03, RTIM-04)

### Phase 32: Frontend Social Layer
**Goal**: Users can interact with all social features through a React UI — profiles, friends, groups, rooms, posts, comments, and likes — built with reusable hooks and components
**Depends on**: Phase 31
**Requirements**: (UI delivery of PROF-01–05, SOCL-01–06, GRUP-01–09, ROOM-01–08, CONT-01–08, REAC-01–06, RTIM-01–04)
**Success Criteria** (what must be TRUE):
  1. User can view and edit their social profile via a ProfileCard component in the UI
  2. User can follow/unfollow users and see their friends list in a FriendsList component
  3. User can create and join groups and rooms, navigate between them in the GroupPanel and RoomList components
  4. User can read and write posts and threaded comments in the PostFeed and CommentThread components
  5. User can like posts and comments via a LikeButton component; real-time social events update the UI without a page refresh
**Plans**: 3 plans

Plans:
- [ ] 32-01-PLAN.md — React hooks (useSocialProfile, useFriends, useGroups, useRooms, usePosts, useComments, useLikes) with real-time WS event handlers
- [ ] 32-02-PLAN.md — UI components (SocialPanel live, GroupPanel, RoomList, PostFeed, CommentThread)
- [ ] 32-03-PLAN.md — AppLayout + App.tsx wiring + human verification checkpoint

## Progress

**Execution Order:** Phases execute in numeric order: 1 → 2 → ... → 19 → [20-24 deferred] → 25 → 26 → 27 → 28 → 29 → 30 → 31 → 32

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1-4 | v1.0 | 13/13 | Complete | 2026-03-03 |
| 5 | v1.1 | 4/4 | Complete | 2026-03-03 |
| 6. Foundation | v1.2 | 3/3 | Complete | 2026-03-04 |
| 7. Presence & Cursors | v1.2 | 4/4 | Complete | 2026-03-10 |
| 8. Chat | v1.2 | 1/1 | Complete | 2026-03-10 |
| 9. CRDT Editor | v1.2 | 2/2 | Complete | 2026-03-10 |
| 10. Reactions & Dev Tools | v1.2 | 3/3 | Complete | 2026-03-10 |
| 11. Auth Foundation | v1.3 | 3/3 | Complete | 2026-03-11 |
| 12. Identity Integration | v1.3 | 2/2 | Complete | 2026-03-11 |
| 13. Session Management | v1.3 | 2/2 | Complete | 2026-03-11 |
| 14. Gap Closure | v1.3 | 1/1 | Complete | 2026-03-11 |
| 15. Cleanup | v1.4 | 1/1 | Complete | 2026-03-12 |
| 16. Reaction Animations | v1.4 | 1/1 | Complete | 2026-03-12 |
| 17. UI Layout & Polish | v1.4 | 2/2 | Complete | 2026-03-12 |
| 18. Typing Indicators & Presence Polish | v1.4 | 1/1 | Complete | 2026-03-12 |
| 19. Per-Service Dev Tools | v1.4 | 2/2 | Complete | 2026-03-14 |
| 20. Error Handling & Observability | v1.5 | 0/1 | Deferred | — |
| 21. Connection & Subscription Resilience | v1.5 | 0/1 | Deferred | — |
| 22. Broadcast & Ordering | v1.5 | 0/1 | Deferred | — |
| 23. Resource Management | v1.5 | 0/1 | Deferred | — |
| 24. Input Validation & Telemetry | v1.5 | 0/1 | Deferred | — |
| 25. Social Infrastructure | 1/1 | Complete    | 2026-03-16 | — |
| 26. User Profiles & Social Graph | 3/3 | Complete    | 2026-03-17 | — |
| 27. Groups | 2/2 | Complete    | 2026-03-17 | — |
| 28. Rooms | 2/2 | Complete    | 2026-03-17 | — |
| 29. Posts & Comments | 2/2 | Complete    | 2026-03-17 | — |
| 30. Reactions & Likes | 2/2 | Complete    | 2026-03-17 | — |
| 31. Real-time Integration | 4/4 | Complete    | 2026-03-17 | — |
| 32. Frontend Social Layer | 1/3 | In Progress|  | — |
