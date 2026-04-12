# Version Checkpointing System Research

**Researched:** 2026-04-12
**Domain:** Y.js document version history -- auto-checkpointing, diffs, restore, named versions
**Confidence:** HIGH (based on existing codebase analysis + Y.js official APIs)

---

## 1. Current State Analysis

### What Already Exists

**Server (`crdt-service.js`):**
- DynamoDB table `crdt-snapshots` with composite key `(documentId: S, timestamp: N)`
- Snapshots are gzip-compressed `Y.encodeStateAsUpdate()` output stored as DynamoDB Binary (B)
- Three snapshot triggers already implemented:
  1. **Debounced** -- 5 seconds after last edit (`SNAPSHOT_DEBOUNCE_MS`, env-configurable)
  2. **Operation count** -- after 50 operations on a channel
  3. **Periodic** -- every 5 minutes (`SNAPSHOT_INTERVAL_MS`, env-configurable)
- Final snapshot on last-subscriber-unsubscribe
- Redis hot-cache for latest snapshot (1-hour TTL)
- `handleListSnapshots` -- queries DynamoDB descending by timestamp, returns `{timestamp, age}[]`
- `handleGetSnapshotAtVersion` -- loads a specific snapshot by exact timestamp, decompresses, returns base64
- `handleRestoreSnapshot` -- loads historical snapshot, replaces in-memory Y.Doc, broadcasts to all subscribers, writes new snapshot
- 7-day TTL on DynamoDB items (direct-write path only)

**Frontend (`useVersionHistory.ts`):**
- Lists versions via `listSnapshots` action (limit 20)
- Preview: loads a version into a standalone `Y.Doc`, exposes as `previewDoc`
- Restore: sends `restoreSnapshot` action, refreshes list on `snapshotRestored`
- Cleanup: destroys preview Y.Doc instances

**Frontend (`VersionHistoryPanel.tsx`):**
- Fixed slide-out panel (right side, 320px)
- Shows relative time + absolute timestamp per version
- Click to preview, "Restore this version" button with `window.confirm`
- No diff visualization, no named versions, no author info

### Gaps

| Feature | Current State | Gap |
|---------|--------------|-----|
| Auto-checkpoint | Server does debounce + op-count + periodic | Works, but no "only if dirty" flag on debounced timer -- triggers even without changes if ops > 0 (already handled by the `operationsSinceSnapshot > 0` check) |
| Snapshot metadata | Only `documentId` + `timestamp` stored | No author, description, name, or change summary |
| Diff visualization | None | No diff computation, no UI for showing changes |
| Named versions | None | No way to tag or label a snapshot |
| Restore safety | Overwrites current doc, broadcasts to all | No preview-before-restore in the editor itself, no fork option |
| Retention policy | 7-day TTL (hardcoded) | No tiered retention, named versions also expire |
| Version types | All snapshots treated equally | No distinction between auto-checkpoint and manual save |

---

## 2. Auto-Checkpointing Design

### Current Triggers (Already Working)

The server already auto-checkpoints via three mechanisms:

1. **Debounced (5s inactivity):** `_scheduleDebouncedSnapshot` clears and resets a per-channel timer on every update. Fires `writeSnapshot` after 5s of silence if `operationsSinceSnapshot > 0`. This is the primary dirty-check.

2. **Operation count (50 ops):** Triggers immediate snapshot. Prevents accumulation during sustained editing bursts.

3. **Periodic (5 min):** `writePeriodicSnapshots` iterates all channels, writes snapshot if `operationsSinceSnapshot > 0`.

### Recommended Changes

**Reduce snapshot frequency for version history.** The current system creates snapshots frequently (every 5s of inactivity), which is correct for durability but creates too many "versions" in the history UI. Version history should show meaningful checkpoints, not every auto-save.

**Two-tier approach:**

