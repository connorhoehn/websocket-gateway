// frontend/src/utils/demoDocument.ts
//
// Demo markdown content for testing the collaborative document editor.

export const DEMO_MARKDOWN = `# Q2 Sprint Planning - Meeting Summary

## Executive Summary

This document captures the key outcomes from our Q2 sprint planning session held on April 10, 2026. The team discussed priorities for the upcoming quarter, including the new collaborative editing feature, infrastructure improvements, and customer-facing bug fixes.

Key themes:
- **Real-time collaboration** is the top priority for Q2
- Infrastructure debt needs to be addressed before scaling
- Customer satisfaction scores are trending upward

## Action Items

- [ ] Set up Tiptap editor with Y.js CRDT integration
- [ ] Deploy shared Redis ECS service for multi-instance sync
- [ ] Fix the 48 audit issues identified in the post-fix review
- [ ] Create Playwright tests for 3-browser collaborative editing
- [ ] Design the document export pipeline (PDF, DOCX, Google Docs)
- [x] Complete the WebSocket gateway infrastructure audit
- [x] Remove ElastiCache dependency from CDK stack

## Decisions

- [ ] Adopt Tiptap v3 as the standard rich text editor
- [ ] Use Y.js with custom GatewayProvider (not Hocuspocus)
- [ ] Store CRDT snapshots in DynamoDB with 7-day TTL
- [ ] Support 3 viewing modes: Editor, Review, Reader

## Technical Notes

The collaborative document editor will be built on top of the existing WebSocket gateway infrastructure. The \`crdt-service.js\` backend has been upgraded to maintain a proper \`Y.Doc\` per channel with awareness protocol support.

### Architecture Highlights

1. **Frontend**: Tiptap v3 + Y.js with custom \`GatewayProvider\`
2. **Backend**: Existing crdt-service.js (treats Y.js updates as opaque binary)
3. **Persistence**: EventBridge -> Lambda -> DynamoDB (gzip compressed, 7-day TTL)
4. **Sync**: Redis pub/sub for multi-instance, WebSocket for client delivery

### Performance Targets

- Edit latency: < 50ms (local) / < 200ms (remote)
- Concurrent editors: 10+ per document
- Document size: up to 100KB of rich text
- Snapshot frequency: every 50 operations or 5 minutes
`;
