# Phase 46: UI Polish & Big Brother View - Context

**Gathered:** 2026-03-27
**Status:** Ready for planning

<domain>
## Phase Boundary

This phase makes the UI demo-quality: all forms display error messages on failure, rough UX patterns are replaced with polished interactions, and a new "Big Brother" dashboard panel shows live room activity, member counts, and the activity feed updating in real-time as simulation runs.

</domain>

<decisions>
## Implementation Decisions

### Error Display Strategy
- Inline error messages below the form field/button — dismisses on next attempt
- Use API response body message when available, generic fallback otherwise
- Cover all mutation forms: create room, create DM, join group, create post, follow user

### Big Brother Dashboard Panel
- New tab/panel alongside existing panels (Activity, Chat, etc.) — not a separate route
- Shows active rooms with member counts, recent events feed, and online user count — per success criteria
- Reuses existing useActivityFeed + usePresence hooks — already wired for live data
- Split panel layout: left column for room stats, right column for scrolling event feed

### UX Rough Edge Cleanup
- Replace "type channel name" pattern with room-selector dropdown using existing room list
- Add helpful empty states: "No rooms yet" / "No posts yet" messages with action hints
- Add loading spinners/skeletons for async operations (room list, post feed, activity)

### Claude's Discretion
- Exact styling of error messages (color, positioning, animation)
- Dashboard panel tab label and icon
- Empty state message wording
- Loading spinner vs skeleton screen choice per component

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `frontend/src/components/ActivityPanel.tsx` — useActivityFeed hook (live events, REST hydration)
- `frontend/src/components/PresencePanel.tsx` — usePresence hook (online users)
- `frontend/src/components/RoomList.tsx` — room list with join/create functionality
- `frontend/src/components/GroupPanel.tsx` — group management with catch block (line 434)
- `frontend/src/hooks/useAuth.ts` — auth state, idToken, userId
- `frontend/src/components/ErrorDisplay.tsx` — existing error display component

### Established Patterns
- Tab-based panel layout in AppLayout.tsx
- Social API calls use `fetch` with Bearer token auth
- Components receive sendMessage, onMessage, connectionState as props

### Integration Points
- `frontend/src/components/AppLayout.tsx` — add new dashboard tab
- All form components — add error state management
- `frontend/src/components/ChannelSelector.tsx` — replace with room-selector

</code_context>

<specifics>
## Specific Ideas

- Success criterion: "No 'type channel name' or other dev-only rough UX patterns remain"
- Success criterion: "Running simulate-activity.sh while viewing the dashboard shows visible real-time updates within 2 seconds"
- Big Brother panel should feel like a monitoring dashboard — compact, information-dense

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>
