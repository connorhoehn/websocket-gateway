// test/mapBusEventToWireEvent.test.js
/**
 * Dedicated coverage for the BusEvent <-> PipelineWireEvent translation seam:
 *   - `mapBusEventToWireEvent` (envelope renaming + field carry-forward)
 *   - `isBusEvent` (predicate that decides which mapping path to take)
 *
 * The bridge is the only place where a distributed-core BusEvent is converted
 * into the gateway's wire shape. Every PipelineEventMap key needs to round-trip
 * cleanly so Phase-4 wire-up doesn't silently drop fields.
 *
 * Note on naming convention: distributed-core emits colon-form (e.g.
 * `pipeline:run:started`) on its EventBus, while our PipelineEventMap and
 * downstream consumers use dot-form (`pipeline.run.started`). The mapper
 * canonicalizes by replacing `:` with `.` in `eventType` at the boundary so
 * downstream code matches uniformly. Channel names (`pipeline:run:{runId}`,
 * `pipeline:all`, `pipeline:approvals`) keep their colon form — those are
 * derived separately by the bridge and don't pass through this mapper.
 *
 * Backend-only test: fixtures are inline plain objects mirroring the
 * `frontend/src/types/pipeline.ts` PipelineEventMap shape. Importing frontend
 * code into a Node test would pull in the whole React graph; the contract is
 * pinned by visual inspection (and by the existing `check:types-sync` script).
 */

const {
    mapBusEventToWireEvent,
    isBusEvent,
} = require('../src/pipeline-bridge/pipeline-bridge');

// ---------------------------------------------------------------------------
// Fixture catalogue — one canonical BusEvent per PipelineEventMap key.
// Payload shapes mirror frontend/src/types/pipeline.ts exactly. Every entry
// here MUST stay in sync with the PipelineEventMap definition; if a new event
// is added to the map without a fixture here, the "every key has coverage"
// guard at the bottom of this file will fail.
// ---------------------------------------------------------------------------

const ISO = '2026-04-25T12:00:00.000Z';

/**
 * @typedef {{
 *   type: string,
 *   payload: object,
 *   description?: string,
 * }} EventFixture
 */

/** @type {Record<string, { payload: object }>} */
const EVENT_FIXTURES = {
    // Run lifecycle
    'pipeline.run.started': {
        payload: {
            runId: 'run-1',
            pipelineId: 'pipe-A',
            triggeredBy: {
                userId: 'u-1',
                triggerType: 'manual',
                payload: { source: 'ui' },
            },
            at: ISO,
        },
    },
    'pipeline.run.completed': {
        payload: { runId: 'run-1', durationMs: 1234, at: ISO },
    },
    'pipeline.run.failed': {
        payload: {
            runId: 'run-1',
            error: { nodeId: 'n-3', message: 'boom', stack: 'Error: boom\n  at ...' },
            at: ISO,
        },
    },
    'pipeline.run.cancelled': {
        payload: { runId: 'run-1', at: ISO },
    },

    // Distribution events (from ResourceRouter)
    'pipeline.run.orphaned': {
        payload: { runId: 'run-1', previousOwner: 'node-A', at: ISO },
    },
    'pipeline.run.reassigned': {
        payload: { runId: 'run-1', from: 'node-A', to: 'node-B', at: ISO },
    },

    // Step lifecycle
    'pipeline.step.started': {
        payload: { runId: 'run-1', stepId: 'step-1', nodeType: 'llm', at: ISO },
    },
    'pipeline.step.completed': {
        payload: {
            runId: 'run-1',
            stepId: 'step-1',
            durationMs: 42,
            output: { tokens: 17, summary: 'ok' },
            at: ISO,
        },
    },
    'pipeline.step.failed': {
        payload: { runId: 'run-1', stepId: 'step-1', error: 'timeout', at: ISO },
    },
    'pipeline.step.skipped': {
        payload: {
            runId: 'run-1',
            stepId: 'step-1',
            reason: 'condition-false',
            at: ISO,
        },
    },
    'pipeline.step.cancelled': {
        payload: { runId: 'run-1', stepId: 'step-1', at: ISO },
    },

    // LLM streaming
    'pipeline.llm.prompt': {
        payload: {
            runId: 'run-1',
            stepId: 'step-llm',
            model: 'claude-sonnet-4-6',
            prompt: 'Summarize: ...',
            at: ISO,
        },
    },
    'pipeline.llm.token': {
        payload: { runId: 'run-1', stepId: 'step-llm', token: 'Hello', at: ISO },
    },
    'pipeline.llm.response': {
        payload: {
            runId: 'run-1',
            stepId: 'step-llm',
            response: 'final text',
            tokensIn: 100,
            tokensOut: 250,
            at: ISO,
        },
    },

    // Approval
    'pipeline.approval.requested': {
        payload: {
            runId: 'run-1',
            stepId: 'step-approve',
            approvers: [
                { type: 'user', value: 'u-99' },
                { type: 'role', value: 'editor' },
            ],
            at: ISO,
        },
    },
    'pipeline.approval.recorded': {
        payload: {
            runId: 'run-1',
            stepId: 'step-approve',
            userId: 'u-99',
            decision: 'approve',
            at: ISO,
        },
    },

    // Pause / resume / retry
    'pipeline.run.paused': {
        payload: { runId: 'run-1', atStepIds: ['step-2', 'step-3'], at: ISO },
    },
    'pipeline.run.resumed': {
        payload: { runId: 'run-1', at: ISO },
    },
    'pipeline.run.resumeFromStep': {
        payload: { runId: 'run-1', fromNodeId: 'n-2', at: ISO },
    },
    'pipeline.run.retry': {
        payload: { newRunId: 'run-2', previousRunId: 'run-1', at: ISO },
    },

    // Webhook
    'pipeline.webhook.triggered': {
        payload: {
            webhookPath: '/hooks/pipeline/release',
            body: { ref: 'main', sha: 'abc123' },
            headers: { 'content-type': 'application/json', 'x-signature': 'sha256=...' },
            at: ISO,
        },
    },

    // Join bookkeeping
    'pipeline.join.waiting': {
        payload: {
            runId: 'run-1',
            stepId: 'join-1',
            received: 1,
            required: 3,
            at: ISO,
        },
    },
    'pipeline.join.fired': {
        payload: {
            runId: 'run-1',
            stepId: 'join-1',
            inputs: ['step-a', 'step-b', 'step-c'],
            at: ISO,
        },
    },
};

