# Document Templates Research: Expanded 15-Type Schema Design

## Current System Capabilities

### Primitives Available

| Primitive | TypeScript Type | Stored In | Notes |
|-----------|----------------|-----------|-------|
| **Rich text** | `Y.XmlFragment` per section | Y.js via Tiptap | Collaborative cursors, @mentions, formatting |
| **Task items** | `TaskItem[]` per section | Y.Array of Y.Maps | `pending/acked/done/rejected` status, assignee, priority, notes |
| **Section types** | `'summary' \| 'tasks' \| 'decisions' \| 'notes' \| 'custom'` | Y.Map `type` field | Controls badge color and task list rendering |
| **Comments** | `CommentData[]` per section | Y.Array of Y.Maps | Threaded, resolvable, with @mentions |
| **View modes** | `'editor' \| 'ack' \| 'reader'` | Local + awareness | Editor = full edit, Ack = review/approve tasks, Reader = read-only |
| **Presence** | `Participant` | Y.js awareness | Per-section focus, avatar stacks, mode broadcasting |
| **Document meta** | `DocumentMeta` | Y.Map `meta` | title, sourceType, status (`draft/review/final`), createdBy |

### Template Interface (Current)

```typescript
interface DocumentTemplate {
  type: string;
  name: string;
  icon: string;
  description: string;
  defaultSections: { type: Section['type']; title: string }[];
}
```

### What the Current System Cannot Do (Gaps)

These are features that do NOT exist yet but are referenced in the template designs below. Each template notes which gaps it depends on so the implementing agent knows what to build.

| Gap ID | Feature | Description |
|--------|---------|-------------|
| G1 | **Section-level metadata fields** | Arbitrary key-value pairs on a section (e.g., severity, vote count, status enum beyond task status) |
| G2 | **Checklist items (non-task)** | Lightweight checkboxes without assignee/priority/ack workflow -- simpler than TaskItem |
| G3 | **Voting / polling** | Per-section or per-item vote counts with user-unique enforcement |
| G4 | **Ordered/numbered items** | Items that maintain explicit ordering with drag-to-reorder |
| G5 | **Date/time fields on sections** | Due dates, scheduled times, sprint date ranges |
| G6 | **Section templates with placeholder text** | Pre-populated rich text content (not just title) |
| G7 | **Conditional section visibility by mode** | Some sections only shown in certain modes (e.g., scoring rubric hidden in reader mode) |
| G8 | **Numeric/rating fields on items** | Score fields (1-5 stars, numeric ratings) on task-like items |
| G9 | **Section grouping / categories** | Visual grouping of sections under collapsible category headers |
| G10 | **Status enums beyond draft/review/final** | Per-document lifecycle states like `open/investigating/mitigated/resolved` |
| G11 | **Linked documents** | Cross-references between documents |
| G12 | **Recurring document creation** | Auto-create from template on schedule |

---

## Template Schemas: All 15 Types

---

### 1. Meeting Notes

**Type key:** `meeting`

**Default sections:**

| # | Title | Section Type | Purpose |
|---|-------|-------------|---------|
| 1 | Agenda | notes | Pre-meeting agenda items (rich text) |
| 2 | Executive Summary | summary | AI-generated or manual recap |
| 3 | Action Items | tasks | Assignable, ackable tasks from the meeting |
| 4 | Decisions | decisions | Formal decisions recorded |
| 5 | Notes | notes | Freeform discussion notes |

**Modes:** All three. Editor during/after meeting. Ack mode for attendees to acknowledge action items. Reader for stakeholders who missed the meeting.

**Collaboration pattern:** Live collaborative -- 2-6 people editing simultaneously during a meeting. One person typically drives while others add to their own action items. Post-meeting, switches to async ack mode.

**Special features needed:** None beyond current system. This is the baseline document type.

**Gaps required:** G5 (meeting date/time field on meta), G12 (recurring meetings)

---

### 2. Sprint Planning

**Type key:** `sprint`

**Default sections:**

| # | Title | Section Type | Purpose |
|---|-------|-------------|---------|
| 1 | Sprint Goals | summary | What the sprint aims to achieve |
| 2 | Capacity & Availability | notes | Team member availability notes |
| 3 | Backlog Candidates | tasks | Items being considered for the sprint |
| 4 | Committed Work | tasks | Items pulled into sprint |
| 5 | Risks & Dependencies | decisions | Known risks and external dependencies |
| 6 | Decisions | decisions | Sprint-level decisions |

**Modes:** Editor during planning ceremony. Ack for team members to commit to tasks. Reader for stakeholders.

**Collaboration pattern:** Live synchronous during sprint planning ceremony. Product owner populates backlog candidates beforehand (async). During the meeting, tasks move conceptually from "Backlog Candidates" to "Committed Work" as team pulls items. Post-ceremony, ack mode for explicit commitment.

**Special features needed:** Story point / effort estimation field on task items. Sprint date range on document meta.

**Gaps required:** G5 (sprint date range), G8 (numeric effort fields on items)

---

### 3. Design Review

**Type key:** `design`

**Default sections:**

| # | Title | Section Type | Purpose |
|---|-------|-------------|---------|
| 1 | Design Summary | summary | Overview of what's being reviewed |
| 2 | Context & Constraints | notes | Background, technical constraints |
| 3 | Design Decisions | decisions | Specific choices made and rationale |
| 4 | Open Questions | tasks | Questions needing answers (assignable) |
| 5 | Feedback | notes | Reviewer feedback (rich text with @mentions) |

**Modes:** Editor for the design author. Ack for reviewers to sign off on decisions. Reader for broader team.

**Collaboration pattern:** Primarily async. Author creates document, shares for review. Reviewers add feedback via comments and the Feedback section. Design decisions in ack mode require sign-off before proceeding. May have a synchronous review meeting where the document is projected.

**Special features needed:** None beyond current system. Comments and @mentions cover the feedback workflow well.

**Gaps required:** G3 (voting on design options), G11 (link to related design docs)

---

### 4. Project Brief

**Type key:** `project`

**Default sections:**

| # | Title | Section Type | Purpose |
|---|-------|-------------|---------|
| 1 | Executive Summary | summary | One-paragraph project overview |
| 2 | Problem Statement | notes | What problem this project solves |
| 3 | Requirements | tasks | Specific requirements (ackable by stakeholders) |
| 4 | Success Criteria | tasks | Measurable outcomes |
| 5 | Scope & Non-Goals | notes | What's in and out of scope |
| 6 | Timeline & Milestones | notes | Key dates and phases |
| 7 | Risks | decisions | Identified risks and mitigations |

**Modes:** Editor for project lead. Ack for stakeholder sign-off on requirements and success criteria. Reader for the broader org.

**Collaboration pattern:** Mostly async. Project lead drafts, circulates for review. Stakeholders use ack mode to formally approve requirements. Document transitions from `draft` to `review` to `final` as sign-offs complete.

**Special features needed:** Status progression is important -- document status should gate editability (final = locked except by owner).

**Gaps required:** G5 (milestone dates), G11 (link to sprint docs, design docs)

---

### 5. Decision Log

**Type key:** `decision`

**Default sections:**

| # | Title | Section Type | Purpose |
|---|-------|-------------|---------|
| 1 | Decision Record | decisions | The decision with status and rationale |
| 2 | Context | notes | Background and constraints |
| 3 | Options Considered | notes | Alternatives evaluated |
| 4 | Consequences | notes | Expected impact of the decision |
| 5 | Stakeholder Sign-off | tasks | People who need to ack the decision |

**Modes:** Editor for the decision author. Ack for stakeholders to formally approve. Reader as permanent record.

**Collaboration pattern:** Async. One person drafts the ADR (architecture decision record). Shared for comment. Stakeholders ack. Once all acks are in, status moves to `final`. Rarely edited after that -- serves as historical record.

**Special features needed:** Decision status tracking (proposed/accepted/deprecated/superseded). ADR numbering.

**Gaps required:** G1 (decision status metadata), G10 (extended status enum), G11 (link to superseding decision)

---

### 6. Retrospective

**Type key:** `retro`

