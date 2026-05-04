// pipeline-bridge/pipeline-bridge.js
/**
 * PipelineBridge — subscribes to a pipeline event source and forwards each
 * event over the gateway's WebSocket via PipelineService.emitEvent.
 *
 * Phase 1 (current): `eventSource` is a plain Node EventEmitter that emits
 *   `'event'` with payload `{ eventType, payload }` (or already-shaped
 *   `PipelineWireEvent` from the dev simulator).
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

// Token-rate ring buffer constants (see Part 1, Phase 4 wiring prep).
// 5000 entries ~= 2 minutes at 40 tok/s — enough for the 1s/10s/60s windows.
const TOKEN_RING_CAPACITY = 5000;
const TOKEN_EVENT_TYPE = 'pipeline.llm.token';

// Inter-token-arrival histogram bucket upper bounds (ms, exclusive on right
// except the last which is a catch-all). Chosen to cover the realistic range
// for LLM token deltas: the first few buckets zero in on healthy streaming
// (<50ms), the mid buckets surface first-token / stall signatures, and the
// 1000+ bucket catches anything pathological. Keep in sync with the
// BUCKET_LABELS array used for log output.
const INTER_TOKEN_BUCKETS_MS = [10, 25, 50, 100, 250, 500, 1000, Infinity];
const INTER_TOKEN_BUCKET_LABELS = [
  '0-10ms',
  '10-25ms',
  '25-50ms',
  '50-100ms',
  '100-250ms',
  '250-500ms',
  '500-1000ms',
  '1000+ms',
];

// Terminal run-event types that should flush the histogram for a runId.
const TERMINAL_RUN_EVENTS = new Set([
  'pipeline.run.completed',
  'pipeline.run.failed',
  'pipeline.run.cancelled',
]);

// Interpretation thresholds for the per-run histogram summary. Tuned against
// the "steady stream ≈ 40 tok/s" assumption; tighten once real histogram data
// is available.
const STEADY_MEDIAN_MAX_MS = 25;
const STEADY_P95_MAX_MS = 100;
const BURSTY_MEDIAN_MIN_MS = 100;
const BURSTY_P95_MIN_MS = 500;

/**
 * True when `o` looks like a distributed-core `BusEvent<T>`:
 *   { id, type, payload, timestamp, sourceNodeId, version }
 * Distinguished from an already-shaped PipelineWireEvent (which uses
 * `eventType` + `emittedAt` and has no `version`).
 *
 * @param {*} o
 * @returns {boolean}
 */
function isBusEvent(o) {
  return !!(
    o &&
    typeof o === 'object' &&
    typeof o.type === 'string' &&
    o.version != null &&
    o.timestamp != null
  );
}

/**
 * Map a distributed-core `BusEvent<T>` to the gateway's `PipelineWireEvent`
 * envelope. Pure — no side effects.
 *
 *   BusEvent<T>:        { id, type, payload, timestamp, sourceNodeId, version }
 *   PipelineWireEvent:  { eventType, payload, seq, sourceNodeId, emittedAt }
 *
 * `id` is dropped (not on the wire). `version` carries the BusEvent monotonic
 * counter forward as `seq` so the frontend can dedupe / detect gaps. Colon-form
 * `type` (distributed-core's native style, e.g. `pipeline:run:started`) is
 * canonicalized to dot-form so downstream constants like `TERMINAL_RUN_EVENTS`
 * and `eventType.startsWith('pipeline.approval.')` match.
 *
 * @param {{ id?: string, type: string, payload: any, timestamp: number, sourceNodeId?: string, version: number }} busEvent
 * @returns {{ eventType: string, payload: any, seq: number, sourceNodeId: string|undefined, emittedAt: number }}
 */
function mapBusEventToWireEvent(busEvent) {
  return {
    eventType: typeof busEvent.type === 'string' ? busEvent.type.replace(/:/g, '.') : busEvent.type,
    payload: busEvent.payload,
    seq: busEvent.version,
    sourceNodeId: busEvent.sourceNodeId,
    emittedAt: busEvent.timestamp,
  };
}

