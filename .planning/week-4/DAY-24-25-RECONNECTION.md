# Days 24-25: Reconnection & Error Recovery

## Client Auto-Reconnect (SDK)

### Stage Reconnection

```js
// In src/sdk/stage.js:
class Stage extends EventEmitter {
  constructor(...) {
    // ...
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 10;
    this.baseReconnectDelay = 1000;
    this._setupReconnection();
  }

  _setupReconnection() {
    this.socket.on('disconnect', async (reason) => {
      logger.warn({ reason, stageId: this.stageId }, 'Disconnected');

      // Don't reconnect if intentionally leaving
      if (reason === 'io client disconnect') return;

      this.emit('connectionStateChanged', 'RECONNECTING');
      await this._attemptReconnect();
    });

    this.socket.on('stage-migration', async ({ reason }) => {
      logger.warn({ reason, stageId: this.stageId }, 'Stage migration');
      this.emit('connectionStateChanged', 'RECONNECTING');
      // Server-initiated reconnect (e.g., pod crash)
      await this._attemptReconnect();
    });
  }

  async _attemptReconnect() {
    while (this.reconnectAttempts < this.maxReconnectAttempts) {
      const delay = Math.min(
        this.baseReconnectDelay * Math.pow(2, this.reconnectAttempts),
        30000  // Cap at 30s
      );

      logger.info({ attempt: this.reconnectAttempts + 1, delay }, 'Reconnecting...');
      await new Promise(r => setTimeout(r, delay));

      try {
        // Socket.io reconnects automatically — wait for connect event
        if (!this.socket.connected) {
          await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error('Connect timeout')), 5000);
            this.socket.once('connect', () => { clearTimeout(timeout); resolve(); });
            this.socket.connect();
          });
        }

        // Re-join stage with same token
        await this._rejoinStage();

        this.reconnectAttempts = 0;
        this.emit('connectionStateChanged', 'CONNECTED');
        this.emit('reconnected');
        logger.info({ stageId: this.stageId }, 'Reconnected successfully');
        return;

      } catch (e) {
        logger.warn({ attempt: this.reconnectAttempts + 1, err: e.message }, 'Reconnect failed');
        this.reconnectAttempts++;
      }
    }

    this.emit('connectionStateChanged', 'ERRORED');
    this.emit('reconnectFailed');
    logger.error({ stageId: this.stageId }, 'Reconnect failed after max attempts');
  }

  async _rejoinStage() {
    // Re-join stage (server validates token, re-creates transports)
    const response = await new Promise((resolve, reject) => {
      this.socket.emit('join-stage', { token: this.token, reconnect: true }, (resp) => {
        resp.error ? reject(new Error(resp.error)) : resolve(resp);
      });
    });

    // Reload device if needed
    if (!this.device || this.device.loaded === false) {
      this.device = new mediasoupClient.Device();
      await this.device.load({ routerRtpCapabilities: response.routerRtpCapabilities });
    }

    // Rebuild producer transport if we were publishing
    if (this.producers.size > 0) {
      this.producerTransport = null; // Old one is dead
      // Re-publish (client re-captures media or uses existing tracks)
      // The caller should handle re-publishing via the 'reconnected' event
    }

    // Rebuild consumer transport — subscribe to existing producers
    this.consumerTransport = null;
    this.consumers.clear();

    for (const prod of response.existingProducers || []) {
      const participant = { id: prod.participantId, isLocal: false };
      if (this.strategy.shouldSubscribeToParticipant(participant)) {
        await this._consumeProducer(prod.producerId, prod.participantId, prod.kind);
      }
    }
  }
}
```

### Connection State Events (IVS-compatible)

```
DISCONNECTED  -> initial state, or after intentional leave
CONNECTING    -> first connection attempt
CONNECTED     -> successfully joined stage
RECONNECTING  -> lost connection, attempting to restore
ERRORED       -> gave up reconnecting
```

## Server-Side: Stale Transport Cleanup

```js
// In mediasoup-server.js:
class MediasoupServer {
  startStaleTransportChecker() {
    setInterval(() => {
      for (const [socketId, transports] of this.transports) {
        for (const [type, transport] of Object.entries(transports)) {
          // Check ICE state
          if (transport.iceState === 'disconnected') {
            if (!transport._disconnectedAt) {
              transport._disconnectedAt = Date.now();
            }

            const staleDuration = Date.now() - transport._disconnectedAt;
            if (staleDuration > 30000) { // 30s stale threshold
              logger.warn({ socketId, type, staleDuration }, 'Closing stale transport');
              transport.close();
              delete transports[type];

              // If both transports are gone, clean up everything
              if (!transports.producer && !transports.consumer) {
                this.transports.delete(socketId);
                this.cleanupSocket(socketId);
              }
            }
          } else {
            // Reset if ICE recovers
            transport._disconnectedAt = null;
          }
        }
      }
    }, 10000); // Check every 10s
  }
}
```

