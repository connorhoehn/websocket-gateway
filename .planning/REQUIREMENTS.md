# Requirements: WebSocket Gateway — Social Platform

**Defined:** 2026-03-16
**Core Value:** Real-time collaborative platform with Cognito-keyed social layer (profiles, groups, rooms, posts, reactions) designed for cross-app reuse and referential integrity.

## v2.0 Requirements

### Profiles

- [x] **PROF-01**: User can create a social profile with display name, bio, and avatar URL backed by their Cognito `sub`
- [x] **PROF-02**: User can update their profile display name, bio, and avatar URL
- [x] **PROF-03**: User can view their own profile
- [x] **PROF-04**: User can view another user's public profile
- [x] **PROF-05**: User can set their profile visibility (public / private)

### Social Graph

- [x] **SOCL-01**: User can follow another user
- [x] **SOCL-02**: User can unfollow a user
- [x] **SOCL-03**: Mutual follows (both following each other) surface as a "friends" relationship
- [x] **SOCL-04**: User can view their list of followers
- [x] **SOCL-05**: User can view who they follow
- [x] **SOCL-06**: User can view their mutual friends

### Groups

- [x] **GRUP-01**: User can create a group with name and description
- [x] **GRUP-02**: User can delete a group they own
- [x] **GRUP-03**: Group owner/admin can invite users to a group by Cognito userId
- [x] **GRUP-04**: User can accept or decline a group invitation
- [x] **GRUP-05**: User can set group visibility (public / private)
- [x] **GRUP-06**: User can join a public group without invitation
- [x] **GRUP-07**: User can leave a group they're a member of
- [x] **GRUP-08**: Group members have roles (owner / admin / member) with appropriate permission boundaries
- [x] **GRUP-09**: User can view group members and their roles

### Rooms

- [x] **ROOM-01**: User can create a standalone room with a name
- [x] **ROOM-02**: Group owner/admin can create rooms scoped within a group
- [x] **ROOM-03**: Two mutual friends can open a direct-message (DM) room
- [x] **ROOM-04**: Room membership is persisted in DynamoDB keyed on Cognito `sub` for referential integrity
- [x] **ROOM-05**: Each room maps to a WebSocket channel ID so real-time events are delivered to members
- [x] **ROOM-06**: User can view the member list of a room they belong to
- [x] **ROOM-07**: Room maintains persistent post history in DynamoDB (beyond LRU cache)
- [x] **ROOM-08**: User can list all rooms they are a member of

### Content

- [x] **CONT-01**: User can create a text post in a room
- [x] **CONT-02**: User can edit their own post
- [x] **CONT-03**: User can delete their own post
- [x] **CONT-04**: User can view a paginated post feed for a room
- [x] **CONT-05**: User can view all posts by a specific user
- [x] **CONT-06**: User can comment on a post
- [x] **CONT-07**: User can reply to an existing comment (threaded / nested)
- [x] **CONT-08**: User can delete their own comment

### Reactions

- [x] **REAC-01**: User can like a post (like stored with attribution — Cognito `sub` of liker)
- [x] **REAC-02**: User can unlike a post they previously liked
- [x] **REAC-03**: User can like a comment with attribution
- [x] **REAC-04**: User can unlike a comment
- [x] **REAC-05**: User can react to a post with an emoji (reuses the existing 12-emoji system)
- [x] **REAC-06**: User can view the total like count and the list of users who liked a post

### Real-time

- [x] **RTIM-01**: New posts in a room are broadcast via WebSocket to all room members
- [x] **RTIM-02**: New comments on a post are broadcast via WebSocket to room members
- [x] **RTIM-03**: New likes are broadcast via WebSocket to room members
- [x] **RTIM-04**: Room member join and leave events are broadcast via WebSocket to existing members

## v2.1 Requirements

### UX Integration (Phase 33)

