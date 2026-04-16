/**
 * Test: Multi-Worker Distribution (Day 3)
 *
 * Verifies that rooms distribute across workers (round-robin).
 */
const { TestClient, apiRequest, assert } = require('./test-harness');

async function main() {
  const result = { test: 'multi-worker', passed: false, metrics: {} };

  const clients = [];

  try {
    // Check workers are up
    const workersResp = await apiRequest('GET', '/api/workers');
    assert(workersResp.status === 200, 'Workers endpoint failed');
    const numWorkers = workersResp.body.totalWorkers;
    assert(numWorkers > 0, 'No workers');

    // Create enough rooms to distribute across workers
    const numRooms = Math.max(numWorkers * 2, 4);
    const injectionIds = [];

    for (let i = 0; i < numRooms; i++) {
      const roomId = `test-worker-${Date.now()}-${i}`;
      const resp = await apiRequest('POST', '/api/test/inject-stream', { roomId });
      assert(resp.status === 200, `Failed to inject stream in room ${i}`);
      injectionIds.push(resp.body.injectionId);
    }

    // Check distribution
    const afterResp = await apiRequest('GET', '/api/workers');
    const workers = afterResp.body.workers;

    // Count total rooms across workers
    const totalRooms = workers.reduce((sum, w) => sum + w.rooms, 0);
    assert(totalRooms >= numRooms, `Expected >= ${numRooms} rooms total, got ${totalRooms}`);

    // If multiple workers, check distribution (not all on one)
    if (numWorkers > 1) {
      const maxRooms = Math.max(...workers.map(w => w.rooms));
      const minRooms = Math.min(...workers.map(w => w.rooms));
      // With round-robin, max-min should be <= 1
      assert(
        maxRooms - minRooms <= 1,
        `Rooms not evenly distributed: max=${maxRooms}, min=${minRooms}`
      );
    }

    // Verify health endpoint
    const healthResp = await apiRequest('GET', '/health');
    assert(healthResp.status === 200, 'Health check failed');
    assert(healthResp.body.status === 'healthy', `Status: ${healthResp.body.status}`);
    assert(healthResp.body.workers.alive === numWorkers, 'Not all workers alive');

    // Verify metrics endpoint
    const metricsResp = await fetch(`${process.env.SERVER_URL || 'http://localhost:3001'}/metrics`);
    const metricsText = await metricsResp.text();
    assert(metricsText.includes('mediasoup_workers_active'), 'Missing workers metric');
    assert(metricsText.includes('mediasoup_rooms_active'), 'Missing rooms metric');

    // Clean up
    for (const id of injectionIds) {
      await apiRequest('DELETE', `/api/test/inject-stream/${id}`);
    }

    result.passed = true;
    result.metrics = {
      numWorkers,
      numRooms,
      distribution: workers.map(w => ({ pid: w.pid, rooms: w.rooms })),
    };
  } catch (err) {
    result.error = err.message;
  } finally {
    clients.forEach(c => c.disconnect());
  }

  console.log(JSON.stringify(result));
  process.exit(result.passed ? 0 : 1);
}

main();
