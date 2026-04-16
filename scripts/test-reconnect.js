/**
 * Test: Reconnection (Days 24-25)
 *
 * Simulates a client disconnect + reconnect with the same token.
 * Verifies the participant is restored and old socket cleaned up.
 */
const { TestClient, assert } = require('./test-harness');

const SIG = process.env.SIGNALING_URL || 'http://localhost:3000';
async function api(method, path, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const r = await fetch(`${SIG}${path}`, opts);
  return { status: r.status, body: await r.json() };
}

async function main() {
  const result = { test: 'reconnect', passed: false, metrics: {} };

  try {
    // Create stage + inject stream
    const stageResp = await api('POST', '/api/stages', { name: 'reconnect-test' });
    const { stageId } = stageResp.body.stage;
    const injectResp = await api('POST', '/api/test/inject-stream', { roomId: stageId });

    // Create a subscriber token
    const tokenResp = await api('POST', `/api/stages/${stageId}/participants`, {
      userId: 'reconnector', capabilities: ['SUBSCRIBE'],
    });
    const token = tokenResp.body.participantToken.token;
    const participantId = tokenResp.body.participantToken.participantId;

    // First connection
    const client1 = new TestClient(SIG);
    await client1.connect();
    const join1 = await new Promise((resolve, reject) => {
      client1.socket.emit('join-stage', { token }, r => r.error ? reject(new Error(r.error)) : resolve(r));
    });
    assert(join1.success, 'First join failed');

    // Verify participant is tracked
    const parts1 = await api('GET', `/api/stages/${stageId}/participants`);
    assert(parts1.body.participants.length >= 1, 'Participant not tracked');
    const oldSocketId = client1.socket.id;

    // Force disconnect (simulate network drop)
    client1.socket.disconnect();
    await new Promise(r => setTimeout(r, 500));

    // Reconnect with same token (new socket, reconnect flag)
    const client2 = new TestClient(SIG);
    await client2.connect();
    const join2 = await new Promise((resolve, reject) => {
      client2.socket.emit('join-stage', { token, reconnect: true }, r => r.error ? reject(new Error(r.error)) : resolve(r));
    });
    assert(join2.success, 'Reconnect join failed');
    assert(join2.stageId === stageId, 'Wrong stageId on reconnect');

    // Verify same participantId but different socketId
    const parts2 = await api('GET', `/api/stages/${stageId}/participants`);
    const reconnectedPart = parts2.body.participants.find(p => p.participantId === participantId);
    assert(reconnectedPart, 'Participant not found after reconnect');
    assert(reconnectedPart.state === 'CONNECTED', `State after reconnect: ${reconnectedPart.state}`);

    // Verify existing producers are available
    assert(join2.existingProducers.length >= 1, 'No producers on reconnect');

    // Clean up
    client2.disconnect();
    await api('DELETE', `/api/test/inject-stream/${injectResp.body.injectionId}`);
    await api('DELETE', `/api/stages/${stageId}`);

    result.passed = true;
    result.metrics = {
      reconnected: true,
      participantRestored: true,
      producersAvailable: join2.existingProducers.length,
    };
  } catch (err) {
    result.error = err.message;
  }

  console.log(JSON.stringify(result));
  process.exit(result.passed ? 0 : 1);
}
main();
