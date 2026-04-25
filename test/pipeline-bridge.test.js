// test/pipeline-bridge.test.js
/**
 * Coverage for the PipelineBridge fan-out + the bindPipelineModule helper that
 * wires a PipelineModule shim into a PipelineService. The real distributed-core
 * module isn't embedded yet — these tests pin the contract surface so the
 * Phase 4 swap-in stays drop-in.
 */

const EventEmitter = require('events');
const { PipelineBridge, bindPipelineModule } = require('../src/pipeline-bridge/pipeline-bridge');

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