// Mirrors keyof PipelineEventMap. Keep alphabetised neither here nor in the
// type — group by lifecycle area as the type does, so a missing addition is
// easy to spot in review.
const PIPELINE_EVENT_MAP_KEYS = [
    'pipeline.run.started',
    'pipeline.run.completed',
    'pipeline.run.failed',
    'pipeline.run.cancelled',
    'pipeline.run.orphaned',
    'pipeline.run.reassigned',
    'pipeline.step.started',
    'pipeline.step.completed',
    'pipeline.step.failed',
    'pipeline.step.skipped',
    'pipeline.step.cancelled',
    'pipeline.llm.prompt',
    'pipeline.llm.token',
    'pipeline.llm.response',
    'pipeline.approval.requested',
    'pipeline.approval.recorded',
    'pipeline.run.paused',
    'pipeline.run.resumed',
    'pipeline.run.resumeFromStep',
    'pipeline.run.retry',
    'pipeline.webhook.triggered',
    'pipeline.join.waiting',
    'pipeline.join.fired',
];

/**
 * Build a synthetic distributed-core BusEvent envelope around an inner payload.
 * Mirrors the `BusEvent<T>` shape: `{ id, type, payload, timestamp, sourceNodeId, version }`.
 */
function makeBusEvent(type, payload, overrides = {}) {
    return {
        id: `bus-${type}-${Math.random().toString(36).slice(2, 8)}`,
        type,
        payload,
        timestamp: 1714000000000,
        sourceNodeId: 'node-test',
        version: 1,
        ...overrides,
    };
}

// ---------------------------------------------------------------------------
// Happy path — every PipelineEventMap key
// ---------------------------------------------------------------------------

