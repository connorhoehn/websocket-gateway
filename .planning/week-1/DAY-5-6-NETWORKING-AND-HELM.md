# Days 5-6: Fix Networking + Helm Chart

## Day 5: Fix Docker Compose Networking

### Problem 1: Coturn on host network, everything else on bridge

Coturn uses `network_mode: host` (line 83 of docker-compose.yml).
Mediasoup/signaling reference `localhost:3478` for TURN — but they're on the bridge network.
Coturn is unreachable from inside containers.

### Fix: Put coturn on the bridge network

```yaml
coturn:
  build:
    context: .
    dockerfile: docker/Dockerfile.coturn
  container_name: coturn-server
  restart: unless-stopped
  ports:
    - "3478:3478/udp"
    - "3478:3478/tcp"
    - "5349:5349/tcp"         # TURNS (TLS)
    - "49152-49252:49152-49252/udp"  # Relay range (limited for local dev)
  command: [
    "-n",
    "--log-file=stdout",
    "--listening-ip=0.0.0.0",
    "--relay-ip=0.0.0.0",
    "--external-ip=0.0.0.0",
    "--min-port=49152",
    "--max-port=49252",       # Narrowed for local dev (100 ports)
    "--lt-cred-mech",
    "--fingerprint",
    "--no-multicast-peers",
    "--no-cli",
    "--realm=webrtc.local",
    "--user=webrtc:webrtc123"
  ]
  networks:
    - webrtc-network
  healthcheck:
    test: ["CMD", "nc", "-z", "localhost", "3478"]
    interval: 30s
    timeout: 10s
    start_period: 60s
    retries: 3
  volumes:
    - coturn_data:/var/lib/coturn
```

### Fix: Update TURN URLs in all services

```yaml
# BEFORE (broken):
- COTURN_URLS=stun:localhost:3478,turn:localhost:3478

# AFTER (Docker DNS):
- COTURN_URLS=stun:coturn-server:3478,turn:coturn-server:3478
```

For the P2P client (browser), TURN URLs must use `localhost:3478` since the browser
connects from the host, not from inside Docker. The server should return different
ICE configs for internal vs external clients:

```js
getIceServers(isInternal = false) {
  const turnHost = isInternal ? 'coturn-server' : (process.env.TURN_EXTERNAL_HOST || 'localhost');
  return [
    { urls: `stun:${turnHost}:3478` },
    {
      urls: `turn:${turnHost}:3478`,
      username: process.env.COTURN_USERNAME || 'webrtc',
      credential: process.env.COTURN_PASSWORD || 'webrtc123'
    }
  ];
}
```

### Problem 2: Mediasoup port range too wide

With WebRtcServer (Day 3), we only need 4 ports per mediasoup instance.

```yaml
mediasoup:
  build:
    context: .
    dockerfile: docker/Dockerfile.mediasoup
  ports:
    - "${MEDIASOUP_PORT:-3001}:3001"
    - "40000-40003:40000-40003/udp"    # 1 port per worker
    - "40000-40003:40000-40003/tcp"
  environment:
    - PORT=3001
    - MEDIASOUP_LISTEN_IP=0.0.0.0
    - MEDIASOUP_ANNOUNCED_IP=${MEDIASOUP_ANNOUNCED_IP:-127.0.0.1}
    - RTC_BASE_PORT=40000
    - MEDIASOUP_WORKERS=4
    - COTURN_URLS=stun:coturn-server:3478,turn:coturn-server:3478
    - COTURN_USERNAME=${COTURN_USERNAME:-webrtc}
    - COTURN_PASSWORD=${COTURN_PASSWORD:-webrtc123}
  depends_on:
    coturn:
      condition: service_healthy
  networks:
    - webrtc-network
  profiles:
    - sfu
    - mediasoup
```

### Updated docker-compose.yml (complete)

