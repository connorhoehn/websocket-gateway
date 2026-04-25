// test/pipeline-bridge.test.js
/**
 * Coverage for the PipelineBridge fan-out + the bindPipelineModule helper that
 * wires a PipelineModule shim into a PipelineService. The real distributed-core
 * module isn't embedded yet — these tests pin the contract surface so the
 * Phase 4 swap-in stays drop-in.
 */

const EventEmitter = require('events');
const {
    PipelineBridge,
    bindPipelineModule,
    mapBusEventToWireEvent,
    isBusEvent,
} = require('../src/pipeline-bridge/pipeline-bridge');

class StubPipelineService {
    constructor() {
        this.emitted = [];
        this.module = null;
        this.cancelHandler = null;
        this.resolveApprovalHandler = null;
    }
    emitEvent(channel, eventType, payload) {
        this.emitted.push({ channel, eventType, payload });
    }
    setPipelineModule(mod) { this.module = mod; }
    setCancelHandler(fn) { this.cancelHandler = fn; }
    setResolveApprovalHandler(fn) { this.resolveApprovalHandler = fn; }
}

describe('PipelineBridge', () => {
    test('start() subscribes to EventEmitter source and fans events to channels', () => {
        const src = new EventEmitter();
        const ps = new StubPipelineService();
        const bridge = new PipelineBridge({ eventSource: src, pipelineService: ps });
        bridge.start();
        src.emit('event', {
            eventType: 'pipeline.run.started',
            payload: { runId: 'r1', pipelineId: 'p1' },
        });
        const channels = ps.emitted.map((e) => e.channel);
        expect(channels).toContain('pipeline:run:r1');
        expect(channels).toContain('pipeline:all');
        expect(channels).not.toContain('pipeline:approvals');
    });

    test('approval.* events fan to pipeline:approvals', () => {
        const src = new EventEmitter();
        const ps = new StubPipelineService();
        const bridge = new PipelineBridge({ eventSource: src, pipelineService: ps });
        bridge.start();
        src.emit('event', {
            eventType: 'pipeline.approval.requested',
            payload: { runId: 'r1', stepId: 's1' },
        });
        const channels = ps.emitted.map((e) => e.channel);
        expect(channels).toContain('pipeline:approvals');
    });

    test('stop() unsubscribes', () => {
        const src = new EventEmitter();
        const ps = new StubPipelineService();
        const bridge = new PipelineBridge({ eventSource: src, pipelineService: ps });
        bridge.start();
        bridge.stop();
        src.emit('event', { eventType: 'pipeline.run.started', payload: { runId: 'r1' } });
        expect(ps.emitted).toHaveLength(0);
    });

    test('subscribeAll path used when source exposes it', () => {
        let captured = null;
        const src = {
            subscribeAll(handler) { captured = handler; return () => { captured = null; }; },
        };
        const ps = new StubPipelineService();
        const bridge = new PipelineBridge({ eventSource: src, pipelineService: ps });
        bridge.start();
        captured('pipeline.run.started', { runId: 'r9', pipelineId: 'p9' });
        const channels = ps.emitted.map((e) => e.channel);
        expect(channels).toContain('pipeline:run:r9');
        expect(channels).toContain('pipeline:all');
    });
});

describe('bindPipelineModule', () => {
    test('wires module into pipelineService and adapts cancel/resolveApproval', () => {
        const ps = new StubPipelineService();
        const mod = {
            trigger: jest.fn(),
            getRun: jest.fn(),
            getHistory: jest.fn(),
            resumeFromStep: jest.fn(),
            deleteResource: jest.fn().mockResolvedValue(),
            resolveApproval: jest.fn().mockResolvedValue(),
        };
        bindPipelineModule(ps, mod);
        expect(ps.module).toBe(mod);
        expect(typeof ps.cancelHandler).toBe('function');
        expect(typeof ps.resolveApprovalHandler).toBe('function');

        ps.cancelHandler('r1');
        expect(mod.deleteResource).toHaveBeenCalledWith('r1');

        ps.resolveApprovalHandler('r1', 's1', 'u', 'approve', 'note');
        expect(mod.resolveApproval).toHaveBeenCalledWith('r1', 's1', 'u', 'approve', 'note');
    });

    test('no-ops when module is null', () => {
        const ps = new StubPipelineService();
        expect(() => bindPipelineModule(ps, null)).not.toThrow();
        expect(ps.module).toBeNull();
    });

    test('throws when pipelineService is missing', () => {
        expect(() => bindPipelineModule(null, {})).toThrow(/pipelineService/);
    });
});

