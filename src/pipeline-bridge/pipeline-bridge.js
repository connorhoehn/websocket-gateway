// pipeline-bridge/pipeline-bridge.js
/**
 * PipelineBridge — subscribes to a pipeline event source and forwards each
 * event over the gateway's WebSocket via PipelineService.emitEvent.
 *
 * Phase 1 (current): `eventSource` is a plain Node EventEmitter that emits
 *   `'event'` with payload `{ eventType, payload }`.
 * Phase 3 (future): `eventSource` is a distributed-core `EventBus` instance.
 *   Provided it exposes either:
 *     - `.subscribeAll(handler)` returning an `unsubscribe()` function, or
 *     - the EventEmitter `.on('event', handler)` / `.off('event', handler)` shape,
 *   this bridge will work without modification.
 *
 * Channel fan-out (see PIPELINES_PLAN.md §14.1):
 *   - `pipeline:run:{runId}`  — when payload.runId is present
 *   - `pipeline:all`          — every event (observability)
 *   - `pipeline:approvals`    — events whose type starts with `pipeline.approval.`
 *
 * Frame shape delivered to subscribers is produced by PipelineService.emitEvent
 * (see PIPELINES_PLAN.md §14.3).
 */
class PipelineBridge {
  /**
   * @param {object} opts
   * @param {import('events').EventEmitter | { subscribeAll: Function }} opts.eventSource
   *   Source that emits pipeline events. Either a plain EventEmitter (`.on('event', fn)`)
   *   or an object exposing `subscribeAll(handler)` returning an `unsubscribe()` fn.
   * @param {object} opts.pipelineService
   *   Gateway PipelineService instance with `.emitEvent(channel, eventType, payload)`.
   * @param {object} [opts.logger]
   *   Optional logger with `.info/.warn/.error/.debug` methods. Falls back to console.
   */
  constructor({ eventSource, pipelineService, logger } = {}) {
    if (!eventSource) {
      throw new Error('PipelineBridge: eventSource is required');
    }
    if (!pipelineService || typeof pipelineService.emitEvent !== 'function') {
      throw new Error('PipelineBridge: pipelineService with .emitEvent is required');
    }

    this.eventSource = eventSource;
    this.pipelineService = pipelineService;
    this.logger = logger || console;

    this._started = false;
    this._unsubscribe = null;
    // Bound so we can pass it to .on / .off symmetrically.
    this._boundHandler = this._handleEvent.bind(this);
  }

  /**
   * Subscribe to the event source. Safe to call once — subsequent calls are no-ops.
   */
  start() {
    if (this._started) {
      this.logger.warn?.('[pipeline-bridge] start() called but bridge already started');
      return;
    }

    // Prefer distributed-core-style subscribeAll when available.
    if (typeof this.eventSource.subscribeAll === 'function') {
      const unsub = this.eventSource.subscribeAll((eventType, payload) => {
        // distributed-core's subscribeAll passes (eventType, payload); normalize
        // into the same shape as the EventEmitter path.
        this._handleEvent({ eventType, payload });
      });
      this._unsubscribe = typeof unsub === 'function' ? unsub : null;
    } else if (typeof this.eventSource.on === 'function') {
      this.eventSource.on('event', this._boundHandler);
    } else {
      throw new Error(
        'PipelineBridge: eventSource must expose subscribeAll(handler) or on(event, handler)'
      );
    }

    this._started = true;
    this.logger.info?.('[pipeline-bridge] started');
  }

  /**
   * Unsubscribe from the event source. Idempotent.
   */
  stop() {
    if (!this._started) return;

    try {
      if (this._unsubscribe) {
        this._unsubscribe();
      } else if (typeof this.eventSource.off === 'function') {
        this.eventSource.off('event', this._boundHandler);
      } else if (typeof this.eventSource.removeListener === 'function') {
        this.eventSource.removeListener('event', this._boundHandler);
      }
    } catch (err) {
      this.logger.warn?.('[pipeline-bridge] error during stop()', err?.message || err);
    }

    this._unsubscribe = null;
    this._started = false;
    this.logger.info?.('[pipeline-bridge] stopped');
  }

  /**
   * Internal: fan out a single bus event to the appropriate WS channels.
   * @param {{ eventType: string, payload: object }} evt
   */
  _handleEvent(evt) {
    if (!evt || typeof evt !== 'object') {
      this.logger.warn?.('[pipeline-bridge] received malformed event (not an object)', evt);
      return;
    }

    const { eventType, payload } = evt;
    if (!eventType || typeof eventType !== 'string') {
      this.logger.warn?.('[pipeline-bridge] received event with missing/invalid eventType', evt);
      return;
    }

    const safePayload = payload && typeof payload === 'object' ? payload : {};
    const runId = safePayload.runId;

    // 1) run-specific channel (only when we have a runId)
    if (runId) {
      this._emit(`pipeline:run:${runId}`, eventType, safePayload);
    }

    // 2) firehose channel — every event
    this._emit('pipeline:all', eventType, safePayload);

    // 3) approvals channel — only approval.* events
    if (eventType.startsWith('pipeline.approval.')) {
      this._emit('pipeline:approvals', eventType, safePayload);
    }
  }

  /**
   * Internal: safe wrapper around pipelineService.emitEvent — swallows and logs errors
   * so one bad subscriber can't tear down the bridge.
   * @param {string} channel
   * @param {string} eventType
   * @param {object} payload
   */
  _emit(channel, eventType, payload) {
    try {
      const maybePromise = this.pipelineService.emitEvent(channel, eventType, payload);
      if (maybePromise && typeof maybePromise.catch === 'function') {
        maybePromise.catch((err) => {
          this.logger.error?.(
            `[pipeline-bridge] emitEvent rejected for channel=${channel} eventType=${eventType}:`,
            err?.message || err
          );
        });
      }
    } catch (err) {
      this.logger.error?.(
        `[pipeline-bridge] emitEvent threw for channel=${channel} eventType=${eventType}:`,
        err?.message || err
      );
    }
  }
}

/**
 * Build the PipelineModule handler interface consumed by PipelineService.
 * Plug in the real PipelineModule from `~/Sandbox/distributed-core` here.
 *
 * The shim returned today simply delegates to the PipelineService's in-memory
 * mock store (it doesn't add behavior — it exists so server.js has one place
 * to swap in the real module). Use `bindPipelineModule(pipelineService, mod)`
 * once a PipelineModule instance is available.
 *
 * Expected `mod` surface (from the distributed-core handoff):
 *   trigger(pipelineId, definition, triggerPayload, triggeredBy) -> Promise<{runId}>
 *   getRun(runId) -> PipelineRun | null
 *   getHistory(runId, fromVersion) -> BusEvent[]
 *   resumeFromStep(runId, fromNodeId) -> Promise<void>
 *   resolveApproval(runId, stepId, userId, decision, comment?) -> Promise<void>
 *   deleteResource(runId) -> Promise<void>   // used as cancel
 */
function bindPipelineModule(pipelineService, mod) {
  if (!pipelineService) throw new Error('bindPipelineModule: pipelineService is required');
  if (!mod) return;
  pipelineService.setPipelineModule(mod);
  if (typeof mod.deleteResource === 'function') {
    pipelineService.setCancelHandler((runId) => mod.deleteResource(runId));
  }
  if (typeof mod.resolveApproval === 'function') {
    pipelineService.setResolveApprovalHandler((runId, stepId, userId, decision, comment) =>
      mod.resolveApproval(runId, stepId, userId, decision, comment),
    );
  }
}

module.exports = { PipelineBridge, bindPipelineModule };
