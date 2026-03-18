# Roadmap: WebSocket Gateway - AWS Migration & Hardening

## Milestones

- ✅ **v1.0 MVP - Production-Ready WebSocket Gateway** — Phases 1-4 (shipped 2026-03-03)
- ✅ **v1.1 Enhanced Reliability** — Phase 5 (shipped 2026-03-03)
- ✅ **v1.2 Frontend Layer** — Phases 6-10 (shipped 2026-03-10)
- ✅ **v1.3 User Auth & Identity** — Phases 11-14 (shipped 2026-03-11)
- ✅ **v1.4 UI Polish & Feature Completeness** — Phases 15-19 (shipped 2026-03-14)
- 🔧 **v1.5 Production Hardening** — Phases 20-24 (Deferred — skipped in favor of v2.0)
- ✅ **v2.0 Social Platform** — Phases 25-32 (shipped 2026-03-17)
- ✅ **v2.1 Social UX Integration** — Phase 33 (shipped 2026-03-18)
- 🚧 **v3.0 Durable Event Architecture** — Phases 34-38 (in progress)

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
<details>
<summary>✅ v2.0 Social Platform (Phases 25-32) — SHIPPED 2026-03-17</summary>

**Milestone Goal:** Add a full social layer on top of the existing real-time gateway — user profiles, follow/friend graph, groups, rooms (standalone + group + DM), posts, threaded comments, likes with attribution, and real-time broadcast of social events to room members — all keyed on Cognito `sub` for referential integrity and cross-app reuse.

- [x] **Phase 25: Social Infrastructure** — New CDK social-stack, all 9 DynamoDB tables, Express social-api base with Cognito auth middleware (completed 2026-03-16)
- [x] **Phase 26: User Profiles & Social Graph** — Profile CRUD endpoints and follow/unfollow/friends REST API (completed 2026-03-17)
- [x] **Phase 27: Groups** — Group CRUD, membership management, roles, visibility, and invitations (completed 2026-03-17)
- [x] **Phase 28: Rooms** — Standalone, group-scoped, and DM room CRUD, membership, and WS channel mapping (completed 2026-03-17)
- [x] **Phase 29: Posts & Comments** — Text posts in rooms, threaded comments, post feed, and user post history (completed 2026-03-17)
- [x] **Phase 30: Reactions & Likes** — Like with attribution, unlike, emoji reactions, and who-liked (completed 2026-03-17)
- [x] **Phase 31: Real-time Integration** — Extend WebSocket gateway with social event types broadcast to room members (completed 2026-03-17)
- [x] **Phase 32: Frontend Social Layer** — React hooks and UI components for the complete social feature set (completed 2026-03-17)

</details>

<details>
<summary>✅ v2.1 Social UX Integration (Phase 33) — SHIPPED 2026-03-18</summary>

**Milestone Goal:** Wire the social layer and WebSocket gateway together so that selecting a social room activates its real-time channel, and resolve UX friction points that block a real multi-user walkthrough of the platform.

- [x] **Phase 33: Social UX Integration** — Room→channel wiring, group room management in GroupPanel, friends-picker for DMs, in-app social notifications (completed 2026-03-18)

</details>

### 🚧 v3.0 Durable Event Architecture (Phases 34-38)

**Milestone Goal:** Replace fire-and-forget social writes with a durable event pipeline (EventBridge → SQS → Lambda → DynamoDB) that never loses events, supports fan-out to multiple consumers (activity log, timeline, notifications), and runs fully locally via LocalStack. CRDT checkpoint writes are routed through the same pipeline. UI surfaces an activity feed and CRDT conflict indicator.

- [x] **Phase 34: LocalStack Dev Environment** — Docker Compose with LocalStack, EventBridge, SQS, Lambda, Redis; local dev scripts and Lambda debug tooling (completed 2026-03-18)
- [x] **Phase 35: Event Bus Infrastructure** — EventBridge custom bus, typed SQS queues, DLQs, CloudWatch DLQ depth alarms, retry/DLQ behavior (completed 2026-03-18)
- [x] **Phase 36: Social Event Publishing** — Room join/leave, follow/unfollow, reaction, and post/comment events published to EventBridge from social-api (completed 2026-03-18)
- [x] **Phase 37: Activity Log** — Lambda consumer persists all social events to user-activity DynamoDB table; REST endpoint and React UI for viewing activity feed (completed 2026-03-18)
- [ ] **Phase 38: CRDT Durability** — CRDT checkpoint writes routed through EventBridge pipeline; snapshot recovery on reconnect; Y.js conflict indicator in UI

