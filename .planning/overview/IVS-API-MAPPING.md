# IVS API Mapping

How each IVS API operation maps to our local implementation.

## IVS Real-Time Streaming (Stages)

| IVS Operation | Our Endpoint | Notes |
|---|---|---|
| CreateStage | `POST /api/stages` | Creates mediasoup router on least-loaded worker |
| GetStage | `GET /api/stages/:stageId` | Returns stage detail + participant counts |
| ListStages | `GET /api/stages` | Lists all active stages |
| UpdateStage | `PATCH /api/stages/:stageId` | Update name, maxParticipants |
| DeleteStage | `DELETE /api/stages/:stageId` | Tears down router, disconnects all |
| CreateParticipantToken | `POST /api/stages/:stageId/participants` | Returns JWT with capabilities |
| GetParticipant | `GET /api/stages/:stageId/participants/:pid` | Participant detail |
| ListParticipants | `GET /api/stages/:stageId/participants` | Filter by published, state |
| DisconnectParticipant | `DELETE /api/stages/:stageId/participants/:pid` | Force disconnect |

### CreateStage Request/Response

```
POST /api/stages
{
  "name": "my-stage",
  "maxParticipants": 12,
  "participantTokenConfigurations": [
    {
      "userId": "user-123",
      "capabilities": ["PUBLISH", "SUBSCRIBE"],
      "duration": 720,
      "attributes": { "displayName": "Alice" }
    }
  ],
  "videoConfig": {
    "maxBitrate": 2500000,
    "maxResolution": "720p"
  }
}

Response 200:
{
  "stage": {
    "stageId": "stg_abc123",
    "name": "my-stage",
    "activeSessionId": null,
    "maxParticipants": 12,
    "state": "IDLE",
    "createdAt": "2026-04-16T...",
    "endpoints": { "signaling": "ws://localhost:3000" }
  },
  "participantTokens": [
    {
      "token": "eyJ...",
      "participantId": "pid_xyz",
      "userId": "user-123",
      "capabilities": ["PUBLISH", "SUBSCRIBE"],
      "expirationTime": "2026-04-17T..."
    }
  ]
}
```

### CreateParticipantToken Request/Response

```
POST /api/stages/:stageId/participants
{
  "userId": "user-456",
  "capabilities": ["PUBLISH", "SUBSCRIBE"],
  "duration": 720,
  "attributes": { "displayName": "Bob", "role": "host" }
}

Response 200:
{
  "participantToken": {
    "token": "eyJhbGciOiJIUzI1NiJ9...",
    "participantId": "pid_abc",
    "userId": "user-456",
    "capabilities": ["PUBLISH", "SUBSCRIBE"],
    "duration": 720,
    "attributes": { "displayName": "Bob", "role": "host" },
    "expirationTime": "2026-04-17T..."
  }
}
```

JWT payload structure:
```json
{
  "stageId": "stg_abc123",
  "participantId": "pid_abc",
  "userId": "user-456",
  "capabilities": ["PUBLISH", "SUBSCRIBE"],
  "attributes": { "displayName": "Bob" },
  "iat": 1713283200,
  "exp": 1713326400
}
```

## IVS Chat (Rooms)

| IVS Operation | Our Endpoint | Notes |
|---|---|---|
| CreateRoom | `POST /api/rooms` | Optional linkedStageId for auto-join |
| GetRoom | `GET /api/rooms/:roomId` | Room detail |
| ListRooms | `GET /api/rooms` | List all rooms |
| UpdateRoom | `PATCH /api/rooms/:roomId` | Update config |
| DeleteRoom | `DELETE /api/rooms/:roomId` | Tear down |
| CreateChatToken | `POST /api/rooms/:roomId/tokens` | JWT with chat capabilities |
| SendMessage | WebSocket: `{ action: "SEND_MESSAGE", content, requestId }` | |
| DeleteMessage | WebSocket: `{ action: "DELETE_MESSAGE", id, reason }` | |

### CreateRoom Request/Response

```
POST /api/rooms
{
  "name": "my-room",
  "maximumMessageLength": 500,
  "maximumMessageRatePerSecond": 10,
  "linkedStageId": "stg_abc123"
}

Response 200:
{
  "room": {
    "roomId": "room_xyz",
    "name": "my-room",
    "maximumMessageLength": 500,
    "maximumMessageRatePerSecond": 10,
    "linkedStageId": "stg_abc123",
    "createdAt": "..."
  }
}
```

### Chat WebSocket Protocol

Client sends:
```json
{ "action": "SEND_MESSAGE", "content": "Hello!", "attributes": {}, "requestId": "req-1" }
{ "action": "DELETE_MESSAGE", "id": "msg-123", "reason": "spam", "requestId": "req-2" }
```

Server broadcasts:
```json
{
  "type": "MESSAGE",
  "id": "msg-456",
  "content": "Hello!",
  "sendTime": "2026-04-16T...",
  "sender": { "userId": "user-456", "attributes": { "displayName": "Bob" } },
  "requestId": "req-1"
}
```

## IVS Channels (1:N Broadcast)

| IVS Operation | Our Endpoint | Notes |
|---|---|---|
| CreateChannel | `POST /api/channels` | Creates single-publisher stage + simulcast |
| GetChannel | `GET /api/channels/:channelId` | Detail with viewer count |
| ListChannels | `GET /api/channels` | List live channels |
| DeleteChannel | `DELETE /api/channels/:channelId` | Stop broadcast |

## IVS Stage Events -> Our WebSocket Events

| IVS EventBridge Event | Our Socket Event | Payload |
|---|---|---|
| Participant Published | `stage-participant-published` | `{ stageId, participantId, kind }` |
| Participant Unpublished | `stage-participant-unpublished` | `{ stageId, participantId, kind }` |
| (participant join) | `stage-participant-joined` | `{ stageId, participantId, userId, attributes }` |
| (participant leave) | `stage-participant-left` | `{ stageId, participantId, userId }` |

## IVS Metrics -> Our Prometheus Metrics

| IVS CloudWatch Metric | Our Prometheus Metric |
|---|---|
| ConcurrentPublishers | `mediasoup_producers_total` |
| ConcurrentSubscriptions | `mediasoup_consumers_total` |
| Publishers (per stage) | `mediasoup_stage_participants{type="publisher"}` |
| Subscribers (per stage) | `mediasoup_stage_participants{type="subscriber"}` |
| PublishBitrate | Available via `producer.getStats()` |
| SubscribeBitrate | Available via `consumer.getStats()` |