/**
 * Nearest-rank percentile over an ascending-sorted numeric array. Returns 0
 * for an empty input. `q` is a fraction in [0, 1].
 *
 * Used for histogram median/p95 reporting — kept simple (no interpolation) so
 * results are stable and easy to reason about.
 *
 * @param {number[]} sorted ascending
 * @param {number} q
 * @returns {number}
 */
function percentile(sorted, q) {
  if (!sorted.length) return 0;
  if (q <= 0) return sorted[0];
  if (q >= 1) return sorted[sorted.length - 1];
  const rank = Math.ceil(q * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(sorted.length - 1, rank))];
}

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
   * @param {object} [opts.backpressureController]
   *   Optional distributed-core BackpressureController instance. When provided,
   *   the bridge subscribes to `bp.dropped.count` events and accumulates
   *   drop stats. When absent, backpressure stats simply stay at zero —
   *   real wiring is a Phase 4 concern (see README §Backpressure).
   */
  constructor({ eventSource, pipelineService, logger, backpressureController } = {}) {
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

    // Timestamp (ms since epoch) of the most recent event relayed by the bridge.
    // Exposed via getLastEventAt() for the health endpoint.
    this._lastEventAt = null;

    // Token-rate sliding-window ring buffer. Each entry is the Date.now() ms
    // timestamp of a `pipeline.llm.token` event observed by the bridge.
    // Fixed-size circular buffer to avoid unbounded growth under load.
    this._tokenRingCap = TOKEN_RING_CAPACITY;
    this._tokenRing = new Array(this._tokenRingCap);
    this._tokenRingHead = 0; // next write position
    this._tokenRingSize = 0; // current number of valid entries (<= cap)
    this._tokenRateTimer = null;

    // Inter-token-arrival histogram state. Keyed by runId so concurrent runs
    // don't pollute each other. Each entry tracks:
    //   lastTs  — timestamp of the previous token for this run (ms)
    //   buckets — per-bucket count (length = INTER_TOKEN_BUCKETS_MS.length)
    //   gaps    — full list of gap samples for median/p95/max
    //   total   — total gap count (== gaps.length)
    //   maxGap  — running max (kept separately so a future bounded-sample
    //             strategy doesn't lose the observed maximum)
    // Entries are evicted when a terminal run event fires for that runId.
    this._interTokenByRun = new Map();

    // Backpressure: wire optional controller. Phase 4 will pass a real
    // distributed-core BackpressureController — today this is usually null.
    // TODO(phase-4): When distributed-core lands, verify the constructor
    // signature matches `{ maxQueueSize, strategy }` and that the event name
    // is `'bp.dropped.count'` with payload `{ count, strategy, key }`. Adjust
    // here if either drifted.
    this._backpressureController = backpressureController || null;
    this._backpressureTotalDropped = 0;
    this._backpressureByStrategy = Object.create(null);
    this._backpressureDropHandler = null;
    if (this._backpressureController && typeof this._backpressureController.on === 'function') {
      this._backpressureDropHandler = (evt) => this._handleBackpressureDrop(evt);
      this._backpressureController.on('bp.dropped.count', this._backpressureDropHandler);
    }
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
      const unsub = this.eventSource.subscribeAll((arg1, arg2) => {
        // Phase 4 distributed-core delivers a single BusEvent<T> argument.
        // Phase 1 callers may invoke (eventType, payload). Handle both.
        if (isBusEvent(arg1)) {
          this._handleEvent(mapBusEventToWireEvent(arg1));
        } else {
          this._handleEvent({ eventType: arg1, payload: arg2 });
        }
      });
      this._unsubscribe = typeof unsub === 'function' ? unsub : null;
    } else if (typeof this.eventSource.on === 'function') {
      this.eventSource.on('event', this._boundHandler);
    } else {
      throw new Error(
        'PipelineBridge: eventSource must expose subscribeAll(handler) or on(event, handler)'
      );
    }

    // Token-rate reporter. Logs once per second; suppressed when fully idle.
    // unref() so a forgotten bridge doesn't keep Jest/Node alive.
    this._tokenRateTimer = setInterval(() => this._reportTokenRate(), 1000);
    if (typeof this._tokenRateTimer.unref === 'function') {
      this._tokenRateTimer.unref();
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

    if (this._tokenRateTimer) {
      clearInterval(this._tokenRateTimer);
      this._tokenRateTimer = null;
    }

    // Detach backpressure listener if one was attached. Missing `.off` is not
    // fatal — just log at debug (controller may already be torn down).
    if (this._backpressureController && this._backpressureDropHandler) {
      try {
        if (typeof this._backpressureController.off === 'function') {
          this._backpressureController.off('bp.dropped.count', this._backpressureDropHandler);
        } else if (typeof this._backpressureController.removeListener === 'function') {
          this._backpressureController.removeListener(
            'bp.dropped.count',
            this._backpressureDropHandler,
          );
        }
      } catch (err) {
        this.logger.debug?.(
          '[pipeline-bridge] error detaching backpressure listener',
          err?.message || err,
        );
      }
      this._backpressureDropHandler = null;
    }

    this._unsubscribe = null;
    this._started = false;
    this.logger.info?.('[pipeline-bridge] stopped');
  }

  /**
   * Internal: fan out a single bus event to the appropriate WS channels.
   * Accepts either a `PipelineWireEvent` (`{ eventType, payload, ... }`) or a
   * raw distributed-core `BusEvent` (`{ type, version, timestamp, ... }`),
   * normalizing the latter via `mapBusEventToWireEvent`.
   *
   * @param {{ eventType?: string, type?: string, payload?: object } & object} evt
   */
  _handleEvent(evt) {
    if (!evt || typeof evt !== 'object') {
      this.logger.warn?.('[pipeline-bridge] received malformed event (not an object)', evt);
      return;
    }

    // Normalize: if upstream emitted a raw BusEvent, map it to wire shape.
    if (!evt.eventType && isBusEvent(evt)) {
      evt = mapBusEventToWireEvent(evt);
    }

    const { eventType, payload } = evt;
    if (!eventType || typeof eventType !== 'string') {
      this.logger.warn?.('[pipeline-bridge] received event with missing/invalid eventType', evt);
      return;
    }

    // Stamp the most recent event time for the health endpoint.
    this._lastEventAt = Date.now();

    const safePayload = payload && typeof payload === 'object' ? payload : {};
    const runId = safePayload.runId;

    // Token-rate + inter-token accounting — record every llm.token event we
    // forward. The inter-token histogram is keyed by runId so concurrent runs
    // stay isolated; events without a runId only advance the global rate.
    if (eventType === TOKEN_EVENT_TYPE) {
      const now = Date.now();
      this._recordTokenEvent(now);
      if (runId) {
        this._recordInterTokenGap(runId, now);
      }
    }

    // Terminal run event — flush the histogram for this run (if any), log,
    // and evict the map entry so we don't leak memory across runs.
    if (runId && TERMINAL_RUN_EVENTS.has(eventType)) {
      this._finalizeInterTokenHistogram(runId);
    }

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
   * Public: ms-since-epoch timestamp of the most recent event relayed by the
   * bridge, or null if no events have been relayed yet. Used by the health
   * endpoint to surface `lastEventAt`.
   *
   * @returns {number | null}
   */
  getLastEventAt() {
    return this._lastEventAt;
  }

  /**
   * Public: snapshot of recent token-throughput windows, suitable for a future
   * health endpoint or `/metrics` projection.
   *
   * @returns {{ perSec1s: number, perSec10s: number, perSec60s: number, windowSize: number }}
   */
  getTokenRate() {
    const now = Date.now();
    const counts = this._countTokensInWindows(now, [1000, 10000, 60000]);
    return {
      perSec1s: counts[0] / 1,
      perSec10s: counts[1] / 10,
      perSec60s: counts[2] / 60,
      windowSize: this._tokenRingSize,
    };
  }

  /**
   * Internal: push a token event timestamp into the ring buffer.
   * @param {number} tsMs
   */
  _recordTokenEvent(tsMs) {
    this._tokenRing[this._tokenRingHead] = tsMs;
    this._tokenRingHead = (this._tokenRingHead + 1) % this._tokenRingCap;
    if (this._tokenRingSize < this._tokenRingCap) {
      this._tokenRingSize += 1;
    }
  }

  /**
   * Internal: count entries falling within each `windowMs` of `now`.
   * Returns counts in the same order as `windowsMs`.
   * @param {number} now
   * @param {number[]} windowsMs
   * @returns {number[]}
   */
  _countTokensInWindows(now, windowsMs) {
    const counts = new Array(windowsMs.length).fill(0);
    const cutoffs = windowsMs.map((w) => now - w);
    // Walk the valid portion of the ring. Cheap enough at cap=5000.
    for (let i = 0; i < this._tokenRingSize; i++) {
      // entries are at indices [head - size, head) mod cap
      const idx = (this._tokenRingHead - this._tokenRingSize + i + this._tokenRingCap) % this._tokenRingCap;
      const ts = this._tokenRing[idx];
      for (let w = 0; w < windowsMs.length; w++) {
        if (ts >= cutoffs[w]) counts[w] += 1;
      }
    }
    return counts;
  }

  /**
   * Internal: log token rates once per tick. Suppress when all windows are 0
   * to avoid spamming during idle periods.
   */
  _reportTokenRate() {
    const r = this.getTokenRate();
    if (r.perSec1s === 0 && r.perSec10s === 0 && r.perSec60s === 0) {
      return;
    }
    this.logger.info?.(
      `[pipeline-bridge] token-rate 1s=${r.perSec1s}ps 10s=${r.perSec10s}ps 60s=${r.perSec60s}ps (window=${r.windowSize}tok)`
    );
  }

  /**
   * Public: snapshot of the inter-token-arrival histogram for a given runId.
   * Returns `null` when no samples have been recorded yet for the run — useful
   * for health endpoints that want to skip unknown runs rather than report
   * empty data.
   *
   * @param {string} runId
   * @returns {{
   *   buckets: Array<{ label: string, count: number, pct: number }>,
   *   total: number,
   *   median: number,
   *   p95: number,
   *   max: number,
   * } | null}
   */
  getInterTokenHistogram(runId) {
    const entry = this._interTokenByRun.get(runId);
    if (!entry || entry.total === 0) return null;
    return this._summarizeInterTokenEntry(entry);
  }

  /**
   * Public: snapshot of bridge-lifetime backpressure-drop accounting.
   * Accumulates across the bridge's lifetime, never resets.
   *
   * @returns {{ totalDropped: number, byStrategy: Record<string, number> }}
   */
  getBackpressureStats() {
    // Defensive copy so callers can't mutate the internal map.
    return {
      totalDropped: this._backpressureTotalDropped,
      byStrategy: { ...this._backpressureByStrategy },
    };
  }

  /**
   * Internal: record a single inter-token gap for `runId`. First token for a
   * run seeds `lastTs` and produces no gap sample.
   *
   * @param {string} runId
   * @param {number} nowMs
   */
  _recordInterTokenGap(runId, nowMs) {
    let entry = this._interTokenByRun.get(runId);
    if (!entry) {
      entry = {
        lastTs: nowMs,
        buckets: new Array(INTER_TOKEN_BUCKETS_MS.length).fill(0),
        gaps: [],
        total: 0,
        maxGap: 0,
      };
      this._interTokenByRun.set(runId, entry);
      return;
    }

    const gap = nowMs - entry.lastTs;
    entry.lastTs = nowMs;
    if (gap < 0) return; // clock moved backwards — ignore.

    // Bucket assignment: first bucket whose upper bound is >= gap.
    for (let i = 0; i < INTER_TOKEN_BUCKETS_MS.length; i++) {
      if (gap < INTER_TOKEN_BUCKETS_MS[i]) {
        entry.buckets[i] += 1;
        break;
      }
    }

    entry.total += 1;
    if (gap > entry.maxGap) entry.maxGap = gap;
    // Keep full sample list for percentile calc. 100k samples ≈ 800KB —
    // acceptable for per-run tracking. If memory pressure appears, swap to a
    // reservoir sample or a fixed-bucket quantile estimator (t-digest).
    entry.gaps.push(gap);
  }

  /**
   * Internal: flush the per-run histogram — log a summary at info, log an
   * interpretation line, then evict the entry. Safe to call with no entry
   * (no-op) or an empty entry (no-op).
   *
   * @param {string} runId
   */
  _finalizeInterTokenHistogram(runId) {
    const entry = this._interTokenByRun.get(runId);
    if (!entry) return;

    // Always evict — even an empty entry shouldn't linger past a terminal.
    this._interTokenByRun.delete(runId);

    if (entry.total === 0) return;

    const summary = this._summarizeInterTokenEntry(entry);
    const header = `[pipeline-bridge] inter-token histogram for run ${runId}:`;
    const bucketLines = summary.buckets
      .filter((b) => b.count > 0)
      .map((b) => `  ${b.label.padEnd(11, ' ')}${String(b.count).padStart(4, ' ')} (${b.pct}%)`);
    const stats = `  median: ${summary.median}ms · p95: ${summary.p95}ms · max: ${summary.max}ms`;
    this.logger.info?.([header, ...bucketLines, stats].join('\n'));

    // One-line interpretation — threshold-driven, deterministic.
    if (summary.median < STEADY_MEDIAN_MAX_MS && summary.p95 < STEADY_P95_MAX_MS) {
      this.logger.info?.(
        '[pipeline-bridge] stream is steady — drop-oldest is appropriate',
      );
    } else if (summary.median > BURSTY_MEDIAN_MIN_MS || summary.p95 > BURSTY_P95_MIN_MS) {
      this.logger.info?.(
        '[pipeline-bridge] stream is bursty — consider reject strategy',
      );
    }
  }

  /**
   * Internal: compute bucket percentages, median, p95, max from a histogram
   * entry. Pure — does not mutate the entry.
   *
   * @param {{ buckets: number[], gaps: number[], total: number, maxGap: number }} entry
   * @returns {{
   *   buckets: Array<{ label: string, count: number, pct: number }>,
   *   total: number,
   *   median: number,
   *   p95: number,
   *   max: number,
   * }}
   */
  _summarizeInterTokenEntry(entry) {
    const total = entry.total;
    const buckets = entry.buckets.map((count, i) => ({
      label: INTER_TOKEN_BUCKET_LABELS[i],
      count,
      pct: total > 0 ? Math.round((count / total) * 100) : 0,
    }));

    // Sort a copy of the gap samples for percentile lookup. O(n log n) per
    // terminal event — fine even at 100k samples.
    const sorted = entry.gaps.slice().sort((a, b) => a - b);
    const median = percentile(sorted, 0.5);
    const p95 = percentile(sorted, 0.95);

    return {
      buckets,
      total,
      median,
      p95,
      max: entry.maxGap,
    };
  }

  /**
   * Internal: handle a `bp.dropped.count` event from a BackpressureController.
   * Accumulates the drop count, breaks down by strategy, and logs at warn
   * (drops are user-visible event loss — never silent).
   *
   * @param {{ count: number, strategy?: string, key?: string }} evt
   */
  _handleBackpressureDrop(evt) {
    if (!evt || typeof evt !== 'object') return;
    const count = Number(evt.count) || 0;
    if (count <= 0) return;
    const strategy = typeof evt.strategy === 'string' ? evt.strategy : 'unknown';
    const key = evt.key != null ? String(evt.key) : 'unknown';

    this._backpressureTotalDropped += count;
    this._backpressureByStrategy[strategy] =
      (this._backpressureByStrategy[strategy] || 0) + count;

    this.logger.warn?.(
      `[pipeline-bridge] backpressure dropped count=${count} strategy=${strategy} key=${key}`,
    );
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

module.exports = {
  PipelineBridge,
  bindPipelineModule,
  mapBusEventToWireEvent,
  isBusEvent,
};
