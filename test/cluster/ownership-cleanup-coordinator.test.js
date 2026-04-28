// test/cluster/ownership-cleanup-coordinator.test.js
/**
 * Unit tests for OwnershipCleanupCoordinator (Wave 4b W1).
 *
 * Mocks the ownership-service entirely (a plain Node EventEmitter is
 * sufficient — the coordinator only reads `.on()` / `.off()`). No real
 * cluster bootstrap.
 */

const { EventEmitter } = require('events');
const {
    OwnershipCleanupCoordinator,
    _resetSingletonForTests,
} = require('../../src/services/ownership-cleanup-coordinator');
const { NullRoomOwnershipService } = require('../../src/services/room-ownership-service');

function silentLogger() {
    return {
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn(),
    };
}

/**
 * Build a coordinator with the same stub-handler set the singleton wires
 * by default (chat / presence / reactions / cursors). We don't import
 * `getOwnershipCleanupCoordinator` because we want a fresh coordinator per
 * test against a mock ownership service.
 */
function buildCoordinatorWithStubs(ownershipService, logger) {
    const coord = new OwnershipCleanupCoordinator({ ownershipService, logger });
    const spies = {
        chat: { onLost: jest.fn(async () => {}), onGained: jest.fn(async () => {}) },
        presence: { onLost: jest.fn(async () => {}), onGained: jest.fn(async () => {}) },
        reactions: { onLost: jest.fn(async () => {}), onGained: jest.fn(async () => {}) },
        cursors: { onLost: jest.fn(async () => {}), onGained: jest.fn(async () => {}) },
    };
    for (const [type, handlers] of Object.entries(spies)) {
        coord.registerCleanupHandler(type, handlers);
    }
    return { coord, spies };
}

