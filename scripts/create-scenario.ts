#!/usr/bin/env npx tsx --tsconfig scripts/tsconfig.scripts.json
/**
 * Deterministic scenario seeder script.
 *
 * Provisions 3 named users (Alice, Bob, Charlie), makes them mutual friends,
 * creates 2 rooms (General Chat, Project Alpha), and seeds conversation content
 * with posts, comments, likes, and reactions through real API calls.
 *
 * Every action is logged as a JSON line to stdout in the same format as
 * simulate-activity.ts.
 *
 * Usage:
 *   npx tsx scripts/create-scenario.ts
 *   ./scripts/create-scenario.sh
 */

import path from 'path';
import {
  createSimUser,
  logAction,
  apiCall,
  loadEnvReal,
  sleep,
  SimUser,
  CognitoConfig,
} from './lib/sim-helpers';

// ── Scenario Step Interface ─────────────────────────────────────────────────

interface ScenarioStep {
  actor: number; // index into users array
  action: string;
  args: Record<string, any>;
}

// ── Counters ────────────────────────────────────────────────────────────────

const counters = {
  users: 0,
  rooms: 0,
  posts: 0,
  comments: 0,
  reactions: 0,
  likes: 0,
  follows: 0,
};

// ── Helpers ─────────────────────────────────────────────────────────────────

