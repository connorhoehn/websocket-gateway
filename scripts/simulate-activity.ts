#!/usr/bin/env npx tsx --tsconfig scripts/tsconfig.scripts.json
/**
 * Random activity simulation script.
 *
 * Provisions N Cognito users, authenticates them, creates profiles and rooms,
 * then drives weighted random social actions for a configurable duration.
 * Every action is logged as a JSON line to stdout.
 *
 * Usage:
 *   npx tsx scripts/simulate-activity.ts --users 5 --duration 60
 *   ./scripts/simulate-activity.sh --users 5 --duration 60
 */

import path from 'path';
import {
  createSimUser,
  logAction,
  apiCall,
  loadEnvReal,
  parseArgs,
  sleep,
  SimUser,
} from './lib/sim-helpers';

// ── State ────────────────────────────────────────────────────────────────────

const users: SimUser[] = [];
const roomIds: string[] = [];
const postIdsByRoom: Map<string, string[]> = new Map();

// ── Counters ─────────────────────────────────────────────────────────────────

let totalActions = 0;
let totalErrors = 0;

// ── Weighted Action Selection ────────────────────────────────────────────────

interface WeightedAction {
  type: string;
  weight: number;
}

const ACTION_WEIGHTS: WeightedAction[] = [
  { type: 'post.create', weight: 30 },
  { type: 'comment.create', weight: 20 },
  { type: 'reaction.add', weight: 20 },
  { type: 'like.add', weight: 15 },
  { type: 'follow', weight: 10 },
  { type: 'room.create', weight: 5 },
];

const TOTAL_WEIGHT = ACTION_WEIGHTS.reduce((sum, a) => sum + a.weight, 0);