**Execution order:**
- Phase 34 first (foundational — all others depend on LocalStack)
- Phase 35 second (event bus required before publishing or consuming)
- Phase 36 after Phase 35 (publishing requires the bus)
- Phases 37 and 38 after Phase 35; can execute in parallel (independent consumers)
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
- [x] 25-01-PLAN.md — CDK social-stack with 9 DynamoDB tables + social-api Express service with Cognito auth middleware

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
- [x] 26-01: Profile CRUD REST endpoints (POST/GET/PUT /profiles, visibility toggle)
- [x] 26-02: Follow/unfollow/friends REST endpoints (followers, following, mutual friends)
- [x] 26-03: Demo UI — Social section card with mock data (ProfileCard, FollowButton, SocialGraphPanel)

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
- [x] 27-01-PLAN.md — Group CRUD and visibility REST endpoints (create, delete, get, update visibility)
- [x] 27-02-PLAN.md — Membership management REST endpoints (invite, accept/decline, join, leave, list members with roles)

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
- [x] 28-01-PLAN.md — rooms.ts + group-rooms.ts: standalone/DM/group-scoped room CRUD with channelId mapping (ROOM-01, ROOM-02, ROOM-03, ROOM-05, ROOM-07)
- [x] 28-02-PLAN.md — room-members.ts + index.ts mount: join, list members, list my rooms (ROOM-04, ROOM-06, ROOM-08)

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
- [x] 29-01-PLAN.md — posts.ts: post CRUD, paginated room feed (ULID sort), user post history (CONT-01, CONT-02, CONT-03, CONT-04, CONT-05)
- [x] 29-02-PLAN.md — comments.ts + index.ts wiring: threaded comments, replies, delete (CONT-06, CONT-07, CONT-08)

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
- [x] 30-01-PLAN.md — likes.ts: like/unlike posts and comments with attribution, who-liked endpoint (REAC-01, REAC-02, REAC-03, REAC-04, REAC-06)
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
- [x] 31-01-PLAN.md — BroadcastService in social-api + wire into posts, comments, likes, reactions, room-members routes (RTIM-01, RTIM-02, RTIM-03, RTIM-04)
- [x] 31-02-PLAN.md — SocialService in gateway + validator whitelist: clients subscribe to room channels via WS (RTIM-01, RTIM-02, RTIM-03, RTIM-04)
- [x] 31-03-PLAN.md — End-to-end integration test script validating social event delivery (RTIM-01, RTIM-02, RTIM-03, RTIM-04)

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
**Plans**: 4 plans

Plans:
- [x] 32-01-PLAN.md — React hooks (useSocialProfile, useFriends, useGroups, useRooms, usePosts, useComments, useLikes) with real-time WS event handlers
- [x] 32-02-PLAN.md — UI components (SocialPanel live, GroupPanel, RoomList, PostFeed, CommentThread)
- [x] 32-03-PLAN.md — AppLayout + App.tsx wiring + human verification checkpoint
- [x] 32-04-PLAN.md — Gap closure: createGroupRoom (ROOM-02), loadMembers (ROOM-06), getUserPosts (CONT-05), whoLiked display (REAC-06)

### Phase 33: Social UX Integration
**Goal**: The social layer and the WebSocket gateway are wired together so that selecting a social room activates its real-time channel, and key UX friction points blocking multi-user testing are resolved — enabling a complete end-to-end walkthrough of all platform features with two or more simultaneous users
**Depends on**: Phase 32
**Requirements**: UXIN-01, UXIN-02, UXIN-03, UXIN-04
**Success Criteria** (what must be TRUE):
  1. When a user selects a room in RoomList, the active WebSocket channel switches to that room's `channelId`; chat messages sent by two users in that room are visible to both in real-time
  2. Selecting a group in GroupPanel shows that group's rooms and the owner/admin can create a new room scoped to the group from within the panel
  3. Opening a DM from RoomList presents a picker of the current user's mutual friends — no raw UUID entry required
  4. When another user follows the current user, joins their room, or posts in the currently active room, a visible notification appears in the UI without inspecting the EventLog
