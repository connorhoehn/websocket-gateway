# Distributed WebSocket Gateway Architecture

This document outlines the architecture for deploying the WebSocket Gateway as a standalone microservice that can be used by multiple applications in a distributed environment.

## Overview

The WebSocket Gateway runs as an independent service behind a Network Load Balancer (NLB) for WebSocket connections, while other applications run behind Application Load Balancers (ALB). Communication happens via REST APIs and webhooks.

## Architecture Components

### 1. Standalone WebSocket Gateway Service

```javascript
// websocket-gateway-service/src/app.js
class WebSocketGatewayService {
    constructor() {
        this.app = express();
        this.server = http.createServer(this.app);
        this.wss = new WebSocketServer({ server: this.server });
        
        this.setupDatabase();
        this.setupRedis();
        this.setupWebSocketHandlers();
        this.setupRESTAPI();
        this.setupWebhooks();
    }

    setupRESTAPI() {
        // API for other services to interact with
        this.app.post('/api/channels', this.createChannel.bind(this));
        this.app.get('/api/channels/:id/messages', this.getMessages.bind(this));
        this.app.post('/api/channels/:id/messages', this.sendMessage.bind(this));
        this.app.post('/api/webhooks/configure', this.configureWebhooks.bind(this));
    }

    setupWebhooks() {
        // Send events to other services
        this.webhookEndpoints = new Map();
    }

    async notifyExternalService(event, data) {
        const endpoints = this.webhookEndpoints.get(event) || [];
        
        for (const endpoint of endpoints) {
            try {
                await axios.post(endpoint, {
                    event,
                    data,
                    timestamp: new Date().toISOString()
                });
            } catch (error) {
                console.error(`Failed to notify ${endpoint}:`, error.message);
            }
        }
    }
}
```

### 2. Client SDK for Other Services

```javascript
// websocket-gateway-client-sdk/index.js
class WebSocketGatewayClient {
    constructor(gatewayUrl, apiKey) {
        this.gatewayUrl = gatewayUrl;
        this.apiKey = apiKey;
        this.axiosInstance = axios.create({
            baseURL: gatewayUrl,
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            }
        });
    }

    // REST API methods for server-to-server communication
    async createChannel(name, type = 'group', metadata = {}) {
        const response = await this.axiosInstance.post('/api/channels', {
            name, type, metadata
        });
        return response.data;
    }

    async sendMessage(channelId, userId, content, messageType = 'text') {
        const response = await this.axiosInstance.post(`/api/channels/${channelId}/messages`, {
            userId, content, messageType
        });
        return response.data;
    }

    async getMessageHistory(channelId, limit = 50, offset = 0) {
        const response = await this.axiosInstance.get(`/api/channels/${channelId}/messages`, {
            params: { limit, offset }
        });
        return response.data;
    }

    // Configure webhooks to receive events
    async configureWebhooks(events, callbackUrl) {
        await this.axiosInstance.post('/api/webhooks/configure', {
            events,
            callbackUrl
        });
    }
}
```

## Deployment Architecture

### Docker Compose (Local Development)

```yaml
# docker-compose.yml for local development
version: '3.8'
services:
  websocket-gateway:
    build: ./websocket-gateway-service
    ports:
      - "8080:8080"
    environment:
      - DATABASE_URL=postgresql://postgres:password@db:5432/wsgateway
      - REDIS_URL=redis://redis:6379
    depends_on:
      - db
      - redis

  your-main-app:
    build: ./your-main-app
    ports:
      - "3000:3000"
    environment:
      - WEBSOCKET_GATEWAY_URL=http://websocket-gateway:8080
      - WEBSOCKET_GATEWAY_API_KEY=your-api-key
    depends_on:
      - websocket-gateway

  db:
    image: postgres:13
    environment:
      - POSTGRES_DB=wsgateway
      - POSTGRES_USER=postgres
      - POSTGRES_PASSWORD=password

  redis:
    image: redis:6
```

### AWS ECS Fargate Deployment

