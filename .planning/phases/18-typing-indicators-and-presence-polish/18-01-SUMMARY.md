---
phase: 18-typing-indicators-and-presence-polish
plan: 01
subsystem: Chat & Presence UI
tags:
  - typing-indicators
  - presence
  - ui-polish
dependencies:
  requires:
    - PRES-01
    - PRES-02
  provides:
    - Typing banner in ChatPanel
    - typingUsers prop contract
  affects:
    - ChatPanel component rendering
    - AppLayout derivation logic
tech_stack:
  added: []
  patterns:
    - Prop-based typing state derivation
    - Formatted UI display from metadata
key_files:
  created: []
  modified:
    - frontend/src/components/ChatPanel.tsx
    - frontend/src/components/AppLayout.tsx
decisions:
  - "formatTypingBanner helper uses 'and N other(s)' pattern capping display at 2 names, consistent with typical UI conventions"
  - "typingUsers derived internally in AppLayout, not exposed as prop—keeps prop interface clean"
  - "Use metadata.displayName with clientId slice fallback to maintain consistency with other components"
duration: "2m"
completed: "2026-03-12T23:13:44Z"
---

# Phase 18 Plan 01: Typing Indicators and Presence Polish Summary

## Objective

Wire typing indicators from the presence state into the ChatPanel UI, surfacing remote user typing state as a visible banner. The presence sidebar typing indicators are already implemented via metadata.isTyping—this plan connects that data to the chat panel.

## What Was Built

**Typing indicator banner in ChatPanel:**
- Added `typingUsers?: string[]` prop to ChatPanelProps
- Renders a formatted banner above the message list when users are typing
- Supports 1, 2, or 3+ user names with appropriate pluralization

**Typing user derivation in AppLayout:**
- Created typingUsers derived value filtering presenceUsers by metadata.isTyping === true
- Excludes self (currentClientId) so local user's own typing state doesn't appear in the banner
- Maps to displayName or first 8 chars of clientId as fallback
- Passes to ChatPanel component

## Tasks Completed

| Task | Name | Commit | Files |
| ---- | ---- | ------ | ----- |
| 1 | Add typingUsers prop to ChatPanel and render typing banner | 96527ca | frontend/src/components/ChatPanel.tsx |
| 2 | Derive typingUsers in AppLayout and pass to ChatPanel | 13a8da5 | frontend/src/components/AppLayout.tsx |

## Verification

- TypeScript compilation: PASSED (zero errors)
- Task 1 verification: ChatPanel renders banner, onTyping prop unchanged
- Task 2 verification: AppLayout derives and passes typingUsers to ChatPanel
- Overall success criteria: PASSED

## Implementation Details

### Task 1: ChatPanel Changes

Added formatTypingBanner helper function:
```typescript
function formatTypingBanner(users: string[]): string {
  if (users.length === 0) return '';
  if (users.length === 1) return `${users[0]} is typing...`;
  if (users.length === 2) return `${users[0]} and ${users[1]} are typing...`;
  const others = users.length - 2;
  return `${users[0]}, ${users[1]} and ${others} other${others > 1 ? 's' : ''} are typing...`;
}
```

Rendering logic:
```tsx
{typingUsers.length > 0 && (
  <div
    style={{
      fontSize: '0.7rem',
      color: '#9ca3af',
      fontStyle: 'italic',
      marginBottom: '0.25rem',
    }}
  >
    {formatTypingBanner(typingUsers)}
  </div>
)}
```

### Task 2: AppLayout Changes

Derivation logic placed before return statement:
```typescript
const typingUsers = presenceUsers
  .filter((u) => u.metadata.isTyping === true && u.clientId !== currentClientId)
  .map((u) =>
    (u.metadata.displayName as string | undefined) ?? u.clientId.slice(0, 8)
  );
```

Passed to ChatPanel in the Chat section.

## Deviations from Plan

None—plan executed exactly as written. Both components implemented with clean TypeScript compilation.

## Requirements Satisfied

- PRES-01: Typing banner visible in chat panel for remote users—SATISFIED
- PRES-02: Typing label visible in presence sidebar—already implemented (verified no changes needed to PresencePanel)

## Self-Check

- ChatPanel.tsx modified with typingUsers prop and banner rendering: VERIFIED
- AppLayout.tsx modified with typingUsers derivation and prop passing: VERIFIED
- Commit 96527ca exists: VERIFIED
- Commit 13a8da5 exists: VERIFIED
- TypeScript compilation: PASSED

## Self-Check: PASSED

All files exist, all commits verified, TypeScript compilation clean.
