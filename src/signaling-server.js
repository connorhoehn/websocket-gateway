const express = require('express');
const crypto = require('crypto');
const { createServer } = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');
const jwt = require('jsonwebtoken');

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------
const LOG_LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };
const CURRENT_LEVEL = LOG_LEVELS[process.env.LOG_LEVEL || 'info'] ?? 2;
function log(level, fields, msg) {
  if ((LOG_LEVELS[level] ?? 2) > CURRENT_LEVEL) return;
  console.log(JSON.stringify({ ts: new Date().toISOString(), level, ...fields, ...(msg ? { msg } : {}) }));
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const MEDIASOUP_URL = process.env.MEDIASOUP_URL || 'http://localhost:3001';
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-prod';

function genId(prefix) { return `${prefix}_${crypto.randomBytes(9).toString('base64url')}`; }

// ---------------------------------------------------------------------------
// Internal HTTP to mediasoup
// ---------------------------------------------------------------------------
async function msReq(method, path, body = null) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const resp = await fetch(`${MEDIASOUP_URL}${path}`, opts);
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`mediasoup ${method} ${path} (${resp.status}): ${text}`);
  }
  return resp.json();
}

// ---------------------------------------------------------------------------
// StageManager
// ---------------------------------------------------------------------------
class StageManager {
  constructor() {
    this.stages = new Map(); // stageId -> StageRecord
  }

  create(config) {
    const stageId = genId('stg');
    const stage = {
      stageId,
      name: config.name || '',
      maxParticipants: config.maxParticipants || 12,
      state: 'IDLE',
      activeSessionId: null,
      videoConfig: {
        maxBitrate: config.videoConfig?.maxBitrate || 2500000,
        maxResolution: config.videoConfig?.maxResolution || '720p',
      },
      participants: new Map(), // participantId -> ParticipantRecord
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.stages.set(stageId, stage);
    return stage;
  }

  get(stageId) { return this.stages.get(stageId); }
  delete(stageId) { this.stages.delete(stageId); }
  list() { return Array.from(this.stages.values()); }
}

function serializeStage(s) {
  return {
    stageId: s.stageId, name: s.name, state: s.state,
    activeSessionId: s.activeSessionId,
    maxParticipants: s.maxParticipants,
    videoConfig: s.videoConfig,
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
    endpoints: { signaling: `ws://localhost:${process.env.PORT || 3000}` },
  };
}

function serializeParticipant(p) {
  return {
    participantId: p.participantId, userId: p.userId, state: p.state,
    published: p.published, capabilities: p.capabilities,
    attributes: p.attributes, firstJoinTime: p.firstJoinTime?.toISOString(),
  };
}

function generateParticipantToken(stageId, config) {
  const participantId = genId('pid');
  const capabilities = config.capabilities || ['PUBLISH', 'SUBSCRIBE'];
  const duration = config.duration || 720;
  const token = jwt.sign({
    stageId, participantId,
    userId: config.userId || '',
    capabilities,
    attributes: config.attributes || {},
  }, JWT_SECRET, { expiresIn: `${duration}m` });

  return {
    token, participantId,
    userId: config.userId || '',
    capabilities, duration,
    attributes: config.attributes || {},
    expirationTime: new Date(Date.now() + duration * 60000).toISOString(),
  };
}

// ---------------------------------------------------------------------------
// RoomManager (Chat)
// ---------------------------------------------------------------------------
class RoomManager {
  constructor() {
    this.rooms = new Map(); // roomId -> ChatRoomRecord
  }

  create(config) {
    const roomId = genId('room');
    const room = {
      roomId,
      name: config.name || '',
      maximumMessageLength: config.maximumMessageLength || 500,
      maximumMessageRatePerSecond: config.maximumMessageRatePerSecond || 10,
      linkedStageId: config.linkedStageId || null,
      participants: new Map(), // userId -> { socketId, attributes, capabilities, messageTimestamps }
      messages: [],
      createdAt: new Date(),
    };
    this.rooms.set(roomId, room);
    return room;
  }

