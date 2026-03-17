#!/usr/bin/env node
/**
 * End-to-end integration test for Phase 31 real-time social events.
 *
 * Prerequisites (all must be running):
 *   - WebSocket gateway: ws://localhost:8080 (or WS_URL)
 *   - social-api: http://localhost:3001 (or SOCIAL_API_URL)
 *
 * Required env vars:
 *   JWT_TOKEN_1    — Cognito JWT for the subscribing user (room member)
 *   ROOM_ID        — roomId the user is a member of
 *   CHANNEL_ID     — channelId for that room (from social-rooms DynamoDB)
 *
 * Optional:
 *   WS_URL         — defaults to ws://localhost:8080
 *   SOCIAL_API_URL — defaults to http://localhost:3001
 *
 * Usage:
 *   JWT_TOKEN_1=eyJ... ROOM_ID=abc CHANNEL_ID=uuid node scripts/test-realtime-social.js
 *
 * Exit codes:
 *   0 — all tests passed (or skipped due to missing env vars)
 *   1 — one or more tests failed
 *
 * RTIM-04 (social:member_joined / social:member_left) requires two Cognito accounts:
 * User 1 subscribes to the channel, User 2 joins the room via POST /api/rooms/:roomId/join.
 * Manual verification: run the script, then in a separate terminal:
 *   curl -X POST http://localhost:3001/api/rooms/$ROOM_ID/join -H "Authorization: Bearer $JWT_TOKEN_2"
 * User 1 should receive { type: 'social:member_joined', ... }
 */
'use strict';

const WebSocket = require('ws');

const WS_URL = process.env.WS_URL || 'ws://localhost:8080';
const SOCIAL_API_URL = process.env.SOCIAL_API_URL || 'http://localhost:3001';
const JWT_TOKEN = process.env.JWT_TOKEN_1;
const ROOM_ID = process.env.ROOM_ID;
const CHANNEL_ID = process.env.CHANNEL_ID;
const TIMEOUT_MS = 3000;

