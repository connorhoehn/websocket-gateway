# Days 12-13: Room (Chat/Data) Layer

Implements IVS Chat equivalents: CreateRoom, CreateChatToken, SendMessage, DeleteMessage, DisconnectUser.

## REST Endpoints

### POST /api/rooms

```js
app.post('/api/rooms', (req, res) => {
  const {
    name = '',
    maximumMessageLength = 500,       // IVS default
    maximumMessageRatePerSecond = 10,  // IVS default
    linkedStageId = null
  } = req.body;

  if (maximumMessageLength < 1 || maximumMessageLength > 500) {
    return res.status(400).json({ error: 'maximumMessageLength must be 1-500' });
  }
  if (maximumMessageRatePerSecond < 1 || maximumMessageRatePerSecond > 100) {
    return res.status(400).json({ error: 'maximumMessageRatePerSecond must be 1-100' });
  }
  if (linkedStageId && !stageManager.stages.has(linkedStageId)) {
    return res.status(400).json({ error: 'Linked stage not found' });
  }

  const roomId = `room_${nanoid(12)}`;
  const room = {
    roomId, name, maximumMessageLength, maximumMessageRatePerSecond,
    linkedStageId,
    participants: new Map(),  // userId -> { socketId, attributes, capabilities }
    messages: [],             // Recent message log (capped at 100)
    createdAt: new Date(),
  };

  roomManager.rooms.set(roomId, room);
  res.status(200).json({ room: serializeRoom(room) });
});
```

### POST /api/rooms/:roomId/tokens

```js
app.post('/api/rooms/:roomId/tokens', (req, res) => {
  const room = roomManager.rooms.get(req.params.roomId);
  if (!room) return res.status(404).json({ error: 'Room not found' });

  const {
    userId,
    capabilities = ['SEND_MESSAGE'],
    sessionDurationInMinutes = 60,
    attributes = {}
  } = req.body;

  if (!userId) return res.status(400).json({ error: 'userId required' });

  const validCaps = ['SEND_MESSAGE', 'DELETE_MESSAGE', 'DISCONNECT_USER'];
  if (!capabilities.every(c => validCaps.includes(c))) {
    return res.status(400).json({ error: 'Invalid capabilities' });
  }

  const token = jwt.sign({
    roomId: room.roomId,
    userId,
    capabilities,
    attributes,
    type: 'chat'
  }, process.env.JWT_SECRET || 'dev-secret', {
    expiresIn: `${sessionDurationInMinutes}m`
  });

  res.json({
    token,
    sessionExpirationTime: new Date(Date.now() + sessionDurationInMinutes * 60000).toISOString(),
  });
});
```

### GET/PATCH/DELETE /api/rooms/:roomId

Standard CRUD — same pattern as stages.

## WebSocket: Chat Protocol

Mirrors IVS Chat messaging API wire format.

### Join Room

```js
socket.on('join-room', async ({ token }, callback) => {
  const payload = jwt.verify(token, process.env.JWT_SECRET || 'dev-secret');
  if (payload.type !== 'chat') return callback({ error: 'Invalid token type' });

  const { roomId, userId, capabilities, attributes } = payload;
  const room = roomManager.rooms.get(roomId);
  if (!room) return callback({ error: 'Room not found' });

  // Track
  room.participants.set(userId, {
    socketId: socket.id,
    userId,
    attributes,
    capabilities,
    joinedAt: new Date(),
    messageTimestamps: [],  // For rate limiting
  });

  socket.chatRoomId = roomId;
  socket.chatUserId = userId;
  socket.chatCapabilities = capabilities;
  socket.join(`chat:${roomId}`);

  callback({ success: true, roomId });
});
```

### Automatic Room Join (Linked Stage)

When a stage has a `linkedStageId`, joining the stage auto-joins the chat room:

```js
// In join-stage handler, after successful join:
if (stage.linkedRoomId) {
  const room = roomManager.rooms.get(stage.linkedRoomId);
  if (room) {
    room.participants.set(userId, { socketId: socket.id, userId, attributes, capabilities: ['SEND_MESSAGE'] });
    socket.chatRoomId = stage.linkedRoomId;
    socket.chatUserId = userId;
    socket.join(`chat:${stage.linkedRoomId}`);
  }
}
```

### SEND_MESSAGE

