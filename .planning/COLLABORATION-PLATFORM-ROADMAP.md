# Collaboration Platform Roadmap

> Synthesized from 5 parallel research agents (2026-04-12)
> Research: Document Templates, CRDT Persistence, Version Checkpointing, Backend Scalability, Collaborator Presence
> Updated: Incorporates social-api K8s integration (separate service with 11 DynamoDB tables, Helm chart, Tilt live_update)

---

## Executive Summary

The platform already has strong foundations: Y.js CRDT sync, awareness protocol, multi-document workspace, presence, and a checkpoint system. A separate **social-api** service (profiles, rooms, groups, posts, comments, likes, activity) is now deployed in K8s alongside the gateway. But the research exposed **critical durability gaps** (Redis-only metadata, no SIGTERM handler, cross-node divergence) that must be fixed before building higher-level features. The roadmap is ordered: fix the foundation, then layer on templates, versioning, presence, and scale.

---

## Current Architecture (Post Social-API Integration)

```
┌─────────────┐     ┌──────────────────┐     ┌─────────────┐
│  Frontend   │────▶│  Gateway (WS)    │────▶│   Redis     │
│  :5174      │     │  :8080           │     │   :6379     │
└─────────────┘     └──────────────────┘     └─────────────┘
      │                     │                       │
      │              ┌──────┴──────┐                │
      │              │ Services:   │                │
      │              │ - CRDT      │                │
      │              │ - Presence  │                │
      │              │ - Chat      │                │
      │              │ - Cursors   │                │
      │              │ - Reactions │                │
      │              │ - Activity  │                │
      │              └─────────────┘                │
      │                                             │
      └────▶┌──────────────────┐     ┌──────────────┘
            │  Social API      │────▶│  DynamoDB    │
            │  :3001           │     │  :8000       │
            └──────────────────┘     └──────────────┘

DynamoDB Tables:
  Gateway:  crdt-snapshots
  Social:   social-profiles, social-relationships, social-outbox,
            social-rooms, social-room-members, social-groups,
            social-group-members, social-posts, social-comments,
            social-likes, user-activity
```

---

## Phase 1: Foundation Hardening (P0 — Do First)

**Why**: Without these, documents can silently disappear on Redis restart or pod deploy.

| Task | Source | Impact |
|------|--------|--------|
| Persist document metadata to DynamoDB (currently Redis-only) | CRDT-PERSISTENCE #4 | Data loss on Redis restart |
| Add SIGTERM handler to flush pending snapshots on deploy | CRDT-PERSISTENCE #2 | Data loss on every rolling deploy |
| Fix cross-node Y.Doc divergence (apply remote updates to local Y.Doc) | CRDT-PERSISTENCE #6 | Users on different nodes see different state |
| Pre-restore checkpoint (auto-save before overwriting) | VERSION-CHECKPOINT #5 | Destructive restore with no undo |
| Add `preStop` hook + `terminationGracePeriodSeconds` to Helm | SCALABILITY #4 | Connection drops on deploy |
| Remove/extend 7-day DynamoDB TTL for active documents | CRDT-PERSISTENCE #3 | Silent document deletion |

| Unify document metadata with social-api patterns (pk/sk DynamoDB schema) | SOCIAL-API integration | Consistency across services |
| Add `crdt-documents` DynamoDB table (mirrors social-api table patterns) | CRDT-PERSISTENCE #4 + SOCIAL-API | Durable document registry |

**Agents needed**: 2 (server persistence + Helm/deploy)
**Files**: `crdt-service.js`, `helm/values.yaml`, `helm/templates/deployment.yaml`, Tiltfile dynamodb-setup

**Note**: The social-api's DynamoDB tables use per-table key schemas (not generic pk/sk). The new `crdt-documents` table should follow the same pattern for consistency. The dynamodb-setup in Tiltfile already creates all 11 social tables + crdt-snapshots.

---

## Phase 2: Document Templates (15 Types)

**Why**: The multi-document workspace is built; templates are the content that fills it.

| Template | Key Feature Needed |
|----------|--------------------|
| Meeting Notes | Rich text + tasks, timer |
| Sprint Planning | Task board, story points |
| Design Review | Image/link sections, voting |
| Project Brief | Structured fields, approval workflow |
| Decision Log | Options table, decision status |
| Retrospective | Categorized columns (start/stop/continue) |
| Standup Log | Per-person daily append, recurring creation |
| Incident Report | Timeline, severity, root cause sections |
| RFC / Proposal | Problem/options/recommendation, voting |
| Onboarding Checklist | Assigned tasks with due dates |
| 1:1 Notes | Rolling agenda, private by default |
| Runbook | Step-by-step ack workflow for incidents |
| Changelog | Versioned entries, publish status |
| Interview Scorecard | Isolated editing ("sealed envelope"), numeric ratings |
| Custom | Blank canvas |