```yaml
# websocket-gateway-task-definition.json
{
  "family": "websocket-gateway",
  "networkMode": "awsvpc",
  "requiresCompatibilities": ["FARGATE"],
  "cpu": "512",
  "memory": "1024",
  "containerDefinitions": [
    {
      "name": "websocket-gateway",
      "image": "your-registry/websocket-gateway:latest",
      "portMappings": [
        {
          "containerPort": 8080,
          "protocol": "tcp"
        }
      ],
      "environment": [
        {
          "name": "DATABASE_URL",
          "value": "postgresql://..."
        },
        {
          "name": "REDIS_URL", 
          "value": "redis://..."
        }
      ]
    }
  ]
}
```

### Load Balancer Configuration

```yaml
# AWS ALB for your main app (HTTP/HTTPS)
MainAppALB:
  Type: AWS::ElasticLoadBalancingV2::LoadBalancer
  Properties:
    Scheme: internet-facing
    Type: application
    Subnets: [subnet-1, subnet-2]

# AWS NLB for WebSocket Gateway (TCP)
WebSocketGatewayNLB:
  Type: AWS::ElasticLoadBalancingV2::LoadBalancer
  Properties:
    Scheme: internet-facing
    Type: network
    Subnets: [subnet-1, subnet-2]
```

## Usage in Your Main Application

```javascript
// your-main-app/src/chat-controller.js
const { WebSocketGatewayClient } = require('websocket-gateway-client-sdk');

class ChatController {
    constructor() {
        this.wsGateway = new WebSocketGatewayClient(
            process.env.WEBSOCKET_GATEWAY_URL,
            process.env.WEBSOCKET_GATEWAY_API_KEY
        );
        
        this.setupWebhooks();
    }

    async setupWebhooks() {
        // Configure the gateway to send events to your app
        await this.wsGateway.configureWebhooks([
            'message:created',
            'user:joined',
            'user:left'
        ], `${process.env.APP_URL}/webhooks/websocket-gateway`);
    }

    async createChatRoom(roomName, userId) {
        // Create channel in the gateway service
        const channel = await this.wsGateway.createChannel(roomName, 'group', {
            createdBy: userId,
            appContext: 'chat-room'
        });

        // Store reference in your app's database
        await this.yourDatabase.query(
            'INSERT INTO chat_rooms (id, gateway_channel_id, name, created_by) VALUES ($1, $2, $3, $4)',
            [uuidv4(), channel.id, roomName, userId]
        );

        return channel;
    }

    // Webhook handler for events from the gateway
    async handleWebSocketEvent(req, res) {
        const { event, data } = req.body;

        switch (event) {
            case 'message:created':
                await this.handleNewMessage(data);
                break;
            case 'user:joined':
                await this.handleUserJoined(data);
                break;
        }

        res.sendStatus(200);
    }

    async handleNewMessage(data) {
        // Your business logic here
        // Send push notifications, update analytics, etc.
        await this.notificationService.sendPush(data.message);
    }
}
```

## Database Schema

The WebSocket Gateway service manages its own database with the following core tables:

```sql
-- Core tables for message persistence
CREATE TABLE users (
    id UUID PRIMARY KEY,
    username VARCHAR(255) UNIQUE NOT NULL,
    email VARCHAR(255) UNIQUE,
    avatar TEXT,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE channels (
    id UUID PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    type ENUM('direct', 'group', 'public') DEFAULT 'group',
    created_by UUID REFERENCES users(id),
    metadata JSONB,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE messages (
    id UUID PRIMARY KEY,
    channel_id UUID REFERENCES channels(id),
    user_id UUID REFERENCES users(id),
    content TEXT NOT NULL,
    message_type VARCHAR(50) DEFAULT 'text',
    reply_to UUID REFERENCES messages(id),
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE reactions (
    id UUID PRIMARY KEY,
    message_id UUID REFERENCES messages(id),
    user_id UUID REFERENCES users(id),
    emoji VARCHAR(50) NOT NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(message_id, user_id, emoji)
);
```

## Benefits of This Architecture

1. **True Microservice**: Gateway runs independently, scales separately
2. **Service Discovery**: Other services find it via environment variables or service mesh
3. **Separate Scaling**: Scale WebSocket connections independently from your main app
4. **Technology Agnostic**: Main app can be Python, Java, .NET - doesn't matter
5. **Event-Driven**: Webhooks keep services loosely coupled
6. **Persistent Connections**: NLB handles sticky WebSocket connections properly

