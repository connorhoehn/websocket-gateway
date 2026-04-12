# Frontend Technology Analysis

**Analysis Date:** 2026-04-12

## Hook Composition Architecture

### Core Pattern: Hub-and-Spoke Message Bus

The frontend follows a **hub-and-spoke** hook composition model. `useWebSocket` is the single source of truth for gateway connectivity. All feature hooks compose on top of it via a **message handler registry pattern** — they do NOT call `useWebSocket` themselves.

**Hub:** `frontend/src/hooks/useWebSocket.ts` (267 lines)
- Manages WebSocket lifecycle, exponential backoff reconnect (5 retries)
- Exposes `sendMessage`, `connectionState`, `sessionToken`, `clientId`, `switchChannel`
- Does NOT subscribe to any service — feature hooks handle their own subscriptions

**Wiring Layer:** `frontend/src/app/App.tsx` — `GatewayDemo` component (lines 96–292)
- Creates a `featureHandlers` ref array (line 114)
- Passes all incoming WS messages to every registered handler (line 119)
- Creates a stable `onMessage` registrar function (lines 173–178) that feature hooks use to register/unregister message handlers
- Instantiates ALL feature hooks at this level and passes results down

**Feature Hook Interface Contract:**
Every WS-based feature hook accepts the same options shape:
```typescript
interface FeatureHookOptions {
  sendMessage: (msg: Record<string, unknown>) => void;
  onMessage: (handler: (msg: GatewayMessage) => void) => () => void;
  currentChannel: string;
  connectionState: ConnectionState;
  displayName: string;  // varies slightly per hook
}
```

### Feature Hook Inventory (WS-based, composing on useWebSocket)

| Hook | File | Lines | Service Protocol |
|------|------|-------|-----------------|
| `usePresence` | `frontend/src/hooks/usePresence.ts` | 203 | `presence:*` |
| `useChat` | `frontend/src/hooks/useChat.ts` | 141 | `chat:*` |
| `useCursors` | `frontend/src/hooks/useCursors.ts` | 340 | `cursor:*` |
| `useCRDT` | `frontend/src/hooks/useCRDT.ts` | 194 | `crdt:*` |
| `useReactions` | `frontend/src/hooks/useReactions.ts` | 130 | `reaction:*` |
| `useActivityBus` | `frontend/src/hooks/useActivityBus.ts` | 251 | `activity:*` |
| `useDocuments` | `frontend/src/hooks/useDocuments.ts` | 257 | `crdt:*` (document list/presence) |
| `useVersionHistory` | `frontend/src/hooks/useVersionHistory.ts` | 300 | `crdt:*` (snapshot ops) |
| `useCollaborativeDoc` | `frontend/src/hooks/useCollaborativeDoc.ts` | 719 | `crdt:*` (Y.js sync) |

### Feature Hook Inventory (REST-based, no WS composition)

| Hook | File | Lines | API |
|------|------|-------|-----|
| `useRooms` | `frontend/src/hooks/useRooms.ts` | 275 | `VITE_SOCIAL_API_URL/api/rooms/*` |
| `usePosts` | `frontend/src/hooks/usePosts.ts` | 225 | `VITE_SOCIAL_API_URL/api/rooms/*/posts/*` |
| `useGroups` | `frontend/src/hooks/useGroups.ts` | 212 | `VITE_SOCIAL_API_URL/api/groups/*` |
| `useSocialProfile` | `frontend/src/hooks/useSocialProfile.ts` | 132 | `VITE_SOCIAL_API_URL/api/profiles/*` |
| `useFriends` | `frontend/src/hooks/useFriends.ts` | 124 | `VITE_SOCIAL_API_URL/api/friends/*` |
| `useLikes` | `frontend/src/hooks/useLikes.ts` | 162 | `VITE_SOCIAL_API_URL/api/likes/*` |
| `useComments` | `frontend/src/hooks/useComments.ts` | 162 | `VITE_SOCIAL_API_URL/api/comments/*` |

### Standalone Hooks (no WS or REST)

