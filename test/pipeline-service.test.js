// test/pipeline-service.test.js
/**
 * Coverage for the Phase 4 PipelineService action surface: trigger, cancel,
 * resolveApproval, resumeFromStep, getRun, getHistory. Verifies both the
 * pluggable PipelineModule path and the in-memory mock fallback path.
 */

const EventEmitter = require('events');
const PipelineService = require('../src/services/pipeline-service');

class MockMessageRouter {
    constructor() {
        this.sent = [];
        this.channelSends = [];
        this.subs = [];
    }
    async subscribeToChannel(clientId, channel) {
        this.subs.push({ clientId, channel });
    }
    async unsubscribeFromChannel(clientId, channel) {
        this.subs.push({ clientId, channel, op: 'unsub' });
    }
    async sendToChannel(channel, message) {
        this.channelSends.push({ channel, message });
    }
    sendToClient(clientId, message) {
        this.sent.push({ clientId, message });
    }
}

class NoopLogger {
    debug() {} info() {} warn() {} error() {}
}

function findFrame(router, predicate) {
    return router.sent.find((s) => predicate(s.message))?.message;
}

describe('PipelineService action surface', () => {
    let router;
    let logger;
    let eventSource;
    let service;

    beforeEach(() => {
        router = new MockMessageRouter();
        logger = new NoopLogger();
        eventSource = new EventEmitter();
        service = new PipelineService(router, logger, null, { eventSource });
    });

    test('handleTrigger with no PipelineModule synthesizes a runId + ack', async () => {
        await service.handleAction('client-1', 'trigger', {
            pipelineId: 'p1',
            triggerPayload: { foo: 'bar' },
            correlationId: 'cid-1',
        });
        const ack = findFrame(router, (m) => m.type === 'pipeline:ack' && m.action === 'trigger');
        expect(ack).toBeDefined();
        expect(ack.runId).toMatch(/^mock-/);
        expect(ack.correlationId).toBe('cid-1');
    });

    test('handleTrigger with PipelineModule.trigger forwards args', async () => {
        const triggerFn = jest.fn().mockResolvedValue({ runId: 'run-from-module' });
        service.setPipelineModule({ trigger: triggerFn });
        await service.handleAction('client-1', 'trigger', {
            pipelineId: 'p1',
            definition: { id: 'p1' },
            triggerPayload: { x: 1 },
            triggeredBy: { userId: 'u', triggerType: 'manual' },
            correlationId: 'cid-2',
        });
        expect(triggerFn).toHaveBeenCalledWith(
            'p1',
            { id: 'p1' },
            { x: 1 },
            { userId: 'u', triggerType: 'manual' },
        );
        const ack = findFrame(router, (m) => m.type === 'pipeline:ack' && m.action === 'trigger');
        expect(ack.runId).toBe('run-from-module');
    });

    test('handleTrigger missing pipelineId returns error', async () => {
        await service.handleAction('client-1', 'trigger', { correlationId: 'cid' });
        const err = findFrame(router, (m) => m.type === 'error');
        expect(err).toBeDefined();
        expect(err.message).toMatch(/requires pipelineId/);
    });

    test('handleGetRun returns mock run after trigger', async () => {
        await service.handleAction('client-1', 'trigger', { pipelineId: 'p1' });
        const ack = findFrame(router, (m) => m.type === 'pipeline:ack' && m.action === 'trigger');
        const runId = ack.runId;
        router.sent = [];
        await service.handleAction('client-1', 'getRun', { runId, correlationId: 'cid-r' });
        const snap = findFrame(router, (m) => m.type === 'pipeline:snapshot');
        expect(snap.run).toBeDefined();
        expect(snap.run.id).toBe(runId);
        expect(snap.run.pipelineId).toBe('p1');
        expect(snap.correlationId).toBe('cid-r');
    });

    test('handleGetRun delegates to PipelineModule.getRun when wired', async () => {
        const getRunFn = jest.fn().mockResolvedValue({ id: 'r1', status: 'completed' });
        service.setPipelineModule({ getRun: getRunFn });
        await service.handleAction('client-1', 'getRun', { runId: 'r1' });
        expect(getRunFn).toHaveBeenCalledWith('r1');
        const snap = findFrame(router, (m) => m.type === 'pipeline:snapshot');
        expect(snap.run.status).toBe('completed');
    });

    test('handleGetHistory returns events from fromVersion onward', async () => {
        await service.handleAction('client-1', 'trigger', { pipelineId: 'p1' });
        const ack = findFrame(router, (m) => m.type === 'pipeline:ack' && m.action === 'trigger');
        const runId = ack.runId;
        // Wait briefly so the synthetic timers have populated history with
        // pipeline.run.started + pipeline.step.started (others fire later).
        await new Promise((r) => setTimeout(r, 30));
        router.sent = [];
        await service.handleAction('client-1', 'getHistory', { runId, fromVersion: 0 });
        const hist = findFrame(router, (m) => m.type === 'pipeline:history');
        expect(hist).toBeDefined();
        expect(hist.events.length).toBeGreaterThanOrEqual(1);
        expect(hist.events[0].eventType).toBe('pipeline.run.started');
    });

    test('handleResumeFromStep without PipelineModule emits resumeFromStep event', async () => {
        const seen = [];
        eventSource.on('event', (e) => seen.push(e));
        await service.handleAction('client-1', 'resumeFromStep', {
            runId: 'r1',
            fromNodeId: 'n5',
            correlationId: 'cid',
        });
        expect(seen.length).toBe(1);
        expect(seen[0].eventType).toBe('pipeline.run.resumeFromStep');
        expect(seen[0].payload.runId).toBe('r1');
        expect(seen[0].payload.fromNodeId).toBe('n5');
    });

    test('handleResumeFromStep delegates when PipelineModule provided', async () => {
        const fn = jest.fn().mockResolvedValue();
        service.setPipelineModule({ resumeFromStep: fn });
        await service.handleAction('client-1', 'resumeFromStep', {
            runId: 'r1',
            fromNodeId: 'n5',
        });
        expect(fn).toHaveBeenCalledWith('r1', 'n5');
    });

    test('handleCancel without handler emits cancelled event on eventSource', async () => {
        const seen = [];
        eventSource.on('event', (e) => seen.push(e));
        await service.handleAction('client-1', 'cancel', {
            runId: 'r1',
            correlationId: 'cid',
        });
        expect(seen.length).toBe(1);
        expect(seen[0].eventType).toBe('pipeline.run.cancelled');
        const ack = findFrame(router, (m) => m.type === 'pipeline:ack' && m.action === 'cancel');
        expect(ack).toBeDefined();
    });

    test('handleResolveApproval without handler emits recorded event', async () => {
        const seen = [];
        eventSource.on('event', (e) => seen.push(e));
        await service.handleAction('client-1', 'resolveApproval', {
            runId: 'r1',
            stepId: 's1',
            decision: 'approve',
            decidedBy: 'u-7',
            comment: 'lgtm',
        });
        expect(seen.length).toBe(1);
        expect(seen[0].eventType).toBe('pipeline.approval.recorded');
        expect(seen[0].payload.userId).toBe('u-7');
        expect(seen[0].payload.decision).toBe('approve');
    });

    test('handleResolveApproval with handler maps decidedBy → userId', async () => {
        const fn = jest.fn().mockResolvedValue();
        service.setResolveApprovalHandler(fn);
        await service.handleAction('client-1', 'resolveApproval', {
            runId: 'r1',
            stepId: 's1',
            decision: 'reject',
            decidedBy: 'u-99',
            comment: 'nope',
        });
        expect(fn).toHaveBeenCalledWith('r1', 's1', 'u-99', 'reject', 'nope');
    });

    test('subscribe + unsubscribe are still wired', async () => {
        await service.handleAction('client-1', 'subscribe', { channel: 'pipeline:run:abc' });
        expect(router.subs.find((s) => s.channel === 'pipeline:run:abc')).toBeDefined();
        await service.handleAction('client-1', 'unsubscribe', { channel: 'pipeline:run:abc' });
        expect(router.subs.find((s) => s.op === 'unsub')).toBeDefined();
    });
});
