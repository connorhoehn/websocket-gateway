# Days 17-18: Kubernetes Auto-Scaling

## Pod Discovery

### Option A: Headless Service (preferred for simplicity)

```yaml
# helm/templates/mediasoup-service-headless.yaml
apiVersion: v1
kind: Service
metadata:
  name: {{ include "lvb.fullname" . }}-mediasoup-headless
spec:
  clusterIP: None
  selector:
    app: mediasoup
  ports:
  - port: 3001
    name: http
```

Signaling discovers pods via DNS:
```js
const dns = require('dns').promises;

async function discoverMediasoupPods() {
  try {
    const addresses = await dns.resolve4('lvb-mediasoup-headless.default.svc.cluster.local');
    return addresses.map(ip => ({
      url: `http://${ip}:3001`,
      ip,
      healthy: true,
      load: 0
    }));
  } catch (e) {
    logger.error({ err: e }, 'Pod discovery failed');
    return [];
  }
}

// Poll every 10s
setInterval(async () => {
  const pods = await discoverMediasoupPods();
  // Merge with existing state (preserve load counts)
  updatePodRegistry(pods);
}, 10000);
```

### Option B: Pod Self-Registration

Each mediasoup pod announces itself to signaling on startup:

```js
// In mediasoup-server.js startup:
const signalingUrl = process.env.SIGNALING_URL;
if (signalingUrl) {
  await fetch(`${signalingUrl}/internal/pods/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      podName: process.env.HOSTNAME,
      podIp: process.env.MY_POD_IP,
      hostIp: process.env.MY_HOST_IP,
      port: parseInt(process.env.PORT),
      workers: this.workers.length,
      maxConsumers: this.workers.length * parseInt(process.env.MAX_CONSUMERS_PER_WORKER || 500)
    })
  });
}

// On SIGTERM:
process.on('SIGTERM', async () => {
  // Deregister
  await fetch(`${signalingUrl}/internal/pods/deregister`, {
    method: 'POST',
    body: JSON.stringify({ podName: process.env.HOSTNAME })
  }).catch(() => {});

  // Graceful drain: stop accepting new transports
  this.draining = true;

  // Wait for existing transports (up to 30s)
  const deadline = Date.now() + 30000;
  while (this.transports.size > 0 && Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 1000));
  }

  await this.shutdown();
  process.exit(0);
});
```

### Signaling Pod Registry

```js
// In signaling-server.js:
class PodRegistry {
  constructor() {
    this.pods = new Map(); // podName -> { url, podIp, hostIp, workers, maxConsumers, load, lastSeen }
  }

  register(info) {
    this.pods.set(info.podName, { ...info, load: 0, lastSeen: Date.now() });
    logger.info({ pod: info.podName }, 'Mediasoup pod registered');
  }

  deregister(podName) {
    this.pods.delete(podName);
    logger.info({ pod: podName }, 'Mediasoup pod deregistered');
  }

  getLeastLoaded() {
    return Array.from(this.pods.values())
      .filter(p => !p.draining && Date.now() - p.lastSeen < 30000)
      .sort((a, b) => a.load - b.load)[0];
  }

  getAll() {
    return Array.from(this.pods.values());
  }
}
```

Env vars in mediasoup deployment (Downward API):
```yaml
env:
- name: MY_POD_IP
  valueFrom:
    fieldRef:
      fieldPath: status.podIP
- name: MY_HOST_IP
  valueFrom:
    fieldRef:
      fieldPath: status.hostIP
- name: HOSTNAME
  valueFrom:
    fieldRef:
      fieldPath: metadata.name
- name: SIGNALING_URL
  value: "http://{{ include "lvb.fullname" . }}-signaling:3000"
```

## KEDA Auto-Scaling

CPU-based HPA doesn't work for WebRTC (CPU stays low while consumers max out).
Use KEDA with Prometheus custom metrics.

### Prerequisites

```bash
helm repo add kedacore https://kedacore.github.io/charts
helm install keda kedacore/keda --namespace keda --create-namespace
```

### ScaledObject

```yaml
# helm/templates/mediasoup-keda.yaml
{{- if .Values.scaling.enabled }}
apiVersion: keda.sh/v1alpha1
kind: ScaledObject
metadata:
  name: {{ include "lvb.fullname" . }}-mediasoup-scaler
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: {{ include "lvb.fullname" . }}-mediasoup
  pollingInterval: 10
  cooldownPeriod: {{ .Values.scaling.cooldownPeriod | default 60 }}
  minReplicaCount: {{ .Values.scaling.minReplicas | default 1 }}
  maxReplicaCount: {{ .Values.scaling.maxReplicas | default 10 }}
  advanced:
    horizontalPodAutoscaperConfig:
      behavior:
        scaleDown:
          stabilizationWindowSeconds: 120
          policies:
          - type: Pods
            value: 1
            periodSeconds: 60
        scaleUp:
          stabilizationWindowSeconds: 0
          policies:
          - type: Pods
            value: 2
            periodSeconds: 30
  triggers:
  - type: prometheus
    metadata:
      serverAddress: {{ .Values.scaling.prometheusUrl | default "http://prometheus-server.monitoring:9090" }}
      query: sum(mediasoup_consumers_total)
      threshold: {{ .Values.scaling.consumerThreshold | default "400" | quote }}
      activationThreshold: "5"
{{- end }}
```

### values.yaml additions

```yaml
scaling:
  enabled: false             # Enable in values-production.yaml
  minReplicas: 1
  maxReplicas: 10
  consumerThreshold: 400
  cooldownPeriod: 60
  prometheusUrl: "http://prometheus-server.monitoring:9090"
```

### ServiceMonitor (for Prometheus to scrape mediasoup)

```yaml
# helm/templates/mediasoup-servicemonitor.yaml
{{- if .Values.metrics.serviceMonitor.enabled }}
apiVersion: monitoring.coreos.com/v1
kind: ServiceMonitor
metadata:
  name: {{ include "lvb.fullname" . }}-mediasoup
spec:
  selector:
    matchLabels:
      app: mediasoup
  endpoints:
  - port: http
    path: /metrics
    interval: {{ .Values.metrics.serviceMonitor.interval | default "15s" }}
{{- end }}
```

## Graceful Drain on Scale-Down

When KEDA removes a pod:
1. SIGTERM sent to mediasoup pod
2. Pod deregisters from signaling
3. Pod sets `draining = true` — stops accepting new room assignments
4. Existing transports continue until clients disconnect or 30s timeout
5. Signaling detects pod gone, migrates any remaining stages to healthy pods

```js
// mediasoup-server.js
process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, starting graceful drain');

  // 1. Deregister
  if (process.env.SIGNALING_URL) {
    await fetch(`${process.env.SIGNALING_URL}/internal/pods/deregister`, {
      method: 'POST',
      body: JSON.stringify({ podName: process.env.HOSTNAME })
    }).catch(() => {});
  }

  // 2. Stop accepting new work
  this.draining = true;

  // 3. Wait for existing work to finish
  const deadline = Date.now() + 30000;
  const checkInterval = setInterval(() => {
    const totalTransports = this.transports.size;
    logger.info({ totalTransports }, 'Drain check');

    if (totalTransports === 0 || Date.now() > deadline) {
      clearInterval(checkInterval);
      this.shutdown().then(() => process.exit(0));
    }
  }, 1000);
});
```

## Health Check Update

```js
app.get('/health', (req, res) => {
  const status = this.draining ? 'draining' : 'healthy';
  const code = this.draining ? 503 : 200; // 503 tells K8s to stop routing

  res.status(code).json({
    status,
    workers: this.workers.filter(w => !w.worker.closed).length,
    rooms: this.rooms.size,
    draining: this.draining,
  });
});
```

K8s readiness probe returns 503 when draining, so the Service stops routing new traffic.

## Verification Script: `scripts/test-scale-trigger.js`

```
1.  Ensure KEDA is installed (or skip KEDA steps, test manual scaling)
2.  helm install with scaling.enabled=true, scaling.consumerThreshold=10
3.  kubectl get pods -l app=mediasoup -> assert 1 pod

4.  Create stage, inject synthetic publisher
5.  Connect 15 synthetic subscribers (exceeds threshold of 10)

6.  Wait up to 60s, poll: kubectl get pods -l app=mediasoup
    Assert: 2 mediasoup pods running

7.  Verify signaling discovers new pod (GET /api/pods on signaling)
8.  Verify new subscribers can still consume (media flowing)

9.  Disconnect all subscribers
10. Wait for cooldown (120s stabilization window)
11. kubectl get pods -l app=mediasoup -> assert back to 1 pod

12. Exit 0
```

For environments without KEDA, test manual scaling:
```bash
kubectl scale deployment lvb-mediasoup --replicas=2
# Run test-fan-out.js to verify cross-pod pipe transports
```

## Files Changed
- `src/mediasoup-server.js` — pod registration, graceful drain, draining flag
- `src/signaling-server.js` — PodRegistry class, discovery endpoints
- `helm/templates/mediasoup-keda.yaml` — new
- `helm/templates/mediasoup-servicemonitor.yaml` — new
- `helm/templates/mediasoup-service-headless.yaml` — new
- `helm/values.yaml` — scaling section
- `scripts/test-scale-trigger.js` — new file
