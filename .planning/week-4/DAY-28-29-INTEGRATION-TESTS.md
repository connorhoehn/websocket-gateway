# Days 28-29: Full Integration Test Suite

## Test Runner: `scripts/test-full-suite.js`

Runs all tests in sequence, collects results, exits with overall pass/fail.

```js
const tests = [
  // Foundation (Week 1)
  { name: 'dual-track',       script: 'test-dual-track.js',       category: 'Foundation' },
  { name: 'room-isolation',   script: 'test-room-isolation.js',   category: 'Foundation' },
  { name: 'multi-worker',     script: 'test-multi-worker.js',     category: 'Foundation' },
  { name: 'gateway',          script: 'test-gateway.js',          category: 'Foundation' },

  // API (Week 2)
  { name: 'stage-crud',       script: 'test-stage-crud.js',       category: 'API' },
  { name: 'participant-flow', script: 'test-participant-flow.js', category: 'API' },
  { name: 'chat',             script: 'test-chat.js',             category: 'API' },
  { name: 'api-suite',        script: 'test-api-suite.js',        category: 'API' },

  // Streaming (Week 3)
  { name: 'broadcast',        script: 'test-broadcast.js',        category: 'Streaming' },
  { name: 'fan-out',          script: 'test-fan-out.js',          category: 'Scaling' },
  { name: 'observability',    script: 'test-observability.js',    category: 'Observability' },

  // Resilience (Week 4)
  { name: 'recording',        script: 'test-recording.js',        category: 'Resilience' },
  { name: 'reconnect',        script: 'test-reconnect.js',        category: 'Resilience' },
];

// Optional (require K8s):
const k8sTests = [
  { name: 'scale-trigger',    script: 'test-scale-trigger.js',    category: 'K8s Scaling' },
];
```

### Runner Logic

```js
async function runSuite() {
  const results = [];

  for (const test of tests) {
    process.stdout.write(`  ${test.category}/${test.name} ... `);
    const startTime = Date.now();

    try {
      const { stdout, exitCode } = await exec(`node scripts/${test.script}`, {
        timeout: 60000,
        env: { ...process.env, SIGNALING_URL: process.env.SIGNALING_URL || 'http://localhost:3000' }
      });

      const duration = Date.now() - startTime;
      const output = JSON.parse(stdout.trim().split('\n').pop()); // Last line is JSON

      results.push({
        ...test,
        passed: exitCode === 0 && output.passed,
        duration,
        metrics: output.metrics || {}
      });

      process.stdout.write(exitCode === 0 ? `PASS (${duration}ms)\n` : `FAIL\n`);
    } catch (e) {
      results.push({ ...test, passed: false, duration: Date.now() - startTime, error: e.message });
      process.stdout.write(`FAIL (${e.message})\n`);
    }
  }

  // Summary
  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;

  console.log(`\n${'='.repeat(50)}`);
  console.log(`Results: ${passed} passed, ${failed} failed, ${results.length} total`);

  if (failed > 0) {
    console.log('\nFailed tests:');
    results.filter(r => !r.passed).forEach(r => {
      console.log(`  - ${r.category}/${r.name}: ${r.error || 'assertion failed'}`);
    });
  }

  // Output full results as JSON
  console.log(JSON.stringify({ suite: 'full', passed: failed === 0, results }, null, 2));
  process.exit(failed > 0 ? 1 : 0);
}
```

## API Suite: `scripts/test-api-suite.js`

Tests every REST endpoint returns correct shapes:

```
Stages:
  POST   /api/stages                    -> 200, { stage, participantTokens? }
  GET    /api/stages                    -> 200, { stages: [...] }
  GET    /api/stages/:id                -> 200, { stage, participants }
  PATCH  /api/stages/:id                -> 200, { stage }
  DELETE /api/stages/:id                -> 200
  POST   /api/stages/:id/participants   -> 200, { participantToken }
  GET    /api/stages/:id/participants   -> 200, { participants }
  DELETE /api/stages/:id/participants/:pid -> 200

Rooms:
  POST   /api/rooms                     -> 200, { room }
  GET    /api/rooms                     -> 200, { rooms: [...] }
  GET    /api/rooms/:id                 -> 200, { room }
  PATCH  /api/rooms/:id                 -> 200, { room }
  DELETE /api/rooms/:id                 -> 200
  POST   /api/rooms/:id/tokens          -> 200, { token }

Channels:
  POST   /api/channels                  -> 200, { channel, publishToken }
  GET    /api/channels                  -> 200, { channels: [...] }
  GET    /api/channels/:id              -> 200, { channel }
  DELETE /api/channels/:id              -> 200
  POST   /api/channels/:id/viewers      -> 200, { viewerToken }

Health/Metrics:
  GET    /api/health                    -> 200, { status, services, stages, channels, rooms }
  GET    /api/dashboard                 -> 200, { overview, stages, channels, pods }
  GET    /metrics                       -> 200, text/plain with mediasoup_* or signaling_*

Workers:
  GET    /api/workers (mediasoup)       -> 200, { workers: [...] }

Error cases:
  GET    /api/stages/nonexistent        -> 404
  POST   /api/stages { maxParticipants: -1 } -> 400
  DELETE /api/stages/nonexistent        -> 404
```

