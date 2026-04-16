# Days 19-20: Broadcast Mode (IVS Channel Equivalent)

Channels: 1 publisher, unlimited viewers, simulcast quality layers.

## Channel API

### POST /api/channels

```js
app.post('/api/channels', async (req, res) => {
  const {
    name = '',
    type = 'STANDARD',            // BASIC (no simulcast) | STANDARD (3-layer simulcast)
    latencyMode = 'LOW',
    videoConfig = {}
  } = req.body;

  // Create a stage internally with single-publisher constraint
  const channelId = `ch_${nanoid(12)}`;
  const stageId = `stg_ch_${channelId}`;

  const pod = podRegistry.getLeastLoaded();
  await fetch(`${pod.url}/internal/rooms/${stageId}/create`, { method: 'POST' });

  const channel = {
    channelId,
    stageId,        // Internal stage backing this channel
    name,
    type,
    latencyMode,
    state: 'IDLE',  // IDLE | LIVE | STOPPED
    mediasoupPod: pod,
    videoConfig: {
      maxBitrate: videoConfig.maxBitrate || 2500000,
      maxResolution: videoConfig.maxResolution || '720p',
      simulcast: type === 'STANDARD',
    },
    publisherId: null,
    viewers: new Map(),  // participantId -> { socketId, joinedAt }
    viewerCount: 0,
    createdAt: new Date(),
  };

  channelManager.channels.set(channelId, channel);
  pod.load++;

  // Generate publish token (only one allowed)
  const publishToken = generateParticipantToken(stageId, {
    userId: 'publisher',
    capabilities: ['PUBLISH'],
    duration: 1440,
    attributes: { channelId, role: 'broadcaster' }
  });

  res.json({
    channel: serializeChannel(channel),
    publishToken
  });
});
```

### GET /api/channels

```js
app.get('/api/channels', (req, res) => {
  const channels = Array.from(channelManager.channels.values()).map(ch => ({
    channelId: ch.channelId,
    name: ch.name,
    state: ch.state,
    type: ch.type,
    viewerCount: ch.viewers.size,
    createdAt: ch.createdAt.toISOString(),
  }));
  res.json({ channels });
});
```

### GET /api/channels/:channelId

Full detail including viewer count, publisher info, quality layers available.

### DELETE /api/channels/:channelId

Stops broadcast, disconnects all viewers, destroys backing stage.

### POST /api/channels/:channelId/viewers

Generate a viewer token (SUBSCRIBE only):
```js
app.post('/api/channels/:channelId/viewers', (req, res) => {
  const channel = channelManager.channels.get(req.params.channelId);
  if (!channel) return res.status(404).json({ error: 'Channel not found' });

  const token = generateParticipantToken(channel.stageId, {
    userId: req.body.userId || `viewer_${nanoid(6)}`,
    capabilities: ['SUBSCRIBE'],
    duration: req.body.duration || 720,
    attributes: { channelId: channel.channelId, role: 'viewer', ...req.body.attributes }
  });

  res.json({ viewerToken: token });
});
```

## Single-Publisher Enforcement

In the signaling gateway's produce handler, check if this stage backs a channel:

```js
socket.on('produce', async (data, callback) => {
  const stageId = socket.stageId;

  // Check if this is a channel's backing stage
  const channel = channelManager.getChannelByStageId(stageId);
  if (channel) {
    // Only one publisher allowed
    if (channel.publisherId && channel.publisherId !== socket.participantId) {
      return callback({ error: 'Channel already has a publisher' });
    }
    channel.publisherId = socket.participantId;
    channel.state = 'LIVE';
  }

  // ... normal produce flow
});
```

## Simulcast Configuration

### Publisher Side (client SDK)

When `channel.type === 'STANDARD'`, the SDK auto-enables simulcast:

```js
// In Stage.publish() when simulcast is enabled:
if (simulcast && track.kind === 'video') {
  options.encodings = [
    {
      rid: 'r0',
      maxBitrate: 100000,
      scaleResolutionDownBy: 4,
      scalabilityMode: 'L1T3'    // Temporal scalability within each spatial layer
    },
    {
      rid: 'r1',
      maxBitrate: 300000,
      scaleResolutionDownBy: 2,
      scalabilityMode: 'L1T3'
    },
    {
      rid: 'r2',
      maxBitrate: 900000,
      scalabilityMode: 'L1T3'
    }
  ];
  options.codecOptions = {
    videoGoogleStartBitrate: 1000
  };
}
```

