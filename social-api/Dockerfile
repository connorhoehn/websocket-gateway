# Stage 1: Build TypeScript
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src/ ./src/
RUN npx tsc

# Stage 2: Runtime
FROM node:20-alpine
RUN apk add --no-cache curl
RUN addgroup -g 1001 -S nodejs && adduser -S socialapi -u 1001 -G nodejs
WORKDIR /app
COPY package*.json tsconfig.json ./
# Full install (includes typescript) so Tilt live_update `npx tsc` works
RUN npm ci && npm cache clean --force
COPY --from=build /app/dist ./dist/
COPY src/ ./src/
RUN chown -R socialapi:nodejs /app
USER socialapi
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
    CMD curl -f http://localhost:3001/health || exit 1
CMD ["node", "dist/index.js"]
