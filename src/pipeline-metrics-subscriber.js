// pipeline-metrics-subscriber.js
/**
 * Subscribes to pipeline EventBus events and records Prometheus metrics for
 * step duration, inflight runs, pending approvals, and LLM token usage.
 *
 * Wired during server bootstrap after PipelineModule is initialized.
 * See server.js _wirePipelineModule for call site.
 */

// Track active runs and their start times for duration calculation.
const activeRuns = new Map(); // runId -> { startedAt, steps: Map<stepId, startedAt> }
const activeApprovals = new Set(); // runId (awaiting approval)

/**
 * Subscribe to all pipeline events from the EventBus and emit metrics.
 * Returns an unsubscribe function.
 *
 * @param {import('distributed-core').EventBus} eventBus
 * @param {{ recordPipelineStepDuration, recordPipelineRunInflightDelta, recordPipelineApprovalPendingDelta, recordLLMTokens }} metricsApi
 * @param {import('./utils/logger')} logger
 * @returns {() => void} unsubscribe function
 */
function subscribePipelineMetrics(eventBus, metricsApi, logger) {
  // EventBus exposes subscribeAll(handler) which calls handler(busEvent) for every event.
  const handler = (busEvent) => {
    try {
      const eventType = busEvent.type ? busEvent.type.replace(/:/g, '.') : '';
      const payload = busEvent.payload;

      // Run lifecycle: track inflight gauge.
      if (eventType === 'pipeline.run.started') {
        const runId = payload && payload.runId;
        if (runId) {
          activeRuns.set(runId, { startedAt: Date.now(), steps: new Map() });
          metricsApi.recordPipelineRunInflightDelta(1);
        }
      } else if (
        eventType === 'pipeline.run.completed' ||
        eventType === 'pipeline.run.failed' ||
        eventType === 'pipeline.run.cancelled'
      ) {
        const runId = payload && payload.runId;
        if (runId && activeRuns.has(runId)) {
          activeRuns.delete(runId);
          metricsApi.recordPipelineRunInflightDelta(-1);
        }
        // If run was awaiting approval, clear it.
        if (runId && activeApprovals.has(runId)) {
          activeApprovals.delete(runId);
          metricsApi.recordPipelineApprovalPendingDelta(-1);
        }
      }

      // Approval lifecycle: track pending gauge.
      else if (eventType === 'pipeline.approval.pending') {
        const runId = payload && payload.runId;
        if (runId && !activeApprovals.has(runId)) {
          activeApprovals.add(runId);
          metricsApi.recordPipelineApprovalPendingDelta(1);
        }
      } else if (
        eventType === 'pipeline.approval.resolved' ||
        eventType === 'pipeline.approval.approved' ||
        eventType === 'pipeline.approval.rejected'
      ) {
        const runId = payload && payload.runId;
        if (runId && activeApprovals.has(runId)) {
          activeApprovals.delete(runId);
          metricsApi.recordPipelineApprovalPendingDelta(-1);
        }
      }

      // Step lifecycle: track duration histogram by node type.
      else if (eventType === 'pipeline.step.started') {
        const runId = payload && payload.runId;
        const stepId = payload && payload.stepId;
        if (runId && stepId) {
          const run = activeRuns.get(runId);
          if (run) {
            run.steps.set(stepId, Date.now());
          }
        }
      } else if (eventType === 'pipeline.step.completed') {
        const runId = payload && payload.runId;
        const stepId = payload && payload.stepId;
        const nodeType = payload && payload.nodeType; // Assumes payload carries nodeType.
        if (runId && stepId && nodeType) {
          const run = activeRuns.get(runId);
          if (run && run.steps.has(stepId)) {
            const startedAt = run.steps.get(stepId);
            const durationMs = Date.now() - startedAt;
            metricsApi.recordPipelineStepDuration(nodeType, durationMs);
            run.steps.delete(stepId);
          }
        }
      }

      // LLM token events: increment counter by model.
      else if (eventType === 'pipeline.llm.token') {
        const model = (payload && payload.model) || 'unknown';
        const direction = (payload && payload.direction) || 'out'; // Default to 'out' if not specified.
        const count = (payload && typeof payload.count === 'number') ? payload.count : 1;
        metricsApi.recordLLMTokens(model, direction, count);
      }
    } catch (err) {
      logger.warn('[pipeline-metrics-subscriber] handler error', { error: err && err.message });
    }
  };

  const unsubscribe = eventBus.subscribeAll(handler);
  logger.info('[pipeline-metrics-subscriber] subscribed to EventBus for metrics');

  return () => {
    unsubscribe();
    logger.info('[pipeline-metrics-subscriber] unsubscribed from EventBus');
  };
}

module.exports = { subscribePipelineMetrics };
