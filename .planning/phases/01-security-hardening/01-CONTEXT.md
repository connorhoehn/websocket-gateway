# Phase 1: Security Hardening - Context

**Gathered:** 2026-03-02
**Status:** Ready for planning

<domain>
## Phase Boundary

Implement production-ready security controls (Cognito JWT authentication, channel-level authorization, rate limiting, input validation) and fix critical memory leaks in presence and chat services. This blocks AWS deployment - no infrastructure changes until security gaps are closed.

</domain>

<decisions>
## Implementation Decisions

### Authentication Strategy
- **JWT validation via AWS Cognito**: Token passed in WebSocket query parameter (`?token=...`) during initial handshake
- **Token verification on connect**: Validate JWT signature, expiration, and required claims before accepting connection
- **Reject unauthenticated**: Return 401 Unauthorized with clear error message if token missing/invalid/expired
- **Extract user context**: Store `userId`, `email`, and `permissions` from JWT claims in client metadata
- **No token refresh in gateway**: Clients must reconnect with new token when it expires (keep gateway stateless)

### Authorization Model
- **Channel-level permissions**: Check user's `channels` claim from JWT (array of channel IDs user can access)
- **Validate on subscribe**: Before allowing client to join channel, verify channel ID is in their permissions array
- **Reject unauthorized**: Return 403 Forbidden if user attempts to access channel they don't have permission for
- **Admin channels**: Channels prefixed with `admin:` require `isAdmin: true` claim in JWT
- **Public channels**: Channels prefixed with `public:` are accessible to all authenticated users (bypass permission check)

### Rate Limiting Implementation
- **Per-client token bucket**: Track message count per `clientId` with sliding window
- **Differentiated limits**: 100 msgs/sec for general messages, 40 msgs/sec specifically for cursor updates
- **Message type detection**: Identify cursor messages by `service: "cursor"` in payload
- **Backpressure response**: When limit exceeded, send error message `RATE_LIMIT_EXCEEDED` to client (don't drop connection)
- **Penalty cooldown**: After exceeding limit, client must wait 1 second before sending again
- **Reset interval**: Token bucket refills every 1 second

### Input Validation & Schema
- **Message schema validation**: All incoming messages must have `{ service, action }` fields
- **Service whitelist**: Only allow messages for enabled services (chat, presence, cursor, reaction)
- **Payload size limits**: Reject messages >64KB (prevents memory exhaustion)
- **String sanitization**: Trim whitespace, reject null bytes in text fields
- **Channel name validation**: 1-50 characters, alphanumeric + hyphens/underscores only
- **Error codes**: Return specific codes (INVALID_MESSAGE, PAYLOAD_TOO_LARGE, INVALID_CHANNEL_NAME)

### Memory Leak Fixes
- **Presence service clientPresence Map**: Add TTL cleanup - remove clients after 90 seconds of no heartbeat
- **Chat service channelHistory Map**: Implement LRU cache with max 100 messages per channel, auto-evict oldest
- **Cursor service Redis fallback**: Fix bug where local storage is written but never queried - add fallback read path
- **Periodic cleanup**: Run TTL/LRU cleanup every 30 seconds in background interval

### Error Response Strategy
- **Security-safe errors**: Don't expose internal state or stack traces to clients
- **User-friendly messages**: "Authentication failed" not "JWT signature verification failed with key mismatch"
- **Error code taxonomy**: AUTH_FAILED, TOKEN_EXPIRED, FORBIDDEN, RATE_LIMIT_EXCEEDED, INVALID_MESSAGE, PAYLOAD_TOO_LARGE
- **Logging verbosity**: Log full error details (including stack traces) server-side, send only error code + message to client
- **Audit trail**: Log all authentication failures, authorization denials, and rate limit violations for security monitoring

### Claude's Discretion
- Exact JWT library choice (jsonwebtoken vs aws-jwt-verify)
- Token bucket data structure (Map vs Redis for distributed rate limiting)
- Cleanup interval tuning (30s vs 60s)
- Error message wording (as long as it's clear and security-safe)
- Memory leak test duration (24 hours vs 48 hours)

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- **Logger (`src/utils/logger.js`)**: Configurable log levels, use for security audit trail
- **Error handling pattern**: Services already use try-catch with `this.logger.error()` - extend for security errors
- **MessageRouter.sendError()**: Existing method to send error messages to clients - use for auth/authz failures
- **Service architecture**: Each service has `handleAction()` - wrap with auth/rate limit middleware

### Established Patterns
- **Message routing**: Server validates `{ service, action }` structure - extend with schema validation
- **Client metadata**: Server stores `clientId` in Maps - add `userId`, `permissions` from JWT
- **Redis coordination**: NodeManager uses Redis for distributed state - consider Redis for distributed rate limiting
- **Cleanup loops**: Presence service has stale cleanup logic (buggy) - pattern exists, needs fixing

### Integration Points
- **WebSocket connection handler** (`src/server.js` lines 191-233): Add JWT validation on connect before accepting
- **Message handler** (`src/server.js` lines 236-275): Add rate limiting check before routing to services
- **Service subscribe methods**: Add authorization check in chat/presence/cursor `join`/`subscribe` actions
- **Logger initialization**: Already wired throughout codebase - add security-specific log messages

</code_context>

<specifics>
## Specific Ideas

- **Cognito User Pool**: Use existing Cognito pool if available, or create new pool specifically for WebSocket gateway
- **JWT claims structure**: Expect `{ sub: userId, email: string, channels: string[], isAdmin?: boolean }`
- **Rate limiting is critical**: Research showed this is the #1 production blocker (no rate limiting = DDoS vulnerable)
- **Memory leaks cause runaway costs**: Fix before AWS deployment (leaks + auto-scaling = infinite cost)
- **Use ECS Fargate for Docker**: Mentioned by user - keep this in mind for future phases (doesn't affect Phase 1 code)

</specifics>

<deferred>
## Deferred Ideas

- CORS configuration (SEC-08) - Simple implementation, will be handled in plans
- Connection limits (SEC-07) - Straightforward addition, will be handled in plans
- Connection state recovery - This is Phase 5 (REL-05)
- AWS Infrastructure deployment - This is Phase 2 (all INFRA-* requirements)
- Monitoring and alerting - This is Phase 3 (all MON-* requirements)

</deferred>

---

*Phase: 01-security-hardening*
*Context gathered: 2026-03-02 (auto mode with smart defaults)*
