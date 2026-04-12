# Stage 1: Build frontend
FROM node:20-alpine AS frontend-build
WORKDIR /build
COPY frontend/package*.json ./
RUN npm install --legacy-peer-deps
COPY frontend/ ./
RUN npx vite build

# Stage 2: Production server
FROM node:20-alpine
RUN apk add --no-cache curl
RUN addgroup -g 1001 -S nodejs && adduser -S websocket -u 1001 -G nodejs
WORKDIR /app
COPY src/package*.json ./
RUN npm install --only=production && npm cache clean --force
COPY src/ ./
COPY --from=frontend-build /build/dist ./public/
RUN chown -R websocket:nodejs /app
USER websocket
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
    CMD curl -f http://localhost:8080/health || exit 1
CMD ["node", "server.js"]