describe('mapBusEventToWireEvent — every PipelineEventMap key round-trips', () => {
    test.each(PIPELINE_EVENT_MAP_KEYS)('%s round-trips through the mapper', (eventType) => {
        const fixture = EVENT_FIXTURES[eventType];
        expect(fixture).toBeDefined();

        const bus = makeBusEvent(eventType, fixture.payload, {
            timestamp: 1714000000123,
            version: 42,
            sourceNodeId: 'node-X',
        });
        const wire = mapBusEventToWireEvent(bus);

        // Envelope shape — eventType remains dot-form, payload is the same
        // reference (no defensive cloning), seq comes from version, etc.
        expect(wire.eventType).toBe(eventType);
        expect(wire.eventType).toMatch(/^pipeline\./);
        expect(wire.eventType).not.toMatch(/^pipeline:/);
        expect(wire.payload).toBe(bus.payload); // reference-equal — no copy
        expect(wire.payload).toEqual(fixture.payload); // structurally identical
        expect(wire.seq).toBe(42);
        expect(wire.sourceNodeId).toBe('node-X');
        expect(wire.emittedAt).toBe(1714000000123);

        // Fields that should NOT have leaked from BusEvent into the wire env.
        expect(wire).not.toHaveProperty('id');
        expect(wire).not.toHaveProperty('type');
        expect(wire).not.toHaveProperty('version');
        expect(wire).not.toHaveProperty('timestamp');

        // Inner payload should still carry its `at` ISO 8601 timestamp
        // (PipelineEventMap convention). The mapper does not touch the payload.
        if ('at' in fixture.payload) {
            expect(wire.payload.at).toBe(fixture.payload.at);
            expect(typeof wire.payload.at).toBe('string');
            // Loose ISO-8601 sanity check — Date can parse it.
            expect(Number.isNaN(Date.parse(wire.payload.at))).toBe(false);
        }
    });

    test('every PipelineEventMap key has a fixture in this file', () => {
        // Guard against drift: if PipelineEventMap grows, the fixture catalogue
        // above must grow with it. (The list is duplicated by intent — it is
        // the contract assertion.)
        for (const k of PIPELINE_EVENT_MAP_KEYS) {
            expect(EVENT_FIXTURES[k]).toBeDefined();
        }
        expect(Object.keys(EVENT_FIXTURES).sort()).toEqual(
            [...PIPELINE_EVENT_MAP_KEYS].sort(),
        );
    });
});

// ---------------------------------------------------------------------------
// Naming canonicalization
// ---------------------------------------------------------------------------

describe('mapBusEventToWireEvent — naming canonicalization', () => {
    test('dot-form event names are passed through unchanged', () => {
        const bus = makeBusEvent('pipeline.run.reassigned', {
            runId: 'r1',
            from: 'a',
            to: 'b',
            at: ISO,
        });
        expect(mapBusEventToWireEvent(bus).eventType).toBe('pipeline.run.reassigned');
    });

    test('mapper canonicalizes colon-form to dot-form', () => {
        // The mapper replaces `:` with `.` in the type so distributed-core's
        // native `pipeline:run:started` shape lines up with our PipelineEventMap
        // dot-form keys. Downstream constants (`TERMINAL_RUN_EVENTS`,
        // `eventType.startsWith('pipeline.approval.')`) match either way.
        const bus = makeBusEvent('pipeline:run:started', { runId: 'r', at: ISO });
        const wire = mapBusEventToWireEvent(bus);
        expect(wire.eventType).toBe('pipeline.run.started');
    });

    test('non-pipeline event types are still passed through (mapper is namespace-agnostic)', () => {
        const bus = makeBusEvent('not-a-pipeline-event', { foo: 'bar' });
        const wire = mapBusEventToWireEvent(bus);
        expect(wire.eventType).toBe('not-a-pipeline-event');
        expect(wire.payload).toEqual({ foo: 'bar' });
    });

    test('llm.token specifically retains its dot-form (used as TOKEN_EVENT_TYPE constant)', () => {
        const bus = makeBusEvent('pipeline.llm.token', {
            runId: 'r',
            stepId: 's',
            token: 'x',
            at: ISO,
        });
        // The bridge's token-rate accounting matches by exact string equality
        // against `'pipeline.llm.token'`. This pin guards that constant.
        expect(mapBusEventToWireEvent(bus).eventType).toBe('pipeline.llm.token');
    });
});

// ---------------------------------------------------------------------------
// Dedupe-key extraction (carry-forward of version + payload identifiers)
// ---------------------------------------------------------------------------

