/**
 * Test Harness — headless test client using socket.io-client
 * No browser needed. Exercises the signaling + mediasoup stack via WebSocket.
 */
const path = require('path');
const { io } = require(path.join(__dirname, '..', 'src', 'node_modules', 'socket.io-client'));

const SERVER_URL = process.env.SERVER_URL || 'http://localhost:3001';

class TestClient {
  constructor(serverUrl = SERVER_URL) {
    this.serverUrl = serverUrl;
    this.socket = null;
    this.roomId = null;
    this.routerRtpCapabilities = null;
    this.producerIds = new Map();  // kind -> producerId
    this.consumerIds = [];
    this.newProducerEvents = [];
  }

  connect() {
    return new Promise((resolve, reject) => {
      this.socket = io(this.serverUrl, {
        transports: ['websocket'],
        reconnection: false,
        timeout: 5000,
      });
      this.socket.on('connect', () => resolve());
      this.socket.on('connect_error', (err) => reject(err));

      // Collect events
      this.socket.on('newProducer', (data) => {
        this.newProducerEvents.push(data);
      });
    });
  }

  async joinRoom(roomId, type = 'streamer', metadata = {}) {
    this.roomId = roomId;
    return new Promise((resolve, reject) => {
      this.socket.emit('join-room', { roomId, type, metadata }, (response) => {
        if (response.error) return reject(new Error(response.error));
        this.routerRtpCapabilities = response.routerRtpCapabilities;
        resolve(response);
      });
    });
  }

  async createTransport(type) {
    return new Promise((resolve, reject) => {
      this.socket.emit('create-webrtc-transport', { type }, (response) => {
        if (response.error) return reject(new Error(response.error));
        resolve(response);
      });
    });
  }

  async connectTransport(type, dtlsParameters) {
    return new Promise((resolve, reject) => {
      this.socket.emit('connect-transport', { type, dtlsParameters }, (response) => {
        if (response?.error) return reject(new Error(response.error));
        resolve();
      });
    });
  }

  async produce(kind, rtpParameters) {
    return new Promise((resolve, reject) => {
      this.socket.emit('produce', { kind, rtpParameters }, (response) => {
        if (response.error) return reject(new Error(response.error));
        this.producerIds.set(kind, response.id);
        resolve(response);
      });
    });
  }

  async consume(producerId, rtpCapabilities) {
    return new Promise((resolve, reject) => {
      this.socket.emit('consume', {
        producerId,
        rtpCapabilities: rtpCapabilities || this.routerRtpCapabilities,
      }, (response) => {
        if (response.error) return reject(new Error(response.error));
        this.consumerIds.push(response.id);
        resolve(response);
      });
    });
  }

  async resume(consumerId) {
    return new Promise((resolve, reject) => {
      this.socket.emit('resume', { consumerId }, (response) => {
        if (response?.error) return reject(new Error(response.error));
        resolve();
      });
    });
  }

  waitForEvent(eventName, timeoutMs = 5000) {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(`Timeout waiting for ${eventName}`)), timeoutMs);
      this.socket.once(eventName, (data) => {
        clearTimeout(timeout);
        resolve(data);
      });
    });
  }

  waitForNewProducers(count, timeoutMs = 5000) {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`Timeout: got ${this.newProducerEvents.length}/${count} producers`));
      }, timeoutMs);

      const check = () => {
        if (this.newProducerEvents.length >= count) {
          clearTimeout(timeout);
          resolve(this.newProducerEvents.slice(0, count));
        }
      };

      check(); // Already collected some?
      this.socket.on('newProducer', () => check());
    });
  }

  disconnect() {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
  }
}

/**
 * Make an HTTP request to the server (for API testing)
 */
async function apiRequest(method, path, body = null) {
  const url = `${SERVER_URL}${path}`;
  const options = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };
  if (body) options.body = JSON.stringify(body);

  const resp = await fetch(url, options);
  const text = await resp.text();
  let json;
  try { json = JSON.parse(text); } catch (e) { json = text; }
  return { status: resp.status, body: json };
}

/**
 * Assert helper
 */
function assert(condition, message) {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

module.exports = { TestClient, apiRequest, assert, SERVER_URL };
