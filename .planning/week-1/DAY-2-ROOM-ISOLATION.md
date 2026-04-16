# Day 2: Room Isolation (Router-per-Room)

## Problem

Single `this.router` for everything. `socket.broadcast.emit` goes to ALL clients regardless of room.

## New Data Structures

```js
class MediasoupServer {
  constructor() {
    this.workers = [];             // Array<WorkerEntry> — filled in init()
    this.rooms = new Map();        // roomId -> { router, worker, participants, createdAt }
    this.socketToRoom = new Map(); // socketId -> roomId
    this.transports = new Map();   // socketId -> { producer: Transport, consumer: Transport }
    this.producers = new Map();    // socketId -> Map<kind, Producer>
    this.consumers = new Map();    // socketId -> Array<Consumer>
  }
}
```

## Room Lifecycle

### Create room (on first join)

```js
async getOrCreateRoom(roomId) {
  if (this.rooms.has(roomId)) return this.rooms.get(roomId);
  
  const workerEntry = this.getNextWorker(); // round-robin
  const router = await workerEntry.worker.createRouter({
    mediaCodecs: this.mediaCodecs
  });
  
  const room = {
    roomId,
    router,
    workerEntry,
    participants: new Map(), // socketId -> { type, metadata, joinedAt }
    createdAt: Date.now()
  };
  
  this.rooms.set(roomId, room);
  workerEntry.roomCount++;
  return room;
}
```

### Destroy room (when empty)

```js
destroyRoom(roomId) {
  const room = this.rooms.get(roomId);
  if (!room) return;
  
  room.router.close(); // Cascades: closes all transports, producers, consumers
  room.workerEntry.roomCount--;
  this.rooms.delete(roomId);
}
```

## Scoped Socket Events

Every `socket.broadcast.emit` changes to `socket.to(roomId).emit`:

```js
// BEFORE (broken — broadcasts to everyone):
socket.broadcast.emit('newProducer', { producerId, socketId, kind });

// AFTER (scoped to room):
const roomId = this.socketToRoom.get(socket.id);
socket.to(roomId).emit('newProducer', { producerId, socketId, kind });
```

Same pattern for:
- `user-joined` / `user-left`
- `newProducer` / `producerClosed`
- `chat-message`

## Updated join-room Handler

```js
socket.on('join-room', async (data, callback) => {
  const { roomId, type, metadata } = data;
  
  // Leave any existing room
  const currentRoom = this.socketToRoom.get(socket.id);
  if (currentRoom) this.leaveRoom(socket.id);
  
  // Get or create room (creates router if new)
  const room = await this.getOrCreateRoom(roomId);
  
  // Track socket -> room mapping
  this.socketToRoom.set(socket.id, roomId);
  socket.join(roomId); // Socket.io room for scoped events
  
  room.participants.set(socket.id, { type, metadata, joinedAt: Date.now() });
  
  // Return router capabilities so client can load mediasoup Device
  callback({
    success: true,
    routerRtpCapabilities: room.router.rtpCapabilities
  });
  
  // Scoped notification
  socket.to(roomId).emit('user-joined', { socketId: socket.id, type, metadata });
  
  // Send existing producers to new subscriber
  if (type === 'viewer' || type === 'subscriber') {
    for (const [producerSocketId, producerMap] of this.producers) {
      if (this.socketToRoom.get(producerSocketId) === roomId) {
        for (const [kind, producer] of producerMap) {
          socket.emit('newProducer', {
            producerId: producer.id,
            socketId: producerSocketId,
            kind
          });
        }
      }
    }
  }
});
```

## Updated Transport Creation

Transports must use the room's router, not a global one:

```js
socket.on('create-webrtc-transport', async (data, callback) => {
  const roomId = this.socketToRoom.get(socket.id);
  const room = this.rooms.get(roomId);
  if (!room) return callback({ error: 'Not in a room' });
  
  // Use listenInfos (modern API) instead of deprecated listenIps
  const transport = await room.router.createWebRtcTransport({
    listenInfos: [{
      protocol: 'udp',
      ip: process.env.MEDIASOUP_LISTEN_IP || '0.0.0.0',
      announcedAddress: process.env.MEDIASOUP_ANNOUNCED_IP || undefined
    }, {
      protocol: 'tcp',
      ip: process.env.MEDIASOUP_LISTEN_IP || '0.0.0.0',
      announcedAddress: process.env.MEDIASOUP_ANNOUNCED_IP || undefined
    }],
    enableUdp: true,
    enableTcp: true,
    preferUdp: true,
  });
  
  // ... store transport, set up events, callback with params
});
```

Note: Once WebRtcServer is added (Day 3), this changes to:
```js
const transport = await room.router.createWebRtcTransport({
  webRtcServer: room.workerEntry.webRtcServer
});
```

## Updated canConsume Check

```js
socket.on('consume', async (data, callback) => {
  const { producerId, rtpCapabilities } = data;
  const roomId = this.socketToRoom.get(socket.id);
  const room = this.rooms.get(roomId);
  
  if (!room.router.canConsume({ producerId, rtpCapabilities })) {
    return callback({ error: 'Cannot consume' });
  }
  
  // ... create consumer on room's router transport
});
```

## Room Stats Endpoint

`GET /api/rooms` returns:
```json
[
  {
    "roomId": "room-A",
    "participants": 5,
    "producers": 2,
    "consumers": 6,
    "workerPid": 12345,
    "createdAt": "2026-04-16T..."
  }
]
```

## Verification Script: `scripts/test-room-isolation.js`

```
1. Create room "room-A"
2. Publisher joins room-A, produces video
3. Create room "room-B"  
4. Subscriber joins room-B
5. Wait 2 seconds
6. Assert: subscriber in room-B received 0 newProducer events
7. Subscriber joins room-A instead
8. Assert: subscriber in room-A receives 1 newProducer event
9. Assert: consumer score > 0 (media flowing)
10. Check GET /api/rooms -> room-A has 2 participants, room-B has 0 (auto-destroyed)
11. Exit 0
```

## Files Changed
- `src/mediasoup-server.js` — room management, scoped events, transport creation
- `scripts/test-room-isolation.js` — new file
