# Testing a Real-Time Collaborative Document Editor - Research

**Researched:** 2026-04-11
**Domain:** Y.js CRDT testing, Playwright multi-user E2E, WebSocket real-time testing, load testing
**Confidence:** HIGH (Y.js unit/integration), HIGH (Playwright multi-context), MEDIUM (load testing), MEDIUM (session replay)

## Summary

Testing a real-time collaborative editor built on Y.js requires a layered approach: (1) pure Y.js convergence tests that run in Node.js with no browser, (2) React hook tests via Vitest verifying the useCRDT lifecycle, (3) Playwright E2E tests using multiple browser contexts to simulate concurrent editors and readers, and (4) k6 load tests for WebSocket throughput under concurrent user load.

The project already has solid unit test infrastructure (Vitest + Testing Library with 8 hook test suites) and a working useCRDT.test.ts. The main gaps are: no Playwright setup for multi-user E2E, no load testing, and no session replay tooling.

**Primary recommendation:** Build a 4-layer test pyramid: Y.js convergence tests (pure Node) -> useCRDT hook tests (Vitest, already exists) -> Playwright multi-context E2E (3 browser contexts: 2 editors + 1 reader) -> k6 WebSocket load tests.

## Standard Stack

### Core Testing Tools

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| vitest | 4.0.18 | Unit/hook testing | Already in project, fast Vite-native runner |
| @testing-library/react | 16.3.2 | React hook testing | Already in project, renderHook for useCRDT |
| @playwright/test | 1.59.1 | Multi-browser E2E | Best multi-context support, native WebSocket interception |
| yjs | 13.6.29 | CRDT convergence tests | Already in project, Y.Doc for pure-Node sync tests |
| k6 | N/A (Go binary) | WebSocket load testing | Industry standard for WS load testing, scriptable in JS |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| rrweb | 2.0.0-alpha.4 | Session recording/replay | Debug collaborative editing issues, record test failures |
| @tiptap/react | 3.22.3 | Rich text editor (future) | If migrating from contentEditable to Tiptap |
| y-prosemirror | 1.3.7 | Y.js <-> ProseMirror binding | If migrating to Tiptap (which uses ProseMirror) |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Playwright | Cypress | Cypress lacks true multi-tab/multi-context support -- critical for collaborative testing |
| k6 | Artillery | Artillery supports WS but k6 has better metrics, CI integration, and WebSocket API |
| rrweb | Replay.io | Replay.io is a hosted service; rrweb is self-hosted and embeddable |

## Architecture Patterns

### Test Directory Structure

```
frontend/
  src/hooks/__tests__/
    useCRDT.test.ts           # Existing hook tests (keep)
  e2e/
    playwright.config.ts       # Playwright config
    fixtures/
      multi-user.ts            # Custom fixture: 3 browser contexts
    tests/
      collaborative-edit.spec.ts   # 2 editors type, verify sync
      read-mode.spec.ts            # Reader sees updates without editing
      mode-transitions.spec.ts     # edit -> read -> ack mode transitions
      reconnect-recovery.spec.ts   # Disconnect/reconnect preserves state
      export-persistence.spec.ts   # Verify snapshot persistence round-trip
tests/
  crdt/
    convergence.test.js        # Pure Y.js convergence (no browser)
    conflict-resolution.test.js # Concurrent edits resolve correctly
    snapshot-roundtrip.test.js  # Encode -> store -> decode fidelity
load/
  k6-websocket-collab.js      # k6 script: N virtual users editing
  k6-websocket-readonly.js    # k6 script: N virtual users reading
```

### Pattern 1: Pure Y.js Convergence Testing (No Browser)

**What:** Create multiple Y.Doc instances in Node.js, simulate concurrent edits, sync updates, verify convergence.
**When to use:** Validate CRDT logic without browser overhead. Runs in milliseconds.
**Example:**

