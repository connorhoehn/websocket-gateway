// test/server/internal-postmortem.test.js
/**
 * Unit tests for the /internal/postmortem HTTP handler.
 *
 * The handler is a tiny standalone module (`src/observability/postmortem.js`)
 * so we exercise it directly with a stub req/res rather than booting the
 * full DistributedWebSocketServer. The cluster resolution path is
 * dependency-injected (`opts.getRoomOwnershipService`) so we never touch
 * the real RoomOwnershipService singleton — keeps the suite hermetic.
 *
 * Three cases exercised:
 *   1. wired + happy path        → 200 + the fixture body verbatim.
 *   2. not wired (NullRoomOwnershipService path) → 200 + { error, wired: false }.
 *   3. snapshot() throws         → 500 + { error, wired: true }.
 */

const { handlePostmortem } = require('../../src/observability/postmortem');

/**
 * Minimal stand-in for `http.ServerResponse` that records writeHead + end so
 * tests can assert on the status code, headers, and body.
 */
function createStubResponse() {
    const calls = {
        writeHead: null,
        body: null,
    };
    return {
        calls,
        writeHead(status, headers) {
            calls.writeHead = { status, headers };
        },
        end(body) {
            calls.body = body;
        },
    };
}

function silentLogger() {
    return {
        info: jest.fn(),
        debug: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
    };
}

describe('GET /internal/postmortem', () => {
    test('returns 200 + snapshot body when the cluster is wired', async () => {
        const fixtureSnapshot = {
            timestamp: 1714300000000,
            nodeId: 'node-A',
            membership: [
                { id: 'node-A', host: '10.0.0.1', port: 7000, status: 'ALIVE' },
            ],
            ownership: [
                { resourceId: 'room:abc', ownerNodeId: 'node-A' },
            ],
            locks: [
                { lockId: 'pipeline:run:42', ownerNodeId: 'node-A', expiresAt: 1714300030000 },
            ],
            inflightRebalances: [],
            walPosition: null,
            metrics: { 'wsg_active_connections{service="gateway"}': 7 },
        };

        const fakeCluster = {
            snapshot: jest.fn(() => fixtureSnapshot),
        };
        // Mock the singleton getter — return a fake RoomOwnershipService whose
        // .cluster property holds our fake cluster. Mirrors the real service's
        // shape so the resolveCluster() helper finds the snapshot fn.
        const getRoomOwnershipService = jest.fn(async () => ({
            cluster: fakeCluster,
        }));

        const res = createStubResponse();
        await handlePostmortem({}, res, {
            logger: silentLogger(),
            getRoomOwnershipService,
        });

        expect(res.calls.writeHead).toEqual({
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        });
        expect(JSON.parse(res.calls.body)).toEqual(fixtureSnapshot);
        expect(fakeCluster.snapshot).toHaveBeenCalledTimes(1);
        expect(getRoomOwnershipService).toHaveBeenCalledTimes(1);
    });

    test('returns 200 + { wired: false } when ownership routing is disabled (NullRoomOwnershipService path)', async () => {
        // NullRoomOwnershipService has no `.cluster` field — this is exactly
        // what the singleton returns when WSG_ENABLE_OWNERSHIP_ROUTING is off.
        const getRoomOwnershipService = jest.fn(async () => ({
            isEnabled: () => false,
            // no `cluster` field
        }));

        const res = createStubResponse();
        await handlePostmortem({}, res, {
            logger: silentLogger(),
            getRoomOwnershipService,
        });

        expect(res.calls.writeHead).toEqual({
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        });
        expect(JSON.parse(res.calls.body)).toEqual({
            error: 'cluster not wired',
            wired: false,
        });
    });

    test('returns 200 + { wired: false } when the singleton itself is null', async () => {
        // Belt-and-braces: if the singleton getter returns null (e.g. because
        // bootstrapGatewayCluster threw and the catch path produced null),
        // we still treat it as "not wired" and respond 200.
        const getRoomOwnershipService = jest.fn(async () => null);

        const res = createStubResponse();
        await handlePostmortem({}, res, {
            logger: silentLogger(),
            getRoomOwnershipService,
        });

        expect(res.calls.writeHead.status).toBe(200);
        expect(JSON.parse(res.calls.body)).toEqual({
            error: 'cluster not wired',
            wired: false,
        });
    });

    test('returns 500 + { wired: true } when cluster.snapshot() throws', async () => {
        const fakeCluster = {
            snapshot: jest.fn(() => {
                throw new Error('registry unreachable');
            }),
        };
        const getRoomOwnershipService = jest.fn(async () => ({
            cluster: fakeCluster,
        }));

        const logger = silentLogger();
        const res = createStubResponse();
        await handlePostmortem({}, res, {
            logger,
            getRoomOwnershipService,
        });

        expect(res.calls.writeHead).toEqual({
            status: 500,
            headers: { 'Content-Type': 'application/json' },
        });
        expect(JSON.parse(res.calls.body)).toEqual({
            error: 'registry unreachable',
            wired: true,
        });
        // The handler must log the failure so it shows up in incident review
        // alongside the 500.
        expect(logger.error).toHaveBeenCalledWith(
            '[postmortem] cluster.snapshot() threw',
            expect.objectContaining({ error: 'registry unreachable' }),
        );
    });

    test('returns 200 + { wired: false } when getRoomOwnershipService() rejects', async () => {
        // The bootstrap is async and can fail (network, file IO on identity
        // file, etc.). The handler must NOT 500 in that case — surface as
        // not-wired, same as the off-flag path.
        const getRoomOwnershipService = jest.fn(async () => {
            throw new Error('bootstrap failed');
        });

        const res = createStubResponse();
        await handlePostmortem({}, res, {
            logger: silentLogger(),
            getRoomOwnershipService,
        });

        expect(res.calls.writeHead.status).toBe(200);
        expect(JSON.parse(res.calls.body)).toEqual({
            error: 'cluster not wired',
            wired: false,
        });
    });
});
