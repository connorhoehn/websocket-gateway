# Days 26-27: Helm Chart Finalization

Complete the Helm chart with all tunables, security, and test hooks.

## Final Chart Structure

```
helm/live-video-broadcaster/
  Chart.yaml
  values.yaml
  values-production.yaml
  templates/
    _helpers.tpl
    NOTES.txt

    # Signaling
    signaling-deployment.yaml
    signaling-service.yaml
    signaling-configmap.yaml
    signaling-ingress.yaml

    # Mediasoup
    mediasoup-deployment.yaml
    mediasoup-service.yaml
    mediasoup-service-headless.yaml
    mediasoup-configmap.yaml

    # Coturn
    coturn-deployment.yaml
    coturn-service-udp.yaml
    coturn-service-tcp.yaml
    coturn-secret.yaml

    # Scaling
    mediasoup-keda.yaml              # (conditional: scaling.enabled)

    # Monitoring
    mediasoup-servicemonitor.yaml    # (conditional: metrics.serviceMonitor.enabled)

    # Storage
    recordings-pvc.yaml              # (conditional: recording.enabled)

    # Security
    networkpolicy.yaml               # (conditional: networkPolicy.enabled)

    # Tests
    tests/
      test-connectivity.yaml
      test-api.yaml
```

## Final values.yaml

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
  logLevel: info
  resources:
    requests:
      cpu: 100m
      memory: 128Mi
    limits:
      cpu: 500m
      memory: 256Mi
  ingress:
    enabled: false
    className: nginx
    annotations:
      nginx.ingress.kubernetes.io/affinity: "cookie"
      nginx.ingress.kubernetes.io/session-cookie-name: "SIG_AFFINITY"
      nginx.ingress.kubernetes.io/proxy-read-timeout: "3600"
      nginx.ingress.kubernetes.io/proxy-send-timeout: "3600"
    hosts:
    - host: signaling.local
      paths:
      - path: /
        pathType: Prefix

mediasoup:
  replicaCount: 1
  image:
    repository: live-video-broadcaster/mediasoup
    tag: latest
    pullPolicy: IfNotPresent
  port: 3001
  hostNetwork: true
  logLevel: info
  workers: 4
  rtcBasePort: 40000
  maxConsumersPerWorker: 500
  pipeTransportThreshold: 400
  resources:
    requests:
      cpu: 500m
      memory: 512Mi
    limits:
      cpu: 2000m
      memory: 2Gi
  nodeSelector: {}
  tolerations: []

coturn:
  enabled: true
  image:
    repository: coturn/coturn
    tag: 4.6.2-alpine
  realm: "webrtc.local"
  credentials:
    username: "webrtc"
    password: "webrtc123"
    existingSecret: ""
  ports:
    listening: 3478
    tlsListening: 5349
    relayMin: 49152
    relayMax: 49252
  resources:
    requests:
      cpu: 100m
      memory: 128Mi
    limits:
      cpu: 500m
      memory: 256Mi

recording:
  enabled: false
  storagePath: /data/recordings
  storageSize: 10Gi
  storageClass: ""

scaling:
  enabled: false
  minReplicas: 1
  maxReplicas: 10
  consumerThreshold: 400
  cooldownPeriod: 60
  prometheusUrl: "http://prometheus-server.monitoring:9090"

metrics:
  enabled: true
  serviceMonitor:
    enabled: false
    interval: 15s
    namespace: ""

networkPolicy:
  enabled: false

testing:
  enabled: true
```

## NetworkPolicy

```yaml
{{- if .Values.networkPolicy.enabled }}
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: {{ include "lvb.fullname" . }}-mediasoup
spec:
  podSelector:
    matchLabels:
      app: mediasoup
  policyTypes:
  - Ingress
  ingress:
  # Only signaling can reach mediasoup HTTP API
  - from:
    - podSelector:
        matchLabels:
          app: signaling
    ports:
    - port: {{ .Values.mediasoup.port }}
      protocol: TCP
  # RTC media from anywhere (clients connect via hostNetwork)
  {{- range $i := until (int .Values.mediasoup.workers) }}
  - ports:
    - port: {{ add (int $.Values.mediasoup.rtcBasePort) $i }}
      protocol: UDP
    - port: {{ add (int $.Values.mediasoup.rtcBasePort) $i }}
      protocol: TCP
  {{- end }}
---
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: {{ include "lvb.fullname" . }}-signaling
spec:
  podSelector:
    matchLabels:
      app: signaling
  policyTypes:
  - Ingress
  ingress:
  # Clients can reach signaling
  - ports:
    - port: {{ .Values.signaling.port }}
      protocol: TCP
{{- end }}
```

## Helm Test: API Suite

```yaml
# templates/tests/test-api.yaml
apiVersion: v1
kind: Pod
metadata:
  name: {{ include "lvb.fullname" . }}-test-api
  annotations:
    "helm.sh/hook": test
spec:
  containers:
  - name: test
    image: "{{ .Values.signaling.image.repository }}:{{ .Values.signaling.image.tag }}"
    command: ['node', 'scripts/test-api-suite.js']
    env:
    - name: SIGNALING_URL
      value: "http://{{ include "lvb.fullname" . }}-signaling:{{ .Values.signaling.port }}"
    - name: MEDIASOUP_URL
      value: "http://{{ include "lvb.fullname" . }}-mediasoup:{{ .Values.mediasoup.port }}"
  restartPolicy: Never
```

## NOTES.txt

```
{{- $sigSvc := printf "%s-signaling" (include "lvb.fullname" .) -}}

Live Video Broadcaster has been installed!

To access the signaling server:
  kubectl port-forward svc/{{ $sigSvc }} {{ .Values.signaling.port }}:{{ .Values.signaling.port }}

Then open: http://localhost:{{ .Values.signaling.port }}

To run tests:
  helm test {{ .Release.Name }}

To check status:
  curl http://localhost:{{ .Values.signaling.port }}/api/health

{{- if .Values.scaling.enabled }}
Auto-scaling is enabled (KEDA).
  Consumer threshold: {{ .Values.scaling.consumerThreshold }}
  Min/Max pods: {{ .Values.scaling.minReplicas }}/{{ .Values.scaling.maxReplicas }}
{{- end }}
```

## Deployment Commands

```bash
# Build images
docker build -f docker/Dockerfile.signaling -t live-video-broadcaster/signaling:latest .
docker build -f docker/Dockerfile.mediasoup -t live-video-broadcaster/mediasoup:latest .

# Install (dev)
helm install lvb ./helm/live-video-broadcaster

# Install (production)
helm install lvb ./helm/live-video-broadcaster -f ./helm/live-video-broadcaster/values-production.yaml

# Test
helm test lvb

# Upgrade
helm upgrade lvb ./helm/live-video-broadcaster

# Uninstall
helm uninstall lvb
```

## Files Changed
- `helm/` — finalize all templates
- `helm/values-production.yaml` — new