## Load Test: `scripts/test-load.js`

```
Usage: node scripts/test-load.js [--viewers=300] [--ramp=10] [--duration=30]

Parameters:
  --viewers    Total viewers to create (default: 100)
  --ramp       Viewers added per second (default: 10)
  --duration   How long each viewer stays connected (seconds, default: 30)
  --channel    Channel ID (auto-creates if not provided)

Output:
{
  "test": "load-test",
  "passed": true,
  "config": { "viewers": 100, "ramp": 10, "duration": 30 },
  "metrics": {
    "totalViewers": 100,
    "successfulJoins": 100,
    "failedJoins": 0,
    "transportCreateLatency": { "p50": 45, "p95": 120, "p99": 230 },
    "firstMediaLatency": { "p50": 340, "p95": 890, "p99": 1200 },
    "peakConsumers": 100,
    "mediaSustained": true,
    "testDuration": 42000
  }
}

Targets:
  - p95 join latency < 2000ms
  - 0 failed joins
  - All viewers receiving media (consumer score events)
```

### Load Test Implementation

```js
async function runLoadTest({ viewers = 100, ramp = 10, duration = 30 }) {
  const signalingUrl = process.env.SIGNALING_URL || 'http://localhost:3000';

  // 1. Create channel + inject synthetic publisher
  const channelResp = await fetch(`${signalingUrl}/api/channels`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'load-test', type: 'STANDARD' })
  });
  const { channel, publishToken } = await channelResp.json();

  // Start synthetic publisher
  await fetch(`${signalingUrl}/api/test/inject-stream`, {
    method: 'POST',
    body: JSON.stringify({ stageId: channel.stageId })
  });

  // 2. Ramp viewers
  const viewerResults = [];
  const batchSize = ramp;
  const totalBatches = Math.ceil(viewers / batchSize);

  for (let batch = 0; batch < totalBatches; batch++) {
    const batchViewers = Math.min(batchSize, viewers - batch * batchSize);

    const promises = Array.from({ length: batchViewers }, async () => {
      const joinStart = Date.now();

      // Get viewer token
      const tokenResp = await fetch(`${signalingUrl}/api/channels/${channel.channelId}/viewers`, {
        method: 'POST',
        body: JSON.stringify({})
      });
      const { viewerToken } = await tokenResp.json();

      // Connect
      const client = new TestClient(signalingUrl);
      const joinResult = await client.joinStageWithToken(viewerToken.token);
      const transportCreateTime = Date.now() - joinStart;

      // Wait for first media
      const mediaStart = Date.now();
      await client.waitForMedia(5000); // 5s timeout
      const firstMediaTime = Date.now() - mediaStart;

      return {
        transportCreateLatency: transportCreateTime,
        firstMediaLatency: firstMediaTime,
        success: true,
        client
      };
    });

    const batchResults = await Promise.allSettled(promises);
    viewerResults.push(...batchResults);

    // Wait 1 second between batches (ramp rate)
    if (batch < totalBatches - 1) {
      await new Promise(r => setTimeout(r, 1000));
    }
  }

  // 3. Hold for duration
  await new Promise(r => setTimeout(r, duration * 1000));

  // 4. Collect stats
  const successful = viewerResults.filter(r => r.status === 'fulfilled');
  const failed = viewerResults.filter(r => r.status === 'rejected');

  const latencies = successful.map(r => r.value.transportCreateLatency).sort((a, b) => a - b);
  const mediaLatencies = successful.map(r => r.value.firstMediaLatency).sort((a, b) => a - b);

  const percentile = (arr, p) => arr[Math.floor(arr.length * p / 100)] || 0;

  // 5. Cleanup
  for (const r of successful) {
    await r.value.client.disconnect();
  }

  return {
    totalViewers: viewers,
    successfulJoins: successful.length,
    failedJoins: failed.length,
    transportCreateLatency: {
      p50: percentile(latencies, 50),
      p95: percentile(latencies, 95),
      p99: percentile(latencies, 99),
    },
    firstMediaLatency: {
      p50: percentile(mediaLatencies, 50),
      p95: percentile(mediaLatencies, 95),
      p99: percentile(mediaLatencies, 99),
    },
    peakConsumers: successful.length,
  };
}
```

## Files Changed
- `scripts/test-full-suite.js` — new (test runner)
- `scripts/test-api-suite.js` — new (API validation)
- `scripts/test-load.js` — new (load test)