**Plans**: 2 plans

Plans:
- [x] 33-01-PLAN.md — Room->channel wiring (UXIN-01), group rooms in GroupPanel (UXIN-02), friends picker for DMs (UXIN-03)
- [x] 33-02-PLAN.md — In-app notification banner for social events (UXIN-04) + end-to-end human verification

### Phase 34: LocalStack Dev Environment
**Goal**: Every v3.0 AWS service (EventBridge, SQS, Lambda, DynamoDB) runs locally in Docker via LocalStack so development and debugging require no AWS account access
**Depends on**: Phase 33
**Requirements**: LDEV-01, LDEV-02, LDEV-03
**Success Criteria** (what must be TRUE):
  1. `docker compose up` starts LocalStack, Redis (ECS container), and all application services without error; no AWS credentials or ElastiCache endpoint required
  2. Developer can invoke a Lambda handler directly against LocalStack using a realistic payload and receive a response in the local terminal
  3. Developer can set a breakpoint in a Lambda handler and hit it via a local debug attach (e.g., `--inspect` flag or equivalent)
  4. All downstream phases (35-38) can run their LocalStack-dependent setup against this environment without modification
**Plans**: 2 plans

Plans:
- [x] 34-01: Docker Compose setup — LocalStack service, Redis container, EventBridge + SQS + DynamoDB bootstrap scripts (LDEV-01, LDEV-02)
- [x] 34-02: Lambda local invocation and debug tooling — invoke scripts, local handler entrypoint, debug attach instructions (LDEV-03)

### Phase 35: Event Bus Infrastructure
**Goal**: An EventBridge custom bus routes social events by category to typed SQS queues, each backed by a DLQ with a CloudWatch alarm — and failed Lambda invocations retry via SQS visibility timeout before landing in the DLQ with full payload preserved
**Depends on**: Phase 34
**Requirements**: EBUS-01, EBUS-02, EBUS-03
**Success Criteria** (what must be TRUE):
  1. A test event published to the EventBridge custom bus routes to the correct SQS queue based on event category (e.g., social.follow lands in the follows queue, not the posts queue)
  2. Each SQS queue has a corresponding DLQ; a CloudWatch alarm fires when the DLQ message count exceeds zero
  3. A Lambda invocation that throws an error does not immediately discard the message — the message reappears in the SQS queue after the visibility timeout and lands in the DLQ after exhausting retries with the original event payload intact
**Plans**: 2 plans

Plans:
- [ ] 35-01-PLAN.md — Bootstrap DLQs, redrive policies, EventBridge routing rules, CloudWatch DLQ alarms + CDK EventBusStack + test-event-routing.sh (EBUS-01, EBUS-02)
- [ ] 35-02-PLAN.md — SQS event format in Lambda handler, event-source-mapping bootstrap, DLQ retry verification script (EBUS-03)

### Phase 36: Social Event Publishing
**Goal**: Every social mutation in social-api (room join/leave, follow/unfollow, reaction, post, comment) publishes a typed event to the EventBridge custom bus with full payload and timestamp, replacing fire-and-forget direct writes
**Depends on**: Phase 35
**Requirements**: SEVT-01, SEVT-02, SEVT-03, SEVT-04
**Success Criteria** (what must be TRUE):
  1. When a user joins or leaves a room, an event with type `social.room.join` or `social.room.leave` appears on the EventBridge bus within the same request cycle
  2. When a user follows or unfollows another user, a `social.follow` or `social.unfollow` event is published with the follower and followee Cognito `sub` values
  3. When a reaction or like is recorded, a `social.reaction` or `social.like` event is published with the full target identifier and emoji type
  4. When a post or comment is created, a `social.post.created` or `social.comment.created` event is published with the room ID, author sub, and content ID
**Plans**: 2 plans

Plans:
- [ ] 36-01-PLAN.md — publishSocialEvent helper in aws-clients.ts + wire into room-members.ts and social.ts (SEVT-01, SEVT-02)
- [ ] 36-02-PLAN.md — Wire publishSocialEvent into likes, reactions, posts, comments routes + verification script (SEVT-01, SEVT-02, SEVT-03, SEVT-04)