```typescript
// Source: https://docs.yjs.dev/api/document-updates
import * as Y from 'yjs';
import { describe, it, expect } from 'vitest';

describe('Y.js convergence', () => {
  it('two docs converge after exchanging updates', () => {
    const doc1 = new Y.Doc();
    const doc2 = new Y.Doc();

    // Wire up real-time sync (simulates WebSocket relay)
    doc1.on('update', (update: Uint8Array) => {
      Y.applyUpdate(doc2, update);
    });
    doc2.on('update', (update: Uint8Array) => {
      Y.applyUpdate(doc1, update);
    });

    // Concurrent edits
    doc1.getText('content').insert(0, 'Hello ');
    doc2.getText('content').insert(0, 'World');

    // Verify convergence
    expect(doc1.getText('content').toString()).toBe(doc2.getText('content').toString());
  });

  it('docs converge via state vector exchange (offline sync)', () => {
    const doc1 = new Y.Doc();
    const doc2 = new Y.Doc();

    // Offline edits (no sync wired)
    doc1.getText('content').insert(0, 'Alice wrote this');
    doc2.getText('content').insert(0, 'Bob wrote this');

    // Sync via state vectors (efficient diff)
    const sv1 = Y.encodeStateVector(doc1);
    const sv2 = Y.encodeStateVector(doc2);
    const diff1 = Y.encodeStateAsUpdate(doc1, sv2);
    const diff2 = Y.encodeStateAsUpdate(doc2, sv1);
    Y.applyUpdate(doc1, diff2);
    Y.applyUpdate(doc2, diff1);

    // Both docs now have identical content
    expect(doc1.getText('content').toString()).toBe(doc2.getText('content').toString());
  });

  it('handles concurrent insert at same position', () => {
    const doc1 = new Y.Doc();
    const doc2 = new Y.Doc();

    // Both insert at position 0 without seeing each other
    doc1.getText('content').insert(0, 'A');
    doc2.getText('content').insert(0, 'B');

    // Exchange full state
    const state1 = Y.encodeStateAsUpdate(doc1);
    const state2 = Y.encodeStateAsUpdate(doc2);
    Y.applyUpdate(doc1, state2);
    Y.applyUpdate(doc2, state1);

    // Both converge to same ordering (Y.js deterministic)
    const text1 = doc1.getText('content').toString();
    const text2 = doc2.getText('content').toString();
    expect(text1).toBe(text2);
    expect(text1).toHaveLength(2);
    expect(text1).toContain('A');
    expect(text1).toContain('B');
  });
});
```

### Pattern 2: Y.js Randomized Fuzz Testing (from Y.js test suite)

**What:** Y.js's own test suite uses a `TestConnector` that simulates network conditions: 2% random disconnect, 1% full flush, 50% random message delivery. Apply random operations then verify convergence.
**When to use:** Confidence that edge cases are covered. Run as part of CI.
**Example:**

```typescript
// Inspired by Y.js testHelper.js
import * as Y from 'yjs';

function createTestDocs(count: number): Y.Doc[] {
  const docs: Y.Doc[] = [];
  const updates: Map<Y.Doc, Uint8Array[]> = new Map();

  for (let i = 0; i < count; i++) {
    const doc = new Y.Doc();
    updates.set(doc, []);
    docs.push(doc);
  }

  // Wire each doc to broadcast updates to all others' queues
  for (const doc of docs) {
    doc.on('update', (update: Uint8Array) => {
      for (const other of docs) {
        if (other !== doc) {
          updates.get(other)!.push(update);
        }
      }
    });
  }

  // Flush all pending updates (simulate network delivery)
  const flushAll = () => {
    for (const [doc, pending] of updates) {
      for (const update of pending) {
        Y.applyUpdate(doc, update);
      }
      pending.length = 0;
    }
  };

  return Object.assign(docs, { flushAll });
}

// Usage in test:
it('N clients converge after random operations', () => {
  const docs = createTestDocs(5) as Y.Doc[] & { flushAll: () => void };

  // Random operations
  for (let i = 0; i < 100; i++) {
    const doc = docs[Math.floor(Math.random() * docs.length)];
    const text = doc.getText('content');
    const pos = Math.floor(Math.random() * (text.length + 1));
    text.insert(pos, String.fromCharCode(65 + (i % 26)));
  }

  docs.flushAll();

  // All docs should have identical content
  const expected = docs[0].getText('content').toString();
  for (const doc of docs) {
    expect(doc.getText('content').toString()).toBe(expected);
  }
});
```

