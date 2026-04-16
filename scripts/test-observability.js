/**
 * Test: Health, Metrics, Dashboard (Day 21)
 */
const { assert } = require('./test-harness');

const SIG = process.env.SIGNALING_URL || 'http://localhost:3000';
const MS = process.env.MEDIASOUP_URL || 'http://localhost:3001';

async function api(base, path) {
  const r = await fetch(`${base}${path}`);
  const text = await r.text();
  let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: r.status, body: json, text };
}

async function main() {
  const result = { test: 'observability', passed: false, metrics: {} };
  try {
    // 1. Signaling health
    const sigHealth = await api(SIG, '/health');
    assert(sigHealth.status === 200, `Signaling health: ${sigHealth.status}`);
    assert(sigHealth.body.status === 'healthy', `Status: ${sigHealth.body.status}`);
    assert(sigHealth.body.services.signaling.status === 'healthy', 'Signaling service unhealthy');
    assert(sigHealth.body.services.mediasoup.status === 'healthy', 'Mediasoup service unhealthy');
    assert(sigHealth.body.stages !== undefined, 'No stages in health');
    assert(sigHealth.body.channels !== undefined, 'No channels in health');
    assert(sigHealth.body.chatRooms !== undefined, 'No chatRooms in health');

    // 2. Mediasoup health
    const msHealth = await api(MS, '/health');
    assert(msHealth.status === 200, `Mediasoup health: ${msHealth.status}`);
    assert(msHealth.body.workers.alive > 0, 'No workers alive');

    // 3. Signaling metrics (aggregated)
    const sigMetrics = await api(SIG, '/metrics');
    assert(sigMetrics.status === 200, 'Metrics failed');
    assert(sigMetrics.text.includes('mediasoup_workers_active'), 'Missing mediasoup metrics in aggregated');
    assert(sigMetrics.text.includes('signaling_active_connections'), 'Missing signaling metrics');
    assert(sigMetrics.text.includes('signaling_stages_active'), 'Missing stages metric');
    assert(sigMetrics.text.includes('signaling_chat_rooms_active'), 'Missing chat rooms metric');

    // 4. Mediasoup metrics (direct)
    const msMetrics = await api(MS, '/metrics');
    assert(msMetrics.text.includes('mediasoup_workers_active'), 'Missing workers metric');
    assert(msMetrics.text.includes('mediasoup_rooms_active'), 'Missing rooms metric');
    assert(msMetrics.text.includes('mediasoup_producers_total'), 'Missing producers metric');
    assert(msMetrics.text.includes('mediasoup_consumers_total'), 'Missing consumers metric');
    assert(msMetrics.text.includes('mediasoup_overflow_routers_active'), 'Missing overflow metric');
    assert(msMetrics.text.includes('mediasoup_pipe_threshold'), 'Missing threshold metric');
    assert(msMetrics.text.includes('mediasoup_worker_consumers'), 'Missing per-worker metric');

    // 5. Workers endpoint
    const workers = await api(SIG, '/api/workers');
    assert(workers.status === 200, 'Workers failed');
    assert(workers.body.totalWorkers > 0, 'No workers');
    assert(workers.body.workers[0].pid > 0, 'Invalid worker PID');
    assert(workers.body.workers[0].port > 0, 'Invalid worker port');

    // 6. TURN config
    const turn = await api(SIG, '/api/turn-config');
    assert(turn.status === 200, 'Turn config failed');
    assert(turn.body.iceServers.length > 0, 'No ICE servers');

    result.passed = true;
    result.metrics = {
      healthEndpoints: true,
      metricsAggregated: true,
      workersDiscoverable: true,
      turnConfigured: true,
    };
  } catch (err) {
    result.error = err.message;
  }
  console.log(JSON.stringify(result));
  process.exit(result.passed ? 0 : 1);
}
main();
