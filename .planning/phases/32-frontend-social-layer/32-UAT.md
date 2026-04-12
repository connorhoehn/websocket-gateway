---
status: testing
phase: 32-frontend-social-layer
source: 32-01-SUMMARY.md, 32-02-SUMMARY.md, 32-03-SUMMARY.md, 32-04-SUMMARY.md
started: 2026-03-17T21:00:00Z
updated: 2026-03-17T21:00:00Z
---

## Current Test
<!-- OVERWRITE each test - shows where we are -->

number: 1
name: Social Panel Loads Live Profile
expected: |
  Open the app as an authenticated user. Navigate to SocialPanel.
  Your real profile data (name, bio) loads from the API — no mock users, no "MockDataBanner".
  While loading, a skeleton/loading state is shown briefly before content appears.
awaiting: user response

## Tests

### 1. Social Panel Loads Live Profile
expected: Open the app as an authenticated user. Navigate to SocialPanel. Your real profile data (name, bio) loads from the API — no mock users, no "MockDataBanner". While loading, a skeleton/loading state is shown briefly before content appears.
result: [pending]

### 2. Update Profile
expected: In SocialPanel, edit your name or bio and click Save. The save button shows a saving state (disabled/spinner) while the request is in flight. After completion, the updated values persist — refreshing the page shows the new values.
result: [pending]

### 3. Follow / Unfollow
expected: In SocialPanel, switch between Followers, Following, and Friends tabs. Real user data loads from the API. Clicking Follow on a user sends the request and updates the UI. Clicking Unfollow removes them from the list.
result: [pending]

### 4. Create Group
expected: In GroupPanel, fill in the group creation form and submit. The new group appears in the group list immediately without a page reload.
result: [pending]

### 5. Delete Group (Owner Only)
expected: As the group owner, a red Delete button is visible on the group card. Clicking it removes the group from the list. As a non-owner member, no Delete button is shown.
result: [pending]

### 6. Create Room
expected: In RoomList, use the create room form to add a new room. The new room appears in the room list. A DM room button starts collapsed and expands to an inline form when clicked.
result: [pending]

### 7. Room Selection Loads Members & Posts
expected: Click a room in RoomList. PostFeed updates to show posts for that room. The member list for that room populates (loaded from GET /api/rooms/:roomId/members).
result: [pending]

### 8. Create & Edit Post
expected: In PostFeed (with a room selected), create a new post. It appears in the feed. Edit the post — the text updates in place. Delete the post — it is removed from the feed.
result: [pending]

### 9. Like Post & whoLiked Display
expected: Click the Like button on a post. The like count increments immediately (optimistic update). Below the button, "Liked by: [name1, name2, ...]" appears showing who liked the post. Clicking again unlikes and count decrements.
result: [pending]

### 10. Emoji Reaction
expected: Click an emoji in the EmojiReactionBar below a post. The reaction is registered (no error). The 12-emoji bar is visible and clickable.
result: [pending]

### 11. Comment on Post
expected: Expand a post's comments. Add a new comment via the comment form. It appears in the CommentThread below the post without a page reload.
result: [pending]

### 12. Nested Reply
expected: In CommentThread, click Reply on an existing comment. A reply form appears inline. Submit a reply — it appears indented (32px) under the parent comment. Delete a comment — it is removed.
result: [pending]

### 13. Create Group Room (ROOM-02)
expected: From within a group context in GroupPanel or RoomList, create a room tied to a group (createGroupRoom). The room appears in the room list.
result: [pending]

## Summary

total: 13
passed: 0
issues: 0
pending: 13
skipped: 0

## Gaps

[none yet]