**Capability gaps to unlock** (from Templates Research):
- G5: Date/time fields (needed by 10/15 templates) — highest priority
- G1: Section-level metadata (needed by 7/15)
- G6: Placeholder/guidance content in sections
- G3: Voting/polling on items
- G8: Numeric rating fields (Interview Scorecard)

**Agents needed**: 3 (type system extensions + template definitions + section UI enhancements)
**Files**: `document.ts`, `documentTemplates.ts`, `SectionBlock.tsx`, new section renderers

---

## Phase 3: Version Checkpointing & Diffs

**Why**: Auto-save exists but has no metadata, no diffs, no named versions.

| Task | Detail |
|------|--------|
| Add version metadata | Author, name, description, type (auto/manual/pre-restore) |
| Two-table design | `crdt-versions` (30-day auto, indefinite named) separate from `crdt-snapshots` (24-hour durability) |
| Named versions | Manual "Save Version" with user-provided name |
| Diff visualization | Client-side JSON diff between Y.js snapshots, per-section rendering |
| Diff UI | Side-by-side or inline diff viewer, section-level changes |
| Restore improvements | Preview before restore, confirmation dialog, auto-backup |

**Agents needed**: 2 (server version storage + frontend diff viewer)
**Files**: `crdt-service.js`, DynamoDB table, `useVersionHistory.ts`, `VersionHistoryPanel.tsx`, new `DiffViewer.tsx`

---

## Phase 4: Collaborator Presence & Navigation

**Why**: With N users across M documents, need global awareness of who's where.

| Task | Detail |
|------|--------|
| Push-based cross-document presence | Replace 10s polling with `documents:presence` meta-channel, server broadcasts deltas on join/leave |
| Jump-to-user across documents | Click avatar on doc list → open doc + scroll to section. Pass `initialJumpToUserId` prop |
| Follow mode | Lock viewport to another user's movements, auto-unlock on interaction, cross-document follows |
| Idle detection | `useIdleDetector` hook (2-min timeout), active/away/offline states in awareness |
| Presence indicators at 4 levels | Document list (avatars), doc header (mode badges), section (colored border), inline (Tiptap cursor) |

**Agents needed**: 2 (server presence aggregation + frontend follow mode & indicators)
**Files**: `crdt-service.js`, `usePresence.ts`, `useCollaborativeDoc.ts`, `DocumentListPage.tsx`, `DocumentHeader.tsx`, new `useIdleDetector.ts`

---

## Phase 5: Backend Scalability

**Why**: Needed when user count exceeds ~30-50 concurrent.

| Task | Priority | Detail |
|------|----------|--------|
| Cache `channelNodes` locally (5s TTL) | P0 | Eliminates SMEMBERS on every publish (~3,000 Redis ops/s at 50 users) |
| Awareness coalescing (50ms buffer) | P0 | Batch high-frequency awareness updates server-side |
| Separate awareness rate limit bucket | P1 | Currently shares with CRDT updates |
| Y.Doc eviction for idle documents | P1 | Memory grows unbounded; evict after 10min idle with snapshot-first |
| Increase pod memory limit | P1 | 512Mi too tight for >50 docs |
| Unified Redis channel per document | P2 | Multiplex services over single channel instead of 5 per doc |
| k6 load test suite | P2 | 6 scenarios: connection storm, awareness flood, CRDT sync, mixed workload, reconnect, multi-doc |
| Social-API scaling | P2 | Connection pooling, DynamoDB GSIs for cross-table queries, Redis caching for hot social data |
| Cross-service health checks | P2 | Gateway ↔ Social-API liveness, circuit breaker for social endpoints |

**Agents needed**: 3 (awareness optimization + Y.Doc memory management + social-api scaling)
**Files**: `message-router.js`, `crdt-service.js`, `node-manager.js`, `social-api/src/`, Helm values

---

## Agent Summary

| Phase | Agents | Parallel? |
|-------|--------|-----------|
| 1. Foundation Hardening | 2 | Yes |
| 2. Document Templates | 3 | Yes |
| 3. Version Checkpointing | 2 | Yes |
| 4. Collaborator Presence | 2 | Yes |
| 5. Backend Scalability | 3 | Yes |
| **Total** | **12** | Phases sequential, agents within each phase parallel |

---

## Recommended Execution Order

```
Phase 1 (Foundation)     ████████░░░░░░░░░░░░  — fix before anything else
Phase 2 (Templates)      ░░░░░░░░████████░░░░  — builds on multi-doc workspace
Phase 3 (Versioning)     ░░░░░░░░████████░░░░  — can run parallel with Phase 2
Phase 4 (Presence)       ░░░░░░░░░░░░░░░░████  — needs Phase 1 fixes
Phase 5 (Scalability)    ░░░░░░░░░░░░░░░░████  — can run parallel with Phase 4
```

Phases 2+3 can run in parallel. Phases 4+5 can run in parallel. Phase 1 must go first.
