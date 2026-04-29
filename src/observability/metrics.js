// src/observability/metrics.js
//
// Shadow Prometheus metrics layer. Coexists with the legacy
// CloudWatch-pushing MetricsCollector at src/utils/metrics-collector.js;
// the legacy collector is the source of truth for production dashboards
// today. This module exposes the same observations through
// distributed-core's MetricsRegistry so a Prometheus scrape at
// `GET /internal/metrics` can pick them up.
//
// Cutover from CloudWatch push → Prometheus pull is a separate phase
// (see .planning/DISTRIBUTED-CORE-INTEGRATION-SPEC.md, Track 2). Until
// then this is additive and side-effect-free with respect to existing
// CloudWatch dashboards.

const os = require('os');
const { MetricsRegistry, MetricsExporter } = require('distributed-core');

const SERVICE = process.env.WSG_SERVICE_NAME || 'gateway';
const NODE_ID = process.env.WSG_NODE_ID || os.hostname();
const BASE_LABELS = { service: SERVICE, node_id: NODE_ID };

const registry = new MetricsRegistry();
const exporter = new MetricsExporter(registry);

// Pre-register the shadowed metrics so the snapshot is non-empty even
// before any traffic arrives (Prometheus scrapes prefer presence to
// gaps). One Counter/Gauge per (name, labels) tuple — labels are baked
// at creation time in distributed-core's MetricsRegistry.
const activeConnections = registry.gauge('wsg_active_connections', BASE_LABELS, 'Currently open WebSocket connections.');
const messagesTotal = registry.counter('wsg_messages_total', BASE_LABELS, 'Total inbound WebSocket messages processed.');
const reconnectAttemptsTotal = registry.counter('wsg_reconnect_attempts_total', BASE_LABELS, 'Reconnection attempts received from clients with a sessionToken.');
const reconnectSuccessesTotal = registry.counter('wsg_reconnect_successes_total', BASE_LABELS, 'Reconnection attempts that successfully restored the previous session.');
const reconnectFailuresTotal = registry.counter('wsg_reconnect_failures_total', BASE_LABELS, 'Reconnection attempts that failed (token expired, restore error, etc).');
const connectionFailuresTotal = registry.counter('wsg_connection_failures_total', BASE_LABELS, 'WebSocket connection attempts rejected before/at handshake.');

// Pipeline lifecycle counters. Pre-registered so a scrape sees zero before traffic;
// call-site wiring lands in Wave 2.
const pipelineTriggersTotal = registry.counter('pipeline_triggers_total', BASE_LABELS, 'Pipeline runs created via trigger or webhook.');
const pipelineApprovalsTotal = registry.counter('pipeline_approvals_total', BASE_LABELS, 'Pipeline approval decisions resolved (approved or rejected).');
const pipelineCancelsTotal = registry.counter('pipeline_cancels_total', BASE_LABELS, 'Pipeline runs explicitly cancelled by an operator.');
const pipelineErrorsTotal = registry.counter('pipeline_errors_total', BASE_LABELS, 'Pipeline operations that failed (bridge throw, probe timeout, etc).');

// Owner-aware routing (Wave 4c step 2 / DC-PIPELINE-7). Counts message-router
// `sendToChannel` invocations that resolved to a non-local room owner and
// attempted peer-addressed delivery via distributed-core's PeerMessaging.
// Outcomes:
//   - ok: peer-send resolved successfully.
//   - peer_failed_fallback: peer-send threw; we fell back to Redis fan-out
//     so the message is NOT dropped.
const peerRoutedOk = registry.counter(
    'gateway_message_peer_routed_count',
    { ...BASE_LABELS, outcome: 'ok' },
    'Owner-aware peer-addressed deliveries from message-router (per-outcome).',
);
const peerRoutedFailed = registry.counter(
    'gateway_message_peer_routed_count',
    { ...BASE_LABELS, outcome: 'peer_failed_fallback' },
    'Owner-aware peer-addressed deliveries from message-router (per-outcome).',
);

function recordConnection(delta) {
    if (delta > 0) activeConnections.inc(delta);
    else if (delta < 0) activeConnections.dec(-delta);
}

function recordMessage() {
    messagesTotal.inc();
}

function recordReconnectionAttempt() {
    reconnectAttemptsTotal.inc();
}

function recordReconnectionSuccess() {
    reconnectSuccessesTotal.inc();
}

function recordReconnectionFailure() {
    reconnectFailuresTotal.inc();
}

function recordConnectionFailure() {
    connectionFailuresTotal.inc();
}

function recordPipelineTrigger() {
    pipelineTriggersTotal.inc();
}

function recordPipelineApproval() {
    pipelineApprovalsTotal.inc();
}

function recordPipelineCancel() {
    pipelineCancelsTotal.inc();
}

function recordPipelineError() {
    pipelineErrorsTotal.inc();
}

function recordPeerRoutedOk() {
    peerRoutedOk.inc();
}

function recordPeerRoutedFallback() {
    peerRoutedFailed.inc();
}

// Renders the registry snapshot as Prometheus 0.0.4 text format.
// Suitable for `Content-Type: text/plain; version=0.0.4; charset=utf-8`.
function renderPrometheusText() {
    const snapshot = registry.getSnapshot();
    return exporter.formatPrometheusMetrics(snapshot.metrics);
}

// Returns the singleton MetricsRegistry for callers that want to register
// additional metrics inline (e.g., a feature module wanting a custom counter).
function getRegistry() {
    return registry;
}

module.exports = {
    recordConnection,
    recordMessage,
    recordReconnectionAttempt,
    recordReconnectionSuccess,
    recordReconnectionFailure,
    recordConnectionFailure,
    recordPipelineTrigger,
    recordPipelineApproval,
    recordPipelineCancel,
    recordPipelineError,
    recordPeerRoutedOk,
    recordPeerRoutedFallback,
    renderPrometheusText,
    getRegistry,
};
