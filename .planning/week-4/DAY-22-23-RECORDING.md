# Days 22-23: Recording

Uses mediasoup PlainTransport to tap the media stream and pipe it to FFmpeg.

## Architecture

```
Producer (in Router)
    |
    +--> Consumer Transports (viewers, normal path)
    |
    +--> PlainTransport (recording tap)
           |
           | UDP (RTP)  127.0.0.1
           v
         FFmpeg process
           |
           v
         /data/recordings/stg_abc123_1713283200.mp4
```

## Mediasoup Internal Endpoints

### POST /internal/rooms/:roomId/recording/start

```js
app.post('/internal/rooms/:roomId/recording/start', async (req, res) => {
  const room = this.rooms.get(req.params.roomId);
  if (!room) return res.status(404).json({ error: 'Room not found' });

  const recordingId = `rec_${nanoid(12)}`;
  const recordingPath = path.join(
    process.env.RECORDING_PATH || '/data/recordings',
    `${req.params.roomId}_${Date.now()}`
  );

  // Find active producers (video + audio)
  const producers = this.getProducersForRoom(req.params.roomId);
  const videoProducer = producers.find(p => p.kind === 'video');
  const audioProducer = producers.find(p => p.kind === 'audio');

  if (!videoProducer) {
    return res.status(400).json({ error: 'No video producer to record' });
  }

  // Create PlainTransport for video
  const videoTransport = await room.router.createPlainTransport({
    listenInfo: { protocol: 'udp', ip: '127.0.0.1' },
    rtcpMux: true,
    comedia: true,
  });

  const videoConsumer = await videoTransport.consume({
    producerId: videoProducer.producerId,
    rtpCapabilities: room.router.rtpCapabilities,
    paused: false,
  });

  let audioTransport = null;
  let audioConsumer = null;
  if (audioProducer) {
    audioTransport = await room.router.createPlainTransport({
      listenInfo: { protocol: 'udp', ip: '127.0.0.1' },
      rtcpMux: true,
      comedia: true,
    });
    audioConsumer = await audioTransport.consume({
      producerId: audioProducer.producerId,
      rtpCapabilities: room.router.rtpCapabilities,
      paused: false,
    });
  }

  // Generate SDP for FFmpeg
  const sdpContent = generateRecordingSdp({
    videoPort: videoTransport.tuple.localPort,
    videoPayloadType: videoConsumer.rtpParameters.codecs[0].payloadType,
    videoClockRate: videoConsumer.rtpParameters.codecs[0].clockRate,
    videoCodec: videoConsumer.rtpParameters.codecs[0].mimeType.split('/')[1],
    videoSsrc: videoConsumer.rtpParameters.encodings[0].ssrc,
    audioPort: audioTransport?.tuple.localPort,
    audioPayloadType: audioConsumer?.rtpParameters.codecs[0].payloadType,
    audioClockRate: audioConsumer?.rtpParameters.codecs[0].clockRate,
    audioSsrc: audioConsumer?.rtpParameters.encodings[0].ssrc,
  });

  // Write SDP to temp file
  const sdpPath = `${recordingPath}.sdp`;
  fs.writeFileSync(sdpPath, sdpContent);

  // Spawn FFmpeg
  const ffmpegArgs = [
    '-loglevel', 'warning',
    '-protocol_whitelist', 'file,udp,rtp',
    '-fflags', '+genpts',
    '-i', sdpPath,
    '-c:v', 'copy',         // No re-encoding
    '-c:a', 'copy',
    '-f', 'matroska',       // MKV container (handles VP8+Opus better than MP4)
    `${recordingPath}.mkv`
  ];

  const ffmpeg = spawn('ffmpeg', ffmpegArgs);

  ffmpeg.stderr.on('data', (data) => {
    logger.debug({ recordingId }, `FFmpeg: ${data.toString().trim()}`);
  });

  ffmpeg.on('close', (code) => {
    logger.info({ recordingId, exitCode: code }, 'FFmpeg process exited');
  });

  // Store recording state
  const recording = {
    recordingId,
    roomId: req.params.roomId,
    path: `${recordingPath}.mkv`,
    sdpPath,
    ffmpeg,
    videoTransport,
    videoConsumer,
    audioTransport,
    audioConsumer,
    startedAt: new Date(),
    state: 'ACTIVE',
  };

  this.recordings.set(recordingId, recording);

  res.json({
    recordingId,
    state: 'ACTIVE',
    path: recording.path,
    startedAt: recording.startedAt.toISOString()
  });
});
```

### POST /internal/rooms/:roomId/recording/:recordingId/stop

