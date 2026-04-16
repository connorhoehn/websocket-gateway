# Kubernetes + WebRTC Patterns

## The Core Challenge

K8s was designed for HTTP/TCP. WebRTC needs UDP on potentially many ports.

## Three Approaches to Media Port Exposure

### 1. hostNetwork: true (what we use)
```yaml
spec:
  hostNetwork: true
  dnsPolicy: ClusterFirstWithHostNet
```
- Pod binds directly to node's network stack
- One media server pod per node (port collision)
- Enforce via `podAntiAffinity` on `kubernetes.io/hostname`
- Use `status.hostIP` via Downward API for announced IP

### 2. WebRtcServer reduces port count
With mediasoup WebRtcServer, all transports share 1 port per worker.
4 workers = 4 ports. Manageable even with hostNetwork.

### 3. STUNner (future alternative)
Kubernetes-native media gateway. Exposes single TURN port (3478).
Routes UDP to pods via UDPRoute. No hostNetwork needed.
Consider if we need to run multiple mediasoup pods per node.

## Key K8s Patterns

### Downward API for IPs
```yaml
env:
- name: MEDIASOUP_ANNOUNCED_IP
  valueFrom:
    fieldRef:
      fieldPath: status.hostIP
- name: MY_POD_IP
  valueFrom:
    fieldRef:
      fieldPath: status.podIP
```

### WebSocket Sticky Sessions (signaling)
```yaml
annotations:
  nginx.ingress.kubernetes.io/affinity: "cookie"
  nginx.ingress.kubernetes.io/session-cookie-name: "SIG_AFFINITY"
  nginx.ingress.kubernetes.io/proxy-read-timeout: "3600"
  nginx.ingress.kubernetes.io/proxy-send-timeout: "3600"
```

### Headless Service for Pod Discovery
```yaml
spec:
  clusterIP: None
  selector:
    app: mediasoup
```
DNS returns all pod IPs: `dns.resolve4('mediasoup-headless.default.svc.cluster.local')`

### KEDA over CPU-based HPA
CPU doesn't correlate with WebRTC load. Use custom Prometheus metrics:
```yaml
triggers:
- type: prometheus
  metadata:
    query: sum(mediasoup_consumers_total)
    threshold: "400"
```

### Service Mesh: Skip for UDP
Istio/Linkerd don't proxy UDP. Use only for TCP signaling path.

## Coturn on K8s

Options:
- `small-hack/coturn-chart` Helm chart
- Relay port range (49152-65535) is the problem — too many ports for a Service
- Solutions: DaemonSet with hostNetwork, or replace with STUNner

For local dev: limited relay range (49152-49252, 100 ports) is sufficient.