| Tier | Purpose | Frequency | Stored Where | Retention |
|------|---------|-----------|-------------|-----------|
| **Durability snapshots** | Crash recovery | Every 5s idle / 50 ops / 5 min (existing) | Redis hot-cache + DynamoDB `crdt-snapshots` | 24 hours (reduce from 7 days) |
| **Version checkpoints** | User-visible history | Every 5 minutes of active editing (configurable) | DynamoDB `crdt-versions` (new table) | 30 days for auto, forever for named |

**Implementation: version checkpoint timer on the server.**

Add a per-channel `lastVersionCheckpoint` timestamp. On each `writeSnapshot`, check if enough time has passed since the last version checkpoint. If yes, also write to the versions table.

```
// Pseudocode for version checkpoint decision
const VERSION_CHECKPOINT_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

if (now - state.lastVersionCheckpoint > VERSION_CHECKPOINT_INTERVAL_MS) {
  writeVersionCheckpoint(channelId, { type: 'auto' });
  state.lastVersionCheckpoint = now;
}
```

**Configurable per doc type:** Add a `versionInterval` field to document metadata. Meeting notes (short-lived) might checkpoint every 2 minutes. Project documents (long-lived) might checkpoint every 10 minutes. Default: 5 minutes.

### Why Not Client-Side Checkpointing?

The server already maintains a Y.Doc per channel and already handles snapshot persistence. Client-triggered checkpoints would add round-trip latency, duplicate logic, and create race conditions with multiple editors. Keep checkpointing server-side.

---

## 3. Snapshot Format

### Y.js Snapshot APIs

Y.js offers two relevant APIs:

| API | Output | Size | Use Case |
|-----|--------|------|----------|
| `Y.encodeStateAsUpdate(doc)` | Full document state as a binary update | Proportional to document size | Restoring a document from scratch (apply to empty Y.Doc) |
| `Y.snapshot(doc)` / `Y.encodeSnapshotV2(snapshot)` | Lightweight snapshot reference (delete set + state vector) | Much smaller than full state | Diffing against the same Y.Doc's history (requires `gc: false`) |

### Recommendation: Store Both

**For version checkpoints, store `Y.encodeStateAsUpdate(doc)` (the current approach).**

Rationale:
- Self-contained: can reconstruct the document without the original Y.Doc
- Works regardless of `gc` setting
- The server already uses this format
- Compresses well with gzip (typical 60-80% compression for text-heavy docs)

**Optionally store `Y.encodeSnapshotV2()` alongside for diff computation** (see section 4).

However, `Y.snapshot()` has a critical requirement: the Y.Doc must have `gc: false`, and the original Y.Doc must still contain the history between the two snapshots being compared. Since the server creates fresh Y.Doc instances on channel subscribe and destroys them on last unsubscribe, Y.js snapshots would only work for diffs computed during a single active session. For cross-session diffs, a different approach is needed.

### Version Record Schema

```
Table: crdt-versions
PK: documentId (S)       -- e.g. "doc:meeting-abc123"
SK: timestamp (N)         -- epoch milliseconds

Attributes:
  snapshot     (B)        -- gzip(Y.encodeStateAsUpdate(doc))
  type         (S)        -- "auto" | "manual"
  name         (S)        -- user-provided label (null for auto)
  description  (S)        -- optional description
  createdBy    (S)        -- userId who triggered (or "system" for auto)
  sectionCount (N)        -- denormalized for display
  wordCount    (N)        -- approximate, for display
  ttl          (N)        -- epoch seconds; null for named versions (never expire)
```

### Size Estimates

| Document Complexity | Raw Y.js State | Gzipped | DynamoDB Cost/Month (1000 versions) |
|-------------------|----------------|---------|-------------------------------------|
| Small (3 sections, 500 words) | ~5 KB | ~2 KB | ~$0.01 |
| Medium (8 sections, 3000 words, 20 tasks) | ~25 KB | ~8 KB | ~$0.04 |
| Large (20 sections, 10000 words, 50 tasks) | ~80 KB | ~25 KB | ~$0.12 |

Well within DynamoDB's 400 KB item limit even without compression.