## Server-Side: Reconnect-Aware Join

```js
// In signaling join-stage handler:
socket.on('join-stage', async ({ token, reconnect = false }, callback) => {
  const payload = jwt.verify(token, process.env.JWT_SECRET);
  const { stageId, participantId } = payload;
  const stage = stageManager.stages.get(stageId);

  if (reconnect) {
    // Clean up old socket mapping for this participant
    const existing = stage.participants.get(participantId);
    if (existing && existing.socketId !== socket.id) {
      // Old socket still around — clean it up
      const oldSocket = io.sockets.sockets.get(existing.socketId);
      if (oldSocket) oldSocket.disconnect(true);

      // Clean up mediasoup resources for old socket
      await fetch(`${stage.mediasoupPod.url}/internal/rooms/${stageId}/cleanup/${existing.socketId}`, {
        method: 'POST'
      }).catch(() => {});
    }

    // Update participant with new socket
    if (existing) {
      existing.socketId = socket.id;
      existing.state = 'CONNECTED';
    }

    logger.info({ participantId, stageId }, 'Participant reconnected');
  }

  // ... rest of join logic (same as normal join)
});
```

## Pod Crash Recovery (Signaling Server)

```js
class PodRegistry {
  startHealthChecker() {
    setInterval(async () => {
      for (const [name, pod] of this.pods) {
        try {
          const resp = await fetch(`${pod.url}/health`, {
            signal: AbortSignal.timeout(3000)
          });
          if (resp.ok) {
            pod.lastSeen = Date.now();
            pod.healthy = true;
          } else {
            pod.healthy = false;
          }
        } catch (e) {
          pod.healthy = false;

          // If unhealthy for more than 15s, consider it dead
          if (Date.now() - pod.lastSeen > 15000) {
            logger.error({ pod: name }, 'Pod considered dead, migrating stages');
            await this.handlePodDeath(name);
          }
        }
      }
    }, 5000); // Health check every 5s
  }

  async handlePodDeath(podName) {
    const deadPod = this.pods.get(podName);
    if (!deadPod) return;

    // Find all stages on this pod
    const affectedStages = Array.from(stageManager.stages.values())
      .filter(s => s.mediasoupPod.podName === podName);

    for (const stage of affectedStages) {
      // Notify all participants to reconnect
      io.to(stage.stageId).emit('stage-migration', {
        reason: 'pod-failure',
        stageId: stage.stageId
      });

      // Find a healthy pod
      const newPod = this.getLeastLoaded();
      if (newPod) {
        // Re-create room on new pod
        await fetch(`${newPod.url}/internal/rooms/${stage.stageId}/create`, {
          method: 'POST'
        }).catch(() => {});

        stage.mediasoupPod = newPod;
        newPod.load++;

        logger.info({ stageId: stage.stageId, oldPod: podName, newPod: newPod.podName },
          'Stage migrated to new pod');
      } else {
        logger.error({ stageId: stage.stageId }, 'No healthy pods for migration');
        stage.state = 'STOPPED';
      }
    }

    // Remove dead pod
    this.pods.delete(podName);
    if (deadPod) deadPod.load = 0;
  }
}
```

## Verification Script: `scripts/test-reconnect.js`

### Test 1: WebSocket Drop Recovery

```
1. Create stage, publisher publishes, subscriber consumes
2. Verify media flowing (consumer score > 0)
3. Force-close subscriber's WebSocket connection (simulate network drop)
4. Wait for reconnect (socket.io auto-reconnects)
5. Assert: subscriber receives 'reconnected' event
6. Assert: subscriber receives media again within 10s
```

### Test 2: Pod Crash Recovery (K8s)

```
1. Create stage on mediasoup pod, publish, subscribe
2. Verify media flowing
3. kubectl delete pod <mediasoup-pod> --grace-period=0
4. Assert: subscriber receives 'stage-migration' event
5. Assert: signaling detects pod death within 15s
6. Assert: new mediasoup pod created (K8s restarts it)
7. Assert: stage migrated to new pod
8. Assert: subscriber re-establishes and receives media within 30s
```

### Test 3: Publisher Reconnect

```
1. Create stage, publisher publishes, 3 subscribers consume
2. Force-disconnect publisher
3. Publisher reconnects
4. Publisher re-publishes
5. Assert: all 3 subscribers receive new producer notification
6. Assert: all 3 subscribers consuming media again
```

## Files Changed
- `src/sdk/stage.js` — reconnection logic, connection state events
- `src/signaling-server.js` — reconnect-aware join, PodRegistry health checker
- `src/mediasoup-server.js` — stale transport checker
- `scripts/test-reconnect.js` — new file
