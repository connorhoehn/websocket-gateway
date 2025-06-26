# Dockerfile
FROM node:20-alpine

# Install curl and redis-cli for health checks
RUN apk add --no-cache curl redis

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S websocket -u 1001 -G nodejs

WORKDIR /app

# Copy package.json from src directory
COPY src/package*.json ./

# Install dependencies
RUN npm install --only=production && npm cache clean --force

# Copy application code
COPY src/ ./

# Change ownership to non-root user
RUN chown -R websocket:nodejs /app
USER websocket

EXPOSE 8080

# Add health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
    CMD curl -f http://localhost:8080/health || exit 1

# Default command - can be overridden in docker-compose or deployment
CMD ["node", "server.js"]