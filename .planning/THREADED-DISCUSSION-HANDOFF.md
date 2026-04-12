# Threaded Discussion → Document Editor: Architecture Handoff

## Source Project: `threaded_discussion`
## Target: WebSocket Gateway Document Editor threading, comments, presence, activity

---

## 1. THREADING DATA MODEL

### How Threads Work in threaded_discussion
- **Storage**: DynamoDB single table (`hierarchical-discussion-posts`), adjacency list pattern
- **Posts**: `type: 'post'`, `id` as UUID, full content with engagement counters
- **Comments**: `type: 'comment'`, `id` prefixed `comment-`, `parentPostId` references post
- **Nesting**: Backend is flat (post → comments only). Client builds nested tree in memory via `replies[]` arrays
- **Depth**: Unlimited client-side, 1-level server-side
- **Sorting**: Client-side: hot (decay algorithm), new, top (votes), controversial (abs votes)

### Post Schema
```
{ id, title, content, userId, timestamp, createdAt, updatedAt, version, status, type, tags[], likes, comments, shares }
```

### Comment Schema  
```
{ id: 'comment-UUID', postId, parentPostId, content, userId, timestamp, createdAt, type: 'comment' }
```

### Key Design Decision
Tree assembly happens client-side. Server returns flat arrays. This keeps queries simple and lets the UI control nesting depth and collapse behavior.

---

## 2. UI COMPONENT ARCHITECTURE

### Layout (3-Column Grid)
```
Header (sticky 60px, gradient #1e3a8a → #3b82f6)
├── Left Sidebar (250px) — groups nav, quick actions
├── Main Content (1fr) — feed, create form, thread view
└── Right Sidebar (250px) — stats, trending, sort options
```

### Thread Rendering
- Post card: flexbox with vote section (40px left) + content area
- Comments: 3px left border (accent on hover), 16px padding
- Nested replies: `margin-left: 20px`, 2px left border, lighter background
- Reply form: inline slide-down animation (0.2s ease-out)
- No modals for replies — all inline and contextual

### Voting System
- Upvote/downvote triangles with toggle logic
- States: upvoted (#3b82f6), downvoted (#7193ff), neutral
- Vote count centered between arrows
- `userVote` tracks per-user state (up/down/null)

### Comment Interaction
- Toggle comments visibility per post
- Inline comment form (textarea + buttons)
- Reply form slides down under target comment
- Recursive `renderComments()` for nested display
- `countAllComments()` traverses full tree

---

## 3. REAL-TIME & PRESENCE PATTERNS

### Current State (threaded_discussion)
- **No WebSocket in client** — pure REST polling
- Chat widget has simulated responses
- Kafka handles inter-service events but no client push
- Presence: static "12 online" indicator in chat header

### Chat Widget UX
- Floating bottom-right bubble with notification badge
- Message list with avatar initials (gradient circles)
- Own messages: right-aligned, blue background
- Others: left-aligned, gray background
- Typing indicator: 3-dot bounce animation
- Voice messages: record → play with waveform progress
- File attachments: icon + name + size preview

### What to Adopt for Doc Editor
- Presence dots (green #10b981) next to usernames
- Typing/activity indicators with animation
- Avatar initials with gradient backgrounds
- Notification badges for unread activity

---

## 4. DESIGN SYSTEM

### Color Tokens (CSS Variables)
```css
/* Dark Mode (default) */
--bg-primary: #1a1a1b
--bg-secondary: #272729
--border-color: #343536
--accent-color: #3b82f6
--accent-hover: #2563eb
--text-primary: #d7dadc
--text-secondary: #818384

/* Light Mode */
--bg-primary: white
--bg-secondary: #f8f9fa
--border-color: #e4e6ea
--text-primary: #1c1e21
--text-secondary: #65676b

/* Semantic */
Success: #10b981 (green)
Error: #ef4444 (red)
Warning: #FF9800 (orange)
```

### Typography
- Font: system stack (-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto)
- Base: 14px, line-height: 1.5
- Code: monospace
- Whitespace: pre-wrap for content

### Animations
| Animation | Duration | Use |
|-----------|----------|-----|
| slideDown | 0.2s ease-out | Reply forms appearing |
| fadeIn | 0.3s ease | Modal backdrop |
| slideInScale | 0.3s ease | Modal content |
| typingDots | 1.4s infinite | Typing indicator |
| pulse | 1s infinite | Recording/active states |

### Component Patterns
- Cards: 1px border, 8px radius, hover border-color shift
- Buttons: 8px padding, rounded, 0.2s transitions
- Inputs: bg-secondary, accent border on focus, 8px radius
- Modals: centered, backdrop blur(4px), max-width 500px, scrollable body
- Toasts: fixed top-right, slide in from right, auto-dismiss 3s

---

## 5. ADMIN & MODERATION

### Drag-to-Action System
- Admin mode activated by holding ⌘ (Mac)
- Content becomes draggable (cursor: move)
- Top bar: Approve, Flag, Investigate, Escalate
- Bottom bar: Remove, Ban, Warn, AI Analyze
- Drop zones glow and scale on drag-over
- Action counters in badges
- AI Analysis: simulated scoring system

---

## 6. SERVICES ARCHITECTURE

### Backend Services (7 total)
| Service | Role | Storage |
|---------|------|---------|
| ContentService | Post/comment CRUD, engagement | DynamoDB |
| FeedService | Timeline generation, pagination | DynamoDB + Redis cache |
| SearchService | Full-text search, autocomplete | Elasticsearch |
| AnalyticsService | Views, engagement tracking | Redis counters |
| KafkaService | Event streaming, async processing | Kafka topics |
| QueueService | Async job queue | Redis lists |
| ElasticsearchService | Search indexing, trending | Elasticsearch |

### Data Flow
1. Post create → Kafka topic → Consumer saves to DynamoDB
2. Feed request → Redis cache (miss) → DynamoDB scan → Cache store
3. Search → Elasticsearch → Return with highlights
4. Comment → DynamoDB put → Increment post.comments counter → Invalidate caches

### Graceful Degradation
- Server starts even without Redis/Kafka/Elasticsearch
- Health checks report what's available
- Search returns empty/mock results when ES is down
- Feeds work without caching when Redis is down

---

## 7. INFRASTRUCTURE

### Local Dev (Docker Compose)
- Redis 7-alpine (cache + queues)
- DynamoDB Local (persistence)
- Elasticsearch 8.11 (search)
- Kafka + Zookeeper (events)
- App container with live reload

### Production (AWS CDK)
- ECS Fargate (256 CPU, 512MB RAM)
- Network Load Balancer (port 80 → 8080)
- ElastiCache Redis (optional, multi-AZ)
- VPC with isolated subnets + VPC endpoints
- CloudWatch Logs
- No NAT Gateway (cost optimization)

---

## 8. MAPPING TO DOC EDITOR FEATURES

### Feature: Section Comments (threaded)
**From threaded_discussion**: Comment model + recursive rendering
**Apply to doc editor**:
- Each section = a "post" context
- Comments stored with `sectionId` as parent reference
- Client-side nesting for reply threads
- Inline reply form (slide-down, not modal)
- 3px left border for visual threading hierarchy
- Vote/react on comments for prioritization

### Feature: Who's Here / Presence
**From threaded_discussion**: Chat presence indicator pattern
**Apply to doc editor**:
- Green dots next to active users in header
- Section-level presence: show avatars on section headers
- Mode indicator: "editing" / "reviewing" / "reading" label
- Click avatar → scroll to their section
- Use Y.js awareness (already exists) for real-time tracking

### Feature: Activity Timeline
**From threaded_discussion**: Engagement counters + Kafka events
**Apply to doc editor**:
- Unified activity bus (already built) for real-time events
- Event types: doc.ack, doc.reject, doc.comment, doc.edit_section, doc.add_section
- Timeline shows user avatar + action + target + timestamp
- Persisted via gateway ActivityService → DynamoDB (future)

### Feature: Read Mode = Summary
**From threaded_discussion**: Feed service with sorting/filtering
**Apply to doc editor**:
- Read mode renders synthesized view, not raw sections
- Completed tasks: grouped summary with checkmarks
- Pending items: highlighted action needed
- Decisions: extracted as key takeaways
- Progress bar: X of Y items reviewed
- Comment highlights: most discussed sections surfaced

### Feature: Persistence
**From threaded_discussion**: DynamoDB + Redis cache pattern
**Apply to doc editor**:
- Y.js document state → server-side snapshot storage
- Comments → DynamoDB or gateway broadcast
- Activity events → DynamoDB via activity-log Lambda
- Session restore: Y.js snapshot loaded on reconnect
- Cache: Redis for hot document state

---

## 9. IMPLEMENTATION PRIORITY

### Phase 1: Core Threading (Section Comments)
- SectionComments component with nested replies (already started)
- Comment data model: `{ id, sectionId, parentCommentId?, userId, displayName, color, text, timestamp, replies[] }`
- Inline reply form with slide-down animation
- Visual threading with left-border indentation
- Publish comments through activity bus

### Phase 2: Presence & Navigation  
- Section-level avatar indicators (already started)
- Click-to-scroll participant list
- Awareness updates on section focus
- Mode badges (editing/reviewing/reading)

### Phase 3: Read Mode Summary
- Summary renderer: extract decisions, completed items, pending actions
- Progress visualization (bar + stats)
- Most-discussed sections highlighted
- Export-ready view

### Phase 4: Persistence & History
- Server-side comment storage (DynamoDB)
- Document snapshot save/restore
- Activity event persistence
- Version history with diff view

---

## 10. KEY FILES REFERENCE

### threaded_discussion (source patterns)
| File | What to learn from it |
|------|----------------------|
| `test/clients/js/app.js` | Thread rendering, vote logic, comment nesting |
| `test/clients/hierarchical-discussion.html` | Layout, CSS variables, component structure |
| `src/services/content-service.js` | Comment CRUD, engagement counters |
| `src/services/feed-service.js` | Pagination, caching, sorting |
| `src/core/database-manager.js` | DynamoDB table setup, indexes |

### websocker_gateway (target files)
| File | What needs work |
|------|----------------|
| `frontend/src/components/doc-editor/SectionComments.tsx` | Enhance with threading |
| `frontend/src/components/doc-editor/SectionBlock.tsx` | Presence + comments integration |
| `frontend/src/components/doc-editor/DocumentEditorPage.tsx` | Comment state, persistence |
| `frontend/src/components/doc-editor/ReaderMode.tsx` | Summary view |
| `frontend/src/hooks/useActivityBus.ts` | Comment events |
| `src/services/activity-service.js` | Comment persistence |