describe('mapBusEventToWireEvent', () => {
    test('produces the right shape from a sample BusEvent', () => {
        const busEvent = {
            id: 'evt-abc-123',
            type: 'pipeline.run.started',
            payload: { runId: 'r1', pipelineId: 'p1' },
            timestamp: 1714000000000,
            sourceNodeId: 'node-a',
            version: 7,
        };
        const wire = mapBusEventToWireEvent(busEvent);
        expect(wire).toEqual({
            eventType: 'pipeline.run.started',
            payload: { runId: 'r1', pipelineId: 'p1' },
            seq: 7,
            sourceNodeId: 'node-a',
            emittedAt: 1714000000000,
        });
        expect(wire).not.toHaveProperty('id');
        expect(wire).not.toHaveProperty('type');
        expect(wire).not.toHaveProperty('version');
        expect(wire).not.toHaveProperty('timestamp');
    });
});

describe('isBusEvent', () => {
    test('returns true for a well-formed BusEvent', () => {
        expect(
            isBusEvent({
                id: 'x',
                type: 'pipeline.run.started',
                payload: {},
                timestamp: Date.now(),
                sourceNodeId: 'n',
                version: 0,
            }),
        ).toBe(true);
    });

    test('returns false for a PipelineWireEvent shape', () => {
        expect(
            isBusEvent({
                eventType: 'pipeline.run.started',
                payload: {},
                seq: 0,
                sourceNodeId: 'n',
                emittedAt: Date.now(),
            }),
        ).toBe(false);
    });

    test('returns false for null/undefined/non-objects', () => {
        expect(isBusEvent(null)).toBe(false);
        expect(isBusEvent(undefined)).toBe(false);
        expect(isBusEvent('pipeline.run.started')).toBe(false);
        expect(isBusEvent(42)).toBe(false);
    });

    test('returns false when version or timestamp is missing', () => {
        expect(isBusEvent({ type: 't', timestamp: 1 })).toBe(false); // no version
        expect(isBusEvent({ type: 't', version: 0 })).toBe(false); // no timestamp
        expect(isBusEvent({ version: 0, timestamp: 1 })).toBe(false); // no type
    });

    test('accepts version=0 (falsy but valid)', () => {
        expect(
            isBusEvent({ type: 't', payload: {}, timestamp: 1, version: 0 }),
        ).toBe(true);
    });
});

describe('PipelineBridge BusEvent normalization', () => {
    test('subscribeAll receiving a single BusEvent argument is normalized', () => {
        let captured = null;
        const src = {
            subscribeAll(handler) {
                captured = handler;
                return () => {
                    captured = null;
                };
            },
        };
        const ps = new StubPipelineService();
        const bridge = new PipelineBridge({ eventSource: src, pipelineService: ps });
        bridge.start();
        captured({
            id: 'evt-1',
            type: 'pipeline.run.started',
            payload: { runId: 'r42' },
            timestamp: Date.now(),
            sourceNodeId: 'node-x',
            version: 3,
        });
        const channels = ps.emitted.map((e) => e.channel);
        expect(channels).toContain('pipeline:run:r42');
        expect(channels).toContain('pipeline:all');
        bridge.stop();
    });

    test('EventEmitter path normalizes a raw BusEvent payload', () => {
        const src = new EventEmitter();
        const ps = new StubPipelineService();
        const bridge = new PipelineBridge({ eventSource: src, pipelineService: ps });
        bridge.start();
        // Some upstreams (or future test fixtures) may emit BusEvent shapes
        // directly on the 'event' channel — bridge should handle both.
        src.emit('event', {
            id: 'e',
            type: 'pipeline.approval.requested',
            payload: { runId: 'r5', stepId: 's1' },
            timestamp: Date.now(),
            sourceNodeId: 'n',
            version: 1,
        });
        const channels = ps.emitted.map((e) => e.channel);
        expect(channels).toContain('pipeline:run:r5');
        expect(channels).toContain('pipeline:all');
        expect(channels).toContain('pipeline:approvals');
        bridge.stop();
    });
});

