# syntax=docker/dockerfile:1.4
# distributed-core is a private git-URL dep. Pass the GitHub token via
# BuildKit secret (--secret id=gh_token,env=GH_TOKEN) so npm can fetch
# it during the build without baking the token into the image. The
# rewrite redirects ssh://git@github.com/ → https://x-access-token:<tok>@…

# Stage 1: Build TypeScript
FROM node:20-alpine AS build
RUN apk add --no-cache git
WORKDIR /app
COPY package*.json ./
RUN --mount=type=secret,id=gh_token \
    if [ -f /run/secrets/gh_token ]; then \
      git config --global url."https://x-access-token:$(cat /run/secrets/gh_token)@github.com/".insteadOf "ssh://git@github.com/" && \
      git config --global url."https://x-access-token:$(cat /run/secrets/gh_token)@github.com/".insteadOf "https://github.com/"; \
    fi && \
    npm ci
COPY tsconfig.json ./
COPY src/ ./src/
RUN npx tsc

# Stage 2: Runtime
FROM node:20-alpine
RUN apk add --no-cache curl git
RUN addgroup -g 1001 -S nodejs && adduser -S socialapi -u 1001 -G nodejs
WORKDIR /app
COPY package*.json tsconfig.json ./
# Full install (includes typescript) so Tilt live_update `npx tsc` works.
# Same secret-mount pattern as the build stage.
RUN --mount=type=secret,id=gh_token \
    if [ -f /run/secrets/gh_token ]; then \
      git config --global url."https://x-access-token:$(cat /run/secrets/gh_token)@github.com/".insteadOf "ssh://git@github.com/" && \
      git config --global url."https://x-access-token:$(cat /run/secrets/gh_token)@github.com/".insteadOf "https://github.com/"; \
    fi && \
    npm ci && npm cache clean --force && \
    git config --global --remove-section url."https://x-access-token:$(cat /run/secrets/gh_token 2>/dev/null)@github.com/" 2>/dev/null || true
COPY --from=build /app/dist ./dist/
COPY src/ ./src/
RUN chown -R socialapi:nodejs /app
USER socialapi
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
    CMD curl -f http://localhost:3001/health || exit 1
CMD ["node", "dist/index.js"]