**Default sections:**

| # | Title | Section Type | Purpose |
|---|-------|-------------|---------|
| 1 | What Went Well | notes | Positive observations (rich text, everyone contributes) |
| 2 | What Could Improve | notes | Issues and pain points |
| 3 | What Puzzled Us | notes | Questions or confusions |
| 4 | Action Items | tasks | Concrete improvements to try next sprint |
| 5 | Previous Action Item Review | tasks | Status check on last retro's items |

**Modes:** Editor during retro ceremony. Ack for action item owners. Reader for management.

**Collaboration pattern:** Live synchronous -- the whole team edits simultaneously. Facilitator may use a "silent brainstorm" phase where everyone types into the same sections. Then live discussion. High concurrency (5-10 simultaneous editors). This is the most collaboration-intensive document type.

**Special features needed:** Anonymous contribution mode (so people can be candid without attribution). Dot-voting on items to prioritize discussion topics.

**Gaps required:** G3 (voting on items), G7 (anonymous mode -- hide author attribution), G12 (recurring, one per sprint)

---

### 7. Custom

**Type key:** `custom`

**Default sections:** Empty -- user builds their own.

**Modes:** All three.

**Collaboration pattern:** Varies entirely by use case.

**Special features needed:** None. This is the escape hatch.

**Gaps required:** None.

---

### 8. Standup Log

**Type key:** `standup`

**Default sections:**

| # | Title | Section Type | Purpose |
|---|-------|-------------|---------|
| 1 | Yesterday | tasks | What was completed (checklist style) |
| 2 | Today | tasks | What's planned for today |
| 3 | Blockers | tasks | Blockers requiring help (high priority) |
| 4 | Notes | notes | Parking lot for off-topic items |

**Modes:** Editor only (no ack mode -- standups are informational). Reader for async team members.

**Collaboration pattern:** Async-first. Each team member fills in their own items before standup. During the synchronous standup call, the document is a shared screen reference. Blockers get discussed and may spawn action items in other documents. This document is ephemeral -- one per day, rarely referenced after.

**Special features needed:**
- Per-user subsections within each section (Yesterday/Today/Blockers grouped by person)
- Auto-carry-over: "Today" items from yesterday's standup become "Yesterday" items in today's
- Blocker items should auto-populate with high priority

**Gaps required:** G2 (lightweight checklist items), G5 (standup date), G9 (per-user grouping), G12 (daily recurrence)

---

### 9. Incident Report

**Type key:** `incident`

**Default sections:**

| # | Title | Section Type | Purpose |
|---|-------|-------------|---------|
| 1 | Incident Summary | summary | What happened, when, severity |
| 2 | Timeline | notes | Chronological event log |
| 3 | Impact | notes | Who/what was affected, blast radius |
| 4 | Root Cause | notes | Why it happened (filled post-incident) |
| 5 | Mitigation Steps | tasks | What was done to stop the bleeding |
| 6 | Remediation Items | tasks | Long-term fixes to prevent recurrence |
| 7 | Lessons Learned | notes | What the team learned |

**Modes:** Editor during and after incident. Ack for remediation item owners. Reader as permanent postmortem record.

**Collaboration pattern:** Live synchronous during active incident -- multiple engineers updating the timeline in real-time. This is high-stress, high-concurrency editing. After incident resolution, transitions to async postmortem writing. Remediation items go through ack workflow with assigned owners.

**Special features needed:**
- **Severity level** on document meta (SEV1/SEV2/SEV3/SEV4)
- **Incident status** lifecycle: `detected -> investigating -> mitigated -> resolved -> postmortem-complete`
- **Timeline section** needs timestamps on each entry (not just rich text -- structured time + event pairs)
- **Duration tracking**: time from detection to mitigation, detection to resolution
- Red/orange visual treatment for active incidents

**Gaps required:** G1 (severity, duration metadata), G5 (timestamps on timeline entries), G10 (incident lifecycle status), G11 (link to runbooks used)

---

### 10. RFC / Proposal

**Type key:** `rfc`

**Default sections:**

| # | Title | Section Type | Purpose |
|---|-------|-------------|---------|
| 1 | Summary | summary | One-paragraph proposal overview |
| 2 | Motivation | notes | Why this change is needed |
| 3 | Detailed Design | notes | Technical details of the proposal |
| 4 | Alternatives Considered | notes | Other approaches evaluated |
| 5 | Migration / Rollout Plan | tasks | Steps to implement if approved |
| 6 | Open Questions | tasks | Unresolved questions (assignable) |
| 7 | Vote | decisions | Formal approval/rejection |

**Modes:** Editor for author(s). Ack for formal voting by approvers. Reader for broader org awareness.

**Collaboration pattern:** Async with a synchronous review meeting. Author writes the RFC, shares it broadly. Comment period (1-2 weeks typically). Reviewers leave threaded comments on specific sections. After comment period, a review meeting may be held. Then formal vote via ack mode. Status: `draft -> open-for-comment -> in-review -> accepted/rejected/withdrawn`.

**Special features needed:**
- **Voting with quorum**: N of M approvers must ack for the RFC to pass. Show vote tally.
- **Comment period tracking**: deadline date after which voting opens
- **RFC numbering**: auto-incrementing RFC-001, RFC-002, etc.
- **Disposition field**: accepted / rejected / withdrawn / deferred

**Gaps required:** G1 (RFC number, disposition, quorum metadata), G3 (formal voting), G5 (comment deadline), G10 (RFC lifecycle status)

---

### 11. Onboarding Checklist

**Type key:** `onboarding`

**Default sections:**

| # | Title | Section Type | Purpose |
|---|-------|-------------|---------|
| 1 | Welcome | summary | Welcome message, team overview, key contacts |
| 2 | Day 1 | tasks | First-day setup tasks (accounts, tools, access) |
| 3 | Week 1 | tasks | First-week learning and orientation |
| 4 | Week 2-4 | tasks | Ramp-up tasks, first contributions |
| 5 | Key Resources | notes | Links to docs, repos, tools, wikis |
| 6 | Buddy / Mentor Notes | notes | Notes from onboarding buddy |

**Modes:** Editor for the hiring manager / onboarding buddy. Ack for the new hire to check off completed items. Reader mode generally not needed.

**Collaboration pattern:** Asymmetric async. Manager/buddy pre-populates the checklist from a template. New hire works through items over days/weeks, acking each one. Buddy checks in periodically and adds notes. Low concurrency (2 people, rarely simultaneous).

**Special features needed:**
- **Progress bar**: percentage of tasks acked across all sections
- **Due date per section** (Day 1 tasks due by EOD1, Week 1 by EOW1, etc.)
- **Pre-populated rich text content** in Welcome section (not just a title -- actual welcome text)
- Tasks should have a "not applicable" status option for items that don't apply to a specific role

**Gaps required:** G2 (simpler checklist items for non-critical tasks), G5 (due dates on sections), G6 (placeholder rich text content)

---

### 12. 1:1 Notes

**Type key:** `one-on-one`

**Default sections:**

| # | Title | Section Type | Purpose |
|---|-------|-------------|---------|
| 1 | Talking Points | tasks | Agenda items either party wants to discuss |
| 2 | Discussion Notes | notes | Notes from the conversation |
| 3 | Action Items | tasks | Follow-up tasks with owners |
| 4 | Career & Growth | notes | Longer-term development topics |
| 5 | Feedback | notes | Bidirectional feedback notes |

**Modes:** Editor during the 1:1. Ack for action items. Reader rarely used (1:1 docs are private).

**Collaboration pattern:** Two-person synchronous document. Both parties add talking points before the meeting (async). During the meeting, one or both take notes. After, action items are assigned. These documents accumulate over time -- each 1:1 may append new sections or the same document is reused with date-stamped entries.

**Special features needed:**
- **Running document model**: rather than one doc per 1:1, a single document that grows with each meeting. New date-stamped section groups are appended.
- **Private by default**: 1:1 docs should only be visible to the two participants
- **Carryover**: unfinished action items from the previous 1:1 carry forward automatically

**Gaps required:** G5 (date stamps), G7 (private document visibility -- not a section feature but a doc-level access control), G9 (date-grouped sections), G12 (recurring, append new sections)

---

### 13. Runbook

**Type key:** `runbook`

**Default sections:**

| # | Title | Section Type | Purpose |
|---|-------|-------------|---------|
| 1 | Overview | summary | What this runbook is for, when to use it |
| 2 | Prerequisites | tasks | Checklist of things needed before starting |
| 3 | Step 1: [Name] | notes | First procedure step (rich text with code blocks) |
| 4 | Step 2: [Name] | notes | Second procedure step |
| 5 | Step 3: [Name] | notes | Third procedure step |
| 6 | Verification | tasks | How to confirm the procedure worked |
| 7 | Troubleshooting | notes | Common problems and solutions |
| 8 | Rollback | notes | How to undo if things go wrong |

**Modes:** Editor for authoring/updating. Reader for execution (operators follow steps). Ack mode for verification checklist.

**Collaboration pattern:** Primarily async authoring by 1-2 subject matter experts. During execution (e.g., during an incident), the runbook is in reader mode -- an operator follows it step by step. Post-execution, the runbook may be updated based on what was learned. Low edit concurrency, high read concurrency during incidents.

**Special features needed:**
- **Step numbering with explicit ordering** that survives section reordering
- **Code block support** in Tiptap (already exists) is critical -- runbooks are heavy on CLI commands
- **"Mark as executed" per step**: during a live execution, operator can mark each step done without entering full edit mode
- **Version pinning**: ability to "lock" a version so edits don't change a runbook mid-execution

**Gaps required:** G2 (lightweight checkboxes for step execution), G4 (explicit step ordering), G6 (placeholder content with code examples)

---

### 14. Changelog / Release Notes

**Type key:** `changelog`

**Default sections:**

| # | Title | Section Type | Purpose |
|---|-------|-------------|---------|
| 1 | Release Summary | summary | Version number, date, high-level overview |
| 2 | New Features | notes | What's new (rich text with screenshots/links) |
| 3 | Improvements | notes | Enhancements to existing features |
| 4 | Bug Fixes | tasks | Fixed issues (linked to tickets) |
| 5 | Breaking Changes | decisions | Changes that require user action |
| 6 | Known Issues | tasks | Unresolved issues shipping with this release |
| 7 | Migration Guide | notes | Steps users need to take for breaking changes |

**Modes:** Editor during release prep. Ack for sign-off (PM, engineering lead, QA). Reader as the published changelog.

**Collaboration pattern:** Async accumulation. Engineers add entries as features merge throughout the sprint. Before release, PM/lead reviews and polishes. QA acks the bug fix list. Multiple contributors over days/weeks, but low simultaneous concurrency. The document is "released" (status = final) and becomes read-only.

**Special features needed:**
- **Version number field** on document meta (semver)
- **Release date** on document meta
- **Category tagging** on items (feature, fix, improvement, breaking)
- **Publish action**: transforms the document into a read-only, formatted release note
- Auto-generated from git commits or PR descriptions (future integration)

**Gaps required:** G1 (version number, release date metadata), G5 (release date), G10 (draft -> published lifecycle)

---

### 15. Interview Scorecard

**Type key:** `interview`

**Default sections:**

| # | Title | Section Type | Purpose |
|---|-------|-------------|---------|
| 1 | Candidate Info | summary | Name, role, date, interviewers |
| 2 | Technical Skills | tasks | Scored rubric items (e.g., "System Design: 4/5") |
| 3 | Communication | tasks | Scored rubric items |
| 4 | Problem Solving | tasks | Scored rubric items |
| 5 | Culture Fit | tasks | Scored rubric items |
| 6 | Detailed Notes | notes | Freeform interviewer observations |
| 7 | Overall Recommendation | decisions | Hire / No Hire / Strong Hire / Strong No Hire |

**Modes:** Editor for each interviewer filling their scorecard. Reader for hiring manager reviewing all scorecards. Ack mode for the overall recommendation sign-off.

