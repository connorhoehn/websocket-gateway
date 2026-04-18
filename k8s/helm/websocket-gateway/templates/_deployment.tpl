{{/*
Reusable Deployment template for application services (gateway, social-api).

Expected dict keys:
  root        - $  (chart root context, for include "websocket-gateway.*")
  name        - short suffix appended to fullname, also container name (e.g. "gateway")
  component   - value for app.kubernetes.io/component label (e.g. "gateway")
  image       - dict with repository, tag, pullPolicy
  port        - HTTP container port (int)
  portName    - name for the containerPort (defaults to "http")
  envFromConfigMap - configmap name suffix resolved to {fullname}-{suffix}
  replicas    - replica count
  resources   - resources dict (passed through toYaml)
  probes      - dict: { livenessPath, readinessPath }  (optional; omitted if nil)
  terminationGracePeriodSeconds - optional int (default 30)
  preStopSleepSeconds - optional int (default 10; set to 0 to omit lifecycle)
*/}}
{{- define "websocket-gateway.deployment" -}}
{{- $root := .root -}}
{{- $portName := default "http" .portName -}}
{{- $grace := default 30 .terminationGracePeriodSeconds -}}
{{- $preStop := default 10 .preStopSleepSeconds -}}
apiVersion: apps/v1
kind: Deployment
metadata:
  name: {{ include "websocket-gateway.fullname" $root }}-{{ .name }}
  labels:
    {{- include "websocket-gateway.labels" $root | nindent 4 }}
    app.kubernetes.io/component: {{ .component }}
spec:
  replicas: {{ .replicas }}
  selector:
    matchLabels:
      {{- include "websocket-gateway.selectorLabels" $root | nindent 6 }}
      app.kubernetes.io/component: {{ .component }}
  template:
    metadata:
      labels:
        {{- include "websocket-gateway.selectorLabels" $root | nindent 8 }}
        app.kubernetes.io/component: {{ .component }}
    spec:
      terminationGracePeriodSeconds: {{ $grace }}
      containers:
        - name: {{ .name }}
          image: "{{ .image.repository }}:{{ .image.tag }}"
          imagePullPolicy: {{ .image.pullPolicy }}
          ports:
            - name: {{ $portName }}
              containerPort: {{ .port }}
              protocol: TCP
          envFrom:
            - configMapRef:
                name: {{ include "websocket-gateway.fullname" $root }}-{{ .envFromConfigMap }}
          {{- if gt (int $preStop) 0 }}
          lifecycle:
            preStop:
              exec:
                command: ["sh", "-c", "sleep {{ $preStop }}"]
          {{- end }}
          {{- with .probes }}
          livenessProbe:
            httpGet:
              path: {{ .livenessPath }}
              port: {{ $portName }}
            initialDelaySeconds: 15
            periodSeconds: 15
          readinessProbe:
            httpGet:
              path: {{ .readinessPath }}
              port: {{ $portName }}
            initialDelaySeconds: 5
            periodSeconds: 5
          {{- end }}
          resources:
            {{- toYaml .resources | nindent 12 }}
{{- end }}
