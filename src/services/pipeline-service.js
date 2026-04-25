// services/pipeline-service.js
/**
 * PipelineService — routes pipeline events between clients and the (future) distributed-core
 * PipelineModule.
 *
 * Phase 4 design: connects to the embedded PipelineModule via EventBus.subscribeAll and
 * projects BusEvents into `pipeline:event` frames delivered to channel subscribers.
 *   - `cancelHandler` will be wired to `PipelineModule.deleteResource(runId)`
 *   - `resolveApprovalHandler` will be wired to `PipelineModule.resolveApproval(...)`
 *
 * Phase 4 wiring contract:
 *   PipelineService.setResolveApprovalHandler((runId, stepId, userId, decision, comment?) => Promise)
 * Frontend wire format:
 *   { service: 'pipeline', action: 'resolveApproval', runId, stepId, decision, comment?, decidedBy, correlationId }
 *   where decidedBy is the user id of the approver (mapped to userId at the gateway boundary).
 *
 * Phase 4 status: every action (subscribe, unsubscribe, trigger, cancel,
 * resolveApproval, resumeFromStep, getRun, getHistory) is implemented. When a
 * PipelineModule is registered (via `setPipelineModule`), it owns execution.
 * Without one, the service uses an in-memory mock store + a synthesized event
 * lifecycle so the frontend exercises the full WS round-trip (see
 * `_mockTrigger`). Cancel and resolveApproval also fall back to local
 * event-source emits when no handler is wired.
 *
 * See PIPELINES_PLAN.md §14 for the full WebSocket protocol.
 *
 * Client → server:
 *   { service: 'pipeline', action: 'subscribe'|'unsubscribe', channel }
 *   { service: 'pipeline', action: 'trigger'|'cancel'|'resolveApproval'|'resumeFromStep'|
 *                                  'getRun'|'getHistory', ...payload, correlationId? }
 *
 * Channels:
 *   pipeline:run:{runId}  — all events for one run
 *   pipeline:all          — every pipeline event (observability)
 *   pipeline:approvals    — approval.requested / approval.recorded only
 */
class PipelineService {
  static CHANNEL_PREFIXES = ['pipeline:run:', 'pipeline:all', 'pipeline:approvals'];
  static MAX_CHANNEL_LENGTH = 100;

  constructor(messageRouter, logger, metricsCollector = null, options = {}) {
    this.messageRouter = messageRouter;
    this.logger = logger;
    this.metricsCollector = metricsCollector;
    this.clientChannels = new Map(); // clientId -> Set of channelIds
    // Phase 1: optional reference to the gateway pipelineEventSource
    // (an EventEmitter). Used by the dev-only `test-emit` action to fan
    // synthetic events through the same bridge path as production events,
    // and by the pluggable cancel/resolveApproval fallbacks below.
    this.eventSource = options.eventSource || null;
    // Phase 4 handlers: will be wired to distributed-core PipelineModule methods.
    // Until set, cancel/resolveApproval use the local event-source fallback.
    this.cancelHandler = options.cancelHandler || null;
    this.resolveApprovalHandler = options.resolveApprovalHandler || null;
    // Phase 4 PipelineModule shim: object exposing
    //   trigger(pipelineId, definition, triggerPayload, triggeredBy) -> Promise<{runId}>
    //   getRun(runId) -> PipelineRun | null
    //   getHistory(runId, fromVersion) -> BusEvent[]
    //   resumeFromStep(runId, fromNodeId) -> Promise<void>
    // When unset, the gateway uses an in-memory map + synthetic events as a dev shim.
    this.pipelineModule = options.pipelineModule || null;
  }

  /**
   * Wire a PipelineModule (from distributed-core, or the in-process mock shim
   * created by pipeline-bridge). Forwards trigger / getRun / getHistory /
   * resumeFromStep when set; otherwise the dev fallbacks below kick in.
   */
  setPipelineModule(mod) {
    this.pipelineModule = mod;
  }

  /**
   * Wire a pipeline event source (typically the same EventEmitter that backs
   * PipelineBridge) so development-only actions like `test-emit` can inject
   * synthetic events. Called from server.js after both are created.
   */
  setEventSource(source) {
    this.eventSource = source;
  }

  /**
   * Register the cancel handler. In Phase 4 this wraps
   * `PipelineModule.deleteResource(runId)`. Without a handler, cancel falls
   * back to emitting `pipeline.run.cancelled` on the local event source so
   * the frontend still receives a cancelled event end-to-end.
   */
  setCancelHandler(fn) {
    this.cancelHandler = fn;
  }