describe('OwnershipCleanupCoordinator', () => {
    let logger;

    beforeEach(() => {
        _resetSingletonForTests();
        logger = silentLogger();
    });

    afterEach(() => {
        _resetSingletonForTests();
    });

    it('after start(), ownership:lost dispatches to all four pre-registered handlers exactly once', async () => {
        const ownership = new EventEmitter();
        const { coord, spies } = buildCoordinatorWithStubs(ownership, logger);
        coord.start();

        ownership.emit('ownership:lost', { roomId: 'room-1', ownerId: 'node-B', isLocal: false });

        // _dispatch is fire-and-forget; let the microtask queue drain.
        await new Promise((r) => setImmediate(r));
        await new Promise((r) => setImmediate(r));

        expect(spies.chat.onLost).toHaveBeenCalledTimes(1);
        expect(spies.presence.onLost).toHaveBeenCalledTimes(1);
        expect(spies.reactions.onLost).toHaveBeenCalledTimes(1);
        expect(spies.cursors.onLost).toHaveBeenCalledTimes(1);

        // None of the gained-handlers should have fired.
        expect(spies.chat.onGained).not.toHaveBeenCalled();
        expect(spies.presence.onGained).not.toHaveBeenCalled();
        expect(spies.reactions.onGained).not.toHaveBeenCalled();
        expect(spies.cursors.onGained).not.toHaveBeenCalled();

        coord.stop();
    });

    it('ownership:gained dispatches to all four onGained handlers', async () => {
        const ownership = new EventEmitter();
        const { coord, spies } = buildCoordinatorWithStubs(ownership, logger);
        coord.start();

        ownership.emit('ownership:gained', { roomId: 'room-2', ownerId: 'node-A', isLocal: true });

        await new Promise((r) => setImmediate(r));
        await new Promise((r) => setImmediate(r));

        expect(spies.chat.onGained).toHaveBeenCalledTimes(1);
        expect(spies.presence.onGained).toHaveBeenCalledTimes(1);
        expect(spies.reactions.onGained).toHaveBeenCalledTimes(1);
        expect(spies.cursors.onGained).toHaveBeenCalledTimes(1);

        coord.stop();
    });

    it('one handler throwing does NOT block the others', async () => {
        const ownership = new EventEmitter();
        const coord = new OwnershipCleanupCoordinator({ ownershipService: ownership, logger });

        // Throwing handler.
        coord.registerCleanupHandler('throws', {
            onLost: () => { throw new Error('boom (sync)'); },
        });

        // Counter handler.
        let counter = 0;
        coord.registerCleanupHandler('counter', {
            onLost: async () => { counter += 1; },
        });

        coord.start();
        ownership.emit('ownership:lost', { roomId: 'room-3' });

        // Drain microtasks; allSettled needs at least one tick.
        await new Promise((r) => setImmediate(r));
        await new Promise((r) => setImmediate(r));

        expect(counter).toBe(1);
        // The error handler should have been called via logger.error.
        expect(logger.error).toHaveBeenCalled();

        coord.stop();
    });

    it('a slow handler (>100ms) does NOT block a fast handler from resolving first', async () => {
        const ownership = new EventEmitter();
        const coord = new OwnershipCleanupCoordinator({ ownershipService: ownership, logger });

        const completionOrder = [];
        coord.registerCleanupHandler('slow', {
            onLost: async () => {
                await new Promise((r) => setTimeout(r, 200));
                completionOrder.push('slow');
            },
        });
        coord.registerCleanupHandler('fast', {
            onLost: async () => {
                completionOrder.push('fast');
            },
        });

        coord.start();
        ownership.emit('ownership:lost', { roomId: 'room-4' });

        // Wait long enough for both to settle.
        await new Promise((r) => setTimeout(r, 300));

        expect(completionOrder).toEqual(['fast', 'slow']);

        coord.stop();
    });

    it('crdt-editor is NOT in getRegisteredTypes()', () => {
        const ownership = new EventEmitter();
        const { coord } = buildCoordinatorWithStubs(ownership, logger);
        const types = coord.getRegisteredTypes();
        expect(types).toEqual(expect.arrayContaining(['chat', 'presence', 'reactions', 'cursors']));
        expect(types).not.toContain('crdt-editor');
    });

    it('registerCleanupHandler("crdt-editor", ...) throws', () => {
        const ownership = new EventEmitter();
        const coord = new OwnershipCleanupCoordinator({ ownershipService: ownership, logger });
        expect(() =>
            coord.registerCleanupHandler('crdt-editor', { onLost: async () => {} }),
        ).toThrow(/crdt-editor/);
    });

    it('start() against a NullRoomOwnershipService is a no-op (no throw)', () => {
        // NullRoomOwnershipService extends EventEmitter so it actually DOES
        // expose .on(). To exercise the "no .on()" branch we use a bare
        // object; we additionally verify NullRoomOwnershipService doesn't
        // crash start().
        const nullSvc = new NullRoomOwnershipService({ logger });
        const coord1 = new OwnershipCleanupCoordinator({ ownershipService: nullSvc, logger });
        expect(() => coord1.start()).not.toThrow();
        coord1.stop();

        const fakeNoOn = { /* no .on() method */ };
        const coord2 = new OwnershipCleanupCoordinator({ ownershipService: fakeNoOn, logger });
        expect(() => coord2.start()).not.toThrow();
        // stop() against a never-started coordinator should also be safe.
        expect(() => coord2.stop()).not.toThrow();
    });

    it('stop() removes listeners — emitting after stop does NOT invoke handlers', async () => {
        const ownership = new EventEmitter();
        const { coord, spies } = buildCoordinatorWithStubs(ownership, logger);
        coord.start();
        coord.stop();

        ownership.emit('ownership:lost', { roomId: 'room-5' });
        await new Promise((r) => setImmediate(r));
        await new Promise((r) => setImmediate(r));

        expect(spies.chat.onLost).not.toHaveBeenCalled();
        expect(spies.presence.onLost).not.toHaveBeenCalled();
        expect(spies.reactions.onLost).not.toHaveBeenCalled();
        expect(spies.cursors.onLost).not.toHaveBeenCalled();
    });

    it('event missing roomId logs a warning and does not dispatch', async () => {
        const ownership = new EventEmitter();
        const { coord, spies } = buildCoordinatorWithStubs(ownership, logger);
        coord.start();

        ownership.emit('ownership:lost', { /* no roomId */ });
        await new Promise((r) => setImmediate(r));

        expect(logger.warn).toHaveBeenCalled();
        expect(spies.chat.onLost).not.toHaveBeenCalled();

        coord.stop();
    });
});
