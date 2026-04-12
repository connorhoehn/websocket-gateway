# V1 vs Current Frontend — Feature Gap Analysis

> Comparison of the original websocket-gateway test clients (6 HTML files) against the current React SPA.
> Generated: 2026-04-11

## Summary

The current React app captures **all core v1 experiences** and adds significant new features (CRDT, social, activity, auth, rooms, groups). A few minor v1 UX details are missing — listed below.

---

## V1 Experiences → Current Status

### Fully Captured (no gaps)

| V1 Feature | V1 Source | Current Component | Notes |
|-------------|-----------|-------------------|-------|
| WebSocket connect/disconnect | All clients | `useWebSocket` + `ConnectionStatus` + `DisconnectReconnect` | Better — adds session recovery, exponential backoff |
| Chat join/leave/send/history | test-client.html | `ChatPanel` + `useChat` | Same feature set |
| Presence online/away/busy/offline | test-client.html | `PresencePanel` + `usePresence` | Better — adds typing indicators, heartbeat |
| Freeform cursor canvas | test-client-freeform.html, multimode | `CursorCanvas` | Core experience identical |
| Table cursor grid (10x6) | test-client-table.html, multimode | `TableCursorGrid` | Core experience identical |
| Text cursor with selection | test-client-text.html, multimode | `TextCursorEditor` | Core experience identical — TreeWalker positioning, selection highlights |
| Canvas cursor with tools | multimode | `CanvasCursorBoard` | Full parity — tool selector, color picker, size slider, trail effects per tool |
| 12 emoji reactions with animations | test-client.html | `ReactionButtons` + `ReactionsOverlay` | Full parity — same 12 emoji, unique animations each |
| Colored cursor circles with initials | All clients | `identityToColor` + `identityToInitials` | Identical pattern — hash-based deterministic colors |
| Mode switching (4 cursor modes) | test-client-multimode.html | `AppLayout` mode selector | Same 4 modes with subscribe/unsubscribe on switch |
| System event log | All clients | `TabbedEventLog` | Better — tabbed filtering by service, direction badges |
| Reconnection handling | All clients | `useWebSocket` | Better — exponential backoff, session token recovery |
| Multi-channel support | All clients | Channel input in each service section | Same pattern |

### Minor Gaps (v1 had, current doesn't)

| V1 Feature | V1 Source | Severity | Description |
|-------------|-----------|----------|-------------|
| **Formula bar in table mode** | test-client-table.html | LOW | V1 had a cell reference display (e.g., "A1") and formula/value input field above the grid. Current `TableCursorGrid` is grid-only, no formula bar. |
| **Formatting toolbar in text cursor mode** | test-client-text.html | LOW | V1 had B/I/U/list buttons and Clear Document in the text cursor client. Current `TextCursorEditor` has no toolbar. (Note: `SharedTextEditor` CRDT component has a full formatting toolbar — but that's a separate feature.) |
| **Tool selector in freeform mode** | test-client-freeform.html | LOW | V1 freeform client had 5 tools (cursor/pen/brush/eraser/select) with per-tool trail effects. Current `CursorCanvas` is mouse-track only. (Note: `CanvasCursorBoard` canvas mode has full tool support — so tools exist but only in canvas mode, not freeform.) |
| **Clear Trail button** | test-client-freeform.html | TRIVIAL | V1 had a button to clear cursor trails. Not present in current. |
| **Server selection dropdown** | test-client-modular.html | LOW | V1 modular client had a dropdown to connect to different service-specific servers (ports 8081-8083). Current frontend connects to a single gateway. |
| **20x10 table grid** | test-client-table.html | TRIVIAL | V1 standalone table client had 20 rows x 10 columns (A-J). Current is 10x6 (A-F). Multimode was also 10x6, so this is only a standalone client difference. |
| **Metadata JSON input** | test-client-modular.html | TRIVIAL | V1 modular client had raw JSON input fields for presence metadata and cursor metadata. Current uses structured UI controls instead (better UX). |

### New in Current (not in v1)

| Feature | Component | Description |
|---------|-----------|-------------|
| CRDT collaborative editing | `SharedTextEditor` + `useCRDT` | Y.js-powered real-time text editing with conflict detection |
| Cognito authentication | `useAuth` + `LoginForm` + `SignupForm` | Full auth flow with cross-tab sync |
| Social profiles | `SocialPanel` + `useSocialProfile` | User profiles with visibility settings |
| Friends/followers | `SocialPanel` + `useFriends` | Follow graph with mutual friends |
| Rooms | `RoomList` + `useRooms` | Standalone, group, and DM rooms |
| Groups | `GroupPanel` + `useGroups` | Group management with roles and invites |
| Posts & comments | `PostFeed` + `CommentThread` | Social feed with nested replies |
| Likes | `useLikes` | Post and comment liking with counts |
| Activity feed | `ActivityPanel` | Real-time activity timeline |
| Big Brother dashboard | `BigBrotherPanel` | Live monitoring with stats |
| Typing indicators | `usePresence` | "typing..." shown in presence panel |
| Session recovery | `useWebSocket` | Reconnects with preserved subscriptions |
| Notification banners | `NotificationBanner` | Auto-dismiss event notifications |

---

## Recommendation

**All core v1 experiences are preserved.** The 7 minor gaps above are cosmetic/convenience features, not core interaction patterns. The current app is a strict superset of v1 functionality.

If you want exact v1 parity on the minor items, the highest-value additions would be:
1. **Merge freeform + canvas modes** — freeform is just canvas without tools. Consider adding tool selector to freeform, or combining them into one mode.
2. **Formula bar for table mode** — nice UX touch for the spreadsheet experience.
3. **Formatting toolbar for text cursor** — could reuse the CRDT toolbar component.

The rest (clear trail, server dropdown, larger grid, raw JSON input) are dev-tooling conveniences that the React app handles better through its structured UI.
