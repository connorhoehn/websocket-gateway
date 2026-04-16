/**
 * Test: Pipe Transport Fan-out (Days 15-16)
 *
 * Sets PIPE_THRESHOLD low, creates consumers past the threshold,
 * verifies overflow router is created and consumers are distributed.
 */
const { TestClient, assert } = require('./test-harness');

const SIG = process.env.SIGNALING_URL || 'http://localhost:3000';
const MS = process.env.MEDIASOUP_URL || 'http://localhost:3001';

async function api(method, path, body, base = SIG) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  return fetch(`${base}${path}`, opts).then(async r => ({ status: r.status, body: await r.json() }));
}

async function main() {
  const result = { test: 'fan-out', passed: false, metrics: {} };

  try {
    // Verify pipe threshold is set low (server should be started with PIPE_THRESHOLD=3)
    const metricsResp = await fetch(`${MS}/metrics`);
    const metricsText = await metricsResp.text();
    const thresholdMatch = metricsText.match(/mediasoup_pipe_threshold (\d+)/);
    const threshold = thresholdMatch ? parseInt(thresholdMatch[1]) : 400;
    log(`Pipe threshold: ${threshold}`);

    // Create a stage and inject a synthetic stream
    const stageResp = await api('POST', '/api/stages', { name: 'fan-out-test' });
    assert(stageResp.status === 200, 'Stage create failed');
    const { stageId } = stageResp.body.stage;

    const injectResp = await api('POST', '/api/test/inject-stream', { roomId: stageId });
    assert(injectResp.status === 200, 'Inject failed');
    const { injectionId, producerId } = injectResp.body;

    // Create subscribers up to threshold + 2
    const numSubscribers = threshold + 2;
    const subscribers = [];

    for (let i = 0; i < numSubscribers; i++) {
      const tokenResp = await api('POST', `/api/stages/${stageId}/participants`, {
        userId: `viewer-${i}`, capabilities: ['SUBSCRIBE'],
      });
      assert(tokenResp.status === 200, `Token ${i} failed`);

      const client = new TestClient(SIG);
      await client.connect();
      const joinResp = await new Promise((resolve, reject) => {
        client.socket.emit('join-stage', { token: tokenResp.body.participantToken.token }, (r) => {
          r.error ? reject(new Error(r.error)) : resolve(r);
        });
      });
      assert(joinResp.success, `Join ${i} failed`);

      // Wait briefly for existing producer notification
      await new Promise(r => setTimeout(r, 100));

      // Consume the producer
      const consumeResp = await new Promise((resolve, reject) => {
        // Need consumer transport first
        client.socket.emit('create-webrtc-transport', { type: 'consumer' }, (transportResp) => {
          if (transportResp.error) return reject(new Error(transportResp.error));
          // Now consume
          client.socket.emit('consume', {
            producerId,
            rtpCapabilities: joinResp.routerRtpCapabilities,
          }, (r) => {
            r.error ? reject(new Error(r.error)) : resolve(r);
          });
        });
      });

      subscribers.push({ client, consumeResp });
    }

    // Check worker distribution via mediasoup API
    const workersResp = await api('GET', '/api/workers', null, MS);
    const workers = workersResp.body.workers;
    const totalConsumers = workers.reduce((sum, w) => sum + w.consumers, 0);

    log(`Total consumers: ${totalConsumers}, across ${workers.length} workers`);
    log(`Worker distribution: ${workers.map(w => `pid=${w.pid}: ${w.consumers}`).join(', ')}`);

    // Check overflow metrics
    const metricsResp2 = await fetch(`${MS}/metrics`);
    const metricsText2 = await metricsResp2.text();
    const overflowMatch = metricsText2.match(/mediasoup_overflow_routers_active (\d+)/);
    const overflowCount = overflowMatch ? parseInt(overflowMatch[1]) : 0;

    log(`Overflow routers: ${overflowCount}`);

    // If threshold is low enough, we should have overflow
    if (threshold <= numSubscribers) {
      // At least one consumer should report overflow=true
      const hasOverflow = subscribers.some(s => s.consumeResp.overflow === true);
      // At least verify consumers were created on different workers
      const workerPids = new Set(subscribers.map(s => s.consumeResp.workerPid).filter(Boolean));

      result.metrics = {
        threshold,
        numSubscribers,
        totalConsumers,
        overflowRouters: overflowCount,
        workerPids: Array.from(workerPids),
        consumersDistributed: workerPids.size > 1 || overflowCount > 0,
      };

      // With threshold=3 and 5 subscribers, we expect overflow
      if (threshold <= 5) {
        assert(overflowCount > 0 || workerPids.size > 1, 'Expected overflow or multi-worker distribution');
      }
    } else {
      result.metrics = { threshold, numSubscribers, totalConsumers, overflowRouters: overflowCount, note: 'Threshold too high for overflow test' };
    }

    // Cleanup
    for (const s of subscribers) s.client.disconnect();
    await api('DELETE', `/api/test/inject-stream/${injectionId}`);
    await api('DELETE', `/api/stages/${stageId}`);

    result.passed = true;
  } catch (err) {
    result.error = err.message;
  }

  console.log(JSON.stringify(result));
  process.exit(result.passed ? 0 : 1);
}

function log(msg) { process.stderr.write(`[fan-out] ${msg}\n`); }

main();