function pickWeightedAction(): string {
  let rand = Math.random() * TOTAL_WEIGHT;
  for (const entry of ACTION_WEIGHTS) {
    rand -= entry.weight;
    if (rand <= 0) return entry.type;
  }
  return ACTION_WEIGHTS[0].type;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const EMOJIS = ['fire', 'heart', 'thumbsup', 'laugh', 'wow', 'sad'];

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function pickOtherUser(actor: SimUser): SimUser | null {
  const others = users.filter((u) => u.userId !== actor.userId);
  return others.length > 0 ? pickRandom(others) : null;
}

function getRandomPostAndRoom(): { roomId: string; postId: string } | null {
  const entries = Array.from(postIdsByRoom.entries()).filter(
    ([, posts]) => posts.length > 0,
  );
  if (entries.length === 0) return null;
  const [roomId, posts] = pickRandom(entries);
  const postId = pickRandom(posts);
  return { roomId, postId };
}

function randomDelay(): number {
  return 500 + Math.floor(Math.random() * 1500); // 500-2000ms
}

// ── Action Executors ─────────────────────────────────────────────────────────

async function executeAction(actionType: string, actor: SimUser): Promise<void> {
  const ts = new Date().toISOString();
  totalActions++;

  switch (actionType) {
    case 'post.create': {
      const roomId = pickRandom(roomIds);
      const res = await apiCall('POST', `/api/rooms/${roomId}/posts`, actor.token, {
        content: `Sim post at ${new Date().toISOString()}`,
      });
      if (res.ok && res.data?.postId) {
        const posts = postIdsByRoom.get(roomId) ?? [];
        posts.push(res.data.postId);
        // Cap at 50 posts per room
        if (posts.length > 50) posts.shift();
        postIdsByRoom.set(roomId, posts);
      }
      logAction({
        timestamp: ts,
        actor: actor.displayName,
        action: 'post.create',
        resource: `room:${roomId}`,
        result: res.ok ? 'ok' : 'error',
        ...(res.ok ? {} : { error: JSON.stringify(res.data), statusCode: res.status }),
      });
      if (!res.ok) totalErrors++;
      break;
    }

    case 'comment.create': {
      const target = getRandomPostAndRoom();
      if (!target) {
        logAction({ timestamp: ts, actor: actor.displayName, action: 'comment.create', resource: 'n/a', result: 'skip' });
        break;
      }
      const res = await apiCall(
        'POST',
        `/api/rooms/${target.roomId}/posts/${target.postId}/comments`,
        actor.token,
        { content: `Sim comment ${Date.now()}` },
      );
      logAction({
        timestamp: ts,
        actor: actor.displayName,
        action: 'comment.create',
        resource: `post:${target.postId}`,
        result: res.ok ? 'ok' : 'error',
        ...(res.ok ? {} : { error: JSON.stringify(res.data), statusCode: res.status }),
      });
      if (!res.ok) totalErrors++;
      break;
    }

    case 'reaction.add': {
      const target = getRandomPostAndRoom();
      if (!target) {
        logAction({ timestamp: ts, actor: actor.displayName, action: 'reaction.add', resource: 'n/a', result: 'skip' });
        break;
      }
      const emoji = pickRandom(EMOJIS);
      const res = await apiCall(
        'POST',
        `/api/rooms/${target.roomId}/posts/${target.postId}/reactions`,
        actor.token,
        { emoji },
      );
      logAction({
        timestamp: ts,
        actor: actor.displayName,
        action: 'reaction.add',
        resource: `post:${target.postId}`,
        result: res.ok ? 'ok' : 'error',
        ...(res.ok ? {} : { error: JSON.stringify(res.data), statusCode: res.status }),
      });
      if (!res.ok) totalErrors++;
      break;
    }

    case 'like.add': {
      const target = getRandomPostAndRoom();
      if (!target) {
        logAction({ timestamp: ts, actor: actor.displayName, action: 'like.add', resource: 'n/a', result: 'skip' });
        break;
      }
      const res = await apiCall(
        'POST',
        `/api/rooms/${target.roomId}/posts/${target.postId}/likes`,
        actor.token,
      );
      logAction({
        timestamp: ts,
        actor: actor.displayName,
        action: 'like.add',
        resource: `post:${target.postId}`,
        result: res.ok ? 'ok' : 'error',
        ...(res.ok ? {} : { error: JSON.stringify(res.data), statusCode: res.status }),
      });
      if (!res.ok) totalErrors++;
      break;
    }

    case 'follow': {
      const target = pickOtherUser(actor);
      if (!target) {
        logAction({ timestamp: ts, actor: actor.displayName, action: 'follow', resource: 'n/a', result: 'skip' });
        break;
      }
      const res = await apiCall(
        'POST',
        `/api/social/follow/${target.userId}`,
        actor.token,
      );
      // 409 = already following, treat as ok (idempotent)
      const isOk = res.ok || res.status === 409;
      logAction({
        timestamp: ts,
        actor: actor.displayName,
        action: 'follow',
        resource: `user:${target.userId}`,
        result: isOk ? 'ok' : 'error',
        ...(isOk ? {} : { error: JSON.stringify(res.data), statusCode: res.status }),
      });
      if (!isOk) totalErrors++;
      break;
    }

    case 'room.create': {
      const res = await apiCall('POST', '/api/rooms', actor.token, {
        name: `Sim Room ${Date.now()}`,
      });
      if (res.ok && res.data?.roomId) {
        roomIds.push(res.data.roomId);
      }
      logAction({
        timestamp: ts,
        actor: actor.displayName,
        action: 'room.create',
        resource: res.data?.roomId ? `room:${res.data.roomId}` : 'n/a',
        result: res.ok ? 'ok' : 'error',
        ...(res.ok ? {} : { error: JSON.stringify(res.data), statusCode: res.status }),
      });
      if (!res.ok) totalErrors++;
      break;
    }
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const { users: userCount, duration } = parseArgs(process.argv);
  const config = loadEnvReal(path.resolve(__dirname, '..'));

  const startTime = Date.now();

  // Phase 1: Provision users
  for (let i = 0; i < userCount; i++) {
    try {
      const user = await createSimUser(config, i);
      users.push(user);
      logAction({
        timestamp: new Date().toISOString(),
        actor: user.displayName,
        action: 'user.create',
        resource: user.email,
        result: 'ok',
      });
    } catch (err) {
      logAction({
        timestamp: new Date().toISOString(),
        actor: `Sim User ${i}`,
        action: 'user.create',
        resource: `user-${i}`,
        result: 'error',
        error: String(err),
      });
      totalErrors++;
      // Continue provisioning remaining users
      continue;
    }
  }

  if (users.length === 0) {
    logAction({
      timestamp: new Date().toISOString(),
      actor: 'simulator',
      action: 'abort',
      resource: 'n/a',
      result: 'error',
      error: 'No users could be provisioned',
    });
    process.exit(1);
  }

  // Phase 2: Create profiles
  for (const user of users) {
    try {
      const res = await apiCall('POST', '/api/profiles', user.token, {
        displayName: user.displayName,
        bio: 'Simulated user',
        avatarUrl: '',
      });
      logAction({
        timestamp: new Date().toISOString(),
        actor: user.displayName,
        action: 'profile.create',
        resource: user.userId,
        result: res.ok ? 'ok' : 'error',
        ...(res.ok ? {} : { error: JSON.stringify(res.data), statusCode: res.status }),
      });
      if (!res.ok) totalErrors++;
    } catch (err) {
      logAction({
        timestamp: new Date().toISOString(),
        actor: user.displayName,
        action: 'profile.create',
        resource: user.userId,
        result: 'error',
        error: String(err),
      });
      totalErrors++;
      continue;
    }
  }

  // Phase 3: Create shared infrastructure (rooms)
  const firstUser = users[0];

  for (let r = 1; r <= 2; r++) {
    try {
      const res = await apiCall('POST', '/api/rooms', firstUser.token, {
        name: `Sim Room ${r}`,
      });
      if (res.ok && res.data?.roomId) {
        roomIds.push(res.data.roomId);
        postIdsByRoom.set(res.data.roomId, []);
      }
      logAction({
        timestamp: new Date().toISOString(),
        actor: firstUser.displayName,
        action: 'room.create',
        resource: res.data?.roomId ? `room:${res.data.roomId}` : 'n/a',
        result: res.ok ? 'ok' : 'error',
        ...(res.ok ? {} : { error: JSON.stringify(res.data), statusCode: res.status }),
      });
      if (!res.ok) totalErrors++;
    } catch (err) {
      logAction({
        timestamp: new Date().toISOString(),
        actor: firstUser.displayName,
        action: 'room.create',
        resource: `room-${r}`,
        result: 'error',
        error: String(err),
      });
      totalErrors++;
      continue;
    }
  }

  // All other users join rooms
  for (const user of users.slice(1)) {
    for (const roomId of roomIds) {
      try {
        const res = await apiCall('POST', `/api/rooms/${roomId}/join`, user.token);
        logAction({
          timestamp: new Date().toISOString(),
          actor: user.displayName,
          action: 'room.join',
          resource: `room:${roomId}`,
          result: res.ok ? 'ok' : 'error',
          ...(res.ok ? {} : { error: JSON.stringify(res.data), statusCode: res.status }),
        });
        if (!res.ok) totalErrors++;
      } catch (err) {
        logAction({
          timestamp: new Date().toISOString(),
          actor: user.displayName,
          action: 'room.join',
          resource: `room:${roomId}`,
          result: 'error',
          error: String(err),
        });
        totalErrors++;
        continue;
      }
    }
  }

  // Phase 4: Activity loop
  while (Date.now() - startTime < duration * 1000) {
    const actor = pickRandom(users);
    const actionType = pickWeightedAction();

    try {
      await executeAction(actionType, actor);
    } catch (err) {
      logAction({
        timestamp: new Date().toISOString(),
        actor: actor.displayName,
        action: actionType,
        resource: 'n/a',
        result: 'error',
        error: String(err),
      });
      totalErrors++;
      // Continue on failure — do not abort
      continue;
    }

    await sleep(randomDelay());
  }

  // Teardown: Summary
  const durationSec = Math.round((Date.now() - startTime) / 1000);
  logAction({
    timestamp: new Date().toISOString(),
    actor: 'simulator',
    action: 'summary',
    resource: 'n/a',
    result: 'ok',
    stats: {
      users: users.length,
      rooms: roomIds.length,
      posts: Array.from(postIdsByRoom.values()).reduce((sum, p) => sum + p.length, 0),
      actions: totalActions,
      errors: totalErrors,
      durationSec,
    },
  });
}

main().catch((err) => {
  logAction({
    timestamp: new Date().toISOString(),
    actor: 'simulator',
    action: 'fatal',
    resource: 'n/a',
    result: 'error',
    error: String(err),
  });
  process.exit(1);
});
