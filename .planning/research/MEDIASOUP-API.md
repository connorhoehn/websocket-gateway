# Mediasoup API Reference (Key Patterns)

Extracted from mediasoup.org v3 docs. Only the patterns we use.

## Worker

```js
const worker = await mediasoup.createWorker({
  logLevel: 'warn',    // 'debug'|'warn'|'error'|'none'
  logTags: ['info', 'ice', 'dtls', 'rtp', 'srtp', 'rtcp'],
});
// Properties: pid, closed, died
// Methods: close(), getResourceUsage(), createRouter(), createWebRtcServer()
// Events: 'died', 'subprocessclose'
// Constraint: 1 Worker = 1 CPU core. Spawn os.cpus().length workers.
```

## WebRtcServer (port sharing — critical for K8s)

All transports on a worker share one UDP+TCP port pair:
```js
const webRtcServer = await worker.createWebRtcServer({
  listenInfos: [
    { protocol: 'udp', ip: '0.0.0.0', announcedAddress: '1.2.3.4', port: 40000 },
    { protocol: 'tcp', ip: '0.0.0.0', announcedAddress: '1.2.3.4', port: 40000 }
  ]
});
// Then: router.createWebRtcTransport({ webRtcServer }) — no listenInfos needed
```

## Router

```js
const router = await worker.createRouter({
  mediaCodecs: [
    { kind: 'audio', mimeType: 'audio/opus', clockRate: 48000, channels: 2 },
    { kind: 'video', mimeType: 'video/VP8', clockRate: 90000 },
    { kind: 'video', mimeType: 'video/VP9', clockRate: 90000, parameters: { 'profile-id': 2 } },
    { kind: 'video', mimeType: 'video/H264', clockRate: 90000, parameters: {
      'packetization-mode': 1, 'profile-level-id': '4d0032', 'level-asymmetry-allowed': 1
    }}
  ]
});
// Do NOT include RTX, RED, ULPFEC — mediasoup adds them automatically
// Properties: id, rtpCapabilities
// Methods: createWebRtcTransport(), createPipeTransport(), createPlainTransport(),
//          createDirectTransport(), pipeToRouter(), canConsume()
```

## WebRtcTransport

```js
const transport = await router.createWebRtcTransport({
  webRtcServer,                          // OR listenInfos
  enableUdp: true, enableTcp: true, preferUdp: true,
  initialAvailableOutgoingBitrate: 600000,
  enableSctp: false,                     // true for DataChannels
});
// Methods: connect({dtlsParameters}), produce(), consume(), restartIce()
//          setMaxIncomingBitrate(), setMaxOutgoingBitrate()
// Events: 'icestatechange', 'dtlsstatechange', 'routerclose'
```

## Producer

```js
const producer = await transport.produce({
  kind: 'video',
  rtpParameters: { /* from client */ },
  paused: false,
});
// Properties: id, kind, type ('simple'|'simulcast'|'svc'|'pipe'), paused, score
// Methods: close(), pause(), resume(), getStats()
// Events: 'transportclose', 'score', 'videoorientationchange'
```

## Consumer

```js
if (!router.canConsume({ producerId, rtpCapabilities })) throw new Error('cannot consume');

const consumer = await transport.consume({
  producerId,
  rtpCapabilities: device.rtpCapabilities,
  paused: true,    // RECOMMENDED: start paused, resume after client ready
});
await consumer.resume();
// Properties: id, producerId, kind, type, paused, producerPaused, currentLayers, score
// Methods: close(), pause(), resume(), getStats(), setPreferredLayers({spatialLayer, temporalLayer})
// Events: 'transportclose', 'producerclose', 'producerpause', 'producerresume',
//         'score', 'layerschange'
```

## PipeTransport (scaling)

### Same-host (automatic):
```js
const { pipeConsumer, pipeProducer } = await router1.pipeToRouter({
  producerId: producer.id,
  router: router2,    // on different worker
});
// pipeProducer now exists in router2 — consumers in router2 attach to it
```

### Cross-machine (manual):
```js
// Server A:
const pipeA = await routerA.createPipeTransport({
  listenInfo: { protocol: 'udp', ip: '0.0.0.0', announcedAddress: 'A_IP' },
  enableSrtp: true,
});
// Server B:
const pipeB = await routerB.createPipeTransport({
  listenInfo: { protocol: 'udp', ip: '0.0.0.0', announcedAddress: 'B_IP' },
  enableSrtp: true,
});
// Exchange via signaling: { ip, port: pipe.tuple.localPort, srtpParameters }
await pipeA.connect({ ip: B_IP, port: B_port, srtpParameters: B_srtp });
await pipeB.connect({ ip: A_IP, port: A_port, srtpParameters: A_srtp });
// Then: pipeA.consume({producerId}), pipeB.produce({kind, rtpParameters})
```

## PlainTransport (recording)

```js
const plainTransport = await router.createPlainTransport({
  listenInfo: { protocol: 'udp', ip: '127.0.0.1' },
  rtcpMux: true,
  comedia: true,    // auto-detect remote from first RTP packet
});
const consumer = await plainTransport.consume({ producerId, rtpCapabilities: router.rtpCapabilities });
const { localPort } = plainTransport.tuple;
// Point FFmpeg/GStreamer at 127.0.0.1:localPort
```

## DirectTransport (synthetic test injection)

```js
const directTransport = await router.createDirectTransport();
const producer = await directTransport.produce({ kind: 'video', rtpParameters: {...} });
producer.send(rtpPacketBuffer); // Inject raw RTP
```

## Simulcast

Client produces with multiple encodings:
```js
sendTransport.produce({
  track: videoTrack,
  encodings: [
    { maxBitrate: 100000 },    // low
    { maxBitrate: 300000 },    // medium
    { maxBitrate: 900000 }     // high
  ]
});
```
Server: `producer.type === 'simulcast'`. Consumer selects layer:
```js
consumer.setPreferredLayers({ spatialLayer: 2, temporalLayer: 2 });
// spatialLayer: 0=low, 1=med, 2=high
// temporalLayer: 0=low fps, 2=full fps
```

## Capacity

~500 consumers per worker (per CPU core).
Fan-out: pipe producers to additional workers/servers.
