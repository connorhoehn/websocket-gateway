// social-api/src/observability/metrics.ts
//
// Prometheus shadow metrics layer for social-api. Mirrors
// gateway's src/observability/metrics.js so a Prometheus scrape
// at `GET /internal/metrics` on social-api returns the same
// connection/message/reconnect counters PLUS pipeline-lifecycle
// counters (triggers, approvals, cancels, errors).
//
// Counter wiring at call sites lands in Wave 2; this module just
// pre-registers the metrics so a scrape sees them at zero before
// traffic. Coexists with any legacy CloudWatch push paths — this
// is additive and side-effect-free w.r.t. existing dashboards.

import os from 'os';
import { MetricsRegistry, formatPrometheus } from 'distributed-core';

const SERVICE = process.env.WSG_SERVICE_NAME || 'social-api';
const NODE_ID = process.env.WSG_NODE_ID || os.hostname();
const BASE_LABELS = { service: SERVICE, node_id: NODE_ID };

const registry = new MetricsRegistry(NODE_ID);

// Connection / message / reconnect shadows — same names as gateway
// so dashboards can union both services on a single panel.
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

// EventBus dead-letter counter (Stream 3 — BusDLQ). Incremented every time a
// subscriber throws or a publish path fails inside the pipeline EventBus.
// `reason` carries the error's `name` (e.g., 'Error', 'TypeError', custom
// classes) so dashboards can break down DLQs by error class without
// unbounded label cardinality from full messages. Pre-registered at module
// load with reason='_init' so a Prometheus scrape sees the metric at zero
// before the first dead letter fires; per-reason counters are minted lazily
// in `incrementBusDeadLetter`.
registry.counter('pipeline_event_bus_dead_letters_total', { ...BASE_LABELS, reason: '_init' }, 'Pipeline EventBus dead letters (subscriber throw or publish failure), labeled by error.name.');

export function recordConnection(delta: number): void {
  if (delta > 0) activeConnections.inc(delta);
  else if (delta < 0) activeConnections.dec(-delta);
}

export function recordMessage(): void {
  messagesTotal.inc();
}

export function recordReconnectionAttempt(): void {
  reconnectAttemptsTotal.inc();
}

export function recordReconnectionSuccess(): void {
  reconnectSuccessesTotal.inc();
}

export function recordReconnectionFailure(): void {
  reconnectFailuresTotal.inc();
}

export function recordConnectionFailure(): void {
  connectionFailuresTotal.inc();
}

export function recordPipelineTrigger(): void {
  pipelineTriggersTotal.inc();
}

export function recordPipelineApproval(): void {
  pipelineApprovalsTotal.inc();
}

export function recordPipelineCancel(): void {
  pipelineCancelsTotal.inc();
}

export function recordPipelineError(): void {
  pipelineErrorsTotal.inc();
}

/**
 * Increment the EventBus dead-letter counter, labeled by `reason`. The caller
 * is expected to pass the error's `name` (e.g., `error.name` — typically
 * 'Error', 'TypeError', or a custom subclass name) so cardinality stays
 * bounded. Full messages are intentionally NOT used as labels; a small fixed
 * set of error classes is the correct shape for a Prometheus counter.
 */
export function incrementBusDeadLetter(reason: string): void {
  registry.counter('pipeline_event_bus_dead_letters_total', { ...BASE_LABELS, reason }).inc();
}

// Renders the registry snapshot as Prometheus 0.0.4 text format.
// Suitable for `Content-Type: text/plain; version=0.0.4; charset=utf-8`.
export function renderPrometheusText(): string {
  return formatPrometheus(registry.getSnapshot());
}

// Returns the singleton MetricsRegistry for callers that want to
// register additional metrics inline (e.g., a feature module wanting
// a custom counter).
export function getRegistry(): MetricsRegistry {
  return registry;
}
