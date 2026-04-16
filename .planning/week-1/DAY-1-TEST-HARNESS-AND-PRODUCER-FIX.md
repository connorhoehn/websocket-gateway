# Day 1: Test Harness + Producer Bug Fix

## Morning: Build the Test Harness

The harness uses `socket.io-client` + mediasoup's server-side APIs directly (no browser needed).
For headless publishing, we use mediasoup's `DirectTransport` + `producer.send()` to inject RTP.

### TestClient Class

File: `scripts/test-harness.js`

```js
class TestClient {
  constructor(serverUrl)                  // connects socket.io-client to signaling
  async joinStage(stageId, token)         // emits join-room, gets router RTP capabilities
  async publish(kind)                     // creates producer transport, produces blank track
  async subscribe(producerId)             // creates consumer transport, consumes
  async verifyMediaFlowing()              // checks consumer.score events over 3s window
  async disconnect()                      // cleanup
  getStats()                              // { producerStats, consumerStats, transportStates }
}
```

### Server-side Synthetic Stream Injection

For tests that need actual media flowing without a browser, add a test-only endpoint on the mediasoup server:

```js
// POST /api/test/inject-stream
// Gated by NODE_ENV=development
// Creates a DirectTransport + producer in a stage, sends blank VP8 frames on a timer

async injectSyntheticStream(roomId, kind = 'video') {
  const room = this.rooms.get(roomId);
  const directTransport = await room.router.createDirectTransport();
  
  const producer = await directTransport.produce({
    kind: 'video',
    rtpParameters: {
      codecs: [{
        mimeType: 'video/VP8',
        payloadType: 101,
        clockRate: 90000,
      }],
      encodings: [{ ssrc: 1111 }],
    }
  });

  // Generate minimal valid RTP packets on interval
  const interval = setInterval(() => {
    if (producer.closed) { clearInterval(interval); return; }
    const rtpPacket = generateBlankVP8RtpPacket(sequenceNumber++, timestamp);
    producer.send(rtpPacket);
    timestamp += 3000; // 30fps at 90kHz clock
  }, 33); // ~30fps

  return { producerId: producer.id, transportId: directTransport.id, interval };
}
```

Helper to generate minimal valid VP8 RTP:
```js
function generateBlankVP8RtpPacket(seq, timestamp) {
  // RTP header: V=2, PT=101, SSRC=1111
  const header = Buffer.alloc(12);
  header[0] = 0x80;           // V=2, no padding, no extension, no CSRC
  header[1] = 101;            // PT=101 (VP8)
  header.writeUInt16BE(seq, 2);
  header.writeUInt32BE(timestamp, 4);
  header.writeUInt32BE(1111, 8); // SSRC

  // Minimal VP8 payload descriptor + empty frame
  const vp8Payload = Buffer.from([
    0x10,  // VP8 payload descriptor: S=1, PID=0
    0x00,  // VP8 payload header: keyframe, version 0
    0x9d, 0x01, 0x2a, // VP8 start code
    0x00, 0x01, 0x00, 0x01, // 1x1 frame
  ]);

  return Buffer.concat([header, vp8Payload]);
}
```

### Test Output Contract

Every test script follows this pattern:
```js
async function main() {
  const result = { test: 'test-name', passed: false, metrics: {} };
  try {
    // ... run test ...
    result.passed = true;
  } catch (err) {
    result.error = err.message;
  }
  console.log(JSON.stringify(result));
  process.exit(result.passed ? 0 : 1);
}
main();
```

---

## Afternoon: Fix Producer Storage Bug

### Current Code (broken)

`src/mediasoup-server.js:286`:
```js
this.producers.set(socket.id, producer);
// OVERWRITES — loses video producer when audio is produced
```

### Fix

Change data structure from `Map<socketId, Producer>` to `Map<socketId, Map<kind, Producer>>`:

```js
// In constructor:
this.producers = new Map(); // socketId -> Map<kind, Producer>

// In produce handler:
if (!this.producers.has(socket.id)) {
  this.producers.set(socket.id, new Map());
}
this.producers.get(socket.id).set(kind, producer);

// In newProducer broadcast (scoped to room):
socket.to(roomId).emit('newProducer', {
  producerId: producer.id,
  socketId: socket.id,
  kind,  // 'video' or 'audio' — subscriber needs this
});
```

### Update Cleanup

```js
cleanup(socketId) {
  const roomId = this.socketToRoom.get(socketId);
  
  // Clean up all producers for this socket
  const producerMap = this.producers.get(socketId);
  if (producerMap) {
    for (const [kind, producer] of producerMap) {
      producer.close();
      if (roomId) {
        this.io.to(roomId).emit('producerClosed', {
          producerId: producer.id,
          socketId,
          kind
        });
      }
    }
    this.producers.delete(socketId);
  }

  // Clean up consumers
  const consumers = this.consumers.get(socketId);
  if (consumers) {
    consumers.forEach(consumer => consumer.close());
    this.consumers.delete(socketId);
  }

  // Clean up transports
  const transports = this.transports.get(socketId);
  if (transports) {
    Object.values(transports).forEach(t => t.close());
    this.transports.delete(socketId);
  }

  this.socketToRoom.delete(socketId);
}
```

### Verification Script: `scripts/test-dual-track.js`

```
1. Connect as publisher to a room
2. Produce VIDEO track
3. Produce AUDIO track
4. Assert: producers Map has 2 entries for this socketId (video + audio)
5. Connect as subscriber
6. Receive 2 newProducer events (video + audio)
7. Consume both
8. Assert: subscriber has 2 consumers
9. Verify both consumers have score > 0 (media flowing)
10. Exit 0
```

### Files Changed
- `src/mediasoup-server.js` — producer storage, cleanup, broadcast
- `scripts/test-harness.js` — new file (TestClient class)
- `scripts/test-dual-track.js` — new file (verification)