describe('mapBusEventToWireEvent — dedupe key carry-forward', () => {
    test('seq is taken verbatim from BusEvent.version (no synthesis)', () => {
        const bus = makeBusEvent('pipeline.run.started', { runId: 'r', at: ISO }, { version: 17 });
        expect(mapBusEventToWireEvent(bus).seq).toBe(17);
    });

    test('seq=0 is preserved (no false-coercion to 1 or undefined)', () => {
        const bus = makeBusEvent('pipeline.run.started', { runId: 'r', at: ISO }, { version: 0 });
        const wire = mapBusEventToWireEvent(bus);
        expect(wire.seq).toBe(0);
        expect(Object.prototype.hasOwnProperty.call(wire, 'seq')).toBe(true);
    });

    test('runId/stepId live on payload and are forwarded by-reference', () => {
        // The dedupe triplet on the wire is (eventType, payload.runId, seq).
        // For step-level events the frontend additionally keys on payload.stepId.
        // The mapper does not pluck these out — they ride along inside `payload`.
        const payload = { runId: 'r-42', stepId: 'step-7', at: ISO };
        const bus = makeBusEvent('pipeline.step.started', { ...payload, nodeType: 'llm' });
        const wire = mapBusEventToWireEvent(bus);
        expect(wire.payload.runId).toBe('r-42');
        expect(wire.payload.stepId).toBe('step-7');
    });

    test('run-level events have no stepId — forwarded payload omits it cleanly', () => {
        const bus = makeBusEvent('pipeline.run.completed', {
            runId: 'r-1',
            durationMs: 99,
            at: ISO,
        });
        const wire = mapBusEventToWireEvent(bus);
        expect(wire.payload.runId).toBe('r-1');
        expect('stepId' in wire.payload).toBe(false);
    });

    test('webhook.triggered has no runId — payload still forwards cleanly', () => {
        const bus = makeBusEvent('pipeline.webhook.triggered', {
            webhookPath: '/hooks/pipeline/x',
            body: {},
            headers: {},
            at: ISO,
        });
        const wire = mapBusEventToWireEvent(bus);
        expect('runId' in wire.payload).toBe(false);
        expect(wire.payload.webhookPath).toBe('/hooks/pipeline/x');
    });

    test('replayed events (same version twice) produce identical wire envelopes — mapper does not dedupe', () => {
        const bus = makeBusEvent(
            'pipeline.run.started',
            { runId: 'r', pipelineId: 'p', triggeredBy: { triggerType: 'manual', payload: {} }, at: ISO },
            { version: 5 },
        );
        const wire1 = mapBusEventToWireEvent(bus);
        const wire2 = mapBusEventToWireEvent(bus);
        expect(wire2).toEqual(wire1);
        // Mapper is pure — dedupe is a downstream concern (frontend, channel
        // multiplexer). This pin guards that boundary.
    });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe('mapBusEventToWireEvent — edge cases', () => {
    test('empty payload object is preserved as an empty object', () => {
        const bus = makeBusEvent('pipeline.run.started', {});
        const wire = mapBusEventToWireEvent(bus);
        expect(wire.payload).toEqual({});
        expect(wire.payload).toBe(bus.payload);
    });

    test('payload with extra unknown fields passes through unchanged (forward-compat)', () => {
        // Distributed-core may add new fields before the gateway/frontend types
        // catch up. Mapper must not strip them.
        const payload = {
            runId: 'r',
            durationMs: 100,
            at: ISO,
            __experimental_costUsd: 0.0142,
            tracingId: 'trace-abc',
        };
        const bus = makeBusEvent('pipeline.run.completed', payload);
        const wire = mapBusEventToWireEvent(bus);
        expect(wire.payload).toEqual(payload);
        expect(wire.payload.__experimental_costUsd).toBe(0.0142);
        expect(wire.payload.tracingId).toBe('trace-abc');
    });

    test('null payload is forwarded as-is (mapper does not normalize)', () => {
        // The bridge handler later coerces null payload to {} for safety,
        // but the mapper itself is a pure renamer.
        const bus = makeBusEvent('pipeline.run.cancelled', null);
        const wire = mapBusEventToWireEvent(bus);
        expect(wire.payload).toBeNull();
    });

    test('undefined sourceNodeId carries through as undefined', () => {
        const bus = makeBusEvent('pipeline.run.started', { runId: 'r', at: ISO });
        delete bus.sourceNodeId;
        const wire = mapBusEventToWireEvent(bus);
        expect(wire.sourceNodeId).toBeUndefined();
        expect('sourceNodeId' in wire).toBe(true);
    });

    test('version=0 produces seq=0 (already covered above, re-asserted at edge layer)', () => {
        const bus = makeBusEvent('pipeline.run.started', { runId: 'r', at: ISO }, { version: 0 });
        expect(mapBusEventToWireEvent(bus).seq).toBe(0);
    });

    test('large timestamp preserves precision (no Date conversion)', () => {
        const bus = makeBusEvent('pipeline.run.started', { runId: 'r', at: ISO }, {
            timestamp: 9_999_999_999_999,
        });
        const wire = mapBusEventToWireEvent(bus);
        expect(wire.emittedAt).toBe(9_999_999_999_999);
        expect(typeof wire.emittedAt).toBe('number');
    });

    test('mapper does not mutate the input BusEvent', () => {
        const payload = { runId: 'r', at: ISO };
        const bus = makeBusEvent('pipeline.run.started', payload);
        const beforeKeys = Object.keys(bus).slice().sort();
        mapBusEventToWireEvent(bus);
        expect(Object.keys(bus).sort()).toEqual(beforeKeys);
        expect(bus.type).toBe('pipeline.run.started'); // not renamed in place
        expect(bus.payload).toBe(payload);
    });
});

// ---------------------------------------------------------------------------
// isBusEvent predicate
// ---------------------------------------------------------------------------

describe('isBusEvent', () => {
    test('returns true for a well-formed BusEvent', () => {
        expect(
            isBusEvent({
                id: 'x',
                type: 'pipeline.run.started',
                payload: {},
                timestamp: 1714000000000,
                sourceNodeId: 'n',
                version: 0,
            }),
        ).toBe(true);
    });

    test('returns true even with version=0 (falsy but valid)', () => {
        expect(
            isBusEvent({ type: 't', payload: {}, timestamp: 1, version: 0 }),
        ).toBe(true);
    });

    test('returns true even when payload is missing (predicate does not validate inner shape)', () => {
        // CONTRACT NOTE: today isBusEvent only checks { type:string, version!=null, timestamp!=null }.
        // It does NOT require `payload` to be present or to be an object. This is
        // deliberate (the bridge tolerates payload-less heartbeats), but worth
        // pinning so a future tightening is intentional.
        expect(isBusEvent({ type: 't', timestamp: 1, version: 0 })).toBe(true);
    });

    test('returns true even when payload is the wrong type (predicate is shallow)', () => {
        // Same caveat as above — see contract note.
        expect(
            isBusEvent({ type: 't', payload: 'not-an-object', timestamp: 1, version: 0 }),
        ).toBe(true);
    });

    test('returns false when type is missing', () => {
        expect(isBusEvent({ payload: {}, timestamp: 1, version: 0 })).toBe(false);
    });

    test('returns false when type is not a string', () => {
        expect(isBusEvent({ type: 42, payload: {}, timestamp: 1, version: 0 })).toBe(false);
        expect(
            isBusEvent({ type: { ns: 'pipeline' }, payload: {}, timestamp: 1, version: 0 }),
        ).toBe(false);
        expect(isBusEvent({ type: null, payload: {}, timestamp: 1, version: 0 })).toBe(false);
    });

    test('returns false when version is null/undefined', () => {
        expect(isBusEvent({ type: 't', payload: {}, timestamp: 1 })).toBe(false);
        expect(isBusEvent({ type: 't', payload: {}, timestamp: 1, version: null })).toBe(false);
        expect(isBusEvent({ type: 't', payload: {}, timestamp: 1, version: undefined })).toBe(false);
    });

    test('returns false when timestamp is null/undefined', () => {
        expect(isBusEvent({ type: 't', payload: {}, version: 0 })).toBe(false);
        expect(isBusEvent({ type: 't', payload: {}, version: 0, timestamp: null })).toBe(false);
        expect(isBusEvent({ type: 't', payload: {}, version: 0, timestamp: undefined })).toBe(false);
    });

    test('returns false for a PipelineWireEvent (eventType + emittedAt, no version/timestamp)', () => {
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

    test('returns false for null / undefined / non-objects', () => {
        expect(isBusEvent(null)).toBe(false);
        expect(isBusEvent(undefined)).toBe(false);
        expect(isBusEvent('pipeline.run.started')).toBe(false);
        expect(isBusEvent(42)).toBe(false);
        expect(isBusEvent(true)).toBe(false);
        expect(isBusEvent(false)).toBe(false);
    });

    test('returns false for arrays (typeof "object" but not a BusEvent)', () => {
        // CONTRACT NOTE: today the predicate accepts arrays as long as they
        // happen to have a numeric/string `type` property and `version`/`timestamp`
        // properties. A naked array (no such props) returns false, which is the
        // case we exercise here. A future tightening should add an explicit
        // `Array.isArray(o) === false` check.
        expect(isBusEvent([])).toBe(false);
        expect(isBusEvent(['pipeline.run.started'])).toBe(false);
        expect(isBusEvent([{ type: 't', version: 0, timestamp: 1 }])).toBe(false);
    });

    test('accepts extra unknown fields (forward-compat)', () => {
        expect(
            isBusEvent({
                id: 'x',
                type: 't',
                payload: {},
                timestamp: 1,
                version: 0,
                __traceId: 'abc',
                spanId: 'def',
            }),
        ).toBe(true);
    });
});