describe('PipelineBridge token-rate counter', () => {
    function silentLogger() {
        return { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
    }

    test('getTokenRate().perSec1s reflects synthetic token events', () => {
        const src = new EventEmitter();
        const ps = new StubPipelineService();
        const bridge = new PipelineBridge({
            eventSource: src,
            pipelineService: ps,
            logger: silentLogger(),
        });
        bridge.start();
        for (let i = 0; i < 100; i++) {
            src.emit('event', {
                eventType: 'pipeline.llm.token',
                payload: { runId: 'r1', token: 'a' },
            });
        }
        const rate = bridge.getTokenRate();
        // All 100 events landed within the 1s window (synchronous emission).
        expect(rate.perSec1s).toBe(100);
        expect(rate.perSec10s).toBe(10); // 100 events / 10s window
        expect(rate.perSec60s).toBeCloseTo(100 / 60, 5);
        expect(rate.windowSize).toBe(100);
        bridge.stop();
    });

    test('non-token events do not advance the token-rate counter', () => {
        const src = new EventEmitter();
        const ps = new StubPipelineService();
        const bridge = new PipelineBridge({
            eventSource: src,
            pipelineService: ps,
            logger: silentLogger(),
        });
        bridge.start();
        src.emit('event', {
            eventType: 'pipeline.run.started',
            payload: { runId: 'r1' },
        });
        const rate = bridge.getTokenRate();
        expect(rate.perSec1s).toBe(0);
        expect(rate.windowSize).toBe(0);
        bridge.stop();
    });

    test('idle period suppresses the periodic token-rate log', () => {
        jest.useFakeTimers();
        const src = new EventEmitter();
        const ps = new StubPipelineService();
        const logger = silentLogger();
        const bridge = new PipelineBridge({ eventSource: src, pipelineService: ps, logger });
        bridge.start();
        // Advance 5 seconds with no token events.
        jest.advanceTimersByTime(5000);
        // The "started" log is allowed; the suppressed line is the token-rate one.
        const tokenLogs = logger.info.mock.calls.filter((args) =>
            String(args[0] || '').includes('token-rate'),
        );
        expect(tokenLogs).toHaveLength(0);
        bridge.stop();
        jest.useRealTimers();
    });

    test('token-rate log emitted when activity is present', () => {
        jest.useFakeTimers();
        const src = new EventEmitter();
        const ps = new StubPipelineService();
        const logger = silentLogger();
        const bridge = new PipelineBridge({ eventSource: src, pipelineService: ps, logger });
        bridge.start();
        for (let i = 0; i < 5; i++) {
            src.emit('event', {
                eventType: 'pipeline.llm.token',
                payload: { runId: 'r1' },
            });
        }
        jest.advanceTimersByTime(1000);
        const tokenLogs = logger.info.mock.calls.filter((args) =>
            String(args[0] || '').includes('token-rate'),
        );
        expect(tokenLogs.length).toBeGreaterThan(0);
        bridge.stop();
        jest.useRealTimers();
    });

    test('stop() clears the token-rate interval', () => {
        const src = new EventEmitter();
        const ps = new StubPipelineService();
        const bridge = new PipelineBridge({
            eventSource: src,
            pipelineService: ps,
            logger: silentLogger(),
        });
        bridge.start();
        expect(bridge._tokenRateTimer).not.toBeNull();
        bridge.stop();
        expect(bridge._tokenRateTimer).toBeNull();
    });

    test('ring buffer caps at TOKEN_RING_CAPACITY', () => {
        const src = new EventEmitter();
        const ps = new StubPipelineService();
        const bridge = new PipelineBridge({
            eventSource: src,
            pipelineService: ps,
            logger: silentLogger(),
        });
        bridge.start();
        // Push more than the cap (5000) — windowSize must clamp.
        for (let i = 0; i < 5100; i++) {
            src.emit('event', {
                eventType: 'pipeline.llm.token',
                payload: { runId: 'r1' },
            });
        }
        expect(bridge.getTokenRate().windowSize).toBe(5000);
        bridge.stop();
    });
});

describe('PipelineBridge inter-token histogram', () => {
    function silentLogger() {
        return { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
    }

    /**
     * Helper: emit token events at a controlled sequence of timestamps by
     * mocking Date.now. `gapsMs` are the inter-arrival gaps in order; the
     * emitter advances the clock by the next gap BEFORE each token after the
     * first. First token seeds `lastTs` — no gap sample is produced for it.
     */
    function emitTokensWithGaps(src, runId, gapsMs, startTs = 1_000_000) {
        const originalNow = Date.now;
        try {
            let t = startTs;
            jest.spyOn(Date, 'now').mockImplementation(() => t);
            // First token — seed.
            src.emit('event', {
                eventType: 'pipeline.llm.token',
                payload: { runId },
            });
            // Subsequent tokens advance the clock by the next gap first.
            for (const gap of gapsMs) {
                t += gap;
                src.emit('event', {
                    eventType: 'pipeline.llm.token',
                    payload: { runId },
                });
            }
        } finally {
            Date.now = originalNow;
        }
    }

    test('bucket counts, median, and p95 are correct for controlled gaps', () => {
        const src = new EventEmitter();
        const ps = new StubPipelineService();
        const bridge = new PipelineBridge({
            eventSource: src,
            pipelineService: ps,
            logger: silentLogger(),
        });
        bridge.start();

        // 11 tokens -> 10 gaps (first token seeds, the rest produce samples).
        // Distribution: 4x 5ms (0-10), 3x 15ms (10-25), 2x 60ms (50-100),
        // 1x 300ms (250-500). Total = 10 gaps.
        const gaps = [5, 5, 5, 5, 15, 15, 15, 60, 60, 300];
        emitTokensWithGaps(src, 'r-hist', gaps);

        const h = bridge.getInterTokenHistogram('r-hist');
        expect(h).not.toBeNull();
        expect(h.total).toBe(10);

        // Bucket order matches INTER_TOKEN_BUCKET_LABELS.
        const countOf = (label) => h.buckets.find((b) => b.label === label).count;
        expect(countOf('0-10ms')).toBe(4);
        expect(countOf('10-25ms')).toBe(3);
        expect(countOf('25-50ms')).toBe(0);
        expect(countOf('50-100ms')).toBe(2);
        expect(countOf('100-250ms')).toBe(0);
        expect(countOf('250-500ms')).toBe(1);
        expect(countOf('500-1000ms')).toBe(0);
        expect(countOf('1000+ms')).toBe(0);

        // Sorted gaps: [5,5,5,5,15,15,15,60,60,300]
        // Nearest-rank median (q=0.5, n=10): rank = ceil(5)-1 = 4 -> sorted[4] = 15
        // Nearest-rank p95 (q=0.95, n=10): rank = ceil(9.5)-1 = 9 -> sorted[9] = 300
        expect(h.median).toBe(15);
        expect(h.p95).toBe(300);
        expect(h.max).toBe(300);

        bridge.stop();
    });

    test('terminal run event logs the histogram and evicts the map entry', () => {
        const src = new EventEmitter();
        const ps = new StubPipelineService();
        const logger = silentLogger();
        const bridge = new PipelineBridge({
            eventSource: src,
            pipelineService: ps,
            logger,
        });
        bridge.start();

        emitTokensWithGaps(src, 'r-term', [5, 5, 15, 15, 60]);
        expect(bridge.getInterTokenHistogram('r-term')).not.toBeNull();

        // Emit the terminal event.
        src.emit('event', {
            eventType: 'pipeline.run.completed',
            payload: { runId: 'r-term' },
        });

        // Histogram log was emitted.
        const logged = logger.info.mock.calls.map((args) => String(args[0] || ''));
        const histLine = logged.find((l) =>
            l.includes('inter-token histogram for run r-term'),
        );
        expect(histLine).toBeTruthy();
        expect(histLine).toMatch(/median:.*p95:.*max:/);

        // Map entry evicted.
        expect(bridge.getInterTokenHistogram('r-term')).toBeNull();

        bridge.stop();
    });

    test('failed and cancelled events also flush the histogram', () => {
        for (const terminal of ['pipeline.run.failed', 'pipeline.run.cancelled']) {
            const src = new EventEmitter();
            const ps = new StubPipelineService();
            const bridge = new PipelineBridge({
                eventSource: src,
                pipelineService: ps,
                logger: silentLogger(),
            });
            bridge.start();
            emitTokensWithGaps(src, 'r-x', [5, 10, 15]);
            src.emit('event', { eventType: terminal, payload: { runId: 'r-x' } });
            expect(bridge.getInterTokenHistogram('r-x')).toBeNull();
            bridge.stop();
        }
    });

    test('interpretation: steady stream logs drop-oldest recommendation', () => {
        const src = new EventEmitter();
        const ps = new StubPipelineService();
        const logger = silentLogger();
        const bridge = new PipelineBridge({
            eventSource: src,
            pipelineService: ps,
            logger,
        });
        bridge.start();
        // All gaps under 25ms -> median < 25 and p95 < 100 -> steady.
        emitTokensWithGaps(src, 'r-steady', [5, 8, 10, 12, 15, 18, 20, 22, 24]);
        src.emit('event', {
            eventType: 'pipeline.run.completed',
            payload: { runId: 'r-steady' },
        });

        const logged = logger.info.mock.calls.map((args) => String(args[0] || ''));
        expect(logged.some((l) => l.includes('stream is steady'))).toBe(true);
        expect(logged.some((l) => l.includes('stream is bursty'))).toBe(false);
        bridge.stop();
    });

    test('interpretation: bursty stream logs reject recommendation', () => {
        const src = new EventEmitter();
        const ps = new StubPipelineService();
        const logger = silentLogger();
        const bridge = new PipelineBridge({
            eventSource: src,
            pipelineService: ps,
            logger,
        });
        bridge.start();
        // Gaps pushing p95 over 500ms -> bursty.
        emitTokensWithGaps(src, 'r-bursty', [50, 100, 200, 400, 800, 1500]);
        src.emit('event', {
            eventType: 'pipeline.run.completed',
            payload: { runId: 'r-bursty' },
        });

        const logged = logger.info.mock.calls.map((args) => String(args[0] || ''));
        expect(logged.some((l) => l.includes('stream is bursty'))).toBe(true);
        expect(logged.some((l) => l.includes('stream is steady'))).toBe(false);
        bridge.stop();
    });

    test('getInterTokenHistogram returns null for unknown runs', () => {
        const src = new EventEmitter();
        const ps = new StubPipelineService();
        const bridge = new PipelineBridge({
            eventSource: src,
            pipelineService: ps,
            logger: silentLogger(),
        });
        bridge.start();
        expect(bridge.getInterTokenHistogram('nope')).toBeNull();
        bridge.stop();
    });

    test('concurrent runs maintain separate histograms', () => {
        const src = new EventEmitter();
        const ps = new StubPipelineService();
        const bridge = new PipelineBridge({
            eventSource: src,
            pipelineService: ps,
            logger: silentLogger(),
        });
        bridge.start();

        // Interleave tokens for two runs under a mocked clock.
        let t = 2_000_000;
        const originalNow = Date.now;
        jest.spyOn(Date, 'now').mockImplementation(() => t);
        try {
            src.emit('event', { eventType: 'pipeline.llm.token', payload: { runId: 'a' } });
            t += 5;
            src.emit('event', { eventType: 'pipeline.llm.token', payload: { runId: 'b' } });
            t += 5;
            src.emit('event', { eventType: 'pipeline.llm.token', payload: { runId: 'a' } }); // gap=10
            t += 100;
            src.emit('event', { eventType: 'pipeline.llm.token', payload: { runId: 'b' } }); // gap=105
        } finally {
            Date.now = originalNow;
        }

        const hA = bridge.getInterTokenHistogram('a');
        const hB = bridge.getInterTokenHistogram('b');
        expect(hA.total).toBe(1);
        expect(hA.max).toBe(10);
        expect(hB.total).toBe(1);
        expect(hB.max).toBe(105);
        bridge.stop();
    });
});

describe('PipelineBridge backpressure stats', () => {
    function silentLogger() {
        return { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
    }

    test('getBackpressureStats starts at zero when no controller is wired', () => {
        const src = new EventEmitter();
        const ps = new StubPipelineService();
        const bridge = new PipelineBridge({
            eventSource: src,
            pipelineService: ps,
            logger: silentLogger(),
        });
        expect(bridge.getBackpressureStats()).toEqual({
            totalDropped: 0,
            byStrategy: {},
        });
    });

    test('drops accumulate across strategies when a controller emits', () => {
        const src = new EventEmitter();
        const ps = new StubPipelineService();
        const controller = new EventEmitter();
        const logger = silentLogger();
        const bridge = new PipelineBridge({
            eventSource: src,
            pipelineService: ps,
            logger,
            backpressureController: controller,
        });
        bridge.start();

        controller.emit('bp.dropped.count', {
            count: 3,
            strategy: 'drop-oldest',
            key: 'pipeline:run:r1',
        });
        controller.emit('bp.dropped.count', {
            count: 2,
            strategy: 'drop-oldest',
            key: 'pipeline:run:r1',
        });
        controller.emit('bp.dropped.count', {
            count: 7,
            strategy: 'reject',
            key: 'pipeline:all',
        });

        const stats = bridge.getBackpressureStats();
        expect(stats.totalDropped).toBe(12);
        expect(stats.byStrategy).toEqual({
            'drop-oldest': 5,
            reject: 7,
        });

        // All three drops logged at warn.
        const warned = logger.warn.mock.calls.map((args) => String(args[0] || ''));
        expect(warned.filter((l) => l.includes('backpressure dropped')).length).toBe(3);
        bridge.stop();
    });

    test('stop() detaches the backpressure listener', () => {
        const src = new EventEmitter();
        const ps = new StubPipelineService();
        const controller = new EventEmitter();
        const bridge = new PipelineBridge({
            eventSource: src,
            pipelineService: ps,
            logger: silentLogger(),
            backpressureController: controller,
        });
        bridge.start();
        controller.emit('bp.dropped.count', { count: 1, strategy: 'drop-oldest', key: 'k' });
        expect(bridge.getBackpressureStats().totalDropped).toBe(1);

        bridge.stop();
        controller.emit('bp.dropped.count', { count: 5, strategy: 'drop-oldest', key: 'k' });
        // Post-stop emissions are ignored — counter must not advance.
        expect(bridge.getBackpressureStats().totalDropped).toBe(1);
    });

    test('malformed drop events are ignored (no NaN, no negative counts)', () => {
        const src = new EventEmitter();
        const ps = new StubPipelineService();
        const controller = new EventEmitter();
        const bridge = new PipelineBridge({
            eventSource: src,
            pipelineService: ps,
            logger: silentLogger(),
            backpressureController: controller,
        });
        bridge.start();
        controller.emit('bp.dropped.count', null);
        controller.emit('bp.dropped.count', { count: 0, strategy: 'drop-oldest', key: 'k' });
        controller.emit('bp.dropped.count', { count: -5, strategy: 'drop-oldest', key: 'k' });
        controller.emit('bp.dropped.count', { count: 'not-a-number' });
        expect(bridge.getBackpressureStats()).toEqual({
            totalDropped: 0,
            byStrategy: {},
        });
        bridge.stop();
    });

    test('drop event without strategy defaults to "unknown"', () => {
        const src = new EventEmitter();
        const ps = new StubPipelineService();
        const controller = new EventEmitter();
        const bridge = new PipelineBridge({
            eventSource: src,
            pipelineService: ps,
            logger: silentLogger(),
            backpressureController: controller,
        });
        bridge.start();
        controller.emit('bp.dropped.count', { count: 4 });
        expect(bridge.getBackpressureStats()).toEqual({
            totalDropped: 4,
            byStrategy: { unknown: 4 },
        });
        bridge.stop();
    });
});