## Communication Flow

1. **Service-to-Service**: Main app uses REST API to create channels, send messages
2. **Real-time Events**: WebSocket Gateway sends events to configured webhook endpoints
3. **Client Connections**: Frontend connects directly to WebSocket Gateway via NLB
4. **Database Persistence**: All messages/events stored in Gateway's database
5. **Cross-Service Data**: Main app stores references to Gateway channels in its own database

## Implementation Steps

1. Refactor current WebSocket Gateway into standalone service
2. Create client SDK for server-to-server communication
3. Implement webhook system for event notifications
4. Set up separate deployment pipeline for Gateway service
5. Configure load balancers and networking
6. Update main applications to use client SDK

This architecture allows the WebSocket Gateway to become a **platform service** that any application in your infrastructure can use, regardless of technology stack or deployment model.

## Alternative: Service Mesh Approach (Better for Local Cloud)

Actually, for a **mini cloud setup** with local services like DynamoDB, MinIO, Kafka, etc., an API Gateway might be overkill and could create unnecessary complexity. For local development cloud environments, consider a **service mesh** pattern instead.

### Why Service Mesh is Better for Local Cloud:

Instead of an API Gateway, consider a **service mesh** pattern with:

#### 1. Service Discovery & Configuration
```yaml
# docker-compose.yml - Your local cloud stack
version: '3.8'
services:
  # Infrastructure services
  dynamodb-local:
    image: amazon/dynamodb-local
    ports: ["8000:8000"]
    
  minio:
    image: minio/minio
    ports: ["9000:9000", "9001:9001"]
    
  kafka:
    image: confluentinc/cp-kafka
    ports: ["9092:9092"]
    
  redis:
    image: redis:6
    ports: ["6379:6379"]

  # Your platform services
  websocket-gateway:
    build: ./websocket-gateway
    ports: ["8080:8080"]
    environment:
      - TENANT_CONFIG_URL=http://config-service:3000
    depends_on: [redis, dynamodb-local]
    
  notification-service:
    build: ./notification-service
    ports: ["8081:8081"]
    environment:
      - TENANT_CONFIG_URL=http://config-service:3000
    depends_on: [kafka, dynamodb-local]
    
  file-service:
    build: ./file-service
    ports: ["8082:8082"]
    environment:
      - TENANT_CONFIG_URL=http://config-service:3000
    depends_on: [minio, dynamodb-local]

  # Lightweight config service (not a full gateway)
  config-service:
    build: ./config-service
    ports: ["3000:3000"]
    depends_on: [dynamodb-local]
    
  # Your apps
  reddit-clone:
    build: ./apps/reddit-clone
    ports: ["4000:4000"]
    environment:
      - WEBSOCKET_URL=http://websocket-gateway:8080
      - NOTIFICATION_URL=http://notification-service:8081
      - FILE_URL=http://file-service:8082
```

#### 2. Lightweight Config Service (Not Full Gateway)
```javascript
// config-service/src/tenant-config.js
class TenantConfigService {
    constructor() {
        this.dynamodb = new AWS.DynamoDB.DocumentClient({
            endpoint: 'http://dynamodb-local:8000'
        });
    }

    // Simple tenant validation endpoint
    async validateTenant(req, res) {
        const { clientId, clientSecret } = req.body;
        
        const tenant = await this.dynamodb.get({
            TableName: 'tenants',
            Key: { clientId }
        }).promise();

        if (!tenant.Item || tenant.Item.clientSecret !== clientSecret) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        res.json({
            tenantId: tenant.Item.clientId,
            permissions: tenant.Item.permissions,
            rateLimits: tenant.Item.rateLimits,
            metadata: tenant.Item.metadata
        });
    }

    // Simple config management
    async updateTenantConfig(req, res) {
        const { clientId } = req.params;
        const updates = req.body;
        
        await this.dynamodb.update({
            TableName: 'tenants',
            Key: { clientId },
            UpdateExpression: 'SET permissions = :p, rateLimits = :r',
            ExpressionAttributeValues: {
                ':p': updates.permissions,
                ':r': updates.rateLimits
            }
        }).promise();

        res.json({ success: true });
    }
}
```