### Phase 37: Activity Log
**Goal**: A Lambda consumer persists all social events to a user-activity DynamoDB table, and users can view their recent activity as a chronological list in the app — validating the full EventBridge pipeline end-to-end
**Depends on**: Phase 35 (event bus), Phase 36 (publishing)
**Requirements**: ALOG-01, ALOG-02, ALOG-03
**Success Criteria** (what must be TRUE):
  1. After a follow, room join, reaction, or post event is published, the corresponding record appears in the user-activity DynamoDB table within a few seconds (Lambda processing time)
  2. A call to `GET /api/activity` on social-api returns the authenticated user's activity log as a chronological list of events
  3. The authenticated user can open an Activity tab (or panel) in the React app and see their recent social events listed in reverse-chronological order without inspecting the EventLog panel
**Plans**: TBD

Plans:
- [ ] 37-01: user-activity DynamoDB table + Lambda consumer — handler persists all event categories keyed on userId + timestamp (ALOG-01)
- [ ] 37-02: GET /api/activity REST endpoint on social-api (ALOG-02)
- [ ] 37-03: ActivityFeed React component + hook wired into AppLayout (ALOG-03)

### Phase 38: CRDT Durability
**Goal**: CRDT checkpoint writes flow through the EventBridge pipeline instead of synchronous DynamoDB writes, clients recover from the latest snapshot on reconnect, and the UI shows a dismissible indicator when Y.js resolves a merge conflict
**Depends on**: Phase 35 (event bus)
**Requirements**: CRDT-01, CRDT-02, CRDT-03
**Success Criteria** (what must be TRUE):
  1. When the CRDT snapshot trigger fires (time, operation count, or disconnect), the checkpoint is published to EventBridge and the Lambda consumer persists it to DynamoDB — no direct synchronous write from the gateway
  2. When a client reconnects after a disconnect, it loads the latest CRDT snapshot from DynamoDB and replays only the ops delta since that checkpoint — the document is restored to the correct state without a full-page reload
  3. When Y.js resolves a concurrent edit conflict (merge), a dismissible indicator appears in the collaborative editor UI; the indicator disappears when the user dismisses it
**Plans**: TBD

Plans:
- [ ] 38-01: Route CRDT checkpoint writes through EventBridge — Lambda consumer persists snapshot to DynamoDB (CRDT-01)
- [ ] 38-02: Client reconnect snapshot recovery — load latest snapshot + ops delta replay on reconnect (CRDT-02)
- [ ] 38-03: Y.js conflict indicator in SharedTextEditor UI (CRDT-03)
## Progress

**Execution Order:** Phases execute in numeric order: 1 → 2 → ... → 19 → [20-24 deferred] → 25 → 26 → 27 → 28 → 29 → 30 → 31 → 32 → 33 → 34 → 35 → 36 → 37/38 (parallel)

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
| 25. Social Infrastructure | v2.0 | 1/1 | Complete | 2026-03-16 |
| 26. User Profiles & Social Graph | v2.0 | 3/3 | Complete | 2026-03-17 |
| 27. Groups | v2.0 | 2/2 | Complete | 2026-03-17 |
| 28. Rooms | v2.0 | 2/2 | Complete | 2026-03-17 |
| 29. Posts & Comments | v2.0 | 2/2 | Complete | 2026-03-17 |
| 30. Reactions & Likes | v2.0 | 2/2 | Complete | 2026-03-17 |
| 31. Real-time Integration | v2.0 | 4/4 | Complete | 2026-03-17 |
| 32. Frontend Social Layer | v2.0 | 4/4 | Complete | 2026-03-17 |
| 33. Social UX Integration | v2.1 | 2/2 | Complete | 2026-03-18 |
| 34. LocalStack Dev Environment | 2/2 | Complete    | 2026-03-18 | — |
| 35. Event Bus Infrastructure | 2/2 | Complete    | 2026-03-18 | — |
| 36. Social Event Publishing | 2/2 | Complete    | 2026-03-18 | — |
| 37. Activity Log | 2/2 | Complete   | 2026-03-18 | — |
| 38. CRDT Durability | v3.0 | 0/3 | Not started | — |