**Collaboration pattern:** Isolated-then-merged. Each interviewer fills out their scorecard independently (to avoid bias). Scorecards should NOT be visible to other interviewers until all are submitted. After all interviewers submit, the hiring manager views all scorecards in reader mode for the debrief. This requires a "sealed envelope" pattern unlike any other document type.

**Special features needed:**
- **Numeric scoring** (1-5 or 1-4) on rubric items with visual star/bar display
- **Sealed mode**: interviewer's section is hidden from others until all have submitted
- **Aggregate scoring**: auto-calculated average across interviewers for each rubric area
- **Recommendation field**: structured enum (Strong No Hire / No Hire / Lean Hire / Hire / Strong Hire)
- **Bias prevention**: no viewing others' scores until you've submitted your own
- Score sections hidden in reader mode for the candidate (if scorecard is ever shared)

**Gaps required:** G1 (candidate metadata, recommendation enum), G3 (aggregate scoring), G7 (conditional visibility), G8 (numeric rating fields)

---

## Comparison Matrix

| Template | Sections | Primary Mode | Concurrency | Sync/Async | Key Gaps |
|----------|----------|-------------|-------------|------------|----------|
| Meeting Notes | 5 | Editor | Medium (2-6) | Synchronous | G5, G12 |
| Sprint Planning | 6 | Editor + Ack | Medium (5-10) | Synchronous | G5, G8 |
| Design Review | 5 | Ack | Low (2-4) | Async | G3, G11 |
| Project Brief | 7 | Ack | Low (1-3) | Async | G5, G11 |
| Decision Log | 5 | Ack | Low (1-2) | Async | G1, G10, G11 |
| Retrospective | 5 | Editor | High (5-10) | Synchronous | G3, G7, G12 |
| Custom | 0 | Any | Any | Any | None |
| Standup Log | 4 | Editor | Medium (5-10) | Async-first | G2, G5, G9, G12 |
| Incident Report | 7 | Editor | High (3-8) | Synchronous | G1, G5, G10, G11 |
| RFC / Proposal | 7 | Ack | Low (1-2 edit, many review) | Async | G1, G3, G5, G10 |
| Onboarding Checklist | 6 | Ack | Low (2) | Async | G2, G5, G6 |
| 1:1 Notes | 5 | Editor | Low (2) | Mixed | G5, G7, G9, G12 |
| Runbook | 8 | Reader | Low edit, high read | Async | G2, G4, G6 |
| Changelog | 7 | Ack | Low (2-5) | Async | G1, G5, G10 |
| Interview Scorecard | 7 | Editor (isolated) | Medium (3-6 isolated) | Isolated-then-merged | G1, G3, G7, G8 |

---

## Gap Priority Analysis

Ranked by how many templates need each gap, weighted by template importance:

| Priority | Gap | Templates That Need It | Effort Estimate |
|----------|-----|----------------------|-----------------|
| **P0** | G5: Date/time fields | 10 of 15 | Low -- add optional date fields to Section and DocumentMeta |
| **P0** | G1: Section-level metadata | 7 of 15 | Medium -- extend Section type with `metadata: Record<string, unknown>` |
| **P1** | G10: Extended status enums | 5 of 15 | Low -- make DocumentMeta.status a string union or free string |
| **P1** | G11: Linked documents | 4 of 15 | Medium -- cross-reference by documentId, render as clickable links |
| **P1** | G3: Voting/polling | 4 of 15 | Medium -- new Y.Map per vote, unique-by-userId enforcement |
| **P1** | G12: Recurring creation | 4 of 15 | High -- needs scheduler, template instantiation, carry-over logic |
| **P2** | G2: Lightweight checklists | 4 of 15 | Low -- simplified TaskItem without assignee/priority/ack |
| **P2** | G6: Placeholder rich text | 3 of 15 | Low -- add `defaultContent: string` (HTML or markdown) to template sections |
| **P2** | G9: Section grouping | 2 of 15 | Medium -- category header component, groupBy field on sections |
| **P2** | G7: Conditional visibility | 3 of 15 | Medium -- `visibleInModes` array on section, access control logic |
| **P2** | G8: Numeric rating fields | 3 of 15 | Low -- add optional `rating: number` and `ratingMax: number` to TaskItem |
| **P3** | G4: Explicit ordering | 1 of 15 | Low -- `orderIndex` field on sections, already implicitly ordered by array position |