### Pattern 3: Playwright Multi-Context E2E (3 Windows)

**What:** Create 3 browser contexts in a single Playwright test: 2 editors + 1 reader. Type in editor1, verify sync in editor2 and reader.
**When to use:** End-to-end validation that the full stack (browser -> WebSocket -> gateway -> CRDT service -> broadcast -> browser) works.
**Example:**

```typescript
// Source: https://playwright.dev/docs/browser-contexts
import { test, expect } from '@playwright/test';

// Custom fixture providing 3 isolated browser contexts
test.describe('Collaborative editing - 3 windows', () => {
  test('editor1 types, editor2 and reader see changes', async ({ browser }) => {
    // Create 3 isolated contexts (like 3 separate browser windows)
    const editor1Ctx = await browser.newContext();
    const editor2Ctx = await browser.newContext();
    const readerCtx = await browser.newContext();

    const editor1 = await editor1Ctx.newPage();
    const editor2 = await editor2Ctx.newPage();
    const reader = await readerCtx.newPage();

    // Navigate all to the same document/channel
    const url = 'http://localhost:5173?channel=test-doc-1';
    await Promise.all([
      editor1.goto(url),
      editor2.goto(url),
      reader.goto(url),
    ]);

    // Wait for WebSocket connections to establish
    await Promise.all([
      editor1.waitForSelector('[contenteditable="true"]'),
      editor2.waitForSelector('[contenteditable="true"]'),
      reader.waitForSelector('[contenteditable]'),
    ]);

    // Editor1 types text
    const editorEl = editor1.locator('[contenteditable="true"]');
    await editorEl.click();
    await editorEl.pressSequentially('Hello from editor 1', { delay: 50 });

    // Verify editor2 receives the text (with retry/polling)
    await expect(editor2.locator('[contenteditable]'))
      .toContainText('Hello from editor 1', { timeout: 5000 });

    // Verify reader also sees the text
    await expect(reader.locator('[contenteditable]'))
      .toContainText('Hello from editor 1', { timeout: 5000 });

    // Cleanup
    await editor1Ctx.close();
    await editor2Ctx.close();
    await readerCtx.close();
  });

  test('concurrent edits from 2 editors converge', async ({ browser }) => {
    const ctx1 = await browser.newContext();
    const ctx2 = await browser.newContext();
    const page1 = await ctx1.newPage();
    const page2 = await ctx2.newPage();

    const url = 'http://localhost:5173?channel=test-doc-2';
    await Promise.all([page1.goto(url), page2.goto(url)]);
    await Promise.all([
      page1.waitForSelector('[contenteditable="true"]'),
      page2.waitForSelector('[contenteditable="true"]'),
    ]);

    // Both type simultaneously
    await Promise.all([
      page1.locator('[contenteditable="true"]').pressSequentially('AAA'),
      page2.locator('[contenteditable="true"]').pressSequentially('BBB'),
    ]);

    // Wait for sync to settle
    await page1.waitForTimeout(2000);

    // Both should converge to identical content
    const text1 = await page1.locator('[contenteditable]').textContent();
    const text2 = await page2.locator('[contenteditable]').textContent();
    expect(text1).toBe(text2);
    expect(text1!.length).toBeGreaterThanOrEqual(6); // Both contributions present

    await ctx1.close();
    await ctx2.close();
  });
});
```

### Pattern 4: WebSocket Message Inspection in Playwright

**What:** Use Playwright's `page.on('websocket')` to intercept and inspect WebSocket frames during E2E tests.
**When to use:** Verify correct CRDT message protocol (subscribe, update, snapshot).
**Example:**

```typescript
test('verify CRDT protocol messages', async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();

  const wsMessages: string[] = [];
  page.on('websocket', ws => {
    ws.on('framesent', frame => {
      wsMessages.push(frame.payload as string);
    });
    ws.on('framereceived', frame => {
      wsMessages.push(frame.payload as string);
    });
  });

  await page.goto('http://localhost:5173');
  await page.waitForSelector('[contenteditable="true"]');

  // Verify subscribe message was sent
  const subscribeMsgs = wsMessages.filter(m => {
    try { const p = JSON.parse(m); return p.service === 'crdt' && p.action === 'subscribe'; }
    catch { return false; }
  });
  expect(subscribeMsgs.length).toBeGreaterThan(0);

  await context.close();
});
```