- [x] **UXIN-01**: Selecting a social room in RoomList switches the active WebSocket channel so that chat, presence, cursors, and reactions all operate within that room (room's `channelId` becomes `currentChannel`)
- [x] **UXIN-02**: GroupPanel lists rooms scoped to the selected group and allows the group owner/admin to create a new room within that group — without leaving the group view
- [x] **UXIN-03**: DM room creation uses a picker populated from the current user's mutual friends list instead of a raw Cognito `sub` UUID input
- [x] **UXIN-04**: Real-time social events (follow received, member joined room, new post in active room) surface as visible in-app notifications so users see activity without needing to inspect the EventLog

## Future Requirements

### Notifications

- **NOTF-01**: User receives in-app notification when followed
- **NOTF-02**: User receives notification when mentioned in a comment
- **NOTF-03**: User can configure notification preferences per room

### Moderation

- **MODR-01**: User can report a post or comment
- **MODR-02**: User can block another user
- **MODR-03**: Group admin can remove a member from a group
- **MODR-04**: Group admin can delete posts in their group

### Media

- **MDIA-01**: User can attach an image to a post (S3 presigned URL upload)
- **MDIA-02**: Thumbnail generated on upload

### Search

- **SRCH-01**: User can search posts by keyword across rooms they're a member of
- **SRCH-02**: User can search for users by display name

## Out of Scope

| Feature | Reason |
|---------|--------|
| Video/audio rooms | High infrastructure complexity; defer to v3+ |
| OAuth social login (Google, Apple) | Cognito email/password is sufficient for v2.0 |
| Push notifications (mobile/email) | Not a web-first priority; v3+ |
| End-to-end encryption for DMs | Complex key management; out of scope for now |
| v1.5 Production Hardening (phases 20-24) | Deferred — address in a future dedicated pass once social layer ships |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| PROF-01 | Phase 26 | Complete |
| PROF-02 | Phase 26 | Complete |
| PROF-03 | Phase 26 | Complete |
| PROF-04 | Phase 26 | Complete |
| PROF-05 | Phase 26 | Complete |
| SOCL-01 | Phase 26 | Complete |
| SOCL-02 | Phase 26 | Complete |
| SOCL-03 | Phase 26 | Complete |
| SOCL-04 | Phase 26 | Complete |
| SOCL-05 | Phase 26 | Complete |
| SOCL-06 | Phase 26 | Complete |
| GRUP-01 | Phase 27 | Complete |
| GRUP-02 | Phase 27 | Complete |
| GRUP-03 | Phase 27 | Complete |
| GRUP-04 | Phase 27 | Complete |
| GRUP-05 | Phase 27 | Complete |
| GRUP-06 | Phase 27 | Complete |
| GRUP-07 | Phase 27 | Complete |
| GRUP-08 | Phase 27 | Complete |
| GRUP-09 | Phase 27 | Complete |
| ROOM-01 | Phase 28 | Complete |
| ROOM-02 | Phase 28 | Complete |
| ROOM-03 | Phase 28 | Complete |
| ROOM-04 | Phase 28 | Complete |
| ROOM-05 | Phase 28 | Complete |
| ROOM-06 | Phase 28 | Complete |
| ROOM-07 | Phase 28 | Complete |
| ROOM-08 | Phase 28 | Complete |
| CONT-01 | Phase 29 | Complete |
| CONT-02 | Phase 29 | Complete |
| CONT-03 | Phase 29 | Complete |
| CONT-04 | Phase 29 | Complete |
| CONT-05 | Phase 29 | Complete |
| CONT-06 | Phase 29 | Complete |
| CONT-07 | Phase 29 | Complete |
| CONT-08 | Phase 29 | Complete |
| REAC-01 | Phase 30 | Complete |
| REAC-02 | Phase 30 | Complete |
| REAC-03 | Phase 30 | Complete |
| REAC-04 | Phase 30 | Complete |
| REAC-05 | Phase 30 | Complete |
| REAC-06 | Phase 30 | Complete |
| RTIM-01 | Phase 31 | Complete |
| RTIM-02 | Phase 31 | Complete |
| RTIM-03 | Phase 31 | Complete |
| RTIM-04 | Phase 31 | Complete |
| UXIN-01 | Phase 33 | Complete |
| UXIN-02 | Phase 33 | Complete |
| UXIN-03 | Phase 33 | Complete |
| UXIN-04 | Phase 33 | Complete |
| LDEV-01 | Phase 34 | Pending |
| LDEV-02 | Phase 34 | Pending |
| LDEV-03 | Phase 34 | Pending |
| EBUS-01 | Phase 35 | Pending |
| EBUS-02 | Phase 35 | Pending |
| EBUS-03 | Phase 35 | Pending |
| SEVT-01 | Phase 36 | Pending |
| SEVT-02 | Phase 36 | Pending |
| SEVT-03 | Phase 36 | Pending |
| SEVT-04 | Phase 36 | Pending |
| ALOG-01 | Phase 37 | Pending |
| ALOG-02 | Phase 37 | Pending |
| ALOG-03 | Phase 37 | Pending |
| CRDT-01 | Phase 38 | Pending |
| CRDT-02 | Phase 38 | Pending |
| CRDT-03 | Phase 38 | Pending |

**Coverage:**
- v2.0 requirements: 38 total (phases 25-32, all complete)
- v2.1 requirements: 4 total (phase 33, all complete)
- v3.0 requirements: 13 total (phases 34-38, pending)
- Unmapped: 0 ✓

---

## v3.0 Requirements

### Local Dev Environment (LDEV)

- [ ] **LDEV-01**: Developer can run EventBridge + SQS + Lambda locally via LocalStack in Docker without AWS access
- [ ] **LDEV-02**: Developer can run Redis via ECS container locally (no ElastiCache dependency)
- [ ] **LDEV-03**: Lambda handlers are invocable and debuggable locally against LocalStack with realistic payloads

### Event Bus Infrastructure (EBUS)

- [ ] **EBUS-01**: EventBridge custom bus routes social events to typed SQS queues by event category
- [ ] **EBUS-02**: Each SQS queue has a dead-letter queue with a CloudWatch alarm on DLQ message depth
- [ ] **EBUS-03**: Failed Lambda invocations retry via SQS visibility timeout and land in DLQ with full event payload preserved for replay

### Social Event Publishing (SEVT)

- [ ] **SEVT-01**: Room join/leave events are published to EventBridge with timestamp when membership changes
- [ ] **SEVT-02**: Follow/unfollow events are published to EventBridge when social graph changes
- [ ] **SEVT-03**: Reaction and like events are published to EventBridge with full payload and timestamp
- [ ] **SEVT-04**: Post and comment creation events are published to EventBridge

### Activity Log (ALOG)

- [ ] **ALOG-01**: Lambda consumer persists all social event categories (join, follow, reaction, post) to a user-activity DynamoDB table
- [ ] **ALOG-02**: User can query their own activity log via a REST endpoint on social-api
- [ ] **ALOG-03**: User can view their recent activity as a chronological list in the app

### CRDT Durability (CRDT)

- [ ] **CRDT-01**: CRDT checkpoint writes are routed through EventBridge → SQS → Lambda instead of direct synchronous DynamoDB writes
- [ ] **CRDT-02**: Client reconnect loads the latest CRDT snapshot from DynamoDB and replays ops delta since that checkpoint
- [ ] **CRDT-03**: UI surfaces a dismissible indicator when Y.js resolves a merge conflict

## Out of Scope (v3.0)

| Feature | Reason |
|---------|--------|
| Email / push notifications | Separate notification system — future milestone |
| Event replay / full event sourcing | Overkill for current scale — DLQ + manual replay is sufficient |
| IVS recording events | Different system, different pipeline |
| User timeline UI beyond activity list | Design problem — deferred until activity log is validated |

---
*Requirements defined: 2026-03-16*
*Last updated: 2026-03-18 — v3.0 traceability added (phases 34-38, 13 requirements)*
