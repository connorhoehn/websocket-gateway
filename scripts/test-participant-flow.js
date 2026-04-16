/**
 * Test: Participant token join + publish/subscribe + capability enforcement (Days 10-11)
 */
const { TestClient, assert } = require('./test-harness');

const BASE = process.env.SIGNALING_URL || 'http://localhost:3000';
async function api(method, path, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const r = await fetch(`${BASE}${path}`, opts);
  return { status: r.status, body: await r.json() };
}

async function main() {
  const result = { test: 'participant-flow', passed: false, metrics: {} };
  const publisher = new TestClient(BASE);
  const viewer = new TestClient(BASE);

  try {
    // Create stage with 2 tokens
    const stageResp = await api('POST', '/api/stages', {
      name: 'flow-test',
      participantTokenConfigurations: [
        { userId: 'pub-user', capabilities: ['PUBLISH', 'SUBSCRIBE'] },
        { userId: 'view-user', capabilities: ['SUBSCRIBE'] },
      ],
    });
    assert(stageResp.status === 200, 'Stage create failed');
    const { stageId } = stageResp.body.stage;
    const pubToken = stageResp.body.participantTokens[0].token;
    const viewToken = stageResp.body.participantTokens[1].token;

    // Inject synthetic stream so there's something to consume
    const injectResp = await api('POST', '/api/test/inject-stream', { roomId: stageId });
    assert(injectResp.status === 200, 'Inject failed');

    // Publisher connects and joins stage
    await publisher.connect();
    const pubJoin = await new Promise((resolve, reject) => {
      publisher.socket.emit('join-stage', { token: pubToken }, (resp) => {
        resp.error ? reject(new Error(resp.error)) : resolve(resp);
      });
    });
    assert(pubJoin.success, 'Publisher join failed');
    assert(pubJoin.routerRtpCapabilities, 'No RTP capabilities');
    assert(pubJoin.stageId === stageId, 'Wrong stageId');

    // Viewer connects and joins
    await viewer.connect();
    const viewJoin = await new Promise((resolve, reject) => {
      viewer.socket.emit('join-stage', { token: viewToken }, (resp) => {
        resp.error ? reject(new Error(resp.error)) : resolve(resp);
      });
    });
    assert(viewJoin.success, 'Viewer join failed');
    assert(viewJoin.existingProducers.length >= 1, `Expected >= 1 existing producer, got ${viewJoin.existingProducers.length}`);

    // Viewer should have received participant-joined event for publisher
    // (may arrive async, check after small delay)
    await new Promise(r => setTimeout(r, 300));

    // Viewer tries to produce -> should fail
    const produceResult = await new Promise((resolve) => {
      viewer.socket.emit('produce', { kind: 'video', rtpParameters: {} }, resolve);
    });
    assert(produceResult.error === 'PUBLISH_NOT_ALLOWED', `Expected PUBLISH_NOT_ALLOWED, got: ${JSON.stringify(produceResult)}`);

    // Check participants via API
    const partsResp = await api('GET', `/api/stages/${stageId}/participants`);
    assert(partsResp.status === 200, 'List participants failed');
    assert(partsResp.body.participants.length === 2, `Expected 2 participants, got ${partsResp.body.participants.length}`);

    // Filter by state
    const connResp = await api('GET', `/api/stages/${stageId}/participants?filterByState=CONNECTED`);
    assert(connResp.body.participants.length === 2, 'Filter by CONNECTED wrong');

    // Force disconnect publisher
    const pubPid = partsResp.body.participants.find(p => p.userId === 'pub-user')?.participantId;
    assert(pubPid, 'Publisher participant not found');
    const disconnResp = await api('DELETE', `/api/stages/${stageId}/participants/${pubPid}`);
    assert(disconnResp.status === 200, 'Disconnect failed');

    await new Promise(r => setTimeout(r, 500));

    // Check participants again
    const partsResp2 = await api('GET', `/api/stages/${stageId}/participants`);
    assert(partsResp2.body.participants.length === 1, `After disconnect: ${partsResp2.body.participants.length}`);

    // Expired token test
    const expiredViewer = new TestClient(BASE);
    await expiredViewer.connect();
    const expiredJoin = await new Promise((resolve) => {
      expiredViewer.socket.emit('join-stage', { token: 'invalid.token.here' }, resolve);
    });
    assert(expiredJoin.error, 'Expected error for invalid token');
    expiredViewer.disconnect();

    // Cleanup
    await api('DELETE', `/api/test/inject-stream/${injectResp.body.injectionId}`);
    await api('DELETE', `/api/stages/${stageId}`);

    result.passed = true;
    result.metrics = { publishBlocked: true, participantsTracked: true, forceDisconnect: true };
  } catch (err) {
    result.error = err.message;
  } finally {
    publisher.disconnect();
    viewer.disconnect();
  }
  console.log(JSON.stringify(result));
  process.exit(result.passed ? 0 : 1);
}
main();