### Pattern 5: Custom Playwright Fixture for Multi-User Testing

**What:** Define reusable fixtures that provide pre-configured user contexts.
**When to use:** Reuse across many collaborative test specs.
**Example:**

```typescript
// e2e/fixtures/multi-user.ts
import { test as base, Page, BrowserContext } from '@playwright/test';

type CollabFixtures = {
  editor1: Page;
  editor2: Page;
  reader: Page;
  editor1Context: BrowserContext;
  editor2Context: BrowserContext;
  readerContext: BrowserContext;
};

export const test = base.extend<CollabFixtures>({
  editor1Context: async ({ browser }, use) => {
    const ctx = await browser.newContext();
    await use(ctx);
    await ctx.close();
  },
  editor2Context: async ({ browser }, use) => {
    const ctx = await browser.newContext();
    await use(ctx);
    await ctx.close();
  },
  readerContext: async ({ browser }, use) => {
    const ctx = await browser.newContext();
    await use(ctx);
    await ctx.close();
  },
  editor1: async ({ editor1Context }, use) => {
    const page = await editor1Context.newPage();
    await use(page);
  },
  editor2: async ({ editor2Context }, use) => {
    const page = await editor2Context.newPage();
    await use(page);
  },
  reader: async ({ readerContext }, use) => {
    const page = await readerContext.newPage();
    await use(page);
  },
});

export { expect } from '@playwright/test';
```

### Anti-Patterns to Avoid

- **Testing Y.js convergence in the browser:** Pure convergence tests should run in Node.js via Vitest -- no browser overhead, runs in milliseconds. Only test the full UI stack in Playwright.
- **Using `page.waitForTimeout()` for sync verification:** Use Playwright's auto-retrying `expect().toContainText()` or `expect().toHaveText()` with timeout instead of fixed waits.
- **Single browser context for multi-user tests:** Playwright contexts share no state. Using a single context means shared cookies/storage -- not simulating real multi-user behavior.
- **Testing the CRDT algorithm itself:** Y.js has 17 test files with randomized fuzz testing. Don't retest what Y.js already validates. Test YOUR integration with Y.js instead.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Multi-client sync testing | Custom WebSocket test harness | Y.js `applyUpdate`/`encodeStateAsUpdate` in Vitest | Y.js API is designed for exactly this |
| Multi-user E2E simulation | Multiple browser processes | Playwright browser contexts | Contexts share a browser process but isolate state |
| WebSocket message interception | Custom proxy/middleware | Playwright `page.on('websocket')` | Built-in, no extra infrastructure |
| Session recording | Custom event logger | rrweb | Handles DOM mutations, canvas, input, etc. |
| WebSocket load testing | Custom concurrent WS scripts | k6 with `k6/websockets` module | Handles VU scaling, metrics, thresholds |
| CRDT conflict resolution testing | Manual state comparison | Y.js state vectors + `encodeStateAsUpdate` with diffs | Mathematically proven convergence |

## Common Pitfalls

### Pitfall 1: ContentEditable Sync Race Conditions
**What goes wrong:** Editor1 types, but the test checks editor2's content before the WebSocket round-trip completes.
**Why it happens:** WebSocket relay + CRDT 10ms batching + React re-render = 50-200ms total latency.
**How to avoid:** Use Playwright's `expect(locator).toContainText('...', { timeout: 5000 })` which auto-retries.
**Warning signs:** Flaky tests that pass sometimes, fail on CI.

### Pitfall 2: Y.Doc Leaks in Tests
**What goes wrong:** Tests create Y.Doc instances that are never destroyed, leading to memory leaks and stale listeners.
**Why it happens:** Y.Doc registers internal observers. Not calling `doc.destroy()` leaves them active.
**How to avoid:** Always `doc.destroy()` in test cleanup. The existing useCRDT hook already does this in its effect cleanup.
**Warning signs:** Tests that pass individually but fail when run together.

