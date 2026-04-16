/**
 * Test: Signaling Gateway (Day 7)
 *
 * Verifies that clients connect to signaling (port 3000), which proxies
 * all SFU operations to mediasoup (port 3001) via internal HTTP API.
 * Client never talks to mediasoup directly.
 */
const { TestClient, assert } = require('./test-harness');

const SIGNALING_URL = process.env.SIGNALING_URL || 'http://localhost:3000';
const MEDIASOUP_URL = process.env.MEDIASOUP_URL || 'http://localhost:3001';

async function main() {
  const result = { test: 'gateway', passed: false, metrics: {} };

  const publisher = new TestClient(SIGNALING_URL);
  const subscriber = new TestClient(SIGNALING_URL);

  try {
    // Verify signaling health (should aggregate mediasoup health)
    const healthResp = await fetch(`${SIGNALING_URL}/health`);
    const health = await healthResp.json();
    assert(health.status === 'healthy', `Health: ${health.status}`);
    assert(health.services.mediasoup.status === 'healthy', 'Mediasoup unhealthy');

    // Inject synthetic stream via signaling proxy
    const roomId = `test-gateway-${Date.now()}`;
    const injectResp = await fetch(`${SIGNALING_URL}/api/test/inject-stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ roomId }),
    });
    assert(injectResp.ok, `Inject failed: ${injectResp.status}`);
    const { injectionId, producerId } = await injectResp.json();

    // Connect clients to SIGNALING (port 3000), not mediasoup
    await publisher.connect();
    await subscriber.connect();

    // Join room through signaling gateway
    const joinResult = await subscriber.joinRoom(roomId, 'viewer');
    assert(joinResult.success, 'Join failed');
    assert(joinResult.routerRtpCapabilities, 'No RTP capabilities returned');

    // Wait for existing producer notification
    await new Promise(r => setTimeout(r, 500));

    assert(
      subscriber.newProducerEvents.length >= 1,
      `Expected >= 1 producer, got ${subscriber.newProducerEvents.length}`
    );
    assert(
      subscriber.newProducerEvents[0].producerId === producerId,
      'Wrong producer ID through gateway'
    );

    // Verify workers/rooms proxied through signaling
    const workersResp = await fetch(`${SIGNALING_URL}/api/workers`);
    assert(workersResp.ok, 'Workers proxy failed');
    const workers = await workersResp.json();
    assert(workers.totalWorkers > 0, 'No workers via gateway');

    const roomsResp = await fetch(`${SIGNALING_URL}/api/mediasoup-rooms`);
    assert(roomsResp.ok, 'Rooms proxy failed');
    const rooms = await roomsResp.json();
    assert(rooms.rooms.length > 0, 'No mediasoup rooms via gateway');

    // Verify metrics proxied
    const metricsResp = await fetch(`${SIGNALING_URL}/metrics`);
    const metricsText = await metricsResp.text();
    assert(metricsText.includes('mediasoup_workers_active'), 'Missing mediasoup metrics');
    assert(metricsText.includes('signaling_active_connections'), 'Missing signaling metrics');

    // Clean up
    await fetch(`${SIGNALING_URL}/api/test/inject-stream/${injectionId}`, { method: 'DELETE' });

    result.passed = true;
    result.metrics = {
      healthOk: true,
      producerReceivedViaGateway: true,
      workersProxied: workers.totalWorkers,
      metricsProxied: true,
    };
  } catch (err) {
    result.error = err.message;
  } finally {
    publisher.disconnect();
    subscriber.disconnect();
  }

  console.log(JSON.stringify(result));
  process.exit(result.passed ? 0 : 1);
}

main();
