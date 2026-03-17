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

- [ ] **CONT-01**: User can create a text post in a room
- [ ] **CONT-02**: User can edit their own post
- [ ] **CONT-03**: User can delete their own post
- [ ] **CONT-04**: User can view a paginated post feed for a room
- [ ] **CONT-05**: User can view all posts by a specific user
- [ ] **CONT-06**: User can comment on a post
- [ ] **CONT-07**: User can reply to an existing comment (threaded / nested)
- [ ] **CONT-08**: User can delete their own comment

### Reactions

- [ ] **REAC-01**: User can like a post (like stored with attribution — Cognito `sub` of liker)
- [ ] **REAC-02**: User can unlike a post they previously liked
- [ ] **REAC-03**: User can like a comment with attribution
- [ ] **REAC-04**: User can unlike a comment
- [ ] **REAC-05**: User can react to a post with an emoji (reuses the existing 12-emoji system)
- [ ] **REAC-06**: User can view the total like count and the list of users who liked a post

### Real-time

- [ ] **RTIM-01**: New posts in a room are broadcast via WebSocket to all room members
- [ ] **RTIM-02**: New comments on a post are broadcast via WebSocket to room members
- [ ] **RTIM-03**: New likes are broadcast via WebSocket to room members
- [ ] **RTIM-04**: Room member join and leave events are broadcast via WebSocket to existing members

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
| CONT-01 | Phase 29 | Pending |
| CONT-02 | Phase 29 | Pending |
| CONT-03 | Phase 29 | Pending |
| CONT-04 | Phase 29 | Pending |
| CONT-05 | Phase 29 | Pending |
| CONT-06 | Phase 29 | Pending |
| CONT-07 | Phase 29 | Pending |
| CONT-08 | Phase 29 | Pending |
| REAC-01 | Phase 30 | Pending |
| REAC-02 | Phase 30 | Pending |
| REAC-03 | Phase 30 | Pending |
| REAC-04 | Phase 30 | Pending |
| REAC-05 | Phase 30 | Pending |
| REAC-06 | Phase 30 | Pending |
| RTIM-01 | Phase 31 | Pending |
| RTIM-02 | Phase 31 | Pending |
| RTIM-03 | Phase 31 | Pending |
| RTIM-04 | Phase 31 | Pending |

**Coverage:**
- v2.0 requirements: 38 total
- Mapped to phases: 38 (phases 26-31; phase 25 is infrastructure, phase 32 is UI delivery)
- Unmapped: 0 ✓

---
*Requirements defined: 2026-03-16*
*Last updated: 2026-03-16 — traceability updated after roadmap creation (phases 25-32)*