#### 3. Each Service Handles Its Own Auth (Simpler)
```javascript
// websocket-gateway/src/middleware/tenant-auth.js
class TenantAuth {
    constructor() {
        this.configServiceUrl = process.env.TENANT_CONFIG_URL;
        this.tenantCache = new Map(); // Simple in-memory cache
    }

    async validateRequest(req, res, next) {
        const clientId = req.headers['x-client-id'];
        const clientSecret = req.headers['x-client-secret'];

        // Check cache first
        const cacheKey = `${clientId}:${clientSecret}`;
        let tenantContext = this.tenantCache.get(cacheKey);

        if (!tenantContext) {
            // Fetch from config service
            const response = await axios.post(`${this.configServiceUrl}/validate`, {
                clientId, clientSecret
            });
            
            if (response.status !== 200) {
                return res.status(401).json({ error: 'Invalid credentials' });
            }
            
            tenantContext = response.data;
            this.tenantCache.set(cacheKey, tenantContext); // Cache for 5 minutes
        }

        req.tenantContext = tenantContext;
        next();
    }
}
```

#### 4. Apps Use Service Discovery
```javascript
// apps/reddit-clone/src/services/platform-client.js
class PlatformClient {
    constructor() {
        // Service URLs from environment (docker-compose network)
        this.services = {
            websocket: process.env.WEBSOCKET_URL,
            notification: process.env.NOTIFICATION_URL,
            files: process.env.FILE_URL
        };
        
        this.credentials = {
            clientId: process.env.CLIENT_ID,
            clientSecret: process.env.CLIENT_SECRET
        };
    }

    async createChatRoom(roomName) {
        return await axios.post(`${this.services.websocket}/api/channels`, {
            name: roomName,
            type: 'group'
        }, {
            headers: {
                'x-client-id': this.credentials.clientId,
                'x-client-secret': this.credentials.clientSecret
            }
        });
    }

    async sendNotification(userId, message) {
        return await axios.post(`${this.services.notification}/api/send`, {
            userId, message
        }, {
            headers: {
                'x-client-id': this.credentials.clientId,
                'x-client-secret': this.credentials.clientSecret
            }
        });
    }
}
```

### Benefits of Service Mesh for Local Cloud:

#### 1. **Service Independence**
- Each service can be developed/deployed independently
- No single point of failure (API Gateway)
- Services can scale individually

#### 2. **Docker Network Magic**
- Services communicate directly via Docker network
- No complex routing logic needed
- Natural load balancing with Docker Compose scale

#### 3. **Development Workflow**
```bash
# Start your entire cloud
docker-compose up

# Scale specific services
docker-compose up --scale websocket-gateway=3

# Update just one service
docker-compose up -d --no-deps websocket-gateway

# Add new app
docker-compose up reddit-clone twitter-clone
```

#### 4. **Configuration Management**
```javascript
// Simple tenant seeding script
async function seedTenants() {
    const tenants = [
        {
            clientId: 'reddit-clone',
            clientSecret: 'secret123',
            permissions: {
                websocket: ['chat:*', 'presence:*'],
                notification: ['send:*'],
                files: ['upload:*']
            }
        },
        {
            clientId: 'twitter-clone', 
            clientSecret: 'secret456',
            permissions: {
                websocket: ['chat:read', 'presence:read'],
                notification: ['send:basic']
            }
        }
    ];
    
    for (const tenant of tenants) {
        await dynamodb.put({
            TableName: 'tenants',
            Item: tenant
        }).promise();
    }
}
```

### Production Deployment Benefits:

This approach gives you:
- **Microservice benefits** without gateway complexity
- **Easy local development** with docker-compose
- **Production-ready** - same pattern works in Kubernetes/ECS Fargate
- **Service mesh ready** - can add Istio/Linkerd later if needed
- **Simple tenant management** without over-engineering
- **Better for deployment** - no need to rebuild API gateway, each service deploys independently
- **ECS/Fargate compatible** - each service gets its own task definition
- **Kubernetes ready** - natural fit for K8s service discovery and networking

The service mesh approach is much better for both local development and production deployment, especially when targeting ECS Fargate or Kubernetes environments.