### Pitfall 3: Testing Full Content Replace Instead of Incremental Edits
**What goes wrong:** The current `applyLocalEdit` does delete-all + insert (full replace). This means every keystroke sends the entire document state, which works but is not how production collaborative editors behave.
**Why it happens:** The SharedTextEditor uses `contentEditable` with `innerHTML` diffing -- not character-level CRDT operations.
**How to avoid:** Test both the current full-replace behavior AND plan for future Tiptap/ProseMirror migration where edits are incremental.
**Warning signs:** Tests pass but performance degrades with large documents.

### Pitfall 4: Authentication in E2E Tests
**What goes wrong:** Playwright contexts need valid Cognito JWTs to connect to the WebSocket gateway.
**Why it happens:** The gateway requires JWT auth on connect (Phase 11).
**How to avoid:** Create test users via `create-test-user.sh`, then use Playwright to sign in via the LoginForm in each context. Or use a test-mode bypass for local development.
**Warning signs:** E2E tests fail with "connection refused" or auth errors.

### Pitfall 5: k6 Cannot Run Y.js
**What goes wrong:** k6 runs JavaScript in a Go runtime (goja), not Node.js. Y.js relies on Node.js APIs that k6 doesn't support.
**Why it happens:** k6's JS runtime is intentionally minimal for performance.
**How to avoid:** For load testing, send raw WebSocket messages that mimic CRDT updates (pre-encoded base64 payloads). Don't try to import Y.js in k6 scripts.
**Warning signs:** Import errors when trying to use `yjs` in k6.

### Pitfall 6: Snapshot Persistence Testing Requires DynamoDB
**What goes wrong:** Tests that verify snapshot persistence need a running DynamoDB (or LocalStack).
**Why it happens:** The CRDT service writes snapshots to DynamoDB via EventBridge.
**How to avoid:** For unit tests, mock the DynamoDB client. For integration tests, use LocalStack. For E2E, ensure the local dev stack is running.
**Warning signs:** "ResourceNotFoundException" in test logs.

## Testing Loop: Developer Workflow

### The Inner Loop (per-change, < 30 seconds)

```bash
# 1. Run Y.js convergence tests (pure Node, ~2s)
cd frontend && npx vitest run tests/crdt/convergence.test.ts

# 2. Run useCRDT hook tests (jsdom, ~3s)
npx vitest run src/hooks/__tests__/useCRDT.test.ts

# 3. Run build check (catches type errors, ~5s)
npx tsc -b --noEmit
```

### The Middle Loop (per-feature, < 5 minutes)

```bash
# 1. Start local dev stack (gateway + frontend + LocalStack)
# (assumed running in background)

# 2. Run Playwright multi-user E2E
npx playwright test e2e/tests/collaborative-edit.spec.ts

# 3. Verify snapshot persistence (requires LocalStack)
npx playwright test e2e/tests/export-persistence.spec.ts
```

### The Outer Loop (pre-merge, < 15 minutes)

```bash
# 1. Full test suite
npx vitest run
npx playwright test

# 2. Load test (optional, manual)
k6 run load/k6-websocket-collab.js --vus 20 --duration 60s
```

### Manual 3-Tab Testing

For quick manual verification during development:

```
Tab 1: http://localhost:5173?channel=test-doc   (Editor A)
Tab 2: http://localhost:5173?channel=test-doc   (Editor B)
Tab 3: http://localhost:5173?channel=test-doc   (Reader / Big Brother view)
```

Test checklist:
- [ ] Type in Tab 1 -- appears in Tab 2 and Tab 3 within 200ms
- [ ] Type in Tab 2 -- appears in Tab 1 and Tab 3
- [ ] Type simultaneously in Tab 1 and Tab 2 -- both converge to same content
- [ ] Refresh Tab 3 -- content restored from snapshot
- [ ] Disconnect Tab 1's network (DevTools) -- Tab 2 continues editing
- [ ] Reconnect Tab 1 -- content syncs from snapshot + live updates

## Mode Transition Testing (Read / Edit / Ack)

### Pattern: State Machine Testing

