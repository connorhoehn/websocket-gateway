# 30-Day Roadmap: Local IVS Replacement
## Kubernetes (Helm) — Stages, Rooms, Fan-out, Automated Verification

**Goal**: Drop-in replacement for AWS IVS real-time stages and rooms, running locally on K8s.
All testing automated via headless Node.js scripts injecting synthetic media — no manual browser work.

## Timeline

| Week | Focus | Key Deliverable |
|---|---|---|
| 1 (Days 1-7) | Fix foundation | Working multi-worker, room-isolated SFU with Helm chart |
| 2 (Days 8-14) | IVS API surface | Stage/Room/Participant CRUD matching IVS API shapes |
| 3 (Days 15-21) | Scaling & fan-out | Pipe transports, K8s HPA, broadcast mode with simulcast |
| 4 (Days 22-30) | Polish & resilience | Recording, reconnection, full test suite, v1.0.0 tag |

## IVS-to-Local Concept Map

| IVS Concept | Our Implementation | Mediasoup Primitive |
|---|---|---|
| Stage | `POST /api/stages` -> creates router on least-loaded worker | `worker.createRouter()` |
| Stage Participant (publisher) | Token with `PUBLISH` capability | `transport.produce()` |
| Stage Participant (subscriber) | Token with `SUBSCRIBE` capability | `transport.consume()` |
| ParticipantToken | JWT signed locally: `{ stageId, participantId, capabilities, exp }` | N/A (auth layer) |
| Room (chat/data) | Socket.io room linked to stage | N/A (signaling layer) |
| Channel (1:N broadcast) | Single-publisher stage + simulcast | Simulcast encodings |
| Composition/Recording | PlainTransport -> FFmpeg sidecar | `router.createPlainTransport()` |
| Auto-scaling | K8s HPA + pipe transports across pods | `router.pipeToRouter()` |
| Quality layers | Simulcast (VP8/H264) or SVC (VP9) | `consumer.setPreferredLayers()` |
| Metrics | Prometheus via prom-client | `worker.getResourceUsage()` |

## IVS Service Quotas We Match

| Quota | IVS Default | Our Target |
|---|---|---|
| Publishers per stage | 12 | 12 (configurable) |
| Subscribers per stage | 10,000 | 500/pod, scale via pipe transports |
| Publish bitrate max | 8.5 Mbps | Configurable per stage |
| Publish resolution max | 720p | Configurable (default 720p) |
| Participant session max | 24 hours | Configurable |

## Architecture

```
Client (browser/test) --> Signaling Server (port 3000)
                              |
                              +--> Mediasoup Pod A (internal, port 3001)
                              |      Workers 0-3, WebRtcServer per worker
                              |      Ports 40000-40003 (1 per worker)
                              |
                              +--> Mediasoup Pod B (internal, port 3001)
                              |      (scaled via K8s HPA)
                              |      Pipe transports bridge to Pod A
                              |
                              +--> Coturn (STUN/TURN, port 3478)
```

## Dependency Summary

New npm packages needed in `src/package.json`:
```json
{
  "pino": "^8.x",
  "prom-client": "^15.x",
  "jsonwebtoken": "^9.x",
  "nanoid": "^5.x"
}
```

New dev/test packages:
```json
{
  "socket.io-client": "^4.7.x",
  "mediasoup-client": "^3.7.x",
  "fake-mediastreamtrack": "^1.x"
}
```

Helm chart dependencies:
- KEDA (optional, for autoscaling): `helm repo add kedacore https://kedacore.github.io/charts`
- Prometheus (for metrics): existing cluster install or `kube-prometheus-stack`

## Risk Register

| Risk | Mitigation | Week |
|---|---|---|
| mediasoup native build fails on Alpine/ARM | Multi-stage Docker build already handles this; pin mediasoup version | 1 |
| WebRtcServer port sharing is new API (v3.13+) | Fall back to port-per-transport if version too old | 1 |
| Cross-pod pipe transport latency | Only pipe when needed (threshold-based) | 3 |
| KEDA not installed on local K8s | Document as optional; manual scaling works without it | 3 |
| FFmpeg SDP compatibility for recording | Use comedia mode + generated SDP; test with specific FFmpeg version | 4 |
| hostNetwork limits 1 mediasoup pod per node | Document; consider STUNner as future alternative | 1 |
