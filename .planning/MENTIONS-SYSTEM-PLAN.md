# @Mentions System Plan

## Overview

Type `@` in any text input (comments, rich text editor, chat) to trigger an autocomplete dropdown of users. Selecting a user inserts a styled mention that links to their profile and can trigger notifications.

## User Sources (Progressive)

### Phase 1: Awareness-based (now)
- Users currently connected via Y.js awareness
- Source: `provider.awareness.getStates()` → extract all user objects
- Data: `{ userId, displayName, color }`
- No backend needed — purely client-side

### Phase 2: Cognito-backed (future)
- All registered users from Cognito User Pool
- Source: `ListUsers` API or a cached user directory
- Enables mentioning offline users

### Phase 3: Groups (future)
- `@engineering`, `@reviewers` — mention entire groups
- Source: group membership service
- Expands to all members for notifications

## UX Design

### Trigger
- User types `@` in any supported input
- Autocomplete dropdown appears below the cursor/caret
- Dropdown filters as user continues typing: `@da` → shows "Dave"
- Arrow keys to navigate, Enter/Tab to select, Esc to dismiss

### Dropdown
```
┌──────────────────────────┐
│ 🟢 Dave        editing   │  ← online, currently in doc
│ 🟢 Alice       reviewing │  ← online
│ ⚪ Eve         offline   │  ← known user, not connected
└──────────────────────────┘
```
- Online users (from awareness) shown first with green dot
- Offline known users shown below with gray dot
- User's color shown as avatar circle
- Current mode shown as badge
- Max 8 results, scrollable

### Inserted Mention
- Rendered as inline styled span: `@Dave` in blue with slight background
- Stored in data model as: `{ type: 'mention', userId: 'xxx', displayName: 'Dave' }`
- In comments (Y.js): stored as part of comment text with markers
- In Tiptap editor: use a Tiptap Mention extension node

### Notification (future)
- When a mention is created, publish activity event: `doc.mention`
- Event payload: `{ mentionedUserId, mentionedBy, sectionId, context }`
- Server can push notification to mentioned user's activity channel

## Implementation Plan

### Component: `MentionDropdown.tsx`
```typescript
interface MentionDropdownProps {
  query: string;           // Text after '@' — filters results
  users: MentionUser[];    // Available users to mention
  position: { top: number; left: number };  // Absolute position
  onSelect: (user: MentionUser) => void;
  onDismiss: () => void;
}

interface MentionUser {
  userId: string;
  displayName: string;
  color: string;
  online: boolean;
  mode?: string;
}
```

### For Comments (`SectionComments.tsx`)
1. Listen for `@` keypress in the comment textarea
2. Track cursor position and query text after `@`
3. Show `MentionDropdown` positioned below cursor
4. On select: insert `@DisplayName` into textarea, store mention metadata
5. On post: include mentions array in comment data

### For Rich Text Editor (`TiptapEditor.tsx`)
1. Use Tiptap's `@tiptap/extension-mention` 
2. Configure with suggestion plugin that shows `MentionDropdown`
3. Mention nodes stored in Y.js document (persist + sync via CRDT)
4. Render as styled inline node with user's color

### For Chat (future)
Same pattern as comments — `@` trigger in chat input

## Data Model

### Comment with mentions
```typescript
interface CommentData {
  id: string;
  text: string;
  userId: string;
  displayName: string;
  color: string;
  timestamp: string;
  parentCommentId: string | null;
  mentions?: { userId: string; displayName: string }[];  // NEW
}
```

### Tiptap mention node (ProseMirror)
```json
{
  "type": "mention",
  "attrs": {
    "id": "user-uuid",
    "label": "Dave"
  }
}
```

### Activity event
```json
{
  "eventType": "doc.mention",
  "detail": {
    "mentionedUserId": "xxx",
    "mentionedDisplayName": "Dave",
    "sectionId": "section-uuid",
    "context": "comment"
  }
}
```

## Files to Create/Modify

### New files
1. `frontend/src/components/doc-editor/MentionDropdown.tsx` — autocomplete UI
2. `frontend/src/hooks/useMentionUsers.ts` — aggregates users from awareness + future sources

### Modified files
3. `frontend/src/components/doc-editor/SectionComments.tsx` — `@` trigger in comment input
4. `frontend/src/components/doc-editor/TiptapEditor.tsx` — Tiptap Mention extension
5. `frontend/src/components/doc-editor/ActivityFeed.tsx` — render `doc.mention` events
6. `frontend/src/types/document.ts` — add `mentions` to CommentData

## Dependencies
- `@tiptap/extension-mention` — already in node_modules (comes with Tiptap starter)
- No backend changes needed for Phase 1

## Effort: ~3 agents
1. MentionDropdown component + useMentionUsers hook
2. Comment textarea @mention integration
3. Tiptap Mention extension integration