```typescript
describe('mode transitions', () => {
  it('read mode: content visible, editor disabled', () => {
    // Render SharedTextEditor with disabled=true
    // Verify contentEditable="false"
    // Verify "Disconnected" message shown
  });

  it('edit mode: editor enabled, changes broadcast', () => {
    // Render SharedTextEditor with disabled=false
    // Type text, verify applyLocalEdit called
    // Verify sendMessage called with crdt update
  });

  it('ack mode: conflict banner shown after remote merge', () => {
    // Apply remote update to doc with existing content
    // Verify hasConflict=true
    // Verify "Edits merged" banner visible
    // Click dismiss, verify hasConflict=false
  });

  it('transition: disconnect -> read mode -> reconnect -> edit mode', () => {
    // Start connected (edit mode)
    // Simulate connectionState -> 'disconnected'
    // Verify editor disabled
    // Simulate connectionState -> 'connected'
    // Verify editor re-enabled, subscribe sent, snapshot loaded
  });
});
```

## Session Recording and Replay

### rrweb Integration for Debugging

```typescript
// Record an editing session for debugging
import { record } from 'rrweb';

let events: any[] = [];
const stopRecording = record({
  emit(event) {
    events.push(event);
  },
  // Mask sensitive content
  maskTextSelector: '.private',
  // Record canvas/contenteditable
  recordCanvas: false,
});

// Later: replay
import { Replayer } from 'rrweb';
const replayer = new Replayer(events);
replayer.play();
```

### Lightweight Alternative: CRDT Event Log

For debugging collaborative editing specifically, you can log Y.js update events:

```typescript
// Debug logging for CRDT operations
const debugLog: Array<{
  timestamp: number;
  source: 'local' | 'remote';
  updateSize: number;
  docLength: number;
}> = [];

ydoc.on('update', (update: Uint8Array, origin: any) => {
  debugLog.push({
    timestamp: Date.now(),
    source: origin === null ? 'remote' : 'local',
    updateSize: update.byteLength,
    docLength: ydoc.getText('content').length,
  });
});

// Export for analysis
console.log(JSON.stringify(debugLog, null, 2));
```

## Demo/Playground Page

### Approach: Standalone Vite Route

Create a dedicated playground page that showcases the editor in isolation, similar to Tiptap's examples page.

```typescript
// frontend/src/pages/EditorPlayground.tsx
import { useState } from 'react';
import * as Y from 'yjs';
import { SharedTextEditor } from '../components/SharedTextEditor';

export function EditorPlayground() {
  const [mode, setMode] = useState<'edit' | 'read' | 'conflict'>('edit');
  const [content, setContent] = useState('<p>Start typing...</p>');

  return (
    <div style={{ maxWidth: 800, margin: '0 auto', padding: 20 }}>
      <h1>Editor Playground</h1>

      {/* Mode switcher */}
      <div style={{ marginBottom: 16 }}>
        <button onClick={() => setMode('edit')}>Edit Mode</button>
        <button onClick={() => setMode('read')}>Read Mode</button>
        <button onClick={() => setMode('conflict')}>Conflict Mode</button>
      </div>

      {/* Editor with controlled mode */}
      <SharedTextEditor
        content={content}
        applyLocalEdit={setContent}
        disabled={mode === 'read'}
        hasConflict={mode === 'conflict'}
        onDismissConflict={() => setMode('edit')}
      />

      {/* Debug panel */}
      <details style={{ marginTop: 16 }}>
        <summary>Debug: Raw HTML Content</summary>
        <pre style={{ fontSize: 12, overflow: 'auto' }}>{content}</pre>
      </details>
    </div>
  );
}
```

### Split-Screen Multi-User Demo

For demonstrating collaborative editing without needing separate tabs:

```typescript
// frontend/src/pages/CollabDemo.tsx
// Two editor instances side-by-side sharing a Y.Doc
import * as Y from 'yjs';
import { SharedTextEditor } from '../components/SharedTextEditor';

export function CollabDemo() {
  const [doc] = useState(() => new Y.Doc());
  const [text] = useState(() => doc.getText('content'));

  // Wire both editors to the same Y.Doc
  // Left = "User A", Right = "User B"
  // Each editor applies edits to the shared doc
  // Changes propagate instantly (same Y.Doc in memory)
}
```

