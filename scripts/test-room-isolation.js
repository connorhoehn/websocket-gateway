/**
 * Test: Room Isolation (Day 2)
 *
 * Verifies that producers in Room A are NOT visible to subscribers in Room B.
 */
const { TestClient, apiRequest, assert } = require('./test-harness');

async function main() {
  const result = { test: 'room-isolation', passed: false, metrics: {} };

  const publisherA = new TestClient();
  const subscriberB = new TestClient();
  const subscriberA = new TestClient();

  try {
    await Promise.all([publisherA.connect(), subscriberB.connect(), subscriberA.connect()]);

    const roomA = `test-room-A-${Date.now()}`;
    const roomB = `test-room-B-${Date.now()}`;

    // Publisher joins room A
    await publisherA.joinRoom(roomA, 'streamer');

    // Inject synthetic stream in room A
    const injectResp = await apiRequest('POST', '/api/test/inject-stream', { roomId: roomA });
    assert(injectResp.status === 200, 'Inject failed');
    const { injectionId } = injectResp.body;

    // Subscriber joins room B
    await subscriberB.joinRoom(roomB, 'viewer');

    // Wait a moment for any stray events
    await new Promise(r => setTimeout(r, 1000));

    // Room B subscriber should have received ZERO producer events
    assert(
      subscriberB.newProducerEvents.length === 0,
      `Room B subscriber got ${subscriberB.newProducerEvents.length} producers (expected 0)`
    );

    // Now subscriber joins room A — should see the producer
    await subscriberA.joinRoom(roomA, 'viewer');

    // Wait for the existing producer notification
    await new Promise(r => setTimeout(r, 500));

    assert(
      subscriberA.newProducerEvents.length >= 1,
      `Room A subscriber got ${subscriberA.newProducerEvents.length} producers (expected >= 1)`
    );

    // Verify rooms via API
    const roomsResp = await apiRequest('GET', '/api/rooms');
    const rooms = roomsResp.body.rooms;
    const rA = rooms.find(r => r.roomId === roomA);
    const rB = rooms.find(r => r.roomId === roomB);

    assert(rA, 'Room A not found');
    assert(rA.producers >= 1, `Room A should have >= 1 producer`);

    // Room B may or may not still exist (subscriber joined but no producers)
    // Either way, it should have 0 producers
    if (rB) {
      assert(rB.producers === 0, `Room B should have 0 producers, got ${rB.producers}`);
    }

    // Clean up
    await apiRequest('DELETE', `/api/test/inject-stream/${injectionId}`);

    result.passed = true;
    result.metrics = {
      roomBProducerEvents: subscriberB.newProducerEvents.length,
      roomAProducerEvents: subscriberA.newProducerEvents.length,
    };
  } catch (err) {
    result.error = err.message;
  } finally {
    publisherA.disconnect();
    subscriberB.disconnect();
    subscriberA.disconnect();
  }

  console.log(JSON.stringify(result));
  process.exit(result.passed ? 0 : 1);
}

main();
