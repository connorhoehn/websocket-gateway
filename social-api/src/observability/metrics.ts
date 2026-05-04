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
import { MetricsRegistry, formatPrometheus, QueueMetrics } from 'distributed-core';

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

// Per-step execution metrics (task #371 - detailed pipeline telemetry).
// Histogram buckets chosen to cover realistic pipeline step durations:
// sub-second for transforms, seconds for LLM calls, minutes for long-running steps.
const pipelineStepDurationMs = registry.histogram(
  'pipeline_step_duration_ms',
  { ...BASE_LABELS, node_type: '_init' },
  'Pipeline step execution time in milliseconds, labeled by node type.',
  [100, 250, 500, 1000, 2500, 5000, 10_000, 30_000, 60_000, 120_000],
);

const pipelineRunsInflight = registry.gauge('pipeline_runs_inflight', BASE_LABELS, 'Pipeline runs currently in pending or running state.');
const pipelineApprovalsPending = registry.gauge('pipeline_approvals_pending', BASE_LABELS, 'Pipeline runs currently awaiting approval.');

// LLM token counter with model label. Pre-registered with model='_init' so the metric
// appears at zero; per-model labels are minted lazily in recordLLMTokens.
registry.counter('pipeline_llm_tokens_total', { ...BASE_LABELS, model: '_init', direction: 'in' }, 'LLM tokens processed, labeled by model and direction (in/out).');

// EventBus dead-letter counter (Stream 3 — BusDLQ). Incremented every time a
// subscriber throws or a publish path fails inside the pipeline EventBus.
// `reason` carries the error's `name` (e.g., 'Error', 'TypeError', custom
// classes) so dashboards can break down DLQs by error class without
// unbounded label cardinality from full messages. Pre-registered at module
// load with reason='_init' so a Prometheus scrape sees the metric at zero
// before the first dead letter fires; per-reason counters are minted lazily
// in `incrementBusDeadLetter`.
registry.counter('pipeline_event_bus_dead_letters_total', { ...BASE_LABELS, reason: '_init' }, 'Pipeline EventBus dead letters (subscriber throw or publish failure), labeled by error.name.');

// Phase 51 TypedDocuments / DocumentTypes counters. Track creation, updates,
// deletes, and validation failures for operator visibility into document type
// usage patterns and error rates.
const documentTypesCreatedTotal = registry.counter('document_types_created_total', BASE_LABELS, 'DocumentTypes created via POST /api/document-types.');
const documentTypesUpdatedTotal = registry.counter('document_types_updated_total', BASE_LABELS, 'DocumentTypes updated via PUT /api/document-types/:id.');
const documentTypesDeletedTotal = registry.counter('document_types_deleted_total', BASE_LABELS, 'DocumentTypes deleted via DELETE /api/document-types/:id.');
const typedDocumentsCreatedTotal = registry.counter('typed_documents_created_total', BASE_LABELS, 'TypedDocuments created via POST /api/typed-documents.');
const typedDocumentsBulkImportedTotal = registry.counter('typed_documents_bulk_imported_total', BASE_LABELS, 'TypedDocument bulk imports via POST /api/typed-documents/bulk-import.');
// Validation error counter pre-registered with error_type='_init' so the metric
// appears at zero before the first validation failure; per-error-type labels
// are minted lazily in recordTypedDocumentValidationError.
registry.counter('typed_documents_validation_errors_total', { ...BASE_LABELS, error_type: '_init' }, 'TypedDocument validation failures, labeled by error type (required_field, type_mismatch, reference_not_found, etc).');

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
 * Record pipeline step execution duration. Called when pipeline.step.completed
 * event is observed. `nodeType` should be the step's node type (llm, transform,
 * approval, etc). `durationMs` is the elapsed time from step.started to step.completed.
 */
export function recordPipelineStepDuration(nodeType: string, durationMs: number): void {
  registry.histogram('pipeline_step_duration_ms', { ...BASE_LABELS, node_type: nodeType }, '', []).observe(durationMs);
}

/**
 * Update the pipeline_runs_inflight gauge. Called on run.started (+1) and
 * run.completed/failed/cancelled (-1).
 */
export function recordPipelineRunInflightDelta(delta: number): void {
  if (delta > 0) pipelineRunsInflight.inc(delta);
  else if (delta < 0) pipelineRunsInflight.dec(-delta);
}

/**
 * Update the pipeline_approvals_pending gauge. Called when a run enters
 * awaiting_approval (+1) and when resolved (-1).
 */
export function recordPipelineApprovalPendingDelta(delta: number): void {
  if (delta > 0) pipelineApprovalsPending.inc(delta);
  else if (delta < 0) pipelineApprovalsPending.dec(-delta);
}

/**
 * Record LLM token consumption. Called when pipeline.llm.token events are observed.
 * `model` is the LLM model name, `direction` is 'in' or 'out', `count` is the token delta.
 */
export function recordLLMTokens(model: string, direction: 'in' | 'out', count: number): void {
  registry.counter('pipeline_llm_tokens_total', { ...BASE_LABELS, model, direction }, '', []).inc(count);
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

export function recordDocumentTypeCreated(): void {
  documentTypesCreatedTotal.inc();
}

export function recordDocumentTypeUpdated(): void {
  documentTypesUpdatedTotal.inc();
}

export function recordDocumentTypeDeleted(): void {
  documentTypesDeletedTotal.inc();
}

export function recordTypedDocumentCreated(): void {
  typedDocumentsCreatedTotal.inc();
}

export function recordTypedDocumentBulkImported(): void {
  typedDocumentsBulkImportedTotal.inc();
}

/**
 * Increment the TypedDocument validation error counter, labeled by `errorType`.
 * Expected error types: 'required_field', 'type_mismatch', 'reference_not_found',
 * 'enum_invalid', 'validation_rule'. Cardinality is bounded by the fixed set of
 * validation failure modes; full error messages are NOT used as labels.
 */
export function recordTypedDocumentValidationError(errorType: string): void {
  registry.counter('typed_documents_validation_errors_total', { ...BASE_LABELS, error_type: errorType }).inc();
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

// Bounded enum: cardinality of the `queue` label is gateway-owned (the
// distributed-core library does not enforce a cap). Adding a fourth queue
// requires a deliberate edit here — it must NOT be a tenant id, run id,
// or any other unbounded identifier.
export const ALLOWED_QUEUE_NAMES = ['run-queue', 'trigger-queue', 'dlq'] as const;
export type QueueName = (typeof ALLOWED_QUEUE_NAMES)[number];

const queueMetricsByName = new Map<QueueName, QueueMetrics>();

export function getQueueMetrics(queueName: QueueName): QueueMetrics {
  if (!ALLOWED_QUEUE_NAMES.includes(queueName)) {
    throw new Error(
      `getQueueMetrics: unknown queueName ${JSON.stringify(queueName)}; allowed: ${ALLOWED_QUEUE_NAMES.join(', ')}`,
    );
  }
  let metrics = queueMetricsByName.get(queueName);
  if (!metrics) {
    metrics = new QueueMetrics({ registry, queueName });
    queueMetricsByName.set(queueName, metrics);
  }
  return metrics;
}