## Load Testing with k6

### WebSocket Load Test Script

```javascript
// load/k6-websocket-collab.js
import ws from 'k6/ws';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

// Pre-encoded Y.js update (base64) -- a simple text insert
// Generate this offline: encode a Y.Doc with a short text insert
const SAMPLE_UPDATE = 'AQH...(base64)...'; // Pre-compute this

const syncLatency = new Trend('sync_latency');
const messageSuccess = new Rate('message_success');

export const options = {
  stages: [
    { duration: '30s', target: 10 },   // Ramp up to 10 users
    { duration: '1m', target: 50 },    // Ramp up to 50 users
    { duration: '30s', target: 0 },    // Ramp down
  ],
  thresholds: {
    sync_latency: ['p(95)<200'],       // 95th percentile < 200ms
    message_success: ['rate>0.99'],    // 99% message success
  },
};

export default function () {
  const url = 'ws://localhost:8080';
  const channel = 'load-test-doc';

  const res = ws.connect(url, { headers: { Authorization: `Bearer ${__ENV.TEST_TOKEN}` } }, (socket) => {
    socket.on('open', () => {
      // Subscribe to CRDT channel
      socket.send(JSON.stringify({
        service: 'crdt',
        action: 'subscribe',
        channel,
      }));
    });

    socket.on('message', (data) => {
      const msg = JSON.parse(data);
      if (msg.type === 'crdt:update') {
        syncLatency.add(Date.now() - new Date(msg.timestamp).getTime());
        messageSuccess.add(1);
      }
    });

    // Simulate editing: send update every 500ms
    socket.setInterval(() => {
      socket.send(JSON.stringify({
        service: 'crdt',
        action: 'update',
        channel,
        update: SAMPLE_UPDATE,
      }));
    }, 500);

    // Keep connection open for test duration
    socket.setTimeout(() => {
      socket.send(JSON.stringify({
        service: 'crdt',
        action: 'unsubscribe',
        channel,
      }));
      socket.close();
    }, 120000);
  });

  check(res, {
    'WebSocket connected': (r) => r && r.status === 101,
  });
}
```

### Expected Capacity Benchmarks

| Metric | Target | How to Measure |
|--------|--------|----------------|
| Concurrent editors per document | 20-50 | k6 with increasing VUs |
| Sync latency (p95) | < 200ms | k6 `sync_latency` metric |
| Message throughput | 1000 msgs/sec | k6 with sustained load |
| Snapshot recovery time | < 1s | Playwright disconnect/reconnect test |
| Memory per connection | < 5MB | Monitor gateway process during k6 run |

## Markdown <-> CRDT Round-Trip Fidelity

### Current State

The current editor uses `contentEditable` with `innerHTML` -- it stores HTML, not markdown. The Y.Text shared type stores plain text (via `toString()`), but `applyLocalEdit` sends the full `innerHTML`.

### If Migrating to Tiptap + Markdown

For future Tiptap/ProseMirror integration with markdown export:

```typescript
// Round-trip fidelity test
import { generateJSON, generateHTML } from '@tiptap/html';
import { extensions } from './editor-config';

it('markdown -> HTML -> Y.js -> HTML -> markdown preserves content', () => {
  const originalMarkdown = '# Hello\n\n**Bold** and *italic*\n\n- Item 1\n- Item 2';

  // markdown -> prosemirror JSON -> HTML
  const json = markdownToJSON(originalMarkdown);
  const html = generateHTML(json, extensions);

  // HTML -> Y.js (via y-prosemirror binding)
  const doc = new Y.Doc();
  // ... apply prosemirror state to Y.XmlFragment ...

  // Y.js -> HTML -> markdown
  const recoveredHtml = generateHTML(/* from Y.js state */, extensions);
  const recoveredMarkdown = htmlToMarkdown(recoveredHtml);

  // Verify fidelity
  expect(recoveredMarkdown).toBe(originalMarkdown);
});
```

