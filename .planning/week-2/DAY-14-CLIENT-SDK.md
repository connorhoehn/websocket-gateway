# Day 14: Client SDK

Clean API wrapping signaling + mediasoup-client, mirroring IVS Web Broadcast SDK patterns.

## SDK Structure

```
src/sdk/
  index.js              # Exports: LiveVideoClient, Stage, ChatRoom
  stage.js              # Stage class (join, publish, subscribe, events)
  chat-room.js          # ChatRoom class (messages, events)
  transport-manager.js  # Manages producer/consumer transports
  logger.js             # Configurable log levels
```

## LiveVideoClient

```js
// src/sdk/index.js
export class LiveVideoClient {
  constructor({ endpoint, logLevel = 'warn' }) {
    this.endpoint = endpoint;
    this.socket = null;
    this.logger = createLogger(logLevel);
  }

  connect() {
    this.socket = io(this.endpoint, {
      transports: ['websocket'],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 30000,
    });
    return new Promise((resolve, reject) => {
      this.socket.on('connect', () => resolve());
      this.socket.on('connect_error', (err) => reject(err));
    });
  }

  async joinStage(stageId, token, strategy = defaultStrategy) {
    if (!this.socket?.connected) await this.connect();
    const stage = new Stage(this.socket, stageId, token, strategy, this.logger);
    await stage.join();
    return stage;
  }

  async joinRoom(roomId, token) {
    if (!this.socket?.connected) await this.connect();
    const room = new ChatRoom(this.socket, roomId, token, this.logger);
    await room.join();
    return room;
  }

  disconnect() {
    this.socket?.disconnect();
  }
}
```

## Stage Class

Mirrors IVS Stage + StageStrategy pattern:

```js
// src/sdk/stage.js
import { EventEmitter } from 'events';
import * as mediasoupClient from 'mediasoup-client';

export class Stage extends EventEmitter {
  constructor(socket, stageId, token, strategy, logger) {
    super();
    this.socket = socket;
    this.stageId = stageId;
    this.token = token;
    this.strategy = strategy;
    this.logger = logger;

    this.device = null;
    this.producerTransport = null;
    this.consumerTransport = null;
    this.producers = new Map();    // kind -> producer
    this.consumers = new Map();    // consumerId -> { consumer, participantId, kind }
    this.participants = new Map(); // participantId -> info
    this.participantId = null;

    this._setupSocketListeners();
  }

  async join() {
    return new Promise((resolve, reject) => {
      this.socket.emit('join-stage', { token: this.token }, async (response) => {
        if (response.error) return reject(new Error(response.error));

        this.participantId = response.participantId;
        this.stageId = response.stageId;

        // Load mediasoup device
        this.device = new mediasoupClient.Device();
        await this.device.load({ routerRtpCapabilities: response.routerRtpCapabilities });

        // Auto-subscribe to existing producers based on strategy
        for (const prod of response.existingProducers || []) {
          if (this.strategy.shouldSubscribeToParticipant({ id: prod.participantId, isLocal: false })) {
            await this._consumeProducer(prod.producerId, prod.participantId, prod.kind);
          }
        }

        resolve();
      });
    });
  }

  async publish({ video = true, audio = true, simulcast = false } = {}) {
    if (!this.producerTransport) {
      await this._createProducerTransport();
    }

    const stream = await navigator.mediaDevices.getUserMedia({
      video: video ? { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } } : false,
      audio: audio ? { echoCancellation: true, noiseSuppression: true } : false
    });

    for (const track of stream.getTracks()) {
      const options = { track };

      if (track.kind === 'video' && simulcast) {
        options.encodings = [
          { maxBitrate: 100000, scaleResolutionDownBy: 4 },
          { maxBitrate: 300000, scaleResolutionDownBy: 2 },
          { maxBitrate: 900000 }
        ];
        options.codecOptions = { videoGoogleStartBitrate: 1000 };
      }

      const producer = await this.producerTransport.produce(options);
      this.producers.set(track.kind, producer);

      producer.on('transportclose', () => {
        this.producers.delete(track.kind);
      });
    }

    this.emit('publishStarted');
    return stream;
  }

  async unpublish() {
    for (const [kind, producer] of this.producers) {
      producer.close();
    }
    this.producers.clear();
    this.emit('publishStopped');
  }

  async setPreferredLayers(consumerId, { spatial, temporal }) {
    this.socket.emit('set-preferred-layers', {
      consumerId,
      spatialLayer: spatial,
      temporalLayer: temporal
    });
  }

  leave() {
    this.unpublish();
    for (const [id, { consumer }] of this.consumers) {
      consumer.close();
    }
    this.consumers.clear();
    this.socket.emit('leave-stage');
    this.removeAllListeners();
  }

  getParticipants() {
    return Array.from(this.participants.values());
  }

  // --- Private ---

  _setupSocketListeners() {
    this.socket.on('stage-participant-joined', (data) => {
      this.participants.set(data.participantId, {
        id: data.participantId,
        userId: data.userId,
        attributes: data.attributes,
        isLocal: data.participantId === this.participantId,
      });
      this.emit('participantJoined', this.participants.get(data.participantId));
    });

    this.socket.on('stage-participant-left', (data) => {
      const participant = this.participants.get(data.participantId);
      this.participants.delete(data.participantId);
      this.emit('participantLeft', participant || data);

      // Clean up consumers for this participant
      for (const [id, entry] of this.consumers) {
        if (entry.participantId === data.participantId) {
          entry.consumer.close();
          this.consumers.delete(id);
        }
      }
    });

    this.socket.on('newProducer', async (data) => {
      const participant = { id: data.participantId, isLocal: data.participantId === this.participantId };
      if (this.strategy.shouldSubscribeToParticipant(participant)) {
        await this._consumeProducer(data.producerId, data.participantId, data.kind);
      }
    });

    this.socket.on('producerClosed', (data) => {
      // Find and close matching consumer
      for (const [id, entry] of this.consumers) {
        if (entry.consumer.producerId === data.producerId) {
          entry.consumer.close();
          this.consumers.delete(id);
          this.emit('streamRemoved', { participantId: entry.participantId, kind: entry.kind });
        }
      }
    });
  }

  async _createProducerTransport() {
    return new Promise((resolve, reject) => {
      this.socket.emit('create-webrtc-transport', { type: 'producer' }, async (response) => {
        if (response.error) return reject(new Error(response.error));

        this.producerTransport = this.device.createSendTransport(response);

        this.producerTransport.on('connect', ({ dtlsParameters }, callback, errback) => {
          this.socket.emit('connect-transport', {
            transportId: response.id,
            type: 'producer',
            dtlsParameters
          }, (result) => result?.error ? errback(new Error(result.error)) : callback());
        });

        this.producerTransport.on('produce', ({ kind, rtpParameters, appData }, callback, errback) => {
          this.socket.emit('produce', {
            transportId: response.id,
            kind,
            rtpParameters,
            appData
          }, (result) => result?.error ? errback(new Error(result.error)) : callback(result));
        });

        resolve();
      });
    });
  }

  async _createConsumerTransport() {
    return new Promise((resolve, reject) => {
      this.socket.emit('create-webrtc-transport', { type: 'consumer' }, async (response) => {
        if (response.error) return reject(new Error(response.error));

        this.consumerTransport = this.device.createRecvTransport(response);

        this.consumerTransport.on('connect', ({ dtlsParameters }, callback, errback) => {
          this.socket.emit('connect-transport', {
            transportId: response.id,
            type: 'consumer',
            dtlsParameters
          }, (result) => result?.error ? errback(new Error(result.error)) : callback());
        });

        resolve();
      });
    });
  }

  async _consumeProducer(producerId, participantId, kind) {
    if (!this.consumerTransport) {
      await this._createConsumerTransport();
    }

    return new Promise((resolve, reject) => {
      this.socket.emit('consume', {
        transportId: this.consumerTransport.id,
        producerId,
        rtpCapabilities: this.device.rtpCapabilities
      }, async (response) => {
        if (response.error) return reject(new Error(response.error));

        const consumer = await this.consumerTransport.consume({
          id: response.id,
          producerId,
          kind: response.kind,
          rtpParameters: response.rtpParameters
        });

        this.consumers.set(consumer.id, { consumer, participantId, kind });

        // Resume
        this.socket.emit('resume', { consumerId: consumer.id }, () => {});

        this.emit('streamReceived', {
          participantId,
          kind,
          track: consumer.track,
          consumer
        });

        resolve(consumer);
      });
    });
  }
}
```