  get(roomId) { return this.rooms.get(roomId); }
  delete(roomId) { this.rooms.delete(roomId); }
  list() { return Array.from(this.rooms.values()); }
}

function serializeRoom(r) {
  return {
    roomId: r.roomId, name: r.name,
    maximumMessageLength: r.maximumMessageLength,
    maximumMessageRatePerSecond: r.maximumMessageRatePerSecond,
    linkedStageId: r.linkedStageId,
    participants: r.participants.size,
    createdAt: r.createdAt.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// ChannelManager (IVS Channels — 1:N broadcast)
// ---------------------------------------------------------------------------
class ChannelManager {
  constructor() {
    this.channels = new Map(); // channelId -> ChannelRecord
  }

  create(config) {
    const channelId = genId('ch');
    const stageId = `stg_ch_${channelId}`;
    const channel = {
      channelId, stageId, name: config.name || '',
      type: config.type || 'STANDARD',
      latencyMode: config.latencyMode || 'LOW',
      state: 'IDLE',
      videoConfig: {
        maxBitrate: config.videoConfig?.maxBitrate || 2500000,
        maxResolution: config.videoConfig?.maxResolution || '720p',
        simulcast: (config.type || 'STANDARD') === 'STANDARD',
      },
      publisherParticipantId: null,
      viewers: new Map(),
      createdAt: new Date(),
    };
    this.channels.set(channelId, channel);
    return channel;
  }

  get(channelId) { return this.channels.get(channelId); }
  getByStageId(stageId) {
    for (const ch of this.channels.values()) {
      if (ch.stageId === stageId) return ch;
    }
    return null;
  }
  delete(channelId) { this.channels.delete(channelId); }
  list() { return Array.from(this.channels.values()); }
}

function serializeChannel(c) {
  return {
    channelId: c.channelId, stageId: c.stageId,
    name: c.name, state: c.state,
    type: c.type, latencyMode: c.latencyMode,
    videoConfig: c.videoConfig,
    viewerCount: c.viewers.size,
    createdAt: c.createdAt.toISOString(),
    endpoints: { signaling: `ws://localhost:${process.env.PORT || 3000}` },
  };
}

// ---------------------------------------------------------------------------
// SignalingGateway
// ---------------------------------------------------------------------------
class SignalingGateway {
  constructor() {
    this.app = express();
    this.app.use(cors());
    this.app.use(express.json());
    this.server = createServer(this.app);
    this.io = new Server(this.server, { cors: { origin: '*', methods: ['GET', 'POST'] } });

    this.stageManager = new StageManager();
    this.roomManager = new RoomManager();
    this.channelManager = new ChannelManager();

    // Socket tracking
    this.socketToRoom = new Map();    // socketId -> mediasoup roomId (for raw room joins)
    this.socketToStage = new Map();   // socketId -> stageId (for stage-based joins)

    this.setupRoutes();
    this.setupSocketHandlers();
  }

  // ---- ICE servers ----
  getIceServers() {
    const iceServers = [];
    const coturnUrls = process.env.COTURN_URLS ? process.env.COTURN_URLS.split(',') : [];
    const user = process.env.COTURN_USERNAME || 'webrtc';
    const pass = process.env.COTURN_PASSWORD || 'webrtc123';
    const host = process.env.TURN_EXTERNAL_HOST || 'localhost';
    coturnUrls.forEach(url => {
      const t = url.trim();
      if (t.startsWith('stun:')) iceServers.push({ urls: [`stun:${host}:3478`] });
      else if (t.startsWith('turn:')) iceServers.push({ urls: [`turn:${host}:3478`], username: user, credential: pass });
    });
    if (!iceServers.length) iceServers.push({ urls: ['stun:stun.l.google.com:19302'] });
    return iceServers;
  }

  // =====================================================================
  // REST API
  // =====================================================================
  setupRoutes() {
    this.app.use(express.static(path.join(__dirname, 'static')));

    // ---- Health ----
    this.app.get('/health', async (req, res) => {
      let msHealth = { status: 'unreachable' };
      try { msHealth = await (await fetch(`${MEDIASOUP_URL}/health`, { signal: AbortSignal.timeout(3000) })).json(); } catch {}
      const ok = msHealth.status === 'healthy';
      res.status(ok ? 200 : 503).json({
        status: ok ? 'healthy' : 'degraded',
        services: { signaling: { status: 'healthy', connections: this.io.sockets.sockets.size }, mediasoup: msHealth },
        stages: { active: this.stageManager.stages.size },
        chatRooms: { active: this.roomManager.rooms.size },
        channels: { active: this.channelManager.channels.size, live: this.channelManager.list().filter(c => c.state === 'LIVE').length },
        timestamp: new Date().toISOString(),
      });
    });

    // ---- Proxy: workers, mediasoup rooms, metrics ----
    this.app.get('/api/workers', async (req, res) => { try { res.json(await msReq('GET', '/api/workers')); } catch (e) { res.status(502).json({ error: e.message }); } });
    this.app.get('/api/mediasoup-rooms', async (req, res) => { try { res.json(await msReq('GET', '/api/rooms')); } catch (e) { res.status(502).json({ error: e.message }); } });
    this.app.get('/metrics', async (req, res) => {
      try {
        const msText = await (await fetch(`${MEDIASOUP_URL}/metrics`)).text();
        const sig = [
          '# HELP signaling_active_connections Current WebSocket connections',
          '# TYPE signaling_active_connections gauge',
          `signaling_active_connections ${this.io.sockets.sockets.size}`,
          '# HELP signaling_stages_active Active stages',
          '# TYPE signaling_stages_active gauge',
          `signaling_stages_active ${this.stageManager.stages.size}`,
          '# HELP signaling_chat_rooms_active Active chat rooms',
          '# TYPE signaling_chat_rooms_active gauge',
          `signaling_chat_rooms_active ${this.roomManager.rooms.size}`,
        ].join('\n');
        res.set('Content-Type', 'text/plain; version=0.0.4').end(msText + sig + '\n');
      } catch (e) { res.status(502).json({ error: e.message }); }
    });
    this.app.get('/api/turn-config', (req, res) => { res.json({ iceServers: this.getIceServers() }); });

    // ================================================================
    // Stage API (IVS CreateStage, GetStage, ListStages, etc.)
    // ================================================================

    // POST /api/stages
    this.app.post('/api/stages', async (req, res) => {
      try {
        const { name = '', maxParticipants = 12, participantTokenConfigurations = [], videoConfig = {} } = req.body;
        if (name && (name.length > 128 || !/^[a-zA-Z0-9\-_ ]*$/.test(name)))
          return res.status(400).json({ error: 'Invalid name' });
        if (maxParticipants < 1 || maxParticipants > 100)
          return res.status(400).json({ error: 'maxParticipants must be 1-100' });
        if (participantTokenConfigurations.length > 12)
          return res.status(400).json({ error: 'Max 12 token configurations' });

        const stage = this.stageManager.create({ name, maxParticipants, videoConfig });

        // Create mediasoup room
        await msReq('POST', `/internal/rooms/${stage.stageId}/create`);

        const participantTokens = participantTokenConfigurations.map(c =>
          generateParticipantToken(stage.stageId, c)
        );

        res.json({ stage: serializeStage(stage), participantTokens });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });

    // GET /api/stages
    this.app.get('/api/stages', (req, res) => {
      const stages = this.stageManager.list().map(s => ({
        ...serializeStage(s),
        participants: {
          total: s.participants.size,
          publishers: Array.from(s.participants.values()).filter(p => p.published).length,
          subscribers: Array.from(s.participants.values()).filter(p => !p.published).length,
        },
      }));
      res.json({ stages });
    });

    // GET /api/stages/:stageId
    this.app.get('/api/stages/:stageId', (req, res) => {
      const stage = this.stageManager.get(req.params.stageId);
      if (!stage) return res.status(404).json({ error: 'Stage not found' });
      res.json({
        stage: serializeStage(stage),
        participants: Array.from(stage.participants.values()).map(serializeParticipant),
      });
    });

    // PATCH /api/stages/:stageId
    this.app.patch('/api/stages/:stageId', (req, res) => {
      const stage = this.stageManager.get(req.params.stageId);
      if (!stage) return res.status(404).json({ error: 'Stage not found' });
      if (req.body.name !== undefined) stage.name = req.body.name;
      if (req.body.maxParticipants !== undefined) stage.maxParticipants = req.body.maxParticipants;
      stage.updatedAt = new Date();
      res.json({ stage: serializeStage(stage) });
    });

    // DELETE /api/stages/:stageId
    this.app.delete('/api/stages/:stageId', async (req, res) => {
      const stage = this.stageManager.get(req.params.stageId);
      if (!stage) return res.status(404).json({ error: 'Stage not found' });
      this.io.to(stage.stageId).emit('stage-stopped', { stageId: stage.stageId, reason: 'deleted' });
      try { await msReq('DELETE', `/internal/rooms/${stage.stageId}`); } catch {}
      this.stageManager.delete(stage.stageId);
      res.json({});
    });

    // ================================================================
    // Participant API
    // ================================================================

    // POST /api/stages/:stageId/participants — generate token
    this.app.post('/api/stages/:stageId/participants', (req, res) => {
      const stage = this.stageManager.get(req.params.stageId);
      if (!stage) return res.status(404).json({ error: 'Stage not found' });
      const { userId = '', capabilities = ['PUBLISH', 'SUBSCRIBE'], duration = 720, attributes = {} } = req.body;
      const validCaps = ['PUBLISH', 'SUBSCRIBE'];
      if (!capabilities.every(c => validCaps.includes(c)))
        return res.status(400).json({ error: 'Invalid capabilities' });
      if (duration < 1 || duration > 20160)
        return res.status(400).json({ error: 'Duration must be 1-20160' });
      if (JSON.stringify(attributes).length > 1024)
        return res.status(400).json({ error: 'Attributes must be under 1KB' });
      const tokenData = generateParticipantToken(stage.stageId, { userId, capabilities, duration, attributes });
      res.json({ participantToken: tokenData });
    });

    // GET /api/stages/:stageId/participants
    this.app.get('/api/stages/:stageId/participants', (req, res) => {
      const stage = this.stageManager.get(req.params.stageId);
      if (!stage) return res.status(404).json({ error: 'Stage not found' });
      let parts = Array.from(stage.participants.values());
      const { filterByPublished, filterByState, filterByUserId } = req.query;
      if (filterByPublished !== undefined) parts = parts.filter(p => p.published === (filterByPublished === 'true'));
      else if (filterByState) parts = parts.filter(p => p.state === filterByState);
      else if (filterByUserId) parts = parts.filter(p => p.userId === filterByUserId);
      res.json({ participants: parts.map(serializeParticipant) });
    });

    // DELETE /api/stages/:stageId/participants/:participantId — force disconnect
    this.app.delete('/api/stages/:stageId/participants/:participantId', async (req, res) => {
      const stage = this.stageManager.get(req.params.stageId);
      if (!stage) return res.status(404).json({ error: 'Stage not found' });
      const p = stage.participants.get(req.params.participantId);
      if (!p) return res.status(404).json({ error: 'Participant not found' });
      const sock = this.io.sockets.sockets.get(p.socketId);
      if (sock) { sock.emit('force-disconnect', { reason: req.body?.reason || 'Disconnected by server' }); sock.disconnect(true); }
      stage.participants.delete(req.params.participantId);
      res.json({});
    });

    // ================================================================
    // Chat Room API (IVS Chat)
    // ================================================================

    // POST /api/rooms
    this.app.post('/api/rooms', (req, res) => {
      const { name = '', maximumMessageLength = 500, maximumMessageRatePerSecond = 10, linkedStageId = null } = req.body;
      if (maximumMessageLength < 1 || maximumMessageLength > 500)
        return res.status(400).json({ error: 'maximumMessageLength must be 1-500' });
      if (maximumMessageRatePerSecond < 1 || maximumMessageRatePerSecond > 100)
        return res.status(400).json({ error: 'maximumMessageRatePerSecond must be 1-100' });
      if (linkedStageId && !this.stageManager.get(linkedStageId))
        return res.status(400).json({ error: 'Linked stage not found' });
      const room = this.roomManager.create({ name, maximumMessageLength, maximumMessageRatePerSecond, linkedStageId });
      res.json({ room: serializeRoom(room) });
    });

    // GET /api/rooms
    this.app.get('/api/rooms', (req, res) => {
      res.json({ rooms: this.roomManager.list().map(serializeRoom) });
    });

    // GET /api/rooms/:roomId
    this.app.get('/api/rooms/:roomId', (req, res) => {
      const room = this.roomManager.get(req.params.roomId);
      if (!room) return res.status(404).json({ error: 'Room not found' });
      res.json({ room: serializeRoom(room) });
    });

    // DELETE /api/rooms/:roomId
    this.app.delete('/api/rooms/:roomId', (req, res) => {
      const room = this.roomManager.get(req.params.roomId);
      if (!room) return res.status(404).json({ error: 'Room not found' });
      this.roomManager.delete(req.params.roomId);
      res.json({});
    });

    // POST /api/rooms/:roomId/tokens — generate chat token
    this.app.post('/api/rooms/:roomId/tokens', (req, res) => {
      const room = this.roomManager.get(req.params.roomId);
      if (!room) return res.status(404).json({ error: 'Room not found' });
      const { userId, capabilities = ['SEND_MESSAGE'], sessionDurationInMinutes = 60, attributes = {} } = req.body;
      if (!userId) return res.status(400).json({ error: 'userId required' });
      const validCaps = ['SEND_MESSAGE', 'DELETE_MESSAGE', 'DISCONNECT_USER'];
      if (!capabilities.every(c => validCaps.includes(c)))
        return res.status(400).json({ error: 'Invalid capabilities' });
      const token = jwt.sign({ roomId: room.roomId, userId, capabilities, attributes, type: 'chat' },
        JWT_SECRET, { expiresIn: `${sessionDurationInMinutes}m` });
      res.json({ token, sessionExpirationTime: new Date(Date.now() + sessionDurationInMinutes * 60000).toISOString() });
    });

    // ================================================================
    // Channel API (IVS Channels — 1:N broadcast)
    // ================================================================

    // POST /api/channels
    this.app.post('/api/channels', async (req, res) => {
      try {
        const { name = '', type = 'STANDARD', latencyMode = 'LOW', videoConfig = {} } = req.body;
        const channel = this.channelManager.create({ name, type, latencyMode, videoConfig });

        // Create backing mediasoup room + register as stage (so join-stage works)
        await msReq('POST', `/internal/rooms/${channel.stageId}/create`);
        const backingStage = this.stageManager.create({
          name: `[channel] ${channel.name}`,
          maxParticipants: 10000, // channels have no practical participant limit
          videoConfig: channel.videoConfig,
        });
        // Override the auto-generated stageId to match the channel's
        this.stageManager.stages.delete(backingStage.stageId);
        backingStage.stageId = channel.stageId;
        this.stageManager.stages.set(channel.stageId, backingStage);

        // Generate single publish token
        const publishToken = generateParticipantToken(channel.stageId, {
          userId: 'publisher',
          capabilities: ['PUBLISH'],
          duration: 1440,
          attributes: { channelId: channel.channelId, role: 'broadcaster' },
        });

        res.json({ channel: serializeChannel(channel), publishToken });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });

    // GET /api/channels
    this.app.get('/api/channels', (req, res) => {
      res.json({ channels: this.channelManager.list().map(serializeChannel) });
    });

    // GET /api/channels/:channelId
    this.app.get('/api/channels/:channelId', (req, res) => {
      const ch = this.channelManager.get(req.params.channelId);
      if (!ch) return res.status(404).json({ error: 'Channel not found' });
      res.json({ channel: serializeChannel(ch) });
    });

    // DELETE /api/channels/:channelId
    this.app.delete('/api/channels/:channelId', async (req, res) => {
      const ch = this.channelManager.get(req.params.channelId);
      if (!ch) return res.status(404).json({ error: 'Channel not found' });
      this.io.to(ch.stageId).emit('channel-stopped', { channelId: ch.channelId, reason: 'deleted' });
      try { await msReq('DELETE', `/internal/rooms/${ch.stageId}`); } catch {}
      this.stageManager.delete(ch.stageId);
      this.channelManager.delete(ch.channelId);
      res.json({});
    });

    // POST /api/channels/:channelId/viewers — generate viewer token
    this.app.post('/api/channels/:channelId/viewers', (req, res) => {
      const ch = this.channelManager.get(req.params.channelId);
      if (!ch) return res.status(404).json({ error: 'Channel not found' });
      const token = generateParticipantToken(ch.stageId, {
        userId: req.body?.userId || `viewer_${Date.now().toString(36)}`,
        capabilities: ['SUBSCRIBE'],
        duration: req.body?.duration || 720,
        attributes: { channelId: ch.channelId, role: 'viewer', ...(req.body?.attributes || {}) },
      });
      res.json({ viewerToken: token });
    });

    // ================================================================
    // Recording API proxy
    // ================================================================
    this.app.post('/api/stages/:stageId/recording/start', async (req, res) => {
      try { res.json(await msReq('POST', `/internal/rooms/${req.params.stageId}/recording/start`)); }
      catch (e) { res.status(502).json({ error: e.message }); }
    });
    this.app.post('/api/stages/:stageId/recording/:recordingId/stop', async (req, res) => {
      try { res.json(await msReq('POST', `/internal/rooms/${req.params.stageId}/recording/${req.params.recordingId}/stop`)); }
      catch (e) { res.status(502).json({ error: e.message }); }
    });
    this.app.get('/api/recordings', async (req, res) => {
      try { res.json(await msReq('GET', '/internal/recordings')); }
      catch (e) { res.status(502).json({ error: e.message }); }
    });

    // ---- Test injection proxy (dev) ----
    if (process.env.NODE_ENV !== 'production') {
      this.app.post('/api/test/inject-stream', async (req, res) => {
        try { res.json(await msReq('POST', '/api/test/inject-stream', req.body)); } catch (e) { res.status(502).json({ error: e.message }); }
      });
      this.app.delete('/api/test/inject-stream/:id', async (req, res) => {
        try { res.json(await msReq('DELETE', `/api/test/inject-stream/${req.params.id}`)); } catch (e) { res.status(502).json({ error: e.message }); }
      });
    }

    this.app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'static', 'mediasoup.html')));
  }

  // =====================================================================
  // Socket.io handlers
  // =====================================================================
  setupSocketHandlers() {
    this.io.on('connection', (socket) => {
      log('debug', { component: 'signaling', socketId: socket.id }, 'Connected');

      // ---- Join stage (token-based, IVS style) ----
      socket.on('join-stage', async ({ token, reconnect = false }, callback) => {
        try {
          const payload = jwt.verify(token, JWT_SECRET);
          const { stageId, participantId, userId, capabilities, attributes } = payload;
          const stage = this.stageManager.get(stageId);
          if (!stage) return callback({ error: 'Stage not found' });

          // Handle reconnection — clean up old socket for this participant
          if (reconnect) {
            const existing = stage.participants.get(participantId);
            if (existing && existing.socketId !== socket.id) {
              const oldSock = this.io.sockets.sockets.get(existing.socketId);
              if (oldSock) oldSock.disconnect(true);
              try { await msReq('POST', `/internal/rooms/${stageId}/cleanup/${existing.socketId}`); } catch {}
              log('info', { component: 'signaling', participantId, stageId }, 'Reconnected (old socket cleaned)');
            }
          }

          if (!reconnect && stage.participants.size >= stage.maxParticipants) return callback({ error: 'Stage full' });
          if (!stage.activeSessionId) { stage.activeSessionId = genId('sess'); stage.state = 'ACTIVE'; }

          stage.participants.set(participantId, {
            participantId, userId, capabilities, attributes,
            socketId: socket.id, state: 'CONNECTED', published: false,
            firstJoinTime: new Date(),
          });

          this.socketToStage.set(socket.id, stageId);
          socket.stageId = stageId;
          socket.participantId = participantId;
          socket.capabilities = capabilities;
          socket.join(stageId);

          // Track channel viewers
          const channel = this.channelManager.getByStageId(stageId);
          if (channel && capabilities.includes('SUBSCRIBE') && !capabilities.includes('PUBLISH')) {
            channel.viewers.set(participantId, { socketId: socket.id, joinedAt: new Date() });
          }

          // Ensure mediasoup room
          const { routerRtpCapabilities } = await msReq('POST', `/internal/rooms/${stageId}/create`);

          socket.to(stageId).emit('stage-participant-joined', { stageId, participantId, userId, attributes });

          const { producers } = await msReq('GET', `/internal/rooms/${stageId}/producers`);

          callback({
            success: true, stageId, participantId, routerRtpCapabilities,
            existingProducers: producers,
          });
        } catch (err) {
          const msg = err.name === 'TokenExpiredError' ? 'Token expired' : err.name === 'JsonWebTokenError' ? 'Invalid token' : err.message;
          callback({ error: msg });
        }
      });

      // ---- Join room (raw, backward-compat for Week 1 tests) ----
      socket.on('join-room', async (data, callback) => {
        try {
          const { roomId, type, metadata = {} } = data;
          if (!roomId) return callback?.({ error: 'roomId required' });
          const { routerRtpCapabilities } = await msReq('POST', `/internal/rooms/${roomId}/create`);
          this.socketToRoom.set(socket.id, roomId);
          socket.join(roomId);
          if (callback) callback({ success: true, routerRtpCapabilities });
          socket.to(roomId).emit('user-joined', { socketId: socket.id, type, roomId, metadata });
          const { producers } = await msReq('GET', `/internal/rooms/${roomId}/producers`);
          for (const p of producers) socket.emit('newProducer', { producerId: p.producerId, socketId: p.socketId, kind: p.kind });
        } catch (e) { if (callback) callback({ error: e.message }); }
      });

      // ---- Join chat room (token-based) ----
      socket.on('join-chat-room', async ({ token }, callback) => {
        try {
          const payload = jwt.verify(token, JWT_SECRET);
          if (payload.type !== 'chat') return callback({ error: 'Invalid token type' });
          const room = this.roomManager.get(payload.roomId);
          if (!room) return callback({ error: 'Room not found' });
          room.participants.set(payload.userId, {
            socketId: socket.id, userId: payload.userId,
            attributes: payload.attributes, capabilities: payload.capabilities,
            messageTimestamps: [],
          });
          socket.chatRoomId = payload.roomId;
          socket.chatUserId = payload.userId;
          socket.chatCapabilities = payload.capabilities;
          socket.join(`chat:${payload.roomId}`);
          callback({ success: true, roomId: payload.roomId });
        } catch (err) {
          callback({ error: err.message });
        }
      });

      // ---- Chat action (SEND_MESSAGE, DELETE_MESSAGE) ----
      socket.on('chat-action', (data, callback) => {
        try {
          const room = this.roomManager.get(socket.chatRoomId);
          if (!room) return callback({ error: 'Not in a chat room' });

          if (data.action === 'SEND_MESSAGE') {
            if (!socket.chatCapabilities?.includes('SEND_MESSAGE'))
              return callback({ error: 'SEND_MESSAGE not allowed' });
            const { content, attributes: msgAttr = {}, requestId } = data;
            if (!content || content.length > room.maximumMessageLength)
              return callback({ error: `Message must be 1-${room.maximumMessageLength} chars` });

            // Rate limit
            const p = room.participants.get(socket.chatUserId);
            const now = Date.now();
            p.messageTimestamps = p.messageTimestamps.filter(t => now - t < 1000);
            if (p.messageTimestamps.length >= room.maximumMessageRatePerSecond)
              return callback({ error: 'Rate limit exceeded' });
            p.messageTimestamps.push(now);

            const messageId = genId('msg');
            const message = {
              type: 'MESSAGE', id: messageId, requestId, content,
              sendTime: new Date().toISOString(),
              sender: { userId: socket.chatUserId, attributes: p.attributes },
              attributes: msgAttr,
            };
            room.messages.push(message);
            if (room.messages.length > 100) room.messages.shift();
            this.io.to(`chat:${socket.chatRoomId}`).emit('chat-event', message);
            callback({ success: true, messageId });

          } else if (data.action === 'DELETE_MESSAGE') {
            if (!socket.chatCapabilities?.includes('DELETE_MESSAGE'))
              return callback({ error: 'DELETE_MESSAGE not allowed' });
            this.io.to(`chat:${socket.chatRoomId}`).emit('chat-event', {
              type: 'EVENT', id: genId('evt'), eventName: 'aws:DELETE_MESSAGE',
              sendTime: new Date().toISOString(),
              attributes: { messageId: data.id, reason: data.reason || '' },
              requestId: data.requestId,
            });
            callback({ success: true });

          } else {
            callback({ error: `Unknown action: ${data.action}` });
          }
        } catch (e) { callback({ error: e.message }); }
      });

      // ---- SFU proxy: transport, produce, consume, resume ----
      socket.on('get-router-rtp-capabilities', async (callback) => {
        try {
          const roomId = this.socketToRoom.get(socket.id) || socket.stageId;
          if (!roomId) return callback({ error: 'Not in a room' });
          const { routerRtpCapabilities } = await msReq('POST', `/internal/rooms/${roomId}/create`);
          callback(routerRtpCapabilities);
        } catch (e) { callback({ error: e.message }); }
      });

      socket.on('create-webrtc-transport', async (data, callback) => {
        try {
          const roomId = this.socketToRoom.get(socket.id) || socket.stageId;
          if (!roomId) throw new Error('Not in a room');
          callback(await msReq('POST', `/internal/rooms/${roomId}/transport/create`, { type: data.type, socketId: socket.id }));
        } catch (e) { callback({ error: e.message }); }
      });

      socket.on('connect-transport', async (data, callback) => {
        try {
          const roomId = this.socketToRoom.get(socket.id) || socket.stageId;
          if (!roomId) throw new Error('Not in a room');
          await msReq('POST', `/internal/rooms/${roomId}/transport/${data.transportId || 'any'}/connect`,
            { socketId: socket.id, type: data.type, dtlsParameters: data.dtlsParameters });
          callback();
        } catch (e) { callback({ error: e.message }); }
      });

      socket.on('produce', async (data, callback) => {
        try {
          const roomId = this.socketToRoom.get(socket.id) || socket.stageId;
          if (!roomId) throw new Error('Not in a room');

          // Capability check for stage participants
          if (socket.capabilities && !socket.capabilities.includes('PUBLISH'))
            return callback({ error: 'PUBLISH_NOT_ALLOWED' });

          // Channel single-publisher enforcement
          const channel = this.channelManager.getByStageId(roomId);
          if (channel) {
            if (channel.publisherParticipantId && channel.publisherParticipantId !== socket.participantId)
              return callback({ error: 'Channel already has a publisher' });
            channel.publisherParticipantId = socket.participantId;
            channel.state = 'LIVE';
          }

          const { producerId } = await msReq('POST', `/internal/rooms/${roomId}/produce`,
            { socketId: socket.id, kind: data.kind, rtpParameters: data.rtpParameters });

          // Update participant record
          if (socket.stageId) {
            const stage = this.stageManager.get(socket.stageId);
            const p = stage?.participants.get(socket.participantId);
            if (p) p.published = true;
            socket.to(socket.stageId).emit('stage-participant-published', { stageId: socket.stageId, participantId: socket.participantId, kind: data.kind });
          }

          socket.to(roomId).emit('newProducer', { producerId, socketId: socket.id, kind: data.kind });
          callback({ id: producerId });
        } catch (e) { callback({ error: e.message }); }
      });

      socket.on('consume', async (data, callback) => {
        try {
          const roomId = this.socketToRoom.get(socket.id) || socket.stageId;
          if (!roomId) throw new Error('Not in a room');
          if (socket.capabilities && !socket.capabilities.includes('SUBSCRIBE'))
            return callback({ error: 'SUBSCRIBE_NOT_ALLOWED' });
          callback(await msReq('POST', `/internal/rooms/${roomId}/consume`,
            { socketId: socket.id, producerId: data.producerId, rtpCapabilities: data.rtpCapabilities }));
        } catch (e) { callback({ error: e.message }); }
      });

      socket.on('resume', async (data, callback) => {
        try {
          const roomId = this.socketToRoom.get(socket.id) || socket.stageId;
          if (!roomId) throw new Error('Not in a room');
          await msReq('POST', `/internal/rooms/${roomId}/consumer/${data.consumerId}/resume`, { socketId: socket.id });
          callback();
        } catch (e) { callback({ error: e.message }); }
      });

      // ---- Legacy chat (room-scoped) ----
      socket.on('chat-message', (data) => {
        const roomId = this.socketToRoom.get(socket.id) || socket.stageId;
        if (roomId) socket.to(roomId).emit('chat-message', { socketId: socket.id, message: data.message, timestamp: new Date().toISOString() });
      });

      socket.on('get-turn-config', () => socket.emit('turn-config', { iceServers: this.getIceServers() }));

      // ---- Disconnect ----
      socket.on('disconnect', async () => {
        const stageId = this.socketToStage.get(socket.id);
        const roomId = this.socketToRoom.get(socket.id);
        const msRoomId = stageId || roomId;

        if (stageId) {
          const stage = this.stageManager.get(stageId);
          if (stage) {
            const p = stage.participants.get(socket.participantId);
            if (p) p.state = 'DISCONNECTED';
            socket.to(stageId).emit('stage-participant-left', { stageId, participantId: socket.participantId, userId: p?.userId });
            stage.participants.delete(socket.participantId);
            if (stage.participants.size === 0) { stage.state = 'IDLE'; stage.activeSessionId = null; }

            // Update channel viewer tracking
            const ch = this.channelManager.getByStageId(stageId);
            if (ch) {
              ch.viewers.delete(socket.participantId);
              if (ch.publisherParticipantId === socket.participantId) {
                ch.publisherParticipantId = null;
                ch.state = 'IDLE';
              }
            }
          }
          this.socketToStage.delete(socket.id);
        }

        if (roomId) {
          socket.to(roomId).emit('user-left', { socketId: socket.id });
          this.socketToRoom.delete(socket.id);
        }

        if (msRoomId) {
          try { await msReq('POST', `/internal/rooms/${msRoomId}/cleanup/${socket.id}`); } catch {}
        }
      });
    });
  }

  start(port = 3000) {
    this.server.listen(port, () => {
      log('info', { component: 'signaling', port, mediasoupUrl: MEDIASOUP_URL }, 'Signaling gateway listening');
    });
  }
}

const gw = new SignalingGateway();
gw.start(process.env.PORT || 3000);
