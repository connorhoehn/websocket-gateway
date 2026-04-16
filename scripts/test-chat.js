/**
 * Test: Chat Room messaging, rate limiting, capability enforcement (Days 12-13)
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
  const result = { test: 'chat', passed: false, metrics: {} };
  const userA = new TestClient(BASE);
  const userB = new TestClient(BASE);

  try {
    // Create chat room with rate limit=5, maxLength=100
    const roomResp = await api('POST', '/api/rooms', {
      name: 'test-chat', maximumMessageRatePerSecond: 5, maximumMessageLength: 100,
    });
    assert(roomResp.status === 200, 'Room create failed');
    const { roomId } = roomResp.body.room;

    // Create tokens: A = SEND+DELETE, B = SEND only
    const tokenA = await api('POST', `/api/rooms/${roomId}/tokens`, {
      userId: 'alice', capabilities: ['SEND_MESSAGE', 'DELETE_MESSAGE'],
    });
    const tokenB = await api('POST', `/api/rooms/${roomId}/tokens`, {
      userId: 'bob', capabilities: ['SEND_MESSAGE'],
    });
    assert(tokenA.status === 200, 'Token A failed');
    assert(tokenB.status === 200, 'Token B failed');

    // Connect both
    await userA.connect();
    await userB.connect();

    // Join chat room
    const joinA = await new Promise((resolve) => {
      userA.socket.emit('join-chat-room', { token: tokenA.body.token }, resolve);
    });
    assert(joinA.success, `Join A failed: ${joinA.error}`);

    const joinB = await new Promise((resolve) => {
      userB.socket.emit('join-chat-room', { token: tokenB.body.token }, resolve);
    });
    assert(joinB.success, `Join B failed: ${joinB.error}`);

    // Collect chat events
    const eventsA = [];
    const eventsB = [];
    userA.socket.on('chat-event', (e) => eventsA.push(e));
    userB.socket.on('chat-event', (e) => eventsB.push(e));

    // A sends message
    const send1 = await new Promise((resolve) => {
      userA.socket.emit('chat-action', {
        action: 'SEND_MESSAGE', content: 'Hello world!', requestId: 'r1',
      }, resolve);
    });
    assert(send1.success, `Send failed: ${send1.error}`);
    assert(send1.messageId.startsWith('msg_'), `Bad messageId: ${send1.messageId}`);

    await new Promise(r => setTimeout(r, 200));

    // Both should receive the message
    assert(eventsA.length >= 1, `A got ${eventsA.length} events`);
    assert(eventsB.length >= 1, `B got ${eventsB.length} events`);
    assert(eventsA[0].type === 'MESSAGE', `Event type: ${eventsA[0].type}`);
    assert(eventsA[0].content === 'Hello world!', 'Content mismatch');
    assert(eventsA[0].sender.userId === 'alice', 'Sender wrong');

    // Message too long
    const longMsg = await new Promise((resolve) => {
      userA.socket.emit('chat-action', {
        action: 'SEND_MESSAGE', content: 'x'.repeat(101),
      }, resolve);
    });
    assert(longMsg.error, 'Expected error for long message');

    // Rate limit: send 5 quickly, 6th should fail
    const sends = [];
    for (let i = 0; i < 6; i++) {
      sends.push(new Promise((resolve) => {
        userB.socket.emit('chat-action', {
          action: 'SEND_MESSAGE', content: `msg-${i}`, requestId: `rl-${i}`,
        }, resolve);
      }));
    }
    const sendResults = await Promise.all(sends);
    const successes = sendResults.filter(r => r.success).length;
    const rateLimited = sendResults.filter(r => r.error === 'Rate limit exceeded').length;
    assert(successes === 5, `Expected 5 successes, got ${successes}`);
    assert(rateLimited === 1, `Expected 1 rate limited, got ${rateLimited}`);

    // A deletes a message
    const del = await new Promise((resolve) => {
      userA.socket.emit('chat-action', {
        action: 'DELETE_MESSAGE', id: send1.messageId, reason: 'spam', requestId: 'del-1',
      }, resolve);
    });
    assert(del.success, `Delete failed: ${del.error}`);

    await new Promise(r => setTimeout(r, 200));

    // Both should get delete event
    const deleteEvents = eventsA.filter(e => e.type === 'EVENT' && e.eventName === 'aws:DELETE_MESSAGE');
    assert(deleteEvents.length >= 1, 'No delete event received');

    // B tries to delete -> should fail (no DELETE_MESSAGE capability)
    const delB = await new Promise((resolve) => {
      userB.socket.emit('chat-action', {
        action: 'DELETE_MESSAGE', id: 'whatever',
      }, resolve);
    });
    assert(delB.error === 'DELETE_MESSAGE not allowed', `Expected capability error, got: ${delB.error}`);

    // Cleanup
    await api('DELETE', `/api/rooms/${roomId}`);

    result.passed = true;
    result.metrics = { messagesDelivered: true, rateLimitWorks: true, capabilityEnforced: true };
  } catch (err) {
    result.error = err.message;
  } finally {
    userA.disconnect();
    userB.disconnect();
  }
  console.log(JSON.stringify(result));
  process.exit(result.passed ? 0 : 1);
}
main();