```js
socket.on('chat-action', async (data, callback) => {
  const { action } = data;

  if (action === 'SEND_MESSAGE') {
    const room = roomManager.rooms.get(socket.chatRoomId);
    if (!room) return callback({ error: 'Not in a room' });

    if (!socket.chatCapabilities.includes('SEND_MESSAGE')) {
      return callback({ error: 'SEND_MESSAGE not allowed' });
    }

    const { content, attributes: msgAttributes = {}, requestId } = data;

    // Validate message length
    if (!content || content.length > room.maximumMessageLength) {
      return callback({ error: `Message must be 1-${room.maximumMessageLength} characters` });
    }

    // Rate limiting
    const participant = room.participants.get(socket.chatUserId);
    const now = Date.now();
    participant.messageTimestamps = participant.messageTimestamps.filter(t => now - t < 1000);
    if (participant.messageTimestamps.length >= room.maximumMessageRatePerSecond) {
      return callback({ error: 'Rate limit exceeded' });
    }
    participant.messageTimestamps.push(now);

    // Create message
    const messageId = `msg_${nanoid(12)}`;
    const message = {
      type: 'MESSAGE',
      id: messageId,
      requestId,
      content,
      sendTime: new Date().toISOString(),
      sender: {
        userId: socket.chatUserId,
        attributes: participant.attributes
      },
      attributes: msgAttributes
    };

    // Store (capped)
    room.messages.push(message);
    if (room.messages.length > 100) room.messages.shift();

    // Broadcast to room
    io.to(`chat:${socket.chatRoomId}`).emit('chat-event', message);

    callback({ success: true, messageId });
  }

  else if (action === 'DELETE_MESSAGE') {
    if (!socket.chatCapabilities.includes('DELETE_MESSAGE')) {
      return callback({ error: 'DELETE_MESSAGE not allowed' });
    }

    const { id: messageId, reason = '', requestId } = data;

    // Broadcast delete event
    io.to(`chat:${socket.chatRoomId}`).emit('chat-event', {
      type: 'EVENT',
      id: `evt_${nanoid(12)}`,
      eventName: 'aws:DELETE_MESSAGE',
      sendTime: new Date().toISOString(),
      attributes: { messageId, reason },
      requestId
    });

    callback({ success: true });
  }

  else if (action === 'DISCONNECT_USER') {
    if (!socket.chatCapabilities.includes('DISCONNECT_USER')) {
      return callback({ error: 'DISCONNECT_USER not allowed' });
    }

    const { userId: targetUserId, reason = '' } = data;
    const room = roomManager.rooms.get(socket.chatRoomId);
    const target = room?.participants.get(targetUserId);
    if (target) {
      const targetSocket = io.sockets.sockets.get(target.socketId);
      if (targetSocket) {
        targetSocket.emit('chat-event', {
          type: 'EVENT',
          eventName: 'DISCONNECT',
          attributes: { reason }
        });
        targetSocket.leave(`chat:${socket.chatRoomId}`);
      }
      room.participants.delete(targetUserId);
    }

    callback({ success: true });
  }
});
```

## RoomManager Class

```js
class RoomManager {
  constructor() {
    this.rooms = new Map();  // roomId -> RoomRecord
  }
}
```

## Verification Script: `scripts/test-chat.js`

```
1.  POST /api/rooms { name: 'test-chat', maximumMessageRatePerSecond: 5, maximumMessageLength: 100 }
    Assert: 200, roomId

2.  Create 2 chat tokens (user-A: SEND+DELETE, user-B: SEND only)

3.  User A connects, joins room
4.  User B connects, joins room

5.  User A sends: { action: 'SEND_MESSAGE', content: 'Hello!', requestId: 'r1' }
    Assert: both users receive MESSAGE event with correct sender, content, id

6.  User A sends message with content.length > 100
    Assert: error about message length

7.  User B sends 5 messages rapidly (within 1 second)
    Assert: first 5 succeed
8.  User B sends 6th message within same second
    Assert: error 'Rate limit exceeded'

9.  User A sends: { action: 'DELETE_MESSAGE', id: <messageId from step 5>, reason: 'spam' }
    Assert: both users receive EVENT with eventName 'aws:DELETE_MESSAGE'

10. User B attempts DELETE_MESSAGE
    Assert: error 'DELETE_MESSAGE not allowed'

11. Exit 0
```

## Files Changed
- `src/signaling-server.js` — RoomManager, chat endpoints, chat socket handlers
- `scripts/test-chat.js` — new file