| Hook | File | Lines | Purpose |
|------|------|-------|---------|
| `useAuth` | `frontend/src/hooks/useAuth.ts` | 370 | Cognito auth lifecycle |
| `useIdleDetector` | `frontend/src/hooks/useIdleDetector.ts` | 91 | Window activity tracking |
| `useMentionUsers` | `frontend/src/hooks/useMentionUsers.ts` | 76 | Aggregates mention candidates from awareness + directory |
| `useMyMentionsAndTasks` | `frontend/src/hooks/useMyMentionsAndTasks.ts` | 130 | Derives user's mentions/tasks from Y.js state |

## Ref-Syncing Pattern (Pervasive)

Every WS feature hook uses the **same boilerplate pattern** to avoid stale closures:

```typescript
const sendMessageRef = useRef(sendMessage);
useEffect(() => { sendMessageRef.current = sendMessage; }, [sendMessage]);

const currentChannelRef = useRef(currentChannel);
useEffect(() => { currentChannelRef.current = currentChannel; }, [currentChannel]);

const displayNameRef = useRef(displayName);
useEffect(() => { displayNameRef.current = displayName; }, [displayName]);
```

This pattern appears in: `usePresence`, `useChat`, `useCursors`, `useReactions`, `useActivityBus`, `useDocuments`, `usePosts`, `useRooms` — at minimum 8 hooks, each with 2–6 ref-sync pairs. Total: ~50 instances of this 2-line boilerplate across the codebase.

**Impact:** Works correctly but adds ~10–20 lines of pure boilerplate per hook. A shared `useLatestRef()` utility or `useEvent()` polyfill would eliminate this.

## Component Organization & Prop Drilling

### Prop Drilling Depth

The architecture has a **3–4 level prop drilling chain** from `App.tsx` to leaf components:

```
App.tsx (auth, hooks)
  → GatewayDemo (all feature hooks instantiated here, 40+ props assembled)
    → AppLayout (44 props in AppLayoutProps interface)
      → DocumentEditorPage (10 props)
        → SectionList → SectionBlock → TiptapEditor (7 props)
```

**AppLayout receives 44 distinct props** (`frontend/src/components/AppLayout.tsx`, lines 138–199). This is the primary bottleneck. Key concerns:
- `ws: UseWebSocketReturn` — the entire WS return object is passed through
- `onMessage`, `sendMessage` — raw WS primitives threaded down 3+ levels
- Comment callbacks (`onAddComment`, `onResolveThread`, `onUnresolveThread`) flow through 4 components

### No Context Providers

There are **zero React Context providers** in the app (besides what Tiptap uses internally). Every piece of state flows via props. This means:
- Adding a new feature that needs `sendMessage` or `onMessage` requires threading it through every intermediate component
- `AppLayout` is forced to import types from hooks it doesn't use (`UseWebSocketReturn`, `ActivityEvent`, etc.)

### Component Sizes

Files exceeding 500 lines (complexity hotspots):

| Component | Lines | Concern |
|-----------|-------|---------|
| `ReaderMode.tsx` | 993 | Monolithic read-only view |
| `DocumentEditorPage.tsx` | 835 | Orchestrates all doc modes |
| `AppLayout.tsx` | 821 | Top-level layout with 44 props |
| `SectionComments.tsx` | 758 | Comment thread UI |
| `SocialPanel.tsx` | 559 | Social profile/friends |
| `GroupPanel.tsx` | 555 | Group management |

## State Management Approach

### Architecture: Distributed useState + Y.js

There is **no global state management library** (no Redux, Zustand, Jotai, or Recoil). State is managed via:

1. **useState in hooks** — Each feature hook owns its domain state (`messages`, `users`, `cursors`, etc.)
2. **Y.js documents** — Collaborative document state lives in `Y.Doc` instances managed by `useCollaborativeDoc`
3. **Y.js Awareness** — Participant presence/cursor state uses the Y.js awareness protocol via `GatewayProvider`
4. **sessionStorage** — WS session token and dev identity persistence
5. **localStorage** — Cognito auth tokens (`auth_id_token`, `auth_refresh_token`, `auth_email`)

### Scaling Assessment

**What works well:**
- Hook isolation is clean — each hook manages its own subscription lifecycle with proper cleanup
- Y.js handles conflict resolution for collaborative editing
- The `onMessage` registrar pattern allows hooks to independently filter messages