  /**
   * Register the resolveApproval handler. In Phase 4 this wraps
   * `PipelineModule.resolveApproval(runId, stepId, userId, decision, comment?)`.
   * Without a handler, resolveApproval falls back to emitting
   * `pipeline.approval.recorded` on the local event source so the frontend
   * receives a recorded event end-to-end.
   *
   * Expected positional signature:
   *   fn(runId: string, stepId: string, userId: string, decision: 'approve'|'reject', comment?: string) => Promise<void>
   *
   * Note: the wire format uses `decidedBy` for the approver; the gateway maps
   * `decidedBy → userId` at this boundary before invoking the handler.
   */
  setResolveApprovalHandler(fn) {
    this.resolveApprovalHandler = fn;
  }

  /**
   * Dispatch an incoming action to its handler. Unknown actions reply with an error frame.
   */
  async handleAction(clientId, action, data) {
    try {
      switch (action) {
        case 'subscribe':
          return await this.handleSubscribe(clientId, data);
        case 'unsubscribe':
          return await this.handleUnsubscribe(clientId, data);
        case 'cancel':
          return await this.handleCancel(clientId, data);
        case 'resolveApproval':
          return await this.handleResolveApproval(clientId, data);
        case 'trigger':
          return await this.handleTrigger(clientId, data);
        case 'resumeFromStep':
          return await this.handleResumeFromStep(clientId, data);
        case 'getRun':
          return await this.handleGetRun(clientId, data);
        case 'getHistory':
          return await this.handleGetHistory(clientId, data);
        case 'test-emit':
          return this.handleTestEmit(clientId, data);
        case 'sim-emit':
          return this.handleSimEmit(clientId, data);
        default:
          this.sendError(clientId, `Unknown pipeline action: ${action}`);
      }
    } catch (error) {
      this.logger.error(`Error handling pipeline action ${action} for client ${clientId}:`, error);
      this.sendError(clientId, 'Internal server error');
    }
  }

  /**
   * Subscribe a client to a pipeline channel. Valid formats:
   *   - pipeline:run:{runId}
   *   - pipeline:all
   *   - pipeline:approvals
   */
  async handleSubscribe(clientId, { channel }) {
    if (!this._isValidChannel(channel)) {
      this.sendError(clientId, 'channel is required (pipeline:run:{runId} | pipeline:all | pipeline:approvals)');
      return;
    }

    await this.messageRouter.subscribeToChannel(clientId, channel);

    if (!this.clientChannels.has(clientId)) {
      this.clientChannels.set(clientId, new Set());
    }
    this.clientChannels.get(clientId).add(channel);

    this.sendToClient(clientId, {
      type: 'pipeline',
      action: 'subscribed',
      channel,
      timestamp: new Date().toISOString(),
    });

    this.logger.info(`Client ${clientId} subscribed to pipeline channel ${channel}`);
  }

  /**
   * Unsubscribe a client from a previously-subscribed pipeline channel.
   */
  async handleUnsubscribe(clientId, { channel }) {
    if (!channel) {
      this.sendError(clientId, 'channel is required');
      return;
    }

    await this.messageRouter.unsubscribeFromChannel(clientId, channel);

    const channels = this.clientChannels.get(clientId);
    if (channels) {
      channels.delete(channel);
      if (channels.size === 0) {
        this.clientChannels.delete(clientId);
      }
    }

    this.sendToClient(clientId, {
      type: 'pipeline',
      action: 'unsubscribed',
      channel,
      timestamp: new Date().toISOString(),
    });

    this.logger.info(`Client ${clientId} unsubscribed from pipeline channel ${channel}`);
  }