**Known fidelity gaps to test:**
- Nested lists (depth > 2)
- Code blocks with language annotations
- Tables
- Inline code adjacent to bold/italic
- Link titles vs. link text
- Image alt text preservation

## Playwright Configuration

```typescript
// frontend/e2e/playwright.config.ts
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  fullyParallel: false, // Collaborative tests need sequential execution
  retries: 1,
  workers: 1, // Single worker for collaborative tests
  timeout: 30000,
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'npm run dev',
    port: 5173,
    reuseExistingServer: true,
  },
});
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Cypress for multi-user tests | Playwright multi-context | 2023+ | Playwright has native multi-context; Cypress does not |
| Manual WebSocket testing | Playwright `page.routeWebSocket()` | Playwright 1.48 (2024) | Can mock/intercept WS frames natively |
| Custom load test scripts | k6 `k6/websockets` module | k6 v0.40+ | Standard WS load testing with metrics |
| Full session replay (LogRocket) | rrweb (self-hosted) | 2024+ | No SaaS dependency, embeddable |

## Open Questions

1. **Authentication in Playwright tests**
   - What we know: Gateway requires Cognito JWT. Test users can be created via CLI.
   - What's unclear: Whether to sign in via UI in each Playwright context or inject tokens directly.
   - Recommendation: Sign in via LoginForm in each context (tests the auth flow too). Cache tokens for speed.

2. **Current editor vs. Tiptap migration**
   - What we know: SharedTextEditor uses raw `contentEditable` + `innerHTML`. Not ideal for incremental CRDT ops.
   - What's unclear: Whether Tiptap migration is planned or the current approach is final.
   - Recommendation: Write tests that work with current editor. When/if Tiptap is adopted, the Playwright E2E tests should need minimal changes (same content assertions).

3. **LocalStack availability for snapshot tests**
   - What we know: CRDT snapshots persist to DynamoDB via EventBridge. LocalStack is used for local dev.
   - What's unclear: Whether LocalStack is always running during test execution.
   - Recommendation: Make snapshot persistence tests conditional on LocalStack being available. Unit tests should mock DynamoDB.

## Sources

### Primary (HIGH confidence)
- [Y.js Document Updates API](https://docs.yjs.dev/api/document-updates) - Sync patterns, state vectors, update encoding
- [Y.js GitHub test suite](https://github.com/yjs/yjs/tree/main/tests) - testHelper.js with TestConnector, randomized fuzz testing
- [Playwright Browser Contexts](https://playwright.dev/docs/browser-contexts) - Multi-user isolation pattern
- [Playwright Input Actions](https://playwright.dev/docs/input) - contentEditable interaction

### Secondary (MEDIUM confidence)
- [Playwright Multi-User Fixtures](https://medium.com/@edtang44/isolate-and-conquer-multi-user-testing-with-playwright-fixtures-f211ad438974) - Custom fixture pattern for collaborative testing
- [k6 WebSocket Documentation](https://grafana.com/docs/k6/latest/using-k6/protocols/websockets/) - WS load testing API
- [rrweb GitHub](https://github.com/rrweb-io/rrweb) - Session recording/replay library
- [Tiptap Examples](https://tiptap.dev/docs/examples) - Demo/playground patterns

### Tertiary (LOW confidence)
- k6 + CRDT combined load testing: No verified examples found of k6 sending actual Y.js updates. Pre-encoded payloads approach is recommended but unverified at scale.
- rrweb + contentEditable: rrweb captures DOM mutations but behavior with frequent contentEditable changes in a CRDT editor is unverified.

## Metadata

**Confidence breakdown:**
- Y.js convergence testing: HIGH - verified from official docs and Y.js's own test suite
- Playwright multi-context: HIGH - verified from official Playwright docs
- useCRDT hook testing: HIGH - existing test suite in project validates the pattern
- k6 WebSocket load testing: MEDIUM - k6 WS support verified but CRDT-specific load testing unverified
- Session recording: MEDIUM - rrweb is well-established but not tested with this specific editor
- Markdown round-trip: LOW - no current need (editor uses HTML), future concern only

**Research date:** 2026-04-11
**Valid until:** 2026-05-11 (stable ecosystem, Y.js/Playwright/k6 all mature)