**What does not scale:**
- All hooks are instantiated in `GatewayDemo` regardless of which view is active. `useCursors`, `useCRDT`, `useChat`, `useReactions` all subscribe to channels even when the user is on the Documents tab
- `AppLayout` re-renders on ANY state change from ANY hook because all 44 props feed through it
- No `React.memo`, `useMemo`, or `useCallback` on the `AppLayout` component itself
- The `onMessage` function created in `GatewayDemo` (line 173) is **not wrapped in `useCallback`** — it creates a new function reference every render, though hooks access it via refs so this is mitigated

## TypeScript Usage Quality

### Strengths
- All hooks have explicit public type interfaces (`UsePresenceReturn`, `UseChatOptions`, etc.)
- Gateway message protocol is typed via `GatewayMessage` with discriminated union on `type` field
- Document types in `frontend/src/types/document.ts` are comprehensive (89 lines of domain types)

### Weaknesses
- `GatewayMessage` uses `[key: string]: unknown` index signature — all field access requires `as` casts:
  ```typescript
  const clientId = msg.clientId as string;
  const content = msg.content as string;
  const msgData = msg.data as { displayName?: string } | undefined;
  ```
  This pattern appears in every message handler. There are no typed message discriminants beyond `type` and `action`.

- `Record<string, unknown>` is the universal send format — no typed outbound messages:
  ```typescript
  sendMessage: (msg: Record<string, unknown>) => void;
  ```

- Multiple `as any` casts in `DocumentEditorPage.tsx` (lines 557, 559) for export enrichment
- REST hooks cast all `fetch` responses with `as Promise<T>` without runtime validation

### Type Coverage Gaps
- No runtime validation (no Zod, io-ts, or similar) for incoming WebSocket messages or REST responses
- `import.meta.env` cast to `Record<string, string>` everywhere instead of a typed env config

## Code Duplication

### Pattern 1: Ref-sync boilerplate (described above)
~50 instances across 8+ hooks.

### Pattern 2: REST hook CRUD pattern
The social hooks (`useGroups`, `useRooms`, `usePosts`, `useSocialProfile`, `useFriends`, `useLikes`, `useComments`) all follow an identical pattern:
```typescript
const [items, setItems] = useState([]);
const [loading, setLoading] = useState(false);
const [error, setError] = useState<string | null>(null);
const baseUrl = (import.meta.env as Record<string, string>).VITE_SOCIAL_API_URL ?? '';

const action = useCallback(async () => {
  setLoading(true);
  setError(null);
  try {
    const res = await fetch(`${baseUrl}/api/...`, { headers: { Authorization: `Bearer ${idToken}` } });
    if (!res.ok) throw new Error(`Failed to X (${res.status})`);
    const data = await res.json() as T;
    setItems(data);
  } catch (err) {
    setError((err as Error).message);
  } finally {
    setLoading(false);
  }
}, [idToken, baseUrl]);
```
This identical structure appears in 7 hooks. A generic `useSocialApi<T>()` or shared fetch utility would eliminate 60–70% of this code.

### Pattern 3: WS subscribe/unsubscribe lifecycle
Every WS hook has an identical `useEffect` for subscribe/unsubscribe:
```typescript
useEffect(() => {
  if (connectionState !== 'connected' || !currentChannel) return;
  sendMessage({ service: 'X', action: 'subscribe', channel: currentChannel });
  return () => {
    sendMessageRef.current({ service: 'X', action: 'unsubscribe', channel: currentChannel });
    setItems([]);
  };
}, [currentChannel, connectionState]);
```
This appears in `usePresence`, `useChat`, `useCursors`, `useReactions`, `useCRDT`, `useActivityBus`, `useDocuments` (7 hooks).

### Pattern 4: Avatar/initials rendering
`getInitials()` helper is defined in both `SectionBlock.tsx` (line 112) and `ParticipantAvatars.tsx`. Avatar circle rendering with gradient + online dot is duplicated in `SectionBlock.tsx` (AvatarStack) and `ParticipantAvatars.tsx`.

## Bundle Size Concerns

### Heavy Dependencies