  /**
   * Trigger a pipeline run. Delegates to the registered PipelineModule when one
   * exists; otherwise falls back to a synthetic in-memory run that fans
   * `pipeline.run.started` + `pipeline.run.completed` events through the local
   * event source so the frontend exercises the full WS path end-to-end.
   *
   * Wire shape: { service:'pipeline', action:'trigger', pipelineId, definition?,
   *               triggerPayload?, triggeredBy?, correlationId? }
   * Reply:      { type:'pipeline:ack', action:'trigger', runId, correlationId }
   */
  async handleTrigger(clientId, data) {
    const { pipelineId, definition, triggerPayload, triggeredBy, correlationId } = data || {};
    if (!pipelineId) {
      return this.sendError(clientId, 'trigger requires pipelineId', correlationId);
    }
    try {
      let runId;
      if (this.pipelineModule && typeof this.pipelineModule.trigger === 'function') {
        const result = await this.pipelineModule.trigger(
          pipelineId,
          definition,
          triggerPayload,
          triggeredBy,
        );
        runId = result?.runId || result?.id;
      } else {
        runId = this._mockTrigger({ pipelineId, definition, triggerPayload, triggeredBy });
      }
      this.sendToClient(clientId, {
        type: 'pipeline:ack',
        action: 'trigger',
        runId,
        correlationId,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      this.logger.error('[pipeline] trigger failed', { pipelineId, error: err?.message || err });
      this.sendError(clientId, `trigger failed: ${err?.message || err}`, correlationId);
    }
  }

  /**
   * Resume a paused / failed run from a specific node. Delegates to the
   * PipelineModule when registered; without one, emits the
   * `pipeline.run.resumeFromStep` event onto the local source so subscribers
   * still observe the resume request.
   */
  async handleResumeFromStep(clientId, data) {
    const { runId, fromNodeId, correlationId } = data || {};
    if (!runId || !fromNodeId) {
      return this.sendError(clientId, 'resumeFromStep requires runId + fromNodeId', correlationId);
    }
    try {
      if (this.pipelineModule && typeof this.pipelineModule.resumeFromStep === 'function') {
        await this.pipelineModule.resumeFromStep(runId, fromNodeId);
      } else if (this.eventSource && typeof this.eventSource.emit === 'function') {
        this.eventSource.emit('event', {
          eventType: 'pipeline.run.resumeFromStep',
          payload: { runId, fromNodeId, at: new Date().toISOString() },
          seq: 0,
          sourceNodeId: 'gateway-local',
          emittedAt: Date.now(),
        });
      } else {
        return this.sendError(clientId, 'resumeFromStep not wired', correlationId);
      }
      this.sendToClient(clientId, {
        type: 'pipeline:ack',
        action: 'resumeFromStep',
        runId,
        correlationId,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      this.logger.error('[pipeline] resumeFromStep failed', { runId, error: err?.message || err });
      this.sendError(clientId, `resumeFromStep failed: ${err?.message || err}`, correlationId);
    }
  }

  /**
   * Reply with a `pipeline:snapshot` frame containing the current run state.
   * Falls back to the in-memory mock store when no PipelineModule is wired.
   */
  async handleGetRun(clientId, data) {
    const { runId, correlationId } = data || {};
    if (!runId) {
      return this.sendError(clientId, 'getRun requires runId', correlationId);
    }
    try {
      let run = null;
      if (this.pipelineModule && typeof this.pipelineModule.getRun === 'function') {
        run = await this.pipelineModule.getRun(runId);
      } else {
        run = this._mockGetRun(runId);
      }
      this.sendToClient(clientId, {
        type: 'pipeline:snapshot',
        runId,
        run,
        correlationId,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      this.logger.error('[pipeline] getRun failed', { runId, error: err?.message || err });
      this.sendError(clientId, `getRun failed: ${err?.message || err}`, correlationId);
    }
  }

  /**
   * Reply with a `pipeline:history` frame containing BusEvents from a given
   * version onward. Used by the frontend to replay state after a reconnect.
   */
  async handleGetHistory(clientId, data) {
    const { runId, fromVersion, correlationId } = data || {};
    if (!runId) {
      return this.sendError(clientId, 'getHistory requires runId', correlationId);
    }
    const from = typeof fromVersion === 'number' ? fromVersion : 0;
    try {
      let events = [];
      if (this.pipelineModule && typeof this.pipelineModule.getHistory === 'function') {
        events = (await this.pipelineModule.getHistory(runId, from)) || [];
      } else {
        events = this._mockGetHistory(runId, from);
      }
      this.sendToClient(clientId, {
        type: 'pipeline:history',
        runId,
        fromVersion: from,
        events,
        correlationId,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      this.logger.error('[pipeline] getHistory failed', { runId, error: err?.message || err });
      this.sendError(clientId, `getHistory failed: ${err?.message || err}`, correlationId);
    }
  }

  // ---------------------------------------------------------------------------
  // In-memory mock store — used when no PipelineModule is wired (Phase 4 dev).
  // Each mock run synthesizes started → step.started → step.completed →
  // run.completed events on a short timer so the frontend's full WS path is
  // exercisable without distributed-core embedded.
  // ---------------------------------------------------------------------------

  _ensureMockStore() {
    if (!this._mockRuns) this._mockRuns = new Map();
    if (!this._mockHistory) this._mockHistory = new Map();
  }

  _mockTrigger({ pipelineId, definition, triggerPayload, triggeredBy }) {
    this._ensureMockStore();
    const runId = `mock-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const startedAt = new Date().toISOString();
    const trigger = triggeredBy || { userId: 'unknown', triggerType: 'manual' };
    const run = {
      id: runId,
      pipelineId,
      pipelineVersion: definition?.version ?? 0,
      status: 'running',
      triggeredBy: trigger,
      ownerNodeId: 'gateway-mock',
      startedAt,
      currentStepIds: [],
      steps: {},
      context: triggerPayload || {},
    };
    this._mockRuns.set(runId, run);
    this._mockHistory.set(runId, []);
    this._emitMock(runId, 'pipeline.run.started', {
      runId, pipelineId, triggeredBy: trigger, at: startedAt,
    });

    // Synthesize a tiny lifecycle on a short timer so the frontend sees a
    // realistic event sequence end-to-end. Real execution comes from the
    // distributed-core PipelineModule once embedded.
    const triggerNode = (definition?.nodes || []).find((n) => n?.data?.type === 'trigger');
    const stepNode = (definition?.nodes || []).find((n) => n?.data?.type !== 'trigger') || triggerNode;
    const stepId = stepNode?.id || 'step-1';
    const nodeType = stepNode?.data?.type || 'transform';
    setTimeout(() => {
      const at = new Date().toISOString();
      this._emitMock(runId, 'pipeline.step.started', { runId, stepId, nodeType, at });
    }, 25);
    setTimeout(() => {
      const at = new Date().toISOString();
      this._emitMock(runId, 'pipeline.step.completed', { runId, stepId, durationMs: 25, at });
    }, 60);
    setTimeout(() => {
      const at = new Date().toISOString();
      const stored = this._mockRuns.get(runId);
      if (stored) {
        stored.status = 'completed';
        stored.completedAt = at;
        stored.durationMs = 100;
      }
      this._emitMock(runId, 'pipeline.run.completed', { runId, durationMs: 100, at });
    }, 100);

    return runId;
  }

  _emitMock(runId, eventType, payload) {
    const history = this._mockHistory.get(runId) || [];
    const seq = history.length;
    const envelope = {
      eventType,
      payload,
      seq,
      sourceNodeId: 'gateway-mock',
      emittedAt: Date.now(),
      version: seq, // BusEvent.version mirrors seq for the mock shim
    };
    history.push(envelope);
    this._mockHistory.set(runId, history);
    if (this.eventSource && typeof this.eventSource.emit === 'function') {
      this.eventSource.emit('event', envelope);
    }
  }

  _mockGetRun(runId) {
    this._ensureMockStore();
    return this._mockRuns.get(runId) || null;
  }

  _mockGetHistory(runId, fromVersion) {
    this._ensureMockStore();
    const history = this._mockHistory.get(runId) || [];
    return history.filter((e) => e.seq >= fromVersion);
  }

  /**
   * Cancel a running pipeline. Phase 4 will wire `this.cancelHandler` to
   * `PipelineModule.deleteResource(runId)`. In Phase 1 (no handler set), this
   * falls back to synthesizing a `pipeline.run.cancelled` event on the local
   * event source so the frontend (via PipelineBridge → EventStreamContext)
   * receives the cancel end-to-end without the real distributed-core wiring.
   */
  async handleCancel(clientId, data) {
    const { runId, correlationId } = data || {};
    if (!runId) {
      return this.sendError(clientId, 'cancel requires runId', correlationId);
    }

    try {
      if (this.cancelHandler) {
        await this.cancelHandler(runId);
        this.logger.info('[pipeline] cancel dispatched to handler', { runId, correlationId });
      } else if (this.eventSource && typeof this.eventSource.emit === 'function') {
        // Phase 1 dev fallback: synthesize the cancelled event locally so the
        // bridge fans it out over pipeline:all and pipeline:run:{runId}.
        this.eventSource.emit('event', {
          eventType: 'pipeline.run.cancelled',
          payload: { runId, at: new Date().toISOString() },
          seq: 0,
          sourceNodeId: 'gateway-local',
          emittedAt: Date.now(),
        });
        this.logger.info('[pipeline] cancel emitted via local event source (no handler yet)', { runId, correlationId });
      } else {
        return this.sendError(clientId, 'cancel not wired — no handler or event source', correlationId);
      }

      this.sendToClient(clientId, {
        type: 'pipeline:ack',
        action: 'cancel',
        runId,
        correlationId,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      this.logger.error('[pipeline] cancel failed', { runId, error: err?.message || err });
      this.sendError(clientId, `cancel failed: ${err?.message || err}`, correlationId);
    }
  }

  /**
   * Resolve an approval request (approve/reject). Phase 4 will wire
   * `this.resolveApprovalHandler` to `PipelineModule.resolveApproval(...)`.
   * In Phase 1 (no handler set), this falls back to synthesizing a
   * `pipeline.approval.recorded` event on the local event source so the
   * frontend observes the decision being recorded end-to-end.
   */
  async handleResolveApproval(clientId, data) {
    const { runId, stepId, decision, comment, decidedBy, correlationId } = data || {};
    if (!runId || !stepId) {
      return this.sendError(clientId, 'resolveApproval requires runId + stepId', correlationId);
    }
    if (decision !== 'approve' && decision !== 'reject') {
      return this.sendError(clientId, 'resolveApproval decision must be "approve" or "reject"', correlationId);
    }
    try {
      if (this.resolveApprovalHandler) {
        // Phase 4: Map decidedBy (wire field) → userId (module param).
        await this.resolveApprovalHandler(runId, stepId, decidedBy, decision, comment);
        this.logger.info('[pipeline] resolveApproval dispatched to handler', {
          runId, stepId, decision, correlationId,
        });
      } else if (this.eventSource && typeof this.eventSource.emit === 'function') {
        // Phase 1 fallback — emit the recorded event locally for the frontend.
        this.eventSource.emit('event', {
          eventType: 'pipeline.approval.recorded',
          payload: {
            runId,
            stepId,
            userId: decidedBy,
            decision,
            comment,
            at: new Date().toISOString(),
          },
          seq: 0,
          sourceNodeId: 'gateway-local',
          emittedAt: Date.now(),
        });
        this.logger.info('[pipeline] resolveApproval emitted via local event source (no handler yet)', {
          runId, stepId, decision, correlationId,
        });
      } else {
        return this.sendError(clientId, 'resolveApproval not wired', correlationId);
      }
      this.sendToClient(clientId, {
        type: 'pipeline:ack',
        action: 'resolveApproval',
        runId,
        stepId,
        correlationId,
        timestamp: Date.now(),
      });
    } catch (err) {
      this.logger.error('[pipeline] resolveApproval failed', { runId, stepId, error: err?.message || err });
      this.sendError(clientId, `resolveApproval failed: ${err?.message ?? err}`, correlationId);
    }
  }

  /**
   * Phase 4 integration point: called by the pipeline-bridge when the embedded
   * PipelineModule's EventBus emits a BusEvent. Broadcasts a `pipeline:event` frame
   * (shape: see PIPELINES_PLAN.md §14.3) to all subscribers of the given channel.
   */
  async emitEvent(channel, eventType, payload) {
    if (!channel || !eventType) {
      this.logger.warn('[pipeline] emitEvent called with missing channel/eventType', { channel, eventType });
      return;
    }

    const frame = {
      type: 'pipeline:event',
      eventType,
      payload,
      channel,
    };

    if (this.messageRouter) {
      try {
        await this.messageRouter.sendToChannel(channel, frame);
      } catch (err) {
        this.logger.error(`[pipeline] Failed to broadcast event to ${channel}:`, err.message);
      }
    } else {
      this._broadcastToLocalSubscribers(channel, frame);
    }
  }

  /**
   * Local-only fallback broadcast (used when no messageRouter is available, e.g. tests).
   */
  _broadcastToLocalSubscribers(channel, message) {
    for (const [subscriberClientId, channels] of this.clientChannels) {
      if (channels.has(channel)) {
        this.sendToClient(subscriberClientId, message);
      }
    }
  }

  /**
   * Validates that a channel string matches one of the allowed pipeline channel formats.
   */
  _isValidChannel(channel) {
    if (!channel || typeof channel !== 'string') return false;
    if (channel.length === 0 || channel.length > PipelineService.MAX_CHANNEL_LENGTH) return false;
    if (channel === 'pipeline:all' || channel === 'pipeline:approvals') return true;
    if (channel.startsWith('pipeline:run:') && channel.length > 'pipeline:run:'.length) return true;
    return false;
  }

  /**
   * Cleanup on client disconnect — unsubscribes from all tracked channels.
   */
  async handleDisconnect(clientId) {
    const channels = this.clientChannels.get(clientId);
    if (channels) {
      for (const channel of channels) {
        try {
          await this.messageRouter.unsubscribeFromChannel(clientId, channel);
        } catch (error) {
          this.logger.error(`Error unsubscribing client ${clientId} from pipeline channel ${channel}:`, error);
        }
      }
      this.clientChannels.delete(clientId);
    }
    this.logger.debug(`Client ${clientId} disconnected from pipeline service`);
  }

  sendToClient(clientId, message) {
    if (this.messageRouter) {
      this.messageRouter.sendToClient(clientId, message);
    }
  }

  sendError(clientId, message, correlationId) {
    this.sendToClient(clientId, {
      type: 'error',
      service: 'pipeline',
      message,
      ...(correlationId ? { correlationId } : {}),
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Dev-only action: inject a synthetic event into the configured event source
   * so it fans out through PipelineBridge exactly like a real pipeline event.
   *
   * Gated by `DCORE_ENABLE_TEST_EMIT=1` (defensive — not enabled in production).
   * Payload shape (from client):
   *   { service: 'pipeline', action: 'test-emit',
   *     eventType: 'pipeline.webhook.triggered',
   *     payload: { ...arbitrary }, correlationId? }
   */
  handleTestEmit(clientId, data) {
    if (process.env.DCORE_ENABLE_TEST_EMIT !== '1') {
      return this.sendError(clientId, 'test_emit_disabled', data?.correlationId);
    }
    const eventType = data?.eventType;
    if (!eventType || typeof eventType !== 'string') {
      return this.sendError(clientId, 'eventType is required', data?.correlationId);
    }
    if (!this.eventSource || typeof this.eventSource.emit !== 'function') {
      return this.sendError(clientId, 'event_source_unavailable', data?.correlationId);
    }
    try {
      this.eventSource.emit('event', { eventType, payload: data?.payload ?? {} });
    } catch (err) {
      this.logger.error('[pipeline] test-emit failed', err?.message || err);
      return this.sendError(clientId, 'test_emit_failed', data?.correlationId);
    }
    this.sendToClient(clientId, {
      type: 'pipeline',
      action: 'test-emit:ok',
      eventType,
      correlationId: data?.correlationId,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Dev-only simulator: fan a fully-shaped PipelineWireEvent (eventType,
   * payload, seq, sourceNodeId, emittedAt) through the configured event source
   * so the frontend can be exercised against "remote-like" events without the
   * real distributed-core PipelineModule wired up.
   *
   * Differs from `test-emit` in that it always stamps seq/sourceNodeId/
   * emittedAt — matching the production wire envelope — and replies with a
   * `pipeline:ack` frame rather than a legacy `pipeline`/`test-emit:ok` frame.
   *
   * Gated by `DCORE_ENABLE_TEST_EMIT=1` (same env flag — defensive; never on
   * in production).
   */
  async handleSimEmit(clientId, data) {
    if (process.env.DCORE_ENABLE_TEST_EMIT !== '1') {
      return this.sendError(clientId, 'sim-emit disabled (set DCORE_ENABLE_TEST_EMIT=1)', data?.correlationId);
    }
    const { eventType, payload } = data || {};
    if (!eventType) return this.sendError(clientId, 'sim-emit requires eventType', data?.correlationId);
    if (!this.eventSource) return this.sendError(clientId, 'sim-emit needs event source', data?.correlationId);
    this.eventSource.emit('event', {
      eventType,
      payload: payload ?? {},
      seq: (data?.seq ?? 0),
      sourceNodeId: 'sim',
      emittedAt: Date.now(),
    });
    this.sendToClient(clientId, {
      type: 'pipeline:ack',
      action: 'sim-emit',
      correlationId: data?.correlationId,
    });
  }

  getStats() {
    return {
      subscribedClients: this.clientChannels.size,
      totalSubscriptions: Array.from(this.clientChannels.values())
        .reduce((sum, set) => sum + set.size, 0),
    };
  }
}

module.exports = PipelineService;