```yaml
services:
  signaling:
    build:
      context: .
      dockerfile: docker/Dockerfile.signaling
    ports:
      - "${SIGNALING_PORT:-3000}:3000"
    environment:
      - PORT=3000
      - COTURN_URLS=stun:coturn-server:3478,turn:coturn-server:3478
      - COTURN_USERNAME=${COTURN_USERNAME:-webrtc}
      - COTURN_PASSWORD=${COTURN_PASSWORD:-webrtc123}
      - MEDIASOUP_URL=http://mediasoup:3001
      - TURN_EXTERNAL_HOST=${TURN_EXTERNAL_HOST:-localhost}
    depends_on:
      coturn:
        condition: service_healthy
      mediasoup:
        condition: service_started
    networks:
      - webrtc-network

  mediasoup:
    build:
      context: .
      dockerfile: docker/Dockerfile.mediasoup
    ports:
      - "3001:3001"
      - "40000-40003:40000-40003/udp"
      - "40000-40003:40000-40003/tcp"
    environment:
      - PORT=3001
      - MEDIASOUP_LISTEN_IP=0.0.0.0
      - MEDIASOUP_ANNOUNCED_IP=${MEDIASOUP_ANNOUNCED_IP:-127.0.0.1}
      - RTC_BASE_PORT=40000
      - MEDIASOUP_WORKERS=4
      - COTURN_URLS=stun:coturn-server:3478,turn:coturn-server:3478
      - COTURN_USERNAME=${COTURN_USERNAME:-webrtc}
      - COTURN_PASSWORD=${COTURN_PASSWORD:-webrtc123}
      - LOG_LEVEL=info
    depends_on:
      coturn:
        condition: service_healthy
    networks:
      - webrtc-network

  coturn:
    build:
      context: .
      dockerfile: docker/Dockerfile.coturn
    container_name: coturn-server
    restart: unless-stopped
    ports:
      - "3478:3478/udp"
      - "3478:3478/tcp"
      - "49152-49252:49152-49252/udp"
    command: ["-n", "--log-file=stdout", "--listening-ip=0.0.0.0",
      "--relay-ip=0.0.0.0", "--min-port=49152", "--max-port=49252",
      "--lt-cred-mech", "--fingerprint", "--no-multicast-peers",
      "--no-cli", "--realm=webrtc.local", "--user=webrtc:webrtc123"]
    networks:
      - webrtc-network
    healthcheck:
      test: ["CMD", "nc", "-z", "localhost", "3478"]
      interval: 30s
      timeout: 10s
      start_period: 60s
      retries: 3

networks:
  webrtc-network:
    driver: bridge
```

---

## Day 6: Helm Chart

### Chart Structure

```
helm/live-video-broadcaster/
  Chart.yaml
  values.yaml
  templates/
    _helpers.tpl
    NOTES.txt
    signaling-deployment.yaml
    signaling-service.yaml
    signaling-configmap.yaml
    mediasoup-deployment.yaml
    mediasoup-service.yaml
    mediasoup-configmap.yaml
    coturn-deployment.yaml
    coturn-service-udp.yaml
    coturn-service-tcp.yaml
    coturn-secret.yaml
    tests/
      test-connectivity.yaml
```

### Chart.yaml

```yaml
apiVersion: v2
name: live-video-broadcaster
description: Local IVS replacement — WebRTC streaming with mediasoup SFU
version: 0.1.0
appVersion: "1.0.0"
type: application
```

### values.yaml

```yaml
global:
  environment: development
  jwtSecret: "dev-secret-change-in-prod"

signaling:
  replicaCount: 1
  image:
    repository: live-video-broadcaster/signaling
    tag: latest
    pullPolicy: IfNotPresent
  port: 3000
  resources:
    requests:
      cpu: 100m
      memory: 128Mi
    limits:
      cpu: 500m
      memory: 256Mi

mediasoup:
  replicaCount: 1
  image:
    repository: live-video-broadcaster/mediasoup
    tag: latest
    pullPolicy: IfNotPresent
  port: 3001
  hostNetwork: true
  workers: 4
  rtcBasePort: 40000
  maxConsumersPerWorker: 500
  logLevel: info
  resources:
    requests:
      cpu: 500m
      memory: 512Mi
    limits:
      cpu: 2000m
      memory: 2Gi

coturn:
  enabled: true
  image:
    repository: coturn/coturn
    tag: 4.6.2-alpine
  realm: "webrtc.local"
  credentials:
    username: "webrtc"
    password: "webrtc123"
  ports:
    listening: 3478
    relayMin: 49152
    relayMax: 49252

metrics:
  enabled: true

testing:
  enabled: true
```