---

## 4. Diff Computation

### The Core Challenge

Y.js CRDTs do not natively expose a "diff" between two arbitrary snapshots in a human-readable format. The CRDT tracks operations, not semantic diffs. Three approaches:

### Approach A: JSON Diff (Recommended)

Extract JSON from both versions and compute a structural diff.

1. Load version A into a Y.Doc, call `toJSON()` on all shared types
2. Load version B into a Y.Doc, call `toJSON()` on all shared types
3. Compute diff at the section level

**For structured content (sections, tasks):**
- Compare section arrays by `id` -- detect added, removed, reordered sections
- Within each section, diff `title`, `collapsed`, `items` arrays
- For `items`, compare by `id` -- detect added, removed, status-changed tasks

**For rich text content (Tiptap XmlFragment):**
- Extract text content from each section's XmlFragment
- Use a text diffing library (`diff-match-patch` or `fast-diff`) on the plain text
- Render diffs as inline additions (green) and deletions (red strikethrough)

**Library:** `diff-match-patch` (Google's library, 50KB, battle-tested) or `fast-diff` (7KB, simpler API, sufficient for line-level diffs).

**Pros:** Works across sessions, no `gc: false` requirement for diff, human-readable output.
**Cons:** Loses fine-grained attribution (who typed what), treats each snapshot as opaque.

### Approach B: Y.js Snapshot Diff (Limited Applicability)

If both snapshots were taken from the same Y.Doc with `gc: false`:

```typescript
const snapshotA = Y.decodeSnapshotV2(bytesA);
const snapshotB = Y.decodeSnapshotV2(bytesB);
// createDocFromSnapshot gives a read-only view at that point
const docA = Y.createDocFromSnapshot(liveDoc, snapshotA);
const docB = Y.createDocFromSnapshot(liveDoc, snapshotB);
```

**Pros:** True CRDT-level diff, could show per-user attributions.
**Cons:** Requires the live Y.Doc to contain all history between A and B. Not feasible when the server recycles Y.Doc instances between sessions. Memory grows unboundedly with `gc: false` on long-lived docs.

### Approach C: State Vector Diff

Use `Y.diffUpdate(updateB, stateVectorA)` to compute the minimal Y.js update that transforms state A into state B. This is a binary diff -- useful for efficient sync but not human-readable.

**Verdict:** Not useful for UI diff visualization, but valuable for bandwidth optimization if sending version data to the client.

### Recommended Diff Strategy

Use **Approach A (JSON diff)** for all UI diff rendering. Implementation:

```
// Per-section diff structure
interface SectionDiff {
  sectionId: string;
  sectionTitle: string;
  status: 'added' | 'removed' | 'modified' | 'unchanged';
  titleChanged?: boolean;
  contentDiff?: TextDiff[];  // array of {type: 'add'|'remove'|'equal', text: string}
  itemsDiff?: {
    added: TaskItem[];
    removed: TaskItem[];
    modified: Array<{id: string, changes: Record<string, {old: any, new: any}>}>;
  };
}
```

**Compute diffs on the client.** The client already loads both the live doc and the preview doc. Extracting JSON and diffing is fast (< 50ms for typical documents). No server-side diff computation needed.

### Per-Section vs Whole-Doc Diffs

**Per-section is the right granularity.** The document is already structured as sections. Users think in terms of "what changed in the Action Items section" not "what changed at byte offset 4523." The section-level diff also aligns with the existing UI layout.

Show a summary at the top: "3 sections modified, 1 section added, 2 tasks completed" with expandable detail per section.

---

## 5. Storage Strategy

### Two-Table Design

| Table | Purpose | Key Schema | TTL |
|-------|---------|-----------|-----|
| `crdt-snapshots` (existing) | Durability / crash recovery | `documentId (S)` + `timestamp (N)` | 24 hours |
| `crdt-versions` (new) | Version history | `documentId (S)` + `timestamp (N)` | 30 days (auto) / none (named) |

**Why separate tables:**
- Different retention policies (TTL)
- Different query patterns (durability snapshots are rarely listed; versions are browsed)
- Durability snapshots can be pruned aggressively without affecting version history
- Named versions must never auto-expire

### Retention Policy

| Version Type | Retention | Rationale |
|-------------|-----------|-----------|
| Auto checkpoint | 30 days | Sufficient for "undo last week's changes" use cases |
| Named version | Indefinite (no TTL) | User explicitly marked this as important |
| Durability snapshot | 24 hours | Only needed until next checkpoint; reduces storage cost |

### Pruning Strategy

For auto checkpoints older than 7 days, keep only one per hour (thin out the 5-minute granularity). This can be a scheduled Lambda or a DynamoDB TTL-based approach:

- Auto checkpoints < 7 days: keep all (~2016 per doc max at 5-min intervals)
- Auto checkpoints 7-30 days: keep 1 per hour (~552 per doc)
- Auto checkpoints > 30 days: delete (TTL)
- Named versions: keep forever

**Implementation:** Set TTL on auto checkpoints to 30 days at write time. For the 7-day thinning, run a daily Lambda that queries each document's versions between 7-30 days old and deletes all but one per hour.

### Storage Cost Estimates (per document)

Assuming medium-complexity documents (8 KB compressed per version):

| Scenario | Versions/Month | Storage | DynamoDB Cost |
|----------|---------------|---------|---------------|
| Active doc, 8 hrs/day editing | ~2,880 auto + pruned to ~600 | ~5 MB | ~$0.01 |
| Light doc, 2 hrs/week editing | ~96 auto | ~0.8 MB | < $0.01 |
| 100 active documents | ~60,000 total | ~500 MB | ~$0.15 |

DynamoDB on-demand pricing: $1.25/million writes, $0.25/GB storage. Negligible cost.

### S3 Consideration

Not needed at current scale. If documents approach the 400 KB DynamoDB item limit (unlikely -- would require ~100K words), store the snapshot binary in S3 and keep only a reference in DynamoDB. This is a future optimization, not an MVP concern.

---

## 6. Restore Workflow

### Current Restore Behavior

The server's `handleRestoreSnapshot` currently:
1. Loads the historical snapshot from DynamoDB
2. Creates a fresh Y.Doc and applies the historical update
3. **Destroys** the live Y.Doc and replaces it
4. Broadcasts the restored state to ALL subscribers as a `crdt:snapshot` message
5. Writes a new durability snapshot

**Problem:** This is a destructive overwrite with no undo. All connected clients instantly see the restored content. There is no preview-in-context, no confirmation from other editors, and no way to get back to the pre-restore state.

### Recommended Restore Flow

#### Step 1: Preview (Already Works)

User clicks a version in the panel. The hook loads it into a separate `previewDoc`. The UI should render this preview alongside (or overlaid on) the current document, ideally with diff highlighting.

#### Step 2: Pre-Restore Snapshot

Before restoring, the server should automatically create a "pre-restore" named version checkpoint:

```
{
  type: "auto",
  name: "Before restore to [timestamp]",
  createdBy: userId,
  ...
}
```

This guarantees the user can always get back to where they were.

#### Step 3: Restore

Two options to offer in the UI:

**A. Overwrite (current behavior, improved):**
- Server creates pre-restore checkpoint
- Server replaces Y.Doc with historical version
- Server broadcasts to all subscribers
- Server writes new durability snapshot
- All clients see the change immediately
- Client shows toast: "Restored to [version]. Previous state saved as a version."

**B. Fork as new document (future enhancement):**
- Create a new document with a copy of the historical snapshot
- Title: "[Original Title] (restored from [date])"
- Original document is untouched
- User can manually merge changes back if desired

For MVP, implement **Option A with pre-restore checkpoint**. Option B can come later when multi-document support is solid.

#### Conflict Handling

If other users are currently editing:
- The restore broadcasts as a `crdt:snapshot` with `restored: true` flag (already in the server code)
- Connected clients apply the snapshot, which replaces their local state
- Any in-flight (unsent) local edits will be merged on top of the restored state by Y.js CRDT -- this is correct behavior since Y.js merges are commutative
- Show a notification to all connected users: "[User] restored the document to a previous version"

**Edge case:** If a user has significant unsaved local content (e.g., typed a paragraph but WebSocket was briefly disconnected), the restore will overwrite it. Mitigation: the pre-restore checkpoint captures the server state, but not unsent client state. This is an acceptable tradeoff for MVP. A more sophisticated approach would have clients flush pending updates before restore begins.

---

## 7. Named Versions

### User Experience

Add a "Save Version" button to the document editor toolbar and/or the version history panel.

**Flow:**
1. User clicks "Save Version"
2. Modal dialog: "Name this version" with text input + optional description
3. Client sends `createVersion` action to server
4. Server writes to `crdt-versions` with `type: "manual"`, user-provided `name` and `description`
5. Version appears in the history panel with a distinct visual treatment (bookmark icon, bold text, colored label)

### Server Action

New CRDT service action: `createVersion`

```
// Client sends:
{
  service: 'crdt',
  action: 'createVersion',
  channel: 'doc:abc123',
  name: 'After design review',
  description: 'Incorporated feedback from Alex and Maria'
}

// Server responds:
{
  type: 'crdt',
  action: 'versionCreated',
  channel: 'doc:abc123',
  version: {
    timestamp: 1712937600000,
    name: 'After design review',
    description: 'Incorporated feedback from Alex and Maria',
    createdBy: 'user-abc',
    type: 'manual'
  }
}
```

### Named Version Protection

Named versions must never be auto-pruned. Implementation:
- Set `ttl` to `null` (or omit) for manual versions in DynamoDB
- DynamoDB TTL only deletes items that have a `ttl` attribute with a past timestamp
- Items without `ttl` are never touched by TTL

---

## 8. UI Considerations

### Version History Panel Enhancements

The current `VersionHistoryPanel.tsx` needs several upgrades:

#### 8.1 Version List Improvements

- **Group by date:** "Today", "Yesterday", "April 10", etc.
- **Distinguish version types:** Auto checkpoints show as small dots on a timeline; named versions show as labeled markers
- **Show author:** Display who triggered the checkpoint (or "Auto-save" for system)
- **Show summary:** "3 sections modified, 2 tasks completed" (computed from diff with previous version)
- **Filter:** Toggle to show only named versions vs all versions

#### 8.2 Diff Viewer

Two rendering modes:

**A. Inline diff (default):**
- Render the document normally but with diff annotations
- Added text highlighted in green
- Removed text shown in red with strikethrough
- Changed task statuses shown with before/after badges
- Added/removed sections shown with full-section highlight

**B. Side-by-side (optional, for complex changes):**
- Split view: left = selected version, right = current (or another version)
- Synchronized scrolling
- Section headers aligned

**Recommendation:** Start with inline diff. It reuses the existing document renderer and is simpler to implement. Side-by-side can be added later.

#### 8.3 Timeline View

Replace the flat list with a vertical timeline:

```
|  [*] Named: "After design review"           Apr 12, 2:30 PM
|       by Connor - "Incorporated feedback"
|
|  [ ] Auto-save                               Apr 12, 2:15 PM
|       3 sections modified
|
|  [ ] Auto-save                               Apr 12, 2:10 PM
|       1 task completed
|
|  [*] Named: "First draft"                    Apr 12, 1:45 PM
|       by Connor
|
|  [ ] Auto-save                               Apr 12, 1:30 PM
|       Document created
```

Named versions get a filled marker, auto-saves get hollow markers.

#### 8.4 Restore Confirmation

Replace `window.confirm` with a proper modal:

- Show the diff summary (what will change)
- Mention that a backup will be created automatically
- Show how many other users are currently connected
- "Restore" and "Cancel" buttons
- If other users are connected, add a warning: "2 other users are editing this document. They will see the restored version immediately."

#### 8.5 "Save Version" Entry Point

Two locations:
1. **In the version history panel:** "Save current version" button at the top, always visible
2. **In the document toolbar:** Small bookmark/save icon that opens a name dialog

---

## 9. Implementation Phases

### Phase 1: Foundation (Server + Storage)

- Create `crdt-versions` DynamoDB table
- Add `createVersion` server action (manual named versions)
- Add version checkpoint logic to `writeSnapshot` (auto versions every N minutes)
- Add metadata fields to version records (author, name, description, type)
- Update `handleListSnapshots` to query `crdt-versions` instead of `crdt-snapshots`
- Add pre-restore checkpoint to `handleRestoreSnapshot`

### Phase 2: Enhanced Frontend

- Update `VersionEntry` type with metadata fields (name, description, createdBy, type)
- Update `useVersionHistory` hook to support `createVersion` action
- Add "Save Version" UI (button + name dialog)
- Improve version list with grouping, type indicators, author display
- Replace `window.confirm` with proper restore confirmation modal

### Phase 3: Diff Visualization

- Add `fast-diff` or `diff-match-patch` dependency
- Build diff computation utility: JSON extraction from Y.Doc, section-level diff, text diff
- Build `DiffViewer` component for inline diff rendering
- Wire diff computation into version preview flow
- Add diff summary to version list items

### Phase 4: Polish

- Timeline view component
- Side-by-side diff mode
- Version filtering (named only / all)
- Retention policy: pruning Lambda for old auto checkpoints
- Configurable checkpoint interval per document type

---

## 10. Technical Decisions Summary

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Snapshot format | `Y.encodeStateAsUpdate()` + gzip | Self-contained, works across sessions, already in use |
| Diff approach | JSON extraction + text diff library | Works without `gc: false`, human-readable, client-computable |
| Diff library | `fast-diff` (7KB) | Lightweight, sufficient for section-level text diffs |
| Storage | Separate `crdt-versions` DynamoDB table | Different retention from durability snapshots |
| Auto-checkpoint interval | 5 minutes (configurable) | Balances granularity vs storage; meaningful change intervals |
| Restore behavior | Overwrite with pre-restore backup | Simple, immediate, recoverable |
| Named version retention | Indefinite (no TTL) | User intent is preservation |
| Diff rendering | Inline (single-column) for MVP | Simpler, reuses existing renderer |
| Checkpoint trigger | Server-side only | Avoids race conditions with multiple editors |

---

## Sources

### Primary (HIGH confidence -- verified against codebase)
- `src/services/crdt-service.js` -- existing snapshot persistence, version retrieval, restore logic
- `frontend/src/hooks/useVersionHistory.ts` -- existing version history hook
- `frontend/src/components/doc-editor/VersionHistoryPanel.tsx` -- existing version panel UI
- `frontend/src/hooks/useCollaborativeDoc.ts` -- Y.Doc lifecycle, section structure
- `frontend/src/providers/GatewayProvider.ts` -- WebSocket-Y.js bridge

### Primary (HIGH confidence -- Y.js official docs)
- [Y.js Document Updates](https://docs.yjs.dev/api/document-updates) -- `encodeStateAsUpdate`, `encodeStateVector`, `diffUpdate`
- [Y.js Snapshots](https://docs.yjs.dev/api/document-updates#snapshots) -- `Y.snapshot`, `Y.encodeSnapshotV2`, `Y.createDocFromSnapshot`
- [Y.js GC behavior](https://docs.yjs.dev/api/faq#gc) -- `gc: false` requirement for snapshot diffs

### Secondary (MEDIUM confidence)
- [fast-diff npm](https://www.npmjs.com/package/fast-diff) -- text diffing library, 7KB, simple API
- [diff-match-patch](https://github.com/google/diff-match-patch) -- Google's diff library, more features but larger

**Research date:** 2026-04-12
**Valid until:** 2026-05-12