| Package | Purpose | Tree-shakeable? | Concern |
|---------|---------|-----------------|---------|
| `yjs` (13.6.29) | CRDT | Partially | Core requirement, ~30KB gzipped |
| `y-prosemirror` (1.3.7) | Y.js ↔ ProseMirror bridge | No | Required for Tiptap collab |
| `@tiptap/*` (8 packages) | Rich text editor | Partially | ~100KB+ gzipped combined |
| `amazon-cognito-identity-js` (6.3.16) | Auth | No | ~40KB gzipped, heavy for what it does |
| `lib0` (0.2.117) | Y.js utility lib | Partially | Required by Y.js |

### Potential Optimizations
- **Cognito SDK**: Only `CognitoUserPool`, `CognitoUser`, `AuthenticationDetails`, `CognitoUserAttribute`, `CognitoRefreshToken` are used from `amazon-cognito-identity-js`. The full SDK includes SRP math, device tracking, etc. Consider `@aws-sdk/client-cognito-identity-provider` with tree-shaking, or raw JWT+fetch for USER_PASSWORD_AUTH.
- **No code splitting**: All views (Panels, Social, Dashboard, Documents) are statically imported in `AppLayout.tsx`. The document editor (Tiptap + Y.js) loads even when the user is on the Social tab. `React.lazy()` for view-level components would defer ~150KB of JS.
- **No dynamic imports**: All 8 Tiptap extensions are statically imported in `TiptapEditor.tsx`.

## Inline Styles vs CSS Approach

### Current State: 100% Inline Styles

The application uses **exclusively inline `style={}` objects**. There is no CSS-in-JS library, no CSS modules, no Tailwind, no styled-components.

**CSS files:**
- `frontend/src/index.css` — 75 lines of Vite scaffold CSS (base resets, dark mode, button defaults)
- No other `.css` files exist anywhere in `src/`

**Style patterns observed:**

1. **Module-level style constants** — Used in `SectionBlock.tsx`, `AppLayout.tsx`:
   ```typescript
   const sectionCardStyle: React.CSSProperties = { background: '#ffffff', ... };
   ```

2. **Inline style objects in JSX** — Used everywhere else:
   ```tsx
   <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px' }}>
   ```

3. **Dynamic style functions** — Used for parameterized styles:
   ```typescript
   const typeBadgeStyle = (bg: string): React.CSSProperties => ({ ... });
   ```

4. **Inline event-based "hover" effects** — Using `onMouseEnter`/`onMouseLeave` to simulate `:hover`:
   ```typescript
   onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = '#e2e8f0'; }}
   onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'none'; }}
   ```
   This pattern appears in `SectionBlock.tsx` (line 289) and multiple other components.

5. **CSS animations referenced but not defined** — `animation: 'slideInRight 0.3s ease-out'` in `AppLayout.tsx` (line 94) references a keyframe animation that is **not defined anywhere** — it will silently do nothing.

### Consistency Issues
- Color tokens are hardcoded as hex strings everywhere (`#e2e8f0`, `#64748b`, `#3b82f6`, `#1e293b`). No shared color palette or design tokens.
- Font sizes mix `rem` and `px` units inconsistently
- Spacing uses arbitrary pixel values (no 4/8px grid system enforced)
- The `index.css` sets `color-scheme: light dark` and defines dark mode styles, but ALL inline styles hardcode light-mode colors — dark mode is effectively broken

## GatewayProvider (Y.js Bridge)

`frontend/src/providers/GatewayProvider.ts` (106 lines) bridges Y.js with the WS gateway:
- Extends `lib0/observable` (not React Context)
- Converts Y.js binary updates to base64 for JSON transport over the gateway
- Manages awareness state (user cursors, presence) with 50ms debounce
- Has a bug in `destroy()`: `this.doc.off('update', () => {})` passes a new anonymous function that won't match the original listener — the update listener is never actually removed

## Authentication Architecture

`frontend/src/hooks/useAuth.ts` (370 lines):
- Uses `amazon-cognito-identity-js` for USER_PASSWORD_AUTH
- Proactive token refresh: schedules `setTimeout` 2 minutes before JWT expiry
- Multi-tab sync via `BroadcastChannel('auth')` — token refreshes and sign-outs propagate
- Dev bypass mode (`VITE_DEV_BYPASS_AUTH=true`): generates random identities per tab from a pool of 8 names, stored in `sessionStorage`
- On token refresh, `App.tsx` triggers a WS reconnect so the gateway receives the new JWT

---

*Frontend tech analysis: 2026-04-12*