// Check for required env vars
if (!JWT_TOKEN || !ROOM_ID || !CHANNEL_ID) {
  const missing = [
    !JWT_TOKEN && 'JWT_TOKEN_1',
    !ROOM_ID && 'ROOM_ID',
    !CHANNEL_ID && 'CHANNEL_ID',
  ].filter(Boolean);
  console.log(`SKIP: Missing required env vars: ${missing.join(', ')}`);
  console.log('Set these env vars to run the real-time integration test.');
  process.exit(0);
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function connectWS() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${WS_URL}?token=${JWT_TOKEN}`);
    const t = setTimeout(() => reject(new Error('WS connect timeout')), 5000);
    ws.on('open', () => { clearTimeout(t); resolve(ws); });
    ws.on('error', (e) => { clearTimeout(t); reject(e); });
  });
}

function waitForEvent(ws, matchFn, timeoutMs = TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(
      () => reject(new Error(`Timeout waiting for event after ${timeoutMs}ms`)),
      timeoutMs
    );
    const handler = (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (matchFn(msg)) {
          clearTimeout(t);
          ws.removeListener('message', handler);
          resolve(msg);
        }
      } catch { /* ignore non-JSON */ }
    };
    ws.on('message', handler);
  });
}

function send(ws, obj) {
  ws.send(JSON.stringify(obj));
}

async function post(path, body) {
  const resp = await fetch(`${SOCIAL_API_URL}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${JWT_TOKEN}`,
    },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`HTTP ${resp.status}: ${text}`);
  }
  return resp.json();
}

// ─── Tests ───────────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

async function runTest(name, fn) {
  process.stdout.write(`  ${name} ... `);
  try {
    await fn();
    console.log('PASS');
    passed++;
  } catch (err) {
    console.log(`FAIL: ${err.message}`);
    failed++;
  }
}

async function main() {
  console.log('\n=== Phase 31 Real-time Social Integration Test ===\n');
  console.log(`  WS gateway:  ${WS_URL}`);
  console.log(`  Social API:  ${SOCIAL_API_URL}`);
  console.log(`  Room:        ${ROOM_ID}`);
  console.log(`  Channel:     ${CHANNEL_ID}\n`);

  let ws;
  try {
    ws = await connectWS();
    console.log('  Connected to WS gateway');
  } catch (err) {
    console.error(`FAIL: Cannot connect to WS gateway: ${err.message}`);
    process.exit(1);
  }

  // Wait for session message
  try {
    await waitForEvent(ws, (m) => m.type === 'session' && m.status === 'connected', 5000);
    console.log('  WS session established\n');
  } catch (err) {
    console.error(`FAIL: No session message: ${err.message}`);
    ws.close();
    process.exit(1);
  }

  // Subscribe to social channel
  send(ws, { service: 'social', action: 'subscribe', channelId: CHANNEL_ID });
  try {
    await waitForEvent(
      ws,
      (m) => m.type === 'social' && m.action === 'subscribed' && m.channelId === CHANNEL_ID,
      5000
    );
    console.log(`  Subscribed to channel ${CHANNEL_ID}\n`);
  } catch (err) {
    console.error(`FAIL: subscribe confirmation not received: ${err.message}`);
    ws.close();
    process.exit(1);
  }

  // RTIM-01: social:post
  await runTest('RTIM-01: social:post event received after POST /rooms/:roomId/posts', async () => {
    const eventPromise = waitForEvent(ws, (m) => m.type === 'social:post' && m.channel === CHANNEL_ID);
    const postResp = await post(`/api/rooms/${ROOM_ID}/posts`, { content: 'rtim-test-post' });
    const event = await eventPromise;
    if (!event.payload || event.payload.postId !== postResp.postId) {
      throw new Error(`Expected payload.postId=${postResp.postId}, got ${JSON.stringify(event.payload)}`);
    }
  });

  // RTIM-02: social:comment
  // Create a parent post first so we have a valid postId to comment on
  await runTest('RTIM-02: social:comment event received after POST /rooms/:roomId/posts/:postId/comments', async () => {
    const postResp = await post(`/api/rooms/${ROOM_ID}/posts`, { content: 'rtim-test-comment-parent' });
    const postId = postResp.postId;

    const eventPromise = waitForEvent(ws, (m) => m.type === 'social:comment' && m.channel === CHANNEL_ID);
    await post(`/api/rooms/${ROOM_ID}/posts/${postId}/comments`, { content: 'rtim-test-comment' });
    const event = await eventPromise;
    if (!event.payload) {
      throw new Error(`Expected payload in social:comment event, got ${JSON.stringify(event)}`);
    }
  });

  // RTIM-03: social:like
  // Create a post first so we have a valid postId to like
  await runTest('RTIM-03: social:like event received after POST /rooms/:roomId/posts/:postId/likes', async () => {
    const postResp = await post(`/api/rooms/${ROOM_ID}/posts`, { content: 'rtim-test-like-target' });
    const postId = postResp.postId;

    const eventPromise = waitForEvent(ws, (m) => m.type === 'social:like' && m.channel === CHANNEL_ID);
    await post(`/api/rooms/${ROOM_ID}/posts/${postId}/likes`, {});
    const event = await eventPromise;
    if (!event.payload) {
      throw new Error(`Expected payload in social:like event, got ${JSON.stringify(event)}`);
    }
  });

  // RTIM-04: social:member_joined — requires two Cognito accounts, manual verification only.
  // Automated assertion is omitted because it needs two separate user tokens.
  // To verify manually:
  //   1. Keep a WS client subscribed to this channel (as user 1)
  //   2. In another terminal, run:
  //      curl -X POST http://localhost:3001/api/rooms/$ROOM_ID/join \
  //           -H "Authorization: Bearer $JWT_TOKEN_2"
  //   3. User 1's WS client should receive:
  //      { type: 'social:member_joined', channel: CHANNEL_ID, payload: { ... }, _meta: { ... } }

  ws.close();

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