async function step(
  label: string,
  fn: () => Promise<void>,
): Promise<void> {
  try {
    await fn();
  } catch (err) {
    logAction({
      timestamp: new Date().toISOString(),
      actor: 'scenario',
      action: label,
      resource: 'n/a',
      result: 'error',
      error: String(err),
    });
  }
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const config = loadEnvReal(path.resolve(__dirname, '..'));

  // ── Phase A: Create 3 users ─────────────────────────────────────────────

  const userDefs = [
    { name: 'Alice Demo', bio: 'Alice Demo - demo account' },
    { name: 'Bob Demo', bio: 'Bob Demo - demo account' },
    { name: 'Charlie Demo', bio: 'Charlie Demo - demo account' },
  ];

  const users: SimUser[] = [];

  for (let i = 0; i < userDefs.length; i++) {
    await step(`user.create[${i}]`, async () => {
      const user = await createSimUser(config, i);
      // Override displayName with scenario name
      user.displayName = userDefs[i].name;
      users.push(user);
      counters.users++;

      logAction({
        timestamp: new Date().toISOString(),
        actor: user.displayName,
        action: 'user.create',
        resource: user.email,
        result: 'ok',
      });

      // Create profile
      const res = await apiCall('POST', '/api/profiles', user.token, {
        displayName: userDefs[i].name,
        bio: userDefs[i].bio,
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
    });
  }

  if (users.length < 3) {
    logAction({
      timestamp: new Date().toISOString(),
      actor: 'scenario',
      action: 'abort',
      resource: 'n/a',
      result: 'error',
      error: `Only ${users.length}/3 users provisioned — cannot run scenario`,
    });
    process.exit(1);
  }

  const [alice, bob, charlie] = users;

  // ── Phase B: Build social graph (mutual follows = friends) ──────────────

  const followPairs: Array<{ follower: SimUser; followee: SimUser }> = [
    { follower: alice, followee: bob },
    { follower: bob, followee: alice },
    { follower: alice, followee: charlie },
    { follower: charlie, followee: alice },
    { follower: bob, followee: charlie },
    { follower: charlie, followee: bob },
  ];

  for (const { follower, followee } of followPairs) {
    await step(`follow`, async () => {
      const res = await apiCall(
        'POST',
        `/api/social/follow/${followee.userId}`,
        follower.token,
      );
      const isOk = res.ok || res.status === 409;
      counters.follows++;

      logAction({
        timestamp: new Date().toISOString(),
        actor: follower.displayName,
        action: 'follow',
        resource: `user:${followee.userId}`,
        result: isOk ? 'ok' : 'error',
        ...(isOk ? {} : { error: JSON.stringify(res.data), statusCode: res.status }),
      });
    });
  }

  // ── Phase C: Create 2 rooms and join members ───────────────────────────

  let generalRoomId = '';
  let projectRoomId = '';

  await step('room.create[General Chat]', async () => {
    const res = await apiCall('POST', '/api/rooms', alice.token, { name: 'General Chat' });
    if (res.ok && res.data?.roomId) {
      generalRoomId = res.data.roomId;
      counters.rooms++;
    }
    logAction({
      timestamp: new Date().toISOString(),
      actor: alice.displayName,
      action: 'room.create',
      resource: generalRoomId ? `room:${generalRoomId}` : 'n/a',
      result: res.ok ? 'ok' : 'error',
      ...(res.ok ? {} : { error: JSON.stringify(res.data), statusCode: res.status }),
    });
  });

  await step('room.create[Project Alpha]', async () => {
    const res = await apiCall('POST', '/api/rooms', alice.token, { name: 'Project Alpha' });
    if (res.ok && res.data?.roomId) {
      projectRoomId = res.data.roomId;
      counters.rooms++;
    }
    logAction({
      timestamp: new Date().toISOString(),
      actor: alice.displayName,
      action: 'room.create',
      resource: projectRoomId ? `room:${projectRoomId}` : 'n/a',
      result: res.ok ? 'ok' : 'error',
      ...(res.ok ? {} : { error: JSON.stringify(res.data), statusCode: res.status }),
    });
  });

  // Bob and Charlie join both rooms
  for (const user of [bob, charlie]) {
    for (const [roomId, roomName] of [[generalRoomId, 'General Chat'], [projectRoomId, 'Project Alpha']] as const) {
      if (!roomId) continue;
      await step(`room.join[${roomName}]`, async () => {
        const res = await apiCall('POST', `/api/rooms/${roomId}/join`, user.token);
        logAction({
          timestamp: new Date().toISOString(),
          actor: user.displayName,
          action: 'room.join',
          resource: `room:${roomId}`,
          result: res.ok ? 'ok' : 'error',
          ...(res.ok ? {} : { error: JSON.stringify(res.data), statusCode: res.status }),
        });
      });
    }
  }

  // ── Phase D: Seed conversation in General Chat ─────────────────────────

  let post1Id = '';
  let post2Id = '';
  let post3Id = ''; // Bob's latest post

  // D1: Alice posts
  await step('post.create[D1]', async () => {
    const res = await apiCall('POST', `/api/rooms/${generalRoomId}/posts`, alice.token, {
      content: 'Hey everyone! Welcome to the demo.',
    });
    if (res.ok && res.data?.postId) {
      post1Id = res.data.postId;
      counters.posts++;
    }
    logAction({
      timestamp: new Date().toISOString(),
      actor: alice.displayName,
      action: 'post.create',
      resource: `room:${generalRoomId}`,
      result: res.ok ? 'ok' : 'error',
      ...(res.ok ? {} : { error: JSON.stringify(res.data), statusCode: res.status }),
    });
  });
  await sleep(300);

  // D2: Bob posts
  await step('post.create[D2]', async () => {
    const res = await apiCall('POST', `/api/rooms/${generalRoomId}/posts`, bob.token, {
      content: 'Thanks Alice! Excited to try this out.',
    });
    if (res.ok && res.data?.postId) {
      post2Id = res.data.postId;
      counters.posts++;
    }
    logAction({
      timestamp: new Date().toISOString(),
      actor: bob.displayName,
      action: 'post.create',
      resource: `room:${generalRoomId}`,
      result: res.ok ? 'ok' : 'error',
      ...(res.ok ? {} : { error: JSON.stringify(res.data), statusCode: res.status }),
    });
  });
  await sleep(300);

  // D3: Charlie comments on post1
  await step('comment.create[D3]', async () => {
    const res = await apiCall(
      'POST',
      `/api/rooms/${generalRoomId}/posts/${post1Id}/comments`,
      charlie.token,
      { content: 'Looks great!' },
    );
    if (res.ok) counters.comments++;
    logAction({
      timestamp: new Date().toISOString(),
      actor: charlie.displayName,
      action: 'comment.create',
      resource: `post:${post1Id}`,
      result: res.ok ? 'ok' : 'error',
      ...(res.ok ? {} : { error: JSON.stringify(res.data), statusCode: res.status }),
    });
  });
  await sleep(300);

  // D4: Alice likes post2
  await step('like.add[D4]', async () => {
    const res = await apiCall(
      'POST',
      `/api/rooms/${generalRoomId}/posts/${post2Id}/likes`,
      alice.token,
    );
    if (res.ok) counters.likes++;
    logAction({
      timestamp: new Date().toISOString(),
      actor: alice.displayName,
      action: 'like.add',
      resource: `post:${post2Id}`,
      result: res.ok ? 'ok' : 'error',
      ...(res.ok ? {} : { error: JSON.stringify(res.data), statusCode: res.status }),
    });
  });
  await sleep(300);

  // D5: Bob reacts to post1 with fire
  await step('reaction.add[D5]', async () => {
    const res = await apiCall(
      'POST',
      `/api/rooms/${generalRoomId}/posts/${post1Id}/reactions`,
      bob.token,
      { emoji: '\uD83D\uDD25' }, // fire emoji
    );
    if (res.ok) counters.reactions++;
    logAction({
      timestamp: new Date().toISOString(),
      actor: bob.displayName,
      action: 'reaction.add',
      resource: `post:${post1Id}`,
      result: res.ok ? 'ok' : 'error',
      ...(res.ok ? {} : { error: JSON.stringify(res.data), statusCode: res.status }),
    });
  });
  await sleep(300);

  // D6: Charlie reacts to post1 with heart
  await step('reaction.add[D6]', async () => {
    const res = await apiCall(
      'POST',
      `/api/rooms/${generalRoomId}/posts/${post1Id}/reactions`,
      charlie.token,
      { emoji: '\u2764\uFE0F' }, // heart emoji
    );
    if (res.ok) counters.reactions++;
    logAction({
      timestamp: new Date().toISOString(),
      actor: charlie.displayName,
      action: 'reaction.add',
      resource: `post:${post1Id}`,
      result: res.ok ? 'ok' : 'error',
      ...(res.ok ? {} : { error: JSON.stringify(res.data), statusCode: res.status }),
    });
  });
  await sleep(300);

  // D7: Alice comments on post1 replying
  await step('comment.create[D7]', async () => {
    const res = await apiCall(
      'POST',
      `/api/rooms/${generalRoomId}/posts/${post1Id}/comments`,
      alice.token,
      { content: 'Thanks Charlie!' },
    );
    if (res.ok) counters.comments++;
    logAction({
      timestamp: new Date().toISOString(),
      actor: alice.displayName,
      action: 'comment.create',
      resource: `post:${post1Id}`,
      result: res.ok ? 'ok' : 'error',
      ...(res.ok ? {} : { error: JSON.stringify(res.data), statusCode: res.status }),
    });
  });
  await sleep(300);

  // D8: Bob posts latest
  await step('post.create[D8]', async () => {
    const res = await apiCall('POST', `/api/rooms/${generalRoomId}/posts`, bob.token, {
      content: 'Just pushed the latest changes to the repo.',
    });
    if (res.ok && res.data?.postId) {
      post3Id = res.data.postId;
      counters.posts++;
    }
    logAction({
      timestamp: new Date().toISOString(),
      actor: bob.displayName,
      action: 'post.create',
      resource: `room:${generalRoomId}`,
      result: res.ok ? 'ok' : 'error',
      ...(res.ok ? {} : { error: JSON.stringify(res.data), statusCode: res.status }),
    });
  });
  await sleep(300);

  // D9: Charlie likes Bob's latest post
  await step('like.add[D9]', async () => {
    const res = await apiCall(
      'POST',
      `/api/rooms/${generalRoomId}/posts/${post3Id}/likes`,
      charlie.token,
    );
    if (res.ok) counters.likes++;
    logAction({
      timestamp: new Date().toISOString(),
      actor: charlie.displayName,
      action: 'like.add',
      resource: `post:${post3Id}`,
      result: res.ok ? 'ok' : 'error',
      ...(res.ok ? {} : { error: JSON.stringify(res.data), statusCode: res.status }),
    });
  });
  await sleep(300);

  // D10: Alice reacts to Bob's latest post with thumbsup
  await step('reaction.add[D10]', async () => {
    const res = await apiCall(
      'POST',
      `/api/rooms/${generalRoomId}/posts/${post3Id}/reactions`,
      alice.token,
      { emoji: '\uD83D\uDC4D' }, // thumbsup emoji
    );
    if (res.ok) counters.reactions++;
    logAction({
      timestamp: new Date().toISOString(),
      actor: alice.displayName,
      action: 'reaction.add',
      resource: `post:${post3Id}`,
      result: res.ok ? 'ok' : 'error',
      ...(res.ok ? {} : { error: JSON.stringify(res.data), statusCode: res.status }),
    });
  });
  await sleep(300);

  // ── Phase E: Seed content in Project Alpha ─────────────────────────────

  let projectPost1Id = '';

  // E1: Alice posts sprint planning
  await step('post.create[E1]', async () => {
    const res = await apiCall('POST', `/api/rooms/${projectRoomId}/posts`, alice.token, {
      content: 'Sprint planning for next week - let\'s discuss priorities',
    });
    if (res.ok && res.data?.postId) {
      projectPost1Id = res.data.postId;
      counters.posts++;
    }
    logAction({
      timestamp: new Date().toISOString(),
      actor: alice.displayName,
      action: 'post.create',
      resource: `room:${projectRoomId}`,
      result: res.ok ? 'ok' : 'error',
      ...(res.ok ? {} : { error: JSON.stringify(res.data), statusCode: res.status }),
    });
  });
  await sleep(300);

  // E2: Bob comments on sprint post
  await step('comment.create[E2]', async () => {
    const res = await apiCall(
      'POST',
      `/api/rooms/${projectRoomId}/posts/${projectPost1Id}/comments`,
      bob.token,
      { content: 'I think we should focus on the API integration' },
    );
    if (res.ok) counters.comments++;
    logAction({
      timestamp: new Date().toISOString(),
      actor: bob.displayName,
      action: 'comment.create',
      resource: `post:${projectPost1Id}`,
      result: res.ok ? 'ok' : 'error',
      ...(res.ok ? {} : { error: JSON.stringify(res.data), statusCode: res.status }),
    });
  });
  await sleep(300);

  // E3: Charlie comments
  await step('comment.create[E3]', async () => {
    const res = await apiCall(
      'POST',
      `/api/rooms/${projectRoomId}/posts/${projectPost1Id}/comments`,
      charlie.token,
      { content: 'Agree with Bob, plus we need to update the docs' },
    );
    if (res.ok) counters.comments++;
    logAction({
      timestamp: new Date().toISOString(),
      actor: charlie.displayName,
      action: 'comment.create',
      resource: `post:${projectPost1Id}`,
      result: res.ok ? 'ok' : 'error',
      ...(res.ok ? {} : { error: JSON.stringify(res.data), statusCode: res.status }),
    });
  });
  await sleep(300);

  // E4: Alice likes the sprint post (liking the post itself)
  await step('like.add[E4]', async () => {
    const res = await apiCall(
      'POST',
      `/api/rooms/${projectRoomId}/posts/${projectPost1Id}/likes`,
      alice.token,
    );
    if (res.ok) counters.likes++;
    logAction({
      timestamp: new Date().toISOString(),
      actor: alice.displayName,
      action: 'like.add',
      resource: `post:${projectPost1Id}`,
      result: res.ok ? 'ok' : 'error',
      ...(res.ok ? {} : { error: JSON.stringify(res.data), statusCode: res.status }),
    });
  });
  await sleep(300);

  // E5: Bob reacts with thumbsup to Alice's post
  await step('reaction.add[E5]', async () => {
    const res = await apiCall(
      'POST',
      `/api/rooms/${projectRoomId}/posts/${projectPost1Id}/reactions`,
      bob.token,
      { emoji: '\uD83D\uDC4D' }, // thumbsup emoji
    );
    if (res.ok) counters.reactions++;
    logAction({
      timestamp: new Date().toISOString(),
      actor: bob.displayName,
      action: 'reaction.add',
      resource: `post:${projectPost1Id}`,
      result: res.ok ? 'ok' : 'error',
      ...(res.ok ? {} : { error: JSON.stringify(res.data), statusCode: res.status }),
    });
  });

  // ── Final Summary ──────────────────────────────────────────────────────

  logAction({
    timestamp: new Date().toISOString(),
    actor: 'scenario',
    action: 'summary',
    resource: 'n/a',
    result: 'ok',
    stats: {
      users: counters.users,
      rooms: counters.rooms,
      posts: counters.posts,
      comments: counters.comments,
      reactions: counters.reactions,
      likes: counters.likes,
      follows: counters.follows,
    },
  });
}

main().catch((err) => {
  logAction({
    timestamp: new Date().toISOString(),
    actor: 'scenario',
    action: 'fatal',
    resource: 'n/a',
    result: 'error',
    error: String(err),
  });
  process.exit(1);
});