```js
app.post('/internal/rooms/:roomId/recording/:recordingId/stop', async (req, res) => {
  const recording = this.recordings.get(req.params.recordingId);
  if (!recording) return res.status(404).json({ error: 'Recording not found' });

  // Stop FFmpeg gracefully (send 'q' to stdin)
  recording.ffmpeg.stdin.write('q');

  // Wait for FFmpeg to finish (up to 10s)
  await new Promise((resolve) => {
    const timeout = setTimeout(() => {
      recording.ffmpeg.kill('SIGKILL');
      resolve();
    }, 10000);

    recording.ffmpeg.on('close', () => {
      clearTimeout(timeout);
      resolve();
    });
  });

  // Close transports
  recording.videoConsumer.close();
  recording.videoTransport.close();
  if (recording.audioConsumer) recording.audioConsumer.close();
  if (recording.audioTransport) recording.audioTransport.close();

  // Clean up SDP
  try { fs.unlinkSync(recording.sdpPath); } catch (e) {}

  // Get file stats
  let fileSize = 0;
  try {
    const stats = fs.statSync(recording.path);
    fileSize = stats.size;
  } catch (e) {}

  recording.state = 'STOPPED';
  recording.stoppedAt = new Date();
  recording.fileSize = fileSize;

  res.json({
    recordingId: recording.recordingId,
    state: 'STOPPED',
    path: recording.path,
    fileSize,
    duration: (recording.stoppedAt - recording.startedAt) / 1000,
    startedAt: recording.startedAt.toISOString(),
    stoppedAt: recording.stoppedAt.toISOString(),
  });
});
```

## SDP Generation

```js
function generateRecordingSdp({ videoPort, videoPayloadType, videoClockRate, videoCodec, videoSsrc,
                                 audioPort, audioPayloadType, audioClockRate, audioSsrc }) {
  let sdp = `v=0
o=- 0 0 IN IP4 127.0.0.1
s=Recording
c=IN IP4 127.0.0.1
t=0 0
`;

  // Video
  const codecName = videoCodec.toUpperCase(); // VP8, VP9, H264
  sdp += `m=video ${videoPort} RTP/AVP ${videoPayloadType}
a=rtpmap:${videoPayloadType} ${codecName}/${videoClockRate}
a=ssrc:${videoSsrc} cname:recording
a=sendonly
`;

  // Audio (if present)
  if (audioPort) {
    sdp += `m=audio ${audioPort} RTP/AVP ${audioPayloadType}
a=rtpmap:${audioPayloadType} opus/${audioClockRate}/2
a=ssrc:${audioSsrc} cname:recording
a=sendonly
`;
  }

  return sdp;
}
```

## Signaling Server Endpoints

### POST /api/stages/:stageId/recording/start

```js
app.post('/api/stages/:stageId/recording/start', async (req, res) => {
  const stage = stageManager.stages.get(req.params.stageId);
  if (!stage) return res.status(404).json({ error: 'Stage not found' });

  const resp = await fetch(
    `${stage.mediasoupPod.url}/internal/rooms/${req.params.stageId}/recording/start`,
    { method: 'POST' }
  );
  const result = await resp.json();
  res.json(result);
});
```

### POST /api/stages/:stageId/recording/stop

### GET /api/recordings

Lists all recordings across all pods.

## K8s: Recording Volume

```yaml
# In mediasoup deployment:
containers:
- name: mediasoup
  volumeMounts:
  - name: recordings
    mountPath: /data/recordings

volumes:
- name: recordings
  {{- if .Values.recording.enabled }}
  persistentVolumeClaim:
    claimName: {{ include "lvb.fullname" . }}-recordings
  {{- else }}
  emptyDir: {}
  {{- end }}
```

```yaml
# helm/templates/recordings-pvc.yaml
{{- if .Values.recording.enabled }}
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: {{ include "lvb.fullname" . }}-recordings
spec:
  accessModes: [ReadWriteOnce]
  resources:
    requests:
      storage: {{ .Values.recording.storageSize | default "10Gi" }}
{{- end }}
```

FFmpeg must be available in the mediasoup Docker image. Add to Dockerfile.mediasoup:
```dockerfile
RUN apk add --no-cache ffmpeg
```

## Verification Script: `scripts/test-recording.js`

```
1. Create stage
2. Inject synthetic publisher (video + audio, 10 seconds)
3. POST /api/stages/:stageId/recording/start
   Assert: 200, recordingId, state='ACTIVE'

4. Wait 10 seconds

5. POST /api/stages/:stageId/recording/stop
   Assert: 200, state='STOPPED', fileSize > 0

6. GET /api/recordings
   Assert: recording appears in list

7. Verify output file is valid:
   ffprobe <recording_path> -> exit code 0
   Assert: has video stream
   Assert: duration >= 8s (allowing for startup delay)

8. Exit 0
```

## Files Changed
- `src/mediasoup-server.js` — recording endpoints, SDP generation, FFmpeg management
- `src/signaling-server.js` — recording proxy endpoints
- `docker/Dockerfile.mediasoup` — add ffmpeg
- `helm/templates/recordings-pvc.yaml` — new
- `helm/templates/mediasoup-deployment.yaml` — recording volume mount
- `scripts/test-recording.js` — new file
