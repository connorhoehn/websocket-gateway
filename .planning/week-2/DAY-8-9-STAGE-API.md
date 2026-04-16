# Days 8-9: Stage CRUD API

Implements IVS equivalents: CreateStage, GetStage, ListStages, UpdateStage, DeleteStage.

## StageManager Class

Lives in signaling server. Owns all stage state and mediasoup pod routing.

```js
class StageManager {
  constructor(mediasoupPods) {
    this.stages = new Map();       // stageId -> StageRecord
    this.pods = mediasoupPods;     // [{ url, name, healthy, load }]
  }

  getLeastLoadedPod() {
    return this.pods
      .filter(p => p.healthy)
      .sort((a, b) => a.load - b.load)[0];
  }
}
```

### StageRecord Shape

```js
{
  stageId: 'stg_abc123',
  name: 'my-stage',
  maxParticipants: 12,
  state: 'IDLE',             // IDLE | ACTIVE | STOPPED
  activeSessionId: null,     // Set when first participant joins
  mediasoupPod: { url, name },
  videoConfig: { maxBitrate: 2500000, maxResolution: '720p' },
  participants: new Map(),   // participantId -> ParticipantRecord
  createdAt: Date,
  updatedAt: Date,
}
```

## REST Endpoints

### POST /api/stages

```js
app.post('/api/stages', async (req, res) => {
  const {
    name = '',
    maxParticipants = 12,
    participantTokenConfigurations = [],
    videoConfig = {}
  } = req.body;

  // Validate
  if (name && (name.length > 128 || !/^[a-zA-Z0-9-_]*$/.test(name))) {
    return res.status(400).json({ error: 'Invalid name' });
  }
  if (maxParticipants < 1 || maxParticipants > 100) {
    return res.status(400).json({ error: 'maxParticipants must be 1-100' });
  }
  if (participantTokenConfigurations.length > 12) {
    return res.status(400).json({ error: 'Max 12 token configurations' });
  }

  const stageId = `stg_${nanoid(12)}`;
  const pod = stageManager.getLeastLoadedPod();

  // Create router on mediasoup pod
  const resp = await fetch(`${pod.url}/internal/rooms/${stageId}/create`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mediaCodecs: DEFAULT_MEDIA_CODECS })
  });

  if (!resp.ok) {
    return res.status(500).json({ error: 'Failed to create stage on mediasoup' });
  }

  const stage = {
    stageId, name, maxParticipants, state: 'IDLE',
    activeSessionId: null,
    mediasoupPod: pod,
    videoConfig: {
      maxBitrate: videoConfig.maxBitrate || 2500000,
      maxResolution: videoConfig.maxResolution || '720p'
    },
    participants: new Map(),
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  stageManager.stages.set(stageId, stage);
  pod.load++;

  // Pre-generate participant tokens if requested
  const participantTokens = participantTokenConfigurations.map(config => {
    return generateParticipantToken(stageId, config);
  });

  res.status(200).json({
    stage: serializeStage(stage),
    participantTokens
  });
});
```

### GET /api/stages

```js
app.get('/api/stages', (req, res) => {
  const stages = Array.from(stageManager.stages.values()).map(stage => ({
    stageId: stage.stageId,
    name: stage.name,
    state: stage.state,
    participants: {
      publishers: countByCapability(stage.participants, 'PUBLISH'),
      subscribers: countByCapability(stage.participants, 'SUBSCRIBE'),
      total: stage.participants.size
    },
    createdAt: stage.createdAt.toISOString(),
    mediasoupPod: stage.mediasoupPod.name
  }));

  res.json({ stages });
});
```

### GET /api/stages/:stageId

```js
app.get('/api/stages/:stageId', (req, res) => {
  const stage = stageManager.stages.get(req.params.stageId);
  if (!stage) return res.status(404).json({ error: 'Stage not found' });

  res.json({
    stage: serializeStage(stage),
    participants: Array.from(stage.participants.values()).map(serializeParticipant)
  });
});
```

### PATCH /api/stages/:stageId

```js
app.patch('/api/stages/:stageId', (req, res) => {
  const stage = stageManager.stages.get(req.params.stageId);
  if (!stage) return res.status(404).json({ error: 'Stage not found' });

  const { name, maxParticipants } = req.body;
  if (name !== undefined) stage.name = name;
  if (maxParticipants !== undefined) stage.maxParticipants = maxParticipants;
  stage.updatedAt = new Date();

  res.json({ stage: serializeStage(stage) });
});
```

### DELETE /api/stages/:stageId

```js
app.delete('/api/stages/:stageId', async (req, res) => {
  const stage = stageManager.stages.get(req.params.stageId);
  if (!stage) return res.status(404).json({ error: 'Stage not found' });

  // Disconnect all participants via signaling
  io.to(stage.stageId).emit('stage-stopped', { stageId: stage.stageId, reason: 'deleted' });

  // Destroy room on mediasoup pod
  await fetch(`${stage.mediasoupPod.url}/internal/rooms/${stage.stageId}`, {
    method: 'DELETE'
  });

  stage.mediasoupPod.load--;
  stageManager.stages.delete(stage.stageId);

  res.status(200).json({});
});
```

## Helper Functions

```js
function serializeStage(stage) {
  return {
    stageId: stage.stageId,
    name: stage.name,
    activeSessionId: stage.activeSessionId,
    maxParticipants: stage.maxParticipants,
    state: stage.state,
    videoConfig: stage.videoConfig,
    createdAt: stage.createdAt.toISOString(),
    updatedAt: stage.updatedAt.toISOString(),
    endpoints: {
      signaling: `ws://localhost:${process.env.PORT || 3000}`
    }
  };
}

function generateParticipantToken(stageId, config) {
  const participantId = `pid_${nanoid(12)}`;
  const token = jwt.sign({
    stageId,
    participantId,
    userId: config.userId || '',
    capabilities: config.capabilities || ['PUBLISH', 'SUBSCRIBE'],
    attributes: config.attributes || {},
  }, process.env.JWT_SECRET || 'dev-secret', {
    expiresIn: `${config.duration || 720}m`
  });

  return {
    token,
    participantId,
    userId: config.userId,
    capabilities: config.capabilities || ['PUBLISH', 'SUBSCRIBE'],
    duration: config.duration || 720,
    attributes: config.attributes || {},
    expirationTime: new Date(Date.now() + (config.duration || 720) * 60000).toISOString()
  };
}
```

## Verification Script: `scripts/test-stage-crud.js`

```
1.  POST /api/stages { name: 'test-stage', maxParticipants: 6 }
    Assert: 200, stageId starts with 'stg_', state='IDLE'

2.  GET /api/stages
    Assert: array contains stage from step 1

3.  GET /api/stages/:stageId
    Assert: name='test-stage', maxParticipants=6

4.  PATCH /api/stages/:stageId { name: 'renamed' }
    Assert: 200, name='renamed'

5.  POST /api/stages with participantTokenConfigurations (2 entries)
    Assert: response includes 2 participantTokens with valid JWTs

6.  DELETE /api/stages/:stageId
    Assert: 200

7.  GET /api/stages
    Assert: deleted stage no longer in list

8.  DELETE /api/stages/nonexistent
    Assert: 404

9.  POST /api/stages { maxParticipants: 999 }
    Assert: 400 (validation error)

10. Exit 0
```

## Files Changed
- `src/signaling-server.js` — StageManager class, REST endpoints
- `src/package.json` — add jsonwebtoken, nanoid
- `scripts/test-stage-crud.js` — new file