This produces a simulcast stream with 3 spatial layers:
- **Layer 0 (low)**: ~180p, 100kbps
- **Layer 1 (medium)**: ~360p, 300kbps
- **Layer 2 (high)**: ~720p, 900kbps

### Server Side

The mediasoup producer automatically detects simulcast from the encodings.
`producer.type` will be `"simulcast"` instead of `"simple"`.

### Viewer Quality Selection

```js
// Client SDK:
stage.setPreferredLayers(consumerId, { spatial: 0, temporal: 2 }); // Low quality, full framerate
stage.setPreferredLayers(consumerId, { spatial: 2, temporal: 2 }); // High quality, full framerate

// On signaling server:
socket.on('set-preferred-layers', async (data) => {
  const stage = stageManager.stages.get(socket.stageId);
  await fetch(`${stage.mediasoupPod.url}/internal/rooms/${socket.stageId}/consumer/${data.consumerId}/layers`, {
    method: 'POST',
    body: JSON.stringify({
      spatialLayer: data.spatialLayer,
      temporalLayer: data.temporalLayer
    })
  });
});

// On mediasoup server:
app.post('/internal/rooms/:roomId/consumer/:consumerId/layers', async (req, res) => {
  const { spatialLayer, temporalLayer } = req.body;
  const consumer = findConsumer(req.params.consumerId);
  if (consumer) {
    await consumer.setPreferredLayers({ spatialLayer, temporalLayer });
    res.json({ currentLayers: consumer.currentLayers });
  }
});
```

### Auto Quality (Default)

By default, mediasoup automatically selects the best layer based on receiver bandwidth estimation. No explicit `setPreferredLayers` call needed — it just works.

Viewers only need to call `setPreferredLayers` to manually force a quality level (e.g., "always low" for mobile data saving).

## Layer Change Events

The consumer emits `layerschange` when the active layer changes:

```js
// On mediasoup server, when consumer is created:
consumer.on('layerschange', (layers) => {
  // Notify signaling, which forwards to client
  // layers: { spatialLayer: 2, temporalLayer: 2 } or null
});
```

Client SDK exposes this as:
```js
stage.on('qualityChanged', ({ consumerId, participantId, layers }) => {
  console.log(`Viewer quality: spatial=${layers.spatialLayer}, temporal=${layers.temporalLayer}`);
});
```

## Channel Lifecycle Events

```
channel-live         { channelId, publisherId }
channel-stopped      { channelId, reason }
channel-viewer-count { channelId, count }    // Emitted every 5s while live
```

## Verification Script: `scripts/test-broadcast.js`

```
1.  POST /api/channels { name: 'test-broadcast', type: 'STANDARD' }
    Assert: 200, channelId, publishToken

2.  Publisher connects with publishToken
3.  Publisher produces video with simulcast (3 layers)
4.  Publisher produces audio
    Assert: producer.type === 'simulcast' on server

5.  Create 10 viewer tokens via POST /api/channels/:id/viewers
6.  Connect all 10 viewers, each consumes video + audio

7.  Assert: all 10 viewers receiving media (consumer score > 0)

8.  Viewer 1: set preferred layers { spatial: 0, temporal: 2 } (low quality)
9.  Viewer 2: set preferred layers { spatial: 2, temporal: 2 } (high quality)
10. Wait 3s for layer switching

11. Check consumer.currentLayers on server for viewer 1 and viewer 2
    Assert: viewer 1 has spatialLayer=0, viewer 2 has spatialLayer=2
    (Note: currentLayers may differ from preferred if bandwidth constrains it)

12. GET /api/channels/:id
    Assert: state='LIVE', viewerCount=10

13. Second publisher attempts to produce on same channel
    Assert: error 'Channel already has a publisher'

14. Disconnect publisher
    Assert: channel state -> 'IDLE'
    Assert: all viewers receive channel-stopped event

15. Exit 0
```

## Files Changed
- `src/signaling-server.js` — ChannelManager, channel endpoints, produce guard, simulcast support
- `src/mediasoup-server.js` — preferred layers endpoint, layer change forwarding
- `src/sdk/stage.js` — simulcast option in publish(), setPreferredLayers()
- `scripts/test-broadcast.js` — new file