---

## Recommended Type Changes to Support These Templates

### 1. Extend Section type

```typescript
export interface Section {
  id: string;
  type: 'summary' | 'tasks' | 'decisions' | 'notes' | 'checklist' | 'custom';
  title: string;
  collapsed: boolean;
  items: TaskItem[];
  metadata?: Record<string, unknown>;  // G1: severity, vote counts, etc.
  dueDate?: string;                    // G5: ISO8601 date
  visibleInModes?: ViewMode[];         // G7: conditional visibility
  groupLabel?: string;                 // G9: section grouping
}
```

### 2. Extend TaskItem type

```typescript
export interface TaskItem {
  id: string;
  text: string;
  status: 'pending' | 'acked' | 'done' | 'rejected' | 'na';  // added 'na'
  assignee: string;
  ackedBy: string;
  ackedAt: string;
  priority: 'low' | 'medium' | 'high';
  notes: string;
  rating?: number;      // G8: numeric score (e.g., 4)
  ratingMax?: number;   // G8: max score (e.g., 5)
  category?: string;    // changelog: feature/fix/improvement/breaking
}
```

### 3. Extend DocumentMeta type

```typescript
export interface DocumentMeta {
  id: string;
  title: string;
  sourceType: 'transcript' | 'meeting' | 'notes' | 'custom';
  sourceId: string;
  createdBy: string;
  createdAt: string;
  aiModel: string;
  status: string;  // widen from union to string for custom lifecycles (G10)
  // New fields:
  documentType?: string;     // template type key
  version?: string;          // semver for changelogs
  severity?: string;         // SEV1-4 for incidents
  scheduledDate?: string;    // G5: for meetings, standups, 1:1s
  linkedDocumentIds?: string[];  // G11: cross-references
  sequenceNumber?: number;   // RFC numbering, ADR numbering
}
```

### 4. Extend DocumentTemplate type

```typescript
export interface DocumentTemplate {
  type: string;
  name: string;
  icon: string;
  description: string;
  defaultSections: {
    type: Section['type'];
    title: string;
    defaultContent?: string;         // G6: placeholder HTML content
    defaultItems?: Partial<TaskItem>[];  // pre-populated items
    metadata?: Record<string, unknown>;
  }[];
  defaultMeta?: Partial<DocumentMeta>;  // pre-set meta fields
  supportedModes?: ViewMode[];          // which modes make sense
  statusLifecycle?: string[];           // valid status transitions
  category?: 'engineering' | 'management' | 'operations' | 'people' | 'general';
}
```

---

## Template Categories for UI Organization

When presenting 15 templates in a creation dialog, they should be grouped:

| Category | Templates |
|----------|-----------|
| **Engineering** | Sprint Planning, Design Review, RFC/Proposal, Runbook, Changelog |
| **Operations** | Incident Report, Standup Log |
| **Management** | Meeting Notes, Project Brief, Decision Log |
| **People** | 1:1 Notes, Onboarding Checklist, Retrospective, Interview Scorecard |
| **General** | Custom |

---

## Implementation Recommendations

### Phase 1 (ship with multi-doc workspace -- no new gaps needed)
Add the 8 new template definitions to `documentTemplates.ts` using only existing section types. They will work today with just title/type on each section. No new features required.

### Phase 2 (P0 gaps -- high value, low effort)
- G5: Date fields on sections and meta
- G1: Section metadata map
- G10: Flexible status strings

### Phase 3 (P1 gaps -- medium effort, unlocks key workflows)
- G3: Voting (enables RFC approval, retro prioritization)
- G11: Linked documents (enables cross-referencing)
- G2: Lightweight checklists (enables standup, onboarding, runbook execution)

### Phase 4 (P2-P3 gaps -- nice-to-have polish)
- G6: Placeholder content
- G7: Conditional visibility
- G8: Numeric ratings (interview scorecards)
- G9: Section grouping
- G12: Recurring document creation