### mediasoup-deployment.yaml (key template)

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: {{ include "lvb.fullname" . }}-mediasoup
spec:
  replicas: {{ .Values.mediasoup.replicaCount }}
  selector:
    matchLabels:
      app: mediasoup
  template:
    metadata:
      labels:
        app: mediasoup
    spec:
      {{- if .Values.mediasoup.hostNetwork }}
      hostNetwork: true
      dnsPolicy: ClusterFirstWithHostNet
      {{- end }}
      affinity:
        podAntiAffinity:
          requiredDuringSchedulingIgnoredDuringExecution:
          - labelSelector:
              matchLabels:
                app: mediasoup
            topologyKey: kubernetes.io/hostname
      containers:
      - name: mediasoup
        image: "{{ .Values.mediasoup.image.repository }}:{{ .Values.mediasoup.image.tag }}"
        imagePullPolicy: {{ .Values.mediasoup.image.pullPolicy }}
        ports:
        - containerPort: {{ .Values.mediasoup.port }}
          protocol: TCP
        {{- range $i := until (int .Values.mediasoup.workers) }}
        - containerPort: {{ add (int $.Values.mediasoup.rtcBasePort) $i }}
          protocol: UDP
        - containerPort: {{ add (int $.Values.mediasoup.rtcBasePort) $i }}
          protocol: TCP
        {{- end }}
        env:
        - name: PORT
          value: {{ .Values.mediasoup.port | quote }}
        - name: MEDIASOUP_LISTEN_IP
          value: "0.0.0.0"
        - name: MEDIASOUP_ANNOUNCED_IP
          valueFrom:
            fieldRef:
              fieldPath: status.hostIP
        - name: RTC_BASE_PORT
          value: {{ .Values.mediasoup.rtcBasePort | quote }}
        - name: MEDIASOUP_WORKERS
          value: {{ .Values.mediasoup.workers | quote }}
        - name: LOG_LEVEL
          value: {{ .Values.mediasoup.logLevel }}
        - name: COTURN_URLS
          value: "stun:{{ include "lvb.fullname" . }}-coturn:{{ .Values.coturn.ports.listening }},turn:{{ include "lvb.fullname" . }}-coturn:{{ .Values.coturn.ports.listening }}"
        - name: COTURN_USERNAME
          valueFrom:
            secretKeyRef:
              name: {{ include "lvb.fullname" . }}-coturn
              key: username
        - name: COTURN_PASSWORD
          valueFrom:
            secretKeyRef:
              name: {{ include "lvb.fullname" . }}-coturn
              key: password
        readinessProbe:
          httpGet:
            path: /health
            port: {{ .Values.mediasoup.port }}
          initialDelaySeconds: 10
          periodSeconds: 10
        startupProbe:
          httpGet:
            path: /health
            port: {{ .Values.mediasoup.port }}
          failureThreshold: 10
          periodSeconds: 5
        resources:
          {{- toYaml .Values.mediasoup.resources | nindent 10 }}
```

### Helm Test Hook

`templates/tests/test-connectivity.yaml`:
```yaml
apiVersion: v1
kind: Pod
metadata:
  name: {{ include "lvb.fullname" . }}-test
  annotations:
    "helm.sh/hook": test
spec:
  containers:
  - name: test
    image: curlimages/curl:latest
    command: ['sh', '-c']
    args:
    - |
      echo "Testing signaling health..."
      curl -sf http://{{ include "lvb.fullname" . }}-signaling:3000/health || exit 1
      echo "Testing mediasoup health..."
      curl -sf http://{{ include "lvb.fullname" . }}-mediasoup:3001/health || exit 1
      echo "Testing mediasoup metrics..."
      curl -sf http://{{ include "lvb.fullname" . }}-mediasoup:3001/metrics | grep mediasoup_ || exit 1
      echo "All connectivity tests passed"
  restartPolicy: Never
```

### Deployment

```bash
# Build images (Docker for Mac / minikube)
docker build -f docker/Dockerfile.signaling -t live-video-broadcaster/signaling:latest .
docker build -f docker/Dockerfile.mediasoup -t live-video-broadcaster/mediasoup:latest .

# Install
helm install lvb ./helm/live-video-broadcaster

# Test
helm test lvb

# Check pods
kubectl get pods -l 'app in (signaling, mediasoup, coturn)'
```

## Verification

```bash
# Docker Compose
docker compose --profile sfu up -d
curl localhost:3001/health  # mediasoup healthy
curl localhost:3000/health  # signaling healthy
# Run test harness against localhost:3000

# Kubernetes
helm install lvb ./helm/live-video-broadcaster
helm test lvb  # Should pass
kubectl port-forward svc/lvb-signaling 3000:3000
# Run test harness against localhost:3000
```

## Files Changed
- `docker-compose.yml` — coturn networking, mediasoup ports, TURN URLs
- `helm/` — entire new directory
- `config/local-dev.env` — update TURN URLs