## Default Strategy

```js
const defaultStrategy = {
  shouldSubscribeToParticipant: (participant) => !participant.isLocal,
  subscribeConfiguration: () => ({
    subscribeType: 'AUDIO_VIDEO',
    preferredLayers: { spatial: 2, temporal: 2 }
  })
};
```

## ChatRoom Class

```js
// src/sdk/chat-room.js
export class ChatRoom extends EventEmitter {
  constructor(socket, roomId, token, logger) { ... }

  async join() { /* emit join-room with token */ }

  async sendMessage(content, attributes = {}) {
    const requestId = nanoid(8);
    return new Promise((resolve, reject) => {
      this.socket.emit('chat-action', {
        action: 'SEND_MESSAGE', content, attributes, requestId
      }, (resp) => resp.error ? reject(new Error(resp.error)) : resolve(resp.messageId));
    });
  }

  async deleteMessage(messageId, reason = '') { /* similar */ }

  disconnect() {
    this.socket.leave(`chat:${this.roomId}`);
    this.removeAllListeners();
  }
}
```

## Updated Demo Pages

`src/static/demo-stage.html` uses new SDK:
```html
<script type="module">
  import { LiveVideoClient } from '/sdk/index.js';

  const client = new LiveVideoClient({ endpoint: window.location.origin });
  const stage = await client.joinStage(stageId, token);

  stage.on('participantJoined', (p) => addParticipant(p));
  stage.on('streamReceived', ({ participantId, track }) => attachTrack(participantId, track));
  stage.on('participantLeft', (p) => removeParticipant(p));

  document.getElementById('publishBtn').onclick = () => stage.publish({ simulcast: true });
</script>
```

## Files Changed
- `src/sdk/` — new directory (index.js, stage.js, chat-room.js, transport-manager.js, logger.js)
- `src/static/demo-stage.html` — new demo using SDK
- `src/static/demo-broadcast.html` — new demo using SDK
- Old `src/static/mediasoup-client.js` — can be removed (replaced by SDK)
