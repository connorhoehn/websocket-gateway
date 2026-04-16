# 30-Day Plan: Local IVS Replacement — Index

See subdirectories for detailed breakdowns.

## Overview
- [ROADMAP.md](overview/ROADMAP.md) — Timeline, concept map, architecture, risks
- [IVS-API-MAPPING.md](overview/IVS-API-MAPPING.md) — Every IVS operation mapped to our endpoints

## Research
- [MEDIASOUP-API.md](research/MEDIASOUP-API.md) — Mediasoup v3 API reference (key patterns)
- [K8S-WEBRTC-PATTERNS.md](research/K8S-WEBRTC-PATTERNS.md) — K8s deployment patterns for WebRTC

## Testing
- [TEST-STRATEGY.md](testing/TEST-STRATEGY.md) — Automated test harness, synthetic media, load testing

## Week 1: Fix the Foundation (Days 1-7)
- [DAY-1](week-1/DAY-1-TEST-HARNESS-AND-PRODUCER-FIX.md) — Test harness + fix single-producer bug
- [DAY-2](week-1/DAY-2-ROOM-ISOLATION.md) — Router-per-room, scoped events
- [DAY-3](week-1/DAY-3-MULTI-WORKER.md) — Multi-worker + WebRtcServer (4 ports, not 5000)
- [DAY-4](week-1/DAY-4-LOGGING-AND-METRICS.md) — Structured logging (pino) + Prometheus metrics
- [DAY-5-6](week-1/DAY-5-6-NETWORKING-AND-HELM.md) — Fix Docker networking + Helm chart
- [DAY-7](week-1/DAY-7-SIGNALING-GATEWAY.md) — Unify signaling as single gateway

## Week 2: IVS Stage & Room API (Days 8-14)
- [DAY-8-9](week-2/DAY-8-9-STAGE-API.md) — Stage CRUD (CreateStage, GetStage, etc.)
- [DAY-10-11](week-2/DAY-10-11-PARTICIPANT-FLOW.md) — Participant tokens, publish/subscribe, capabilities
- [DAY-12-13](week-2/DAY-12-13-CHAT-ROOMS.md) — Chat rooms (IVS Chat equivalent)
- [DAY-14](week-2/DAY-14-CLIENT-SDK.md) — Client SDK mirroring IVS Web Broadcast SDK

## Week 3: Scaling & Fan-out (Days 15-21)
- [DAY-15-16](week-3/DAY-15-16-PIPE-TRANSPORTS.md) — Pipe transports for cross-worker/pod fan-out
- [DAY-17-18](week-3/DAY-17-18-K8S-SCALING.md) — K8s auto-scaling (KEDA, pod discovery, graceful drain)
- [DAY-19-20](week-3/DAY-19-20-BROADCAST-MODE.md) — Broadcast channels + simulcast
- [DAY-21](week-3/DAY-21-OBSERVABILITY.md) — Health, dashboard, trace IDs

## Week 4: Polish & Production-Ready (Days 22-30)
- [DAY-22-23](week-4/DAY-22-23-RECORDING.md) — Recording via PlainTransport + FFmpeg
- [DAY-24-25](week-4/DAY-24-25-RECONNECTION.md) — Auto-reconnect, pod crash recovery
- [DAY-26-27](week-4/DAY-26-27-HELM-FINAL.md) — Helm chart finalization
- [DAY-28-29](week-4/DAY-28-29-INTEGRATION-TESTS.md) — Full test suite + load test
- [DAY-30](week-4/DAY-30-CLEANUP.md) — Cleanup, OpenAPI spec, tag v1.0.0
