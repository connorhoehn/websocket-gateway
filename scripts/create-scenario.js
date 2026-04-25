#!/usr/bin/env npx tsx --tsconfig scripts/tsconfig.scripts.json
"use strict";
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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const path_1 = __importDefault(require("path"));
const sim_helpers_1 = require("./lib/sim-helpers");
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
async function step(label, fn) {
    try {
        await fn();
    }
    catch (err) {
        (0, sim_helpers_1.logAction)({
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
async function main() {
    const config = (0, sim_helpers_1.loadEnvReal)(path_1.default.resolve(__dirname, '..'));
    // ── Phase A: Create 3 users ─────────────────────────────────────────────
    const userDefs = [
        { name: 'Alice Demo', bio: 'Alice Demo - demo account' },
        { name: 'Bob Demo', bio: 'Bob Demo - demo account' },
        { name: 'Charlie Demo', bio: 'Charlie Demo - demo account' },
    ];
    const users = [];
    for (let i = 0; i < userDefs.length; i++) {
        await step(`user.create[${i}]`, async () => {
            const user = await (0, sim_helpers_1.createSimUser)(config, i);
            // Override displayName with scenario name
            user.displayName = userDefs[i].name;
            users.push(user);
            counters.users++;
            (0, sim_helpers_1.logAction)({
                timestamp: new Date().toISOString(),
                actor: user.displayName,
                action: 'user.create',
                resource: user.email,
                result: 'ok',
            });
            // Create profile
            const res = await (0, sim_helpers_1.apiCall)('POST', '/api/profiles', user.token, {
                displayName: userDefs[i].name,
                bio: userDefs[i].bio,
                avatarUrl: '',
            });
            (0, sim_helpers_1.logAction)({
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
        (0, sim_helpers_1.logAction)({
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
    const followPairs = [
        { follower: alice, followee: bob },
        { follower: bob, followee: alice },
        { follower: alice, followee: charlie },
        { follower: charlie, followee: alice },
        { follower: bob, followee: charlie },
        { follower: charlie, followee: bob },
    ];
    for (const { follower, followee } of followPairs) {
        await step(`follow`, async () => {
            const res = await (0, sim_helpers_1.apiCall)('POST', `/api/social/follow/${followee.userId}`, follower.token);
            const isOk = res.ok || res.status === 409;
            counters.follows++;
            (0, sim_helpers_1.logAction)({
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
        const res = await (0, sim_helpers_1.apiCall)('POST', '/api/rooms', alice.token, { name: 'General Chat' });
        if (res.ok && res.data?.roomId) {
            generalRoomId = res.data.roomId;
            counters.rooms++;
        }
        (0, sim_helpers_1.logAction)({
            timestamp: new Date().toISOString(),
            actor: alice.displayName,
            action: 'room.create',
            resource: generalRoomId ? `room:${generalRoomId}` : 'n/a',
            result: res.ok ? 'ok' : 'error',
            ...(res.ok ? {} : { error: JSON.stringify(res.data), statusCode: res.status }),
        });
    });
    await step('room.create[Project Alpha]', async () => {
        const res = await (0, sim_helpers_1.apiCall)('POST', '/api/rooms', alice.token, { name: 'Project Alpha' });
        if (res.ok && res.data?.roomId) {
            projectRoomId = res.data.roomId;
            counters.rooms++;
        }
        (0, sim_helpers_1.logAction)({
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
        for (const [roomId, roomName] of [[generalRoomId, 'General Chat'], [projectRoomId, 'Project Alpha']]) {
            if (!roomId)
                continue;
            await step(`room.join[${roomName}]`, async () => {
                const res = await (0, sim_helpers_1.apiCall)('POST', `/api/rooms/${roomId}/join`, user.token);
                (0, sim_helpers_1.logAction)({
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
        const res = await (0, sim_helpers_1.apiCall)('POST', `/api/rooms/${generalRoomId}/posts`, alice.token, {
            content: 'Hey everyone! Welcome to the demo.',
        });
        if (res.ok && res.data?.postId) {
            post1Id = res.data.postId;
            counters.posts++;
        }
        (0, sim_helpers_1.logAction)({
            timestamp: new Date().toISOString(),
            actor: alice.displayName,
            action: 'post.create',
            resource: `room:${generalRoomId}`,
            result: res.ok ? 'ok' : 'error',
            ...(res.ok ? {} : { error: JSON.stringify(res.data), statusCode: res.status }),
        });
    });
    await (0, sim_helpers_1.sleep)(300);
    // D2: Bob posts
    await step('post.create[D2]', async () => {
        const res = await (0, sim_helpers_1.apiCall)('POST', `/api/rooms/${generalRoomId}/posts`, bob.token, {
            content: 'Thanks Alice! Excited to try this out.',
        });
        if (res.ok && res.data?.postId) {
            post2Id = res.data.postId;
            counters.posts++;
        }
        (0, sim_helpers_1.logAction)({
            timestamp: new Date().toISOString(),
            actor: bob.displayName,
            action: 'post.create',
            resource: `room:${generalRoomId}`,
            result: res.ok ? 'ok' : 'error',
            ...(res.ok ? {} : { error: JSON.stringify(res.data), statusCode: res.status }),
        });
    });
    await (0, sim_helpers_1.sleep)(300);
    // D3: Charlie comments on post1
    await step('comment.create[D3]', async () => {
        const res = await (0, sim_helpers_1.apiCall)('POST', `/api/rooms/${generalRoomId}/posts/${post1Id}/comments`, charlie.token, { content: 'Looks great!' });
        if (res.ok)
            counters.comments++;
        (0, sim_helpers_1.logAction)({
            timestamp: new Date().toISOString(),
            actor: charlie.displayName,
            action: 'comment.create',
            resource: `post:${post1Id}`,
            result: res.ok ? 'ok' : 'error',
            ...(res.ok ? {} : { error: JSON.stringify(res.data), statusCode: res.status }),
        });
    });
    await (0, sim_helpers_1.sleep)(300);
    // D4: Alice likes post2
    await step('like.add[D4]', async () => {
        const res = await (0, sim_helpers_1.apiCall)('POST', `/api/rooms/${generalRoomId}/posts/${post2Id}/likes`, alice.token);
        if (res.ok)
            counters.likes++;
        (0, sim_helpers_1.logAction)({
            timestamp: new Date().toISOString(),
            actor: alice.displayName,
            action: 'like.add',
            resource: `post:${post2Id}`,
            result: res.ok ? 'ok' : 'error',
            ...(res.ok ? {} : { error: JSON.stringify(res.data), statusCode: res.status }),
        });
    });
    await (0, sim_helpers_1.sleep)(300);
    // D5: Bob reacts to post1 with fire
    await step('reaction.add[D5]', async () => {
        const res = await (0, sim_helpers_1.apiCall)('POST', `/api/rooms/${generalRoomId}/posts/${post1Id}/reactions`, bob.token, { emoji: '\uD83D\uDD25' });
        if (res.ok)
            counters.reactions++;
        (0, sim_helpers_1.logAction)({
            timestamp: new Date().toISOString(),
            actor: bob.displayName,
            action: 'reaction.add',
            resource: `post:${post1Id}`,
            result: res.ok ? 'ok' : 'error',
            ...(res.ok ? {} : { error: JSON.stringify(res.data), statusCode: res.status }),
        });
    });
    await (0, sim_helpers_1.sleep)(300);
    // D6: Charlie reacts to post1 with heart
    await step('reaction.add[D6]', async () => {
        const res = await (0, sim_helpers_1.apiCall)('POST', `/api/rooms/${generalRoomId}/posts/${post1Id}/reactions`, charlie.token, { emoji: '\u2764\uFE0F' });
        if (res.ok)
            counters.reactions++;
        (0, sim_helpers_1.logAction)({
            timestamp: new Date().toISOString(),
            actor: charlie.displayName,
            action: 'reaction.add',
            resource: `post:${post1Id}`,
            result: res.ok ? 'ok' : 'error',
            ...(res.ok ? {} : { error: JSON.stringify(res.data), statusCode: res.status }),
        });
    });
    await (0, sim_helpers_1.sleep)(300);
    // D7: Alice comments on post1 replying
    await step('comment.create[D7]', async () => {
        const res = await (0, sim_helpers_1.apiCall)('POST', `/api/rooms/${generalRoomId}/posts/${post1Id}/comments`, alice.token, { content: 'Thanks Charlie!' });
        if (res.ok)
            counters.comments++;
        (0, sim_helpers_1.logAction)({
            timestamp: new Date().toISOString(),
            actor: alice.displayName,
            action: 'comment.create',
            resource: `post:${post1Id}`,
            result: res.ok ? 'ok' : 'error',
            ...(res.ok ? {} : { error: JSON.stringify(res.data), statusCode: res.status }),
        });
    });
    await (0, sim_helpers_1.sleep)(300);
    // D8: Bob posts latest
    await step('post.create[D8]', async () => {
        const res = await (0, sim_helpers_1.apiCall)('POST', `/api/rooms/${generalRoomId}/posts`, bob.token, {
            content: 'Just pushed the latest changes to the repo.',
        });
        if (res.ok && res.data?.postId) {
            post3Id = res.data.postId;
            counters.posts++;
        }
        (0, sim_helpers_1.logAction)({
            timestamp: new Date().toISOString(),
            actor: bob.displayName,
            action: 'post.create',
            resource: `room:${generalRoomId}`,
            result: res.ok ? 'ok' : 'error',
            ...(res.ok ? {} : { error: JSON.stringify(res.data), statusCode: res.status }),
        });
    });
    await (0, sim_helpers_1.sleep)(300);
    // D9: Charlie likes Bob's latest post
    await step('like.add[D9]', async () => {
        const res = await (0, sim_helpers_1.apiCall)('POST', `/api/rooms/${generalRoomId}/posts/${post3Id}/likes`, charlie.token);
        if (res.ok)
            counters.likes++;
        (0, sim_helpers_1.logAction)({
            timestamp: new Date().toISOString(),
            actor: charlie.displayName,
            action: 'like.add',
            resource: `post:${post3Id}`,
            result: res.ok ? 'ok' : 'error',
            ...(res.ok ? {} : { error: JSON.stringify(res.data), statusCode: res.status }),
        });
    });
    await (0, sim_helpers_1.sleep)(300);
    // D10: Alice reacts to Bob's latest post with thumbsup
    await step('reaction.add[D10]', async () => {
        const res = await (0, sim_helpers_1.apiCall)('POST', `/api/rooms/${generalRoomId}/posts/${post3Id}/reactions`, alice.token, { emoji: '\uD83D\uDC4D' });
        if (res.ok)
            counters.reactions++;
        (0, sim_helpers_1.logAction)({
            timestamp: new Date().toISOString(),
            actor: alice.displayName,
            action: 'reaction.add',
            resource: `post:${post3Id}`,
            result: res.ok ? 'ok' : 'error',
            ...(res.ok ? {} : { error: JSON.stringify(res.data), statusCode: res.status }),
        });
    });
    await (0, sim_helpers_1.sleep)(300);
    // ── Phase E: Seed content in Project Alpha ─────────────────────────────
    let projectPost1Id = '';
    // E1: Alice posts sprint planning
    await step('post.create[E1]', async () => {
        const res = await (0, sim_helpers_1.apiCall)('POST', `/api/rooms/${projectRoomId}/posts`, alice.token, {
            content: 'Sprint planning for next week - let\'s discuss priorities',
        });
        if (res.ok && res.data?.postId) {
            projectPost1Id = res.data.postId;
            counters.posts++;
        }
        (0, sim_helpers_1.logAction)({
            timestamp: new Date().toISOString(),
            actor: alice.displayName,
            action: 'post.create',
            resource: `room:${projectRoomId}`,
            result: res.ok ? 'ok' : 'error',
            ...(res.ok ? {} : { error: JSON.stringify(res.data), statusCode: res.status }),
        });
    });
    await (0, sim_helpers_1.sleep)(300);
    // E2: Bob comments on sprint post
    await step('comment.create[E2]', async () => {
        const res = await (0, sim_helpers_1.apiCall)('POST', `/api/rooms/${projectRoomId}/posts/${projectPost1Id}/comments`, bob.token, { content: 'I think we should focus on the API integration' });
        if (res.ok)
            counters.comments++;
        (0, sim_helpers_1.logAction)({
            timestamp: new Date().toISOString(),
            actor: bob.displayName,
            action: 'comment.create',
            resource: `post:${projectPost1Id}`,
            result: res.ok ? 'ok' : 'error',
            ...(res.ok ? {} : { error: JSON.stringify(res.data), statusCode: res.status }),
        });
    });
    await (0, sim_helpers_1.sleep)(300);
    // E3: Charlie comments
    await step('comment.create[E3]', async () => {
        const res = await (0, sim_helpers_1.apiCall)('POST', `/api/rooms/${projectRoomId}/posts/${projectPost1Id}/comments`, charlie.token, { content: 'Agree with Bob, plus we need to update the docs' });
        if (res.ok)
            counters.comments++;
        (0, sim_helpers_1.logAction)({
            timestamp: new Date().toISOString(),
            actor: charlie.displayName,
            action: 'comment.create',
            resource: `post:${projectPost1Id}`,
            result: res.ok ? 'ok' : 'error',
            ...(res.ok ? {} : { error: JSON.stringify(res.data), statusCode: res.status }),
        });
    });
    await (0, sim_helpers_1.sleep)(300);
    // E4: Alice likes the sprint post (liking the post itself)
    await step('like.add[E4]', async () => {
        const res = await (0, sim_helpers_1.apiCall)('POST', `/api/rooms/${projectRoomId}/posts/${projectPost1Id}/likes`, alice.token);
        if (res.ok)
            counters.likes++;
        (0, sim_helpers_1.logAction)({
            timestamp: new Date().toISOString(),
            actor: alice.displayName,
            action: 'like.add',
            resource: `post:${projectPost1Id}`,
            result: res.ok ? 'ok' : 'error',
            ...(res.ok ? {} : { error: JSON.stringify(res.data), statusCode: res.status }),
        });
    });
    await (0, sim_helpers_1.sleep)(300);
    // E5: Bob reacts with thumbsup to Alice's post
    await step('reaction.add[E5]', async () => {
        const res = await (0, sim_helpers_1.apiCall)('POST', `/api/rooms/${projectRoomId}/posts/${projectPost1Id}/reactions`, bob.token, { emoji: '\uD83D\uDC4D' });
        if (res.ok)
            counters.reactions++;
        (0, sim_helpers_1.logAction)({
            timestamp: new Date().toISOString(),
            actor: bob.displayName,
            action: 'reaction.add',
            resource: `post:${projectPost1Id}`,
            result: res.ok ? 'ok' : 'error',
            ...(res.ok ? {} : { error: JSON.stringify(res.data), statusCode: res.status }),
        });
    });
    // ── Final Summary ──────────────────────────────────────────────────────
    (0, sim_helpers_1.logAction)({
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
    (0, sim_helpers_1.logAction)({
        timestamp: new Date().toISOString(),
        actor: 'scenario',
        action: 'fatal',
        resource: 'n/a',
        result: 'error',
        error: String(err),
    });
    process.exit(1);
});
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY3JlYXRlLXNjZW5hcmlvLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiY3JlYXRlLXNjZW5hcmlvLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7O0FBQ0E7Ozs7Ozs7Ozs7Ozs7R0FhRzs7Ozs7QUFFSCxnREFBd0I7QUFDeEIsbURBUTJCO0FBVTNCLCtFQUErRTtBQUUvRSxNQUFNLFFBQVEsR0FBRztJQUNmLEtBQUssRUFBRSxDQUFDO0lBQ1IsS0FBSyxFQUFFLENBQUM7SUFDUixLQUFLLEVBQUUsQ0FBQztJQUNSLFFBQVEsRUFBRSxDQUFDO0lBQ1gsU0FBUyxFQUFFLENBQUM7SUFDWixLQUFLLEVBQUUsQ0FBQztJQUNSLE9BQU8sRUFBRSxDQUFDO0NBQ1gsQ0FBQztBQUVGLCtFQUErRTtBQUUvRSxLQUFLLFVBQVUsSUFBSSxDQUNqQixLQUFhLEVBQ2IsRUFBdUI7SUFFdkIsSUFBSSxDQUFDO1FBQ0gsTUFBTSxFQUFFLEVBQUUsQ0FBQztJQUNiLENBQUM7SUFBQyxPQUFPLEdBQUcsRUFBRSxDQUFDO1FBQ2IsSUFBQSx1QkFBUyxFQUFDO1lBQ1IsU0FBUyxFQUFFLElBQUksSUFBSSxFQUFFLENBQUMsV0FBVyxFQUFFO1lBQ25DLEtBQUssRUFBRSxVQUFVO1lBQ2pCLE1BQU0sRUFBRSxLQUFLO1lBQ2IsUUFBUSxFQUFFLEtBQUs7WUFDZixNQUFNLEVBQUUsT0FBTztZQUNmLEtBQUssRUFBRSxNQUFNLENBQUMsR0FBRyxDQUFDO1NBQ25CLENBQUMsQ0FBQztJQUNMLENBQUM7QUFDSCxDQUFDO0FBRUQsK0VBQStFO0FBRS9FLEtBQUssVUFBVSxJQUFJO0lBQ2pCLE1BQU0sTUFBTSxHQUFHLElBQUEseUJBQVcsRUFBQyxjQUFJLENBQUMsT0FBTyxDQUFDLFNBQVMsRUFBRSxJQUFJLENBQUMsQ0FBQyxDQUFDO0lBRTFELDJFQUEyRTtJQUUzRSxNQUFNLFFBQVEsR0FBRztRQUNmLEVBQUUsSUFBSSxFQUFFLFlBQVksRUFBRSxHQUFHLEVBQUUsMkJBQTJC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QUFDLENBQUMsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbIiMhL3Vzci9iaW4vZW52IG5weCB0c3ggLS10c2NvbmZpZyBzY3JpcHRzL3RzY29uZmlnLnNjcmlwdHMuanNvblxuLyoqXG4gKiBEZXRlcm1pbmlzdGljIHNjZW5hcmlvIHNlZWRlciBzY3JpcHQuXG4gKlxuICogUHJvdmlzaW9ucyAzIG5hbWVkIHVzZXJzIChBbGljZSwgQm9iLCBDaGFybGllKSwgbWFrZXMgdGhlbSBtdXR1YWwgZnJpZW5kcyxcbiAqIGNyZWF0ZXMgMiByb29tcyAoR2VuZXJhbCBDaGF0LCBQcm9qZWN0IEFscGhhKSwgYW5kIHNlZWRzIGNvbnZlcnNhdGlvbiBjb250ZW50XG4gKiB3aXRoIHBvc3RzLCBjb21tZW50cywgbGlrZXMsIGFuZCByZWFjdGlvbnMgdGhyb3VnaCByZWFsIEFQSSBjYWxscy5cbiAqXG4gKiBFdmVyeSBhY3Rpb24gaXMgbG9nZ2VkIGFzIGEgSlNPTiBsaW5lIHRvIHN0ZG91dCBpbiB0aGUgc2FtZSBmb3JtYXQgYXNcbiAqIHNpbXVsYXRlLWFjdGl2aXR5LnRzLlxuICpcbiAqIFVzYWdlOlxuICogICBucHggdHN4IHNjcmlwdHMvY3JlYXRlLXNjZW5hcmlvLnRzXG4gKiAgIC4vc2NyaXB0cy9jcmVhdGUtc2NlbmFyaW8uc2hcbiAqL1xuXG5pbXBvcnQgcGF0aCBmcm9tICdwYXRoJztcbmltcG9ydCB7XG4gIGNyZWF0ZVNpbVVzZXIsXG4gIGxvZ0FjdGlvbixcbiAgYXBpQ2FsbCxcbiAgbG9hZEVudlJlYWwsXG4gIHNsZWVwLFxuICBTaW1Vc2VyLFxuICBDb2duaXRvQ29uZmlnLFxufSBmcm9tICcuL2xpYi9zaW0taGVscGVycyc7XG5cbi8vIOKUgOKUgCBTY2VuYXJpbyBTdGVwIEludGVyZmFjZSDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIBcblxuaW50ZXJmYWNlIFNjZW5hcmlvU3RlcCB7XG4gIGFjdG9yOiBudW1iZXI7IC8vIGluZGV4IGludG8gdXNlcnMgYXJyYXlcbiAgYWN0aW9uOiBzdHJpbmc7XG4gIGFyZ3M6IFJlY29yZDxzdHJpbmcsIGFueT47XG59XG5cbi8vIOKUgOKUgCBDb3VudGVycyDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIBcblxuY29uc3QgY291bnRlcnMgPSB7XG4gIHVzZXJzOiAwLFxuICByb29tczogMCxcbiAgcG9zdHM6IDAsXG4gIGNvbW1lbnRzOiAwLFxuICByZWFjdGlvbnM6IDAsXG4gIGxpa2VzOiAwLFxuICBmb2xsb3dzOiAwLFxufTtcblxuLy8g4pSA4pSAIEhlbHBlcnMg4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSAXG5cbmFzeW5jIGZ1bmN0aW9uIHN0ZXAoXG4gIGxhYmVsOiBzdHJpbmcsXG4gIGZuOiAoKSA9PiBQcm9taXNlPHZvaWQ+LFxuKTogUHJvbWlzZTx2b2lkPiB7XG4gIHRyeSB7XG4gICAgYXdhaXQgZm4oKTtcbiAgfSBjYXRjaCAoZXJyKSB7XG4gICAgbG9nQWN0aW9uKHtcbiAgICAgIHRpbWVzdGFtcDogbmV3IERhdGUoKS50b0lTT1N0cmluZygpLFxuICAgICAgYWN0b3I6ICdzY2VuYXJpbycsXG4gICAgICBhY3Rpb246IGxhYmVsLFxuICAgICAgcmVzb3VyY2U6ICduL2EnLFxuICAgICAgcmVzdWx0OiAnZXJyb3InLFxuICAgICAgZXJyb3I6IFN0cmluZyhlcnIpLFxuICAgIH0pO1xuICB9XG59XG5cbi8vIOKUgOKUgCBNYWluIOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgFxuXG5hc3luYyBmdW5jdGlvbiBtYWluKCk6IFByb21pc2U8dm9pZD4ge1xuICBjb25zdCBjb25maWcgPSBsb2FkRW52UmVhbChwYXRoLnJlc29sdmUoX19kaXJuYW1lLCAnLi4nKSk7XG5cbiAgLy8g4pSA4pSAIFBoYXNlIEE6IENyZWF0ZSAzIHVzZXJzIOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgFxuXG4gIGNvbnN0IHVzZXJEZWZzID0gW1xuICAgIHsgbmFtZTogJ0FsaWNlIERlbW8nLCBiaW86ICdBbGljZSBEZW1vIC0gZGVtbyBhY2NvdW50JyB9LFxuICAgIHsgbmFtZTogJ0JvYiBEZW1vJywgYmlvOiAnQm9iIERlbW8gLSBkZW1vIGFjY291bnQnIH0sXG4gICAgeyBuYW1lOiAnQ2hhcmxpZSBEZW1vJywgYmlvOiAnQ2hhcmxpZSBEZW1vIC0gZGVtbyBhY2NvdW50JyB9LFxuICBdO1xuXG4gIGNvbnN0IHVzZXJzOiBTaW1Vc2VyW10gPSBbXTtcblxuICBmb3IgKGxldCBpID0gMDsgaSA8IHVzZXJEZWZzLmxlbmd0aDsgaSsrKSB7XG4gICAgYXdhaXQgc3RlcChgdXNlci5jcmVhdGVbJHtpfV1gLCBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCB1c2VyID0gYXdhaXQgY3JlYXRlU2ltVXNlcihjb25maWcsIGkpO1xuICAgICAgLy8gT3ZlcnJpZGUgZGlzcGxheU5hbWUgd2l0aCBzY2VuYXJpbyBuYW1lXG4gICAgICB1c2VyLmRpc3BsYXlOYW1lID0gdXNlckRlZnNbaV0ubmFtZTtcbiAgICAgIHVzZXJzLnB1c2godXNlcik7XG4gICAgICBjb3VudGVycy51c2VycysrO1xuXG4gICAgICBsb2dBY3Rpb24oe1xuICAgICAgICB0aW1lc3RhbXA6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKSxcbiAgICAgICAgYWN0b3I6IHVzZXIuZGlzcGxheU5hbWUsXG4gICAgICAgIGFjdGlvbjogJ3VzZXIuY3JlYXRlJyxcbiAgICAgICAgcmVzb3VyY2U6IHVzZXIuZW1haWwsXG4gICAgICAgIHJlc3VsdDogJ29rJyxcbiAgICAgIH0pO1xuXG4gICAgICAvLyBDcmVhdGUgcHJvZmlsZVxuICAgICAgY29uc3QgcmVzID0gYXdhaXQgYXBpQ2FsbCgnUE9TVCcsICcvYXBpL3Byb2ZpbGVzJywgdXNlci50b2tlbiwge1xuICAgICAgICBkaXNwbGF5TmFtZTogdXNlckRlZnNbaV0ubmFtZSxcbiAgICAgICAgYmlvOiB1c2VyRGVmc1tpXS5iaW8sXG4gICAgICAgIGF2YXRhclVybDogJycsXG4gICAgICB9KTtcblxuICAgICAgbG9nQWN0aW9uKHtcbiAgICAgICAgdGltZXN0YW1wOiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCksXG4gICAgICAgIGFjdG9yOiB1c2VyLmRpc3BsYXlOYW1lLFxuICAgICAgICBhY3Rpb246ICdwcm9maWxlLmNyZWF0ZScsXG4gICAgICAgIHJlc291cmNlOiB1c2VyLnVzZXJJZCxcbiAgICAgICAgcmVzdWx0OiByZXMub2sgPyAnb2snIDogJ2Vycm9yJyxcbiAgICAgICAgLi4uKHJlcy5vayA/IHt9IDogeyBlcnJvcjogSlNPTi5zdHJpbmdpZnkocmVzLmRhdGEpLCBzdGF0dXNDb2RlOiByZXMuc3RhdHVzIH0pLFxuICAgICAgfSk7XG4gICAgfSk7XG4gIH1cblxuICBpZiAodXNlcnMubGVuZ3RoIDwgMykge1xuICAgIGxvZ0FjdGlvbih7XG4gICAgICB0aW1lc3RhbXA6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKSxcbiAgICAgIGFjdG9yOiAnc2NlbmFyaW8nLFxuICAgICAgYWN0aW9uOiAnYWJvcnQnLFxuICAgICAgcmVzb3VyY2U6ICduL2EnLFxuICAgICAgcmVzdWx0OiAnZXJyb3InLFxuICAgICAgZXJyb3I6IGBPbmx5ICR7dXNlcnMubGVuZ3RofS8zIHVzZXJzIHByb3Zpc2lvbmVkIOKAlCBjYW5ub3QgcnVuIHNjZW5hcmlvYCxcbiAgICB9KTtcbiAgICBwcm9jZXNzLmV4aXQoMSk7XG4gIH1cblxuICBjb25zdCBbYWxpY2UsIGJvYiwgY2hhcmxpZV0gPSB1c2VycztcblxuICAvLyDilIDilIAgUGhhc2UgQjogQnVpbGQgc29jaWFsIGdyYXBoIChtdXR1YWwgZm9sbG93cyA9IGZyaWVuZHMpIOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgFxuXG4gIGNvbnN0IGZvbGxvd1BhaXJzOiBBcnJheTx7IGZvbGxvd2VyOiBTaW1Vc2VyOyBmb2xsb3dlZTogU2ltVXNlciB9PiA9IFtcbiAgICB7IGZvbGxvd2VyOiBhbGljZSwgZm9sbG93ZWU6IGJvYiB9LFxuICAgIHsgZm9sbG93ZXI6IGJvYiwgZm9sbG93ZWU6IGFsaWNlIH0sXG4gICAgeyBmb2xsb3dlcjogYWxpY2UsIGZvbGxvd2VlOiBjaGFybGllIH0sXG4gICAgeyBmb2xsb3dlcjogY2hhcmxpZSwgZm9sbG93ZWU6IGFsaWNlIH0sXG4gICAgeyBmb2xsb3dlcjogYm9iLCBmb2xsb3dlZTogY2hhcmxpZSB9LFxuICAgIHsgZm9sbG93ZXI6IGNoYXJsaWUsIGZvbGxvd2VlOiBib2IgfSxcbiAgXTtcblxuICBmb3IgKGNvbnN0IHsgZm9sbG93ZXIsIGZvbGxvd2VlIH0gb2YgZm9sbG93UGFpcnMpIHtcbiAgICBhd2FpdCBzdGVwKGBmb2xsb3dgLCBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCByZXMgPSBhd2FpdCBhcGlDYWxsKFxuICAgICAgICAnUE9TVCcsXG4gICAgICAgIGAvYXBpL3NvY2lhbC9mb2xsb3cvJHtmb2xsb3dlZS51c2VySWR9YCxcbiAgICAgICAgZm9sbG93ZXIudG9rZW4sXG4gICAgICApO1xuICAgICAgY29uc3QgaXNPayA9IHJlcy5vayB8fCByZXMuc3RhdHVzID09PSA0MDk7XG4gICAgICBjb3VudGVycy5mb2xsb3dzKys7XG5cbiAgICAgIGxvZ0FjdGlvbih7XG4gICAgICAgIHRpbWVzdGFtcDogbmV3IERhdGUoKS50b0lTT1N0cmluZygpLFxuICAgICAgICBhY3RvcjogZm9sbG93ZXIuZGlzcGxheU5hbWUsXG4gICAgICAgIGFjdGlvbjogJ2ZvbGxvdycsXG4gICAgICAgIHJlc291cmNlOiBgdXNlcjoke2ZvbGxvd2VlLnVzZXJJZH1gLFxuICAgICAgICByZXN1bHQ6IGlzT2sgPyAnb2snIDogJ2Vycm9yJyxcbiAgICAgICAgLi4uKGlzT2sgPyB7fSA6IHsgZXJyb3I6IEpTT04uc3RyaW5naWZ5KHJlcy5kYXRhKSwgc3RhdHVzQ29kZTogcmVzLnN0YXR1cyB9KSxcbiAgICAgIH0pO1xuICAgIH0pO1xuICB9XG5cbiAgLy8g4pSA4pSAIFBoYXNlIEM6IENyZWF0ZSAyIHJvb21zIGFuZCBqb2luIG1lbWJlcnMg4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSAXG5cbiAgbGV0IGdlbmVyYWxSb29tSWQgPSAnJztcbiAgbGV0IHByb2plY3RSb29tSWQgPSAnJztcblxuICBhd2FpdCBzdGVwKCdyb29tLmNyZWF0ZVtHZW5lcmFsIENoYXRdJywgYXN5bmMgKCkgPT4ge1xuICAgIGNvbnN0IHJlcyA9IGF3YWl0IGFwaUNhbGwoJ1BPU1QnLCAnL2FwaS9yb29tcycsIGFsaWNlLnRva2VuLCB7IG5hbWU6ICdHZW5lcmFsIENoYXQnIH0pO1xuICAgIGlmIChyZXMub2sgJiYgcmVzLmRhdGE/LnJvb21JZCkge1xuICAgICAgZ2VuZXJhbFJvb21JZCA9IHJlcy5kYXRhLnJvb21JZDtcbiAgICAgIGNvdW50ZXJzLnJvb21zKys7XG4gICAgfVxuICAgIGxvZ0FjdGlvbih7XG4gICAgICB0aW1lc3RhbXA6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKSxcbiAgICAgIGFjdG9yOiBhbGljZS5kaXNwbGF5TmFtZSxcbiAgICAgIGFjdGlvbjogJ3Jvb20uY3JlYXRlJyxcbiAgICAgIHJlc291cmNlOiBnZW5lcmFsUm9vbUlkID8gYHJvb206JHtnZW5lcmFsUm9vbUlkfWAgOiAnbi9hJyxcbiAgICAgIHJlc3VsdDogcmVzLm9rID8gJ29rJyA6ICdlcnJvcicsXG4gICAgICAuLi4ocmVzLm9rID8ge30gOiB7IGVycm9yOiBKU09OLnN0cmluZ2lmeShyZXMuZGF0YSksIHN0YXR1c0NvZGU6IHJlcy5zdGF0dXMgfSksXG4gICAgfSk7XG4gIH0pO1xuXG4gIGF3YWl0IHN0ZXAoJ3Jvb20uY3JlYXRlW1Byb2plY3QgQWxwaGFdJywgYXN5bmMgKCkgPT4ge1xuICAgIGNvbnN0IHJlcyA9IGF3YWl0IGFwaUNhbGwoJ1BPU1QnLCAnL2FwaS9yb29tcycsIGFsaWNlLnRva2VuLCB7IG5hbWU6ICdQcm9qZWN0IEFscGhhJyB9KTtcbiAgICBpZiAocmVzLm9rICYmIHJlcy5kYXRhPy5yb29tSWQpIHtcbiAgICAgIHByb2plY3RSb29tSWQgPSByZXMuZGF0YS5yb29tSWQ7XG4gICAgICBjb3VudGVycy5yb29tcysrO1xuICAgIH1cbiAgICBsb2dBY3Rpb24oe1xuICAgICAgdGltZXN0YW1wOiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCksXG4gICAgICBhY3RvcjogYWxpY2UuZGlzcGxheU5hbWUsXG4gICAgICBhY3Rpb246ICdyb29tLmNyZWF0ZScsXG4gICAgICByZXNvdXJjZTogcHJvamVjdFJvb21JZCA/IGByb29tOiR7cHJvamVjdFJvb21JZH1gIDogJ24vYScsXG4gICAgICByZXN1bHQ6IHJlcy5vayA/ICdvaycgOiAnZXJyb3InLFxuICAgICAgLi4uKHJlcy5vayA/IHt9IDogeyBlcnJvcjogSlNPTi5zdHJpbmdpZnkocmVzLmRhdGEpLCBzdGF0dXNDb2RlOiByZXMuc3RhdHVzIH0pLFxuICAgIH0pO1xuICB9KTtcblxuICAvLyBCb2IgYW5kIENoYXJsaWUgam9pbiBib3RoIHJvb21zXG4gIGZvciAoY29uc3QgdXNlciBvZiBbYm9iLCBjaGFybGllXSkge1xuICAgIGZvciAoY29uc3QgW3Jvb21JZCwgcm9vbU5hbWVdIG9mIFtbZ2VuZXJhbFJvb21JZCwgJ0dlbmVyYWwgQ2hhdCddLCBbcHJvamVjdFJvb21JZCwgJ1Byb2plY3QgQWxwaGEnXV0gYXMgY29uc3QpIHtcbiAgICAgIGlmICghcm9vbUlkKSBjb250aW51ZTtcbiAgICAgIGF3YWl0IHN0ZXAoYHJvb20uam9pblske3Jvb21OYW1lfV1gLCBhc3luYyAoKSA9PiB7XG4gICAgICAgIGNvbnN0IHJlcyA9IGF3YWl0IGFwaUNhbGwoJ1BPU1QnLCBgL2FwaS9yb29tcy8ke3Jvb21JZH0vam9pbmAsIHVzZXIudG9rZW4pO1xuICAgICAgICBsb2dBY3Rpb24oe1xuICAgICAgICAgIHRpbWVzdGFtcDogbmV3IERhdGUoKS50b0lTT1N0cmluZygpLFxuICAgICAgICAgIGFjdG9yOiB1c2VyLmRpc3BsYXlOYW1lLFxuICAgICAgICAgIGFjdGlvbjogJ3Jvb20uam9pbicsXG4gICAgICAgICAgcmVzb3VyY2U6IGByb29tOiR7cm9vbUlkfWAsXG4gICAgICAgICAgcmVzdWx0OiByZXMub2sgPyAnb2snIDogJ2Vycm9yJyxcbiAgICAgICAgICAuLi4ocmVzLm9rID8ge30gOiB7IGVycm9yOiBKU09OLnN0cmluZ2lmeShyZXMuZGF0YSksIHN0YXR1c0NvZGU6IHJlcy5zdGF0dXMgfSksXG4gICAgICAgIH0pO1xuICAgICAgfSk7XG4gICAgfVxuICB9XG5cbiAgLy8g4pSA4pSAIFBoYXNlIEQ6IFNlZWQgY29udmVyc2F0aW9uIGluIEdlbmVyYWwgQ2hhdCDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIBcblxuICBsZXQgcG9zdDFJZCA9ICcnO1xuICBsZXQgcG9zdDJJZCA9ICcnO1xuICBsZXQgcG9zdDNJZCA9ICcnOyAvLyBCb2IncyBsYXRlc3QgcG9zdFxuXG4gIC8vIEQxOiBBbGljZSBwb3N0c1xuICBhd2FpdCBzdGVwKCdwb3N0LmNyZWF0ZVtEMV0nLCBhc3luYyAoKSA9PiB7XG4gICAgY29uc3QgcmVzID0gYXdhaXQgYXBpQ2FsbCgnUE9TVCcsIGAvYXBpL3Jvb21zLyR7Z2VuZXJhbFJvb21JZH0vcG9zdHNgLCBhbGljZS50b2tlbiwge1xuICAgICAgY29udGVudDogJ0hleSBldmVyeW9uZSEgV2VsY29tZSB0byB0aGUgZGVtby4nLFxuICAgIH0pO1xuICAgIGlmIChyZXMub2sgJiYgcmVzLmRhdGE/LnBvc3RJZCkge1xuICAgICAgcG9zdDFJZCA9IHJlcy5kYXRhLnBvc3RJZDtcbiAgICAgIGNvdW50ZXJzLnBvc3RzKys7XG4gICAgfVxuICAgIGxvZ0FjdGlvbih7XG4gICAgICB0aW1lc3RhbXA6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKSxcbiAgICAgIGFjdG9yOiBhbGljZS5kaXNwbGF5TmFtZSxcbiAgICAgIGFjdGlvbjogJ3Bvc3QuY3JlYXRlJyxcbiAgICAgIHJlc291cmNlOiBgcm9vbToke2dlbmVyYWxSb29tSWR9YCxcbiAgICAgIHJlc3VsdDogcmVzLm9rID8gJ29rJyA6ICdlcnJvcicsXG4gICAgICAuLi4ocmVzLm9rID8ge30gOiB7IGVycm9yOiBKU09OLnN0cmluZ2lmeShyZXMuZGF0YSksIHN0YXR1c0NvZGU6IHJlcy5zdGF0dXMgfSksXG4gICAgfSk7XG4gIH0pO1xuICBhd2FpdCBzbGVlcCgzMDApO1xuXG4gIC8vIEQyOiBCb2IgcG9zdHNcbiAgYXdhaXQgc3RlcCgncG9zdC5jcmVhdGVbRDJdJywgYXN5bmMgKCkgPT4ge1xuICAgIGNvbnN0IHJlcyA9IGF3YWl0IGFwaUNhbGwoJ1BPU1QnLCBgL2FwaS9yb29tcy8ke2dlbmVyYWxSb29tSWR9L3Bvc3RzYCwgYm9iLnRva2VuLCB7XG4gICAgICBjb250ZW50OiAnVGhhbmtzIEFsaWNlISBFeGNpdGVkIHRvIHRyeSB0aGlzIG91dC4nLFxuICAgIH0pO1xuICAgIGlmIChyZXMub2sgJiYgcmVzLmRhdGE/LnBvc3RJZCkge1xuICAgICAgcG9zdDJJZCA9IHJlcy5kYXRhLnBvc3RJZDtcbiAgICAgIGNvdW50ZXJzLnBvc3RzKys7XG4gICAgfVxuICAgIGxvZ0FjdGlvbih7XG4gICAgICB0aW1lc3RhbXA6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKSxcbiAgICAgIGFjdG9yOiBib2IuZGlzcGxheU5hbWUsXG4gICAgICBhY3Rpb246ICdwb3N0LmNyZWF0ZScsXG4gICAgICByZXNvdXJjZTogYHJvb206JHtnZW5lcmFsUm9vbUlkfWAsXG4gICAgICByZXN1bHQ6IHJlcy5vayA/ICdvaycgOiAnZXJyb3InLFxuICAgICAgLi4uKHJlcy5vayA/IHt9IDogeyBlcnJvcjogSlNPTi5zdHJpbmdpZnkocmVzLmRhdGEpLCBzdGF0dXNDb2RlOiByZXMuc3RhdHVzIH0pLFxuICAgIH0pO1xuICB9KTtcbiAgYXdhaXQgc2xlZXAoMzAwKTtcblxuICAvLyBEMzogQ2hhcmxpZSBjb21tZW50cyBvbiBwb3N0MVxuICBhd2FpdCBzdGVwKCdjb21tZW50LmNyZWF0ZVtEM10nLCBhc3luYyAoKSA9PiB7XG4gICAgY29uc3QgcmVzID0gYXdhaXQgYXBpQ2FsbChcbiAgICAgICdQT1NUJyxcbiAgICAgIGAvYXBpL3Jvb21zLyR7Z2VuZXJhbFJvb21JZH0vcG9zdHMvJHtwb3N0MUlkfS9jb21tZW50c2AsXG4gICAgICBjaGFybGllLnRva2VuLFxuICAgICAgeyBjb250ZW50OiAnTG9va3MgZ3JlYXQhJyB9LFxuICAgICk7XG4gICAgaWYgKHJlcy5vaykgY291bnRlcnMuY29tbWVudHMrKztcbiAgICBsb2dBY3Rpb24oe1xuICAgICAgdGltZXN0YW1wOiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCksXG4gICAgICBhY3RvcjogY2hhcmxpZS5kaXNwbGF5TmFtZSxcbiAgICAgIGFjdGlvbjogJ2NvbW1lbnQuY3JlYXRlJyxcbiAgICAgIHJlc291cmNlOiBgcG9zdDoke3Bvc3QxSWR9YCxcbiAgICAgIHJlc3VsdDogcmVzLm9rID8gJ29rJyA6ICdlcnJvcicsXG4gICAgICAuLi4ocmVzLm9rID8ge30gOiB7IGVycm9yOiBKU09OLnN0cmluZ2lmeShyZXMuZGF0YSksIHN0YXR1c0NvZGU6IHJlcy5zdGF0dXMgfSksXG4gICAgfSk7XG4gIH0pO1xuICBhd2FpdCBzbGVlcCgzMDApO1xuXG4gIC8vIEQ0OiBBbGljZSBsaWtlcyBwb3N0MlxuICBhd2FpdCBzdGVwKCdsaWtlLmFkZFtENF0nLCBhc3luYyAoKSA9PiB7XG4gICAgY29uc3QgcmVzID0gYXdhaXQgYXBpQ2FsbChcbiAgICAgICdQT1NUJyxcbiAgICAgIGAvYXBpL3Jvb21zLyR7Z2VuZXJhbFJvb21JZH0vcG9zdHMvJHtwb3N0MklkfS9saWtlc2AsXG4gICAgICBhbGljZS50b2tlbixcbiAgICApO1xuICAgIGlmIChyZXMub2spIGNvdW50ZXJzLmxpa2VzKys7XG4gICAgbG9nQWN0aW9uKHtcbiAgICAgIHRpbWVzdGFtcDogbmV3IERhdGUoKS50b0lTT1N0cmluZygpLFxuICAgICAgYWN0b3I6IGFsaWNlLmRpc3BsYXlOYW1lLFxuICAgICAgYWN0aW9uOiAnbGlrZS5hZGQnLFxuICAgICAgcmVzb3VyY2U6IGBwb3N0OiR7cG9zdDJJZH1gLFxuICAgICAgcmVzdWx0OiByZXMub2sgPyAnb2snIDogJ2Vycm9yJyxcbiAgICAgIC4uLihyZXMub2sgPyB7fSA6IHsgZXJyb3I6IEpTT04uc3RyaW5naWZ5KHJlcy5kYXRhKSwgc3RhdHVzQ29kZTogcmVzLnN0YXR1cyB9KSxcbiAgICB9KTtcbiAgfSk7XG4gIGF3YWl0IHNsZWVwKDMwMCk7XG5cbiAgLy8gRDU6IEJvYiByZWFjdHMgdG8gcG9zdDEgd2l0aCBmaXJlXG4gIGF3YWl0IHN0ZXAoJ3JlYWN0aW9uLmFkZFtENV0nLCBhc3luYyAoKSA9PiB7XG4gICAgY29uc3QgcmVzID0gYXdhaXQgYXBpQ2FsbChcbiAgICAgICdQT1NUJyxcbiAgICAgIGAvYXBpL3Jvb21zLyR7Z2VuZXJhbFJvb21JZH0vcG9zdHMvJHtwb3N0MUlkfS9yZWFjdGlvbnNgLFxuICAgICAgYm9iLnRva2VuLFxuICAgICAgeyBlbW9qaTogJ1xcdUQ4M0RcXHVERDI1JyB9LCAvLyBmaXJlIGVtb2ppXG4gICAgKTtcbiAgICBpZiAocmVzLm9rKSBjb3VudGVycy5yZWFjdGlvbnMrKztcbiAgICBsb2dBY3Rpb24oe1xuICAgICAgdGltZXN0YW1wOiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCksXG4gICAgICBhY3RvcjogYm9iLmRpc3BsYXlOYW1lLFxuICAgICAgYWN0aW9uOiAncmVhY3Rpb24uYWRkJyxcbiAgICAgIHJlc291cmNlOiBgcG9zdDoke3Bvc3QxSWR9YCxcbiAgICAgIHJlc3VsdDogcmVzLm9rID8gJ29rJyA6ICdlcnJvcicsXG4gICAgICAuLi4ocmVzLm9rID8ge30gOiB7IGVycm9yOiBKU09OLnN0cmluZ2lmeShyZXMuZGF0YSksIHN0YXR1c0NvZGU6IHJlcy5zdGF0dXMgfSksXG4gICAgfSk7XG4gIH0pO1xuICBhd2FpdCBzbGVlcCgzMDApO1xuXG4gIC8vIEQ2OiBDaGFybGllIHJlYWN0cyB0byBwb3N0MSB3aXRoIGhlYXJ0XG4gIGF3YWl0IHN0ZXAoJ3JlYWN0aW9uLmFkZFtENl0nLCBhc3luYyAoKSA9PiB7XG4gICAgY29uc3QgcmVzID0gYXdhaXQgYXBpQ2FsbChcbiAgICAgICdQT1NUJyxcbiAgICAgIGAvYXBpL3Jvb21zLyR7Z2VuZXJhbFJvb21JZH0vcG9zdHMvJHtwb3N0MUlkfS9yZWFjdGlvbnNgLFxuICAgICAgY2hhcmxpZS50b2tlbixcbiAgICAgIHsgZW1vamk6ICdcXHUyNzY0XFx1RkUwRicgfSwgLy8gaGVhcnQgZW1vamlcbiAgICApO1xuICAgIGlmIChyZXMub2spIGNvdW50ZXJzLnJlYWN0aW9ucysrO1xuICAgIGxvZ0FjdGlvbih7XG4gICAgICB0aW1lc3RhbXA6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKSxcbiAgICAgIGFjdG9yOiBjaGFybGllLmRpc3BsYXlOYW1lLFxuICAgICAgYWN0aW9uOiAncmVhY3Rpb24uYWRkJyxcbiAgICAgIHJlc291cmNlOiBgcG9zdDoke3Bvc3QxSWR9YCxcbiAgICAgIHJlc3VsdDogcmVzLm9rID8gJ29rJyA6ICdlcnJvcicsXG4gICAgICAuLi4ocmVzLm9rID8ge30gOiB7IGVycm9yOiBKU09OLnN0cmluZ2lmeShyZXMuZGF0YSksIHN0YXR1c0NvZGU6IHJlcy5zdGF0dXMgfSksXG4gICAgfSk7XG4gIH0pO1xuICBhd2FpdCBzbGVlcCgzMDApO1xuXG4gIC8vIEQ3OiBBbGljZSBjb21tZW50cyBvbiBwb3N0MSByZXBseWluZ1xuICBhd2FpdCBzdGVwKCdjb21tZW50LmNyZWF0ZVtEN10nLCBhc3luYyAoKSA9PiB7XG4gICAgY29uc3QgcmVzID0gYXdhaXQgYXBpQ2FsbChcbiAgICAgICdQT1NUJyxcbiAgICAgIGAvYXBpL3Jvb21zLyR7Z2VuZXJhbFJvb21JZH0vcG9zdHMvJHtwb3N0MUlkfS9jb21tZW50c2AsXG4gICAgICBhbGljZS50b2tlbixcbiAgICAgIHsgY29udGVudDogJ1RoYW5rcyBDaGFybGllIScgfSxcbiAgICApO1xuICAgIGlmIChyZXMub2spIGNvdW50ZXJzLmNvbW1lbnRzKys7XG4gICAgbG9nQWN0aW9uKHtcbiAgICAgIHRpbWVzdGFtcDogbmV3IERhdGUoKS50b0lTT1N0cmluZygpLFxuICAgICAgYWN0b3I6IGFsaWNlLmRpc3BsYXlOYW1lLFxuICAgICAgYWN0aW9uOiAnY29tbWVudC5jcmVhdGUnLFxuICAgICAgcmVzb3VyY2U6IGBwb3N0OiR7cG9zdDFJZH1gLFxuICAgICAgcmVzdWx0OiByZXMub2sgPyAnb2snIDogJ2Vycm9yJyxcbiAgICAgIC4uLihyZXMub2sgPyB7fSA6IHsgZXJyb3I6IEpTT04uc3RyaW5naWZ5KHJlcy5kYXRhKSwgc3RhdHVzQ29kZTogcmVzLnN0YXR1cyB9KSxcbiAgICB9KTtcbiAgfSk7XG4gIGF3YWl0IHNsZWVwKDMwMCk7XG5cbiAgLy8gRDg6IEJvYiBwb3N0cyBsYXRlc3RcbiAgYXdhaXQgc3RlcCgncG9zdC5jcmVhdGVbRDhdJywgYXN5bmMgKCkgPT4ge1xuICAgIGNvbnN0IHJlcyA9IGF3YWl0IGFwaUNhbGwoJ1BPU1QnLCBgL2FwaS9yb29tcy8ke2dlbmVyYWxSb29tSWR9L3Bvc3RzYCwgYm9iLnRva2VuLCB7XG4gICAgICBjb250ZW50OiAnSnVzdCBwdXNoZWQgdGhlIGxhdGVzdCBjaGFuZ2VzIHRvIHRoZSByZXBvLicsXG4gICAgfSk7XG4gICAgaWYgKHJlcy5vayAmJiByZXMuZGF0YT8ucG9zdElkKSB7XG4gICAgICBwb3N0M0lkID0gcmVzLmRhdGEucG9zdElkO1xuICAgICAgY291bnRlcnMucG9zdHMrKztcbiAgICB9XG4gICAgbG9nQWN0aW9uKHtcbiAgICAgIHRpbWVzdGFtcDogbmV3IERhdGUoKS50b0lTT1N0cmluZygpLFxuICAgICAgYWN0b3I6IGJvYi5kaXNwbGF5TmFtZSxcbiAgICAgIGFjdGlvbjogJ3Bvc3QuY3JlYXRlJyxcbiAgICAgIHJlc291cmNlOiBgcm9vbToke2dlbmVyYWxSb29tSWR9YCxcbiAgICAgIHJlc3VsdDogcmVzLm9rID8gJ29rJyA6ICdlcnJvcicsXG4gICAgICAuLi4ocmVzLm9rID8ge30gOiB7IGVycm9yOiBKU09OLnN0cmluZ2lmeShyZXMuZGF0YSksIHN0YXR1c0NvZGU6IHJlcy5zdGF0dXMgfSksXG4gICAgfSk7XG4gIH0pO1xuICBhd2FpdCBzbGVlcCgzMDApO1xuXG4gIC8vIEQ5OiBDaGFybGllIGxpa2VzIEJvYidzIGxhdGVzdCBwb3N0XG4gIGF3YWl0IHN0ZXAoJ2xpa2UuYWRkW0Q5XScsIGFzeW5jICgpID0+IHtcbiAgICBjb25zdCByZXMgPSBhd2FpdCBhcGlDYWxsKFxuICAgICAgJ1BPU1QnLFxuICAgICAgYC9hcGkvcm9vbXMvJHtnZW5lcmFsUm9vbUlkfS9wb3N0cy8ke3Bvc3QzSWR9L2xpa2VzYCxcbiAgICAgIGNoYXJsaWUudG9rZW4sXG4gICAgKTtcbiAgICBpZiAocmVzLm9rKSBjb3VudGVycy5saWtlcysrO1xuICAgIGxvZ0FjdGlvbih7XG4gICAgICB0aW1lc3RhbXA6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKSxcbiAgICAgIGFjdG9yOiBjaGFybGllLmRpc3BsYXlOYW1lLFxuICAgICAgYWN0aW9uOiAnbGlrZS5hZGQnLFxuICAgICAgcmVzb3VyY2U6IGBwb3N0OiR7cG9zdDNJZH1gLFxuICAgICAgcmVzdWx0OiByZXMub2sgPyAnb2snIDogJ2Vycm9yJyxcbiAgICAgIC4uLihyZXMub2sgPyB7fSA6IHsgZXJyb3I6IEpTT04uc3RyaW5naWZ5KHJlcy5kYXRhKSwgc3RhdHVzQ29kZTogcmVzLnN0YXR1cyB9KSxcbiAgICB9KTtcbiAgfSk7XG4gIGF3YWl0IHNsZWVwKDMwMCk7XG5cbiAgLy8gRDEwOiBBbGljZSByZWFjdHMgdG8gQm9iJ3MgbGF0ZXN0IHBvc3Qgd2l0aCB0aHVtYnN1cFxuICBhd2FpdCBzdGVwKCdyZWFjdGlvbi5hZGRbRDEwXScsIGFzeW5jICgpID0+IHtcbiAgICBjb25zdCByZXMgPSBhd2FpdCBhcGlDYWxsKFxuICAgICAgJ1BPU1QnLFxuICAgICAgYC9hcGkvcm9vbXMvJHtnZW5lcmFsUm9vbUlkfS9wb3N0cy8ke3Bvc3QzSWR9L3JlYWN0aW9uc2AsXG4gICAgICBhbGljZS50b2tlbixcbiAgICAgIHsgZW1vamk6ICdcXHVEODNEXFx1REM0RCcgfSwgLy8gdGh1bWJzdXAgZW1vamlcbiAgICApO1xuICAgIGlmIChyZXMub2spIGNvdW50ZXJzLnJlYWN0aW9ucysrO1xuICAgIGxvZ0FjdGlvbih7XG4gICAgICB0aW1lc3RhbXA6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKSxcbiAgICAgIGFjdG9yOiBhbGljZS5kaXNwbGF5TmFtZSxcbiAgICAgIGFjdGlvbjogJ3JlYWN0aW9uLmFkZCcsXG4gICAgICByZXNvdXJjZTogYHBvc3Q6JHtwb3N0M0lkfWAsXG4gICAgICByZXN1bHQ6IHJlcy5vayA/ICdvaycgOiAnZXJyb3InLFxuICAgICAgLi4uKHJlcy5vayA/IHt9IDogeyBlcnJvcjogSlNPTi5zdHJpbmdpZnkocmVzLmRhdGEpLCBzdGF0dXNDb2RlOiByZXMuc3RhdHVzIH0pLFxuICAgIH0pO1xuICB9KTtcbiAgYXdhaXQgc2xlZXAoMzAwKTtcblxuICAvLyDilIDilIAgUGhhc2UgRTogU2VlZCBjb250ZW50IGluIFByb2plY3QgQWxwaGEg4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSAXG5cbiAgbGV0IHByb2plY3RQb3N0MUlkID0gJyc7XG5cbiAgLy8gRTE6IEFsaWNlIHBvc3RzIHNwcmludCBwbGFubmluZ1xuICBhd2FpdCBzdGVwKCdwb3N0LmNyZWF0ZVtFMV0nLCBhc3luYyAoKSA9PiB7XG4gICAgY29uc3QgcmVzID0gYXdhaXQgYXBpQ2FsbCgnUE9TVCcsIGAvYXBpL3Jvb21zLyR7cHJvamVjdFJvb21JZH0vcG9zdHNgLCBhbGljZS50b2tlbiwge1xuICAgICAgY29udGVudDogJ1NwcmludCBwbGFubmluZyBmb3IgbmV4dCB3ZWVrIC0gbGV0XFwncyBkaXNjdXNzIHByaW9yaXRpZXMnLFxuICAgIH0pO1xuICAgIGlmIChyZXMub2sgJiYgcmVzLmRhdGE/LnBvc3RJZCkge1xuICAgICAgcHJvamVjdFBvc3QxSWQgPSByZXMuZGF0YS5wb3N0SWQ7XG4gICAgICBjb3VudGVycy5wb3N0cysrO1xuICAgIH1cbiAgICBsb2dBY3Rpb24oe1xuICAgICAgdGltZXN0YW1wOiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCksXG4gICAgICBhY3RvcjogYWxpY2UuZGlzcGxheU5hbWUsXG4gICAgICBhY3Rpb246ICdwb3N0LmNyZWF0ZScsXG4gICAgICByZXNvdXJjZTogYHJvb206JHtwcm9qZWN0Um9vbUlkfWAsXG4gICAgICByZXN1bHQ6IHJlcy5vayA/ICdvaycgOiAnZXJyb3InLFxuICAgICAgLi4uKHJlcy5vayA/IHt9IDogeyBlcnJvcjogSlNPTi5zdHJpbmdpZnkocmVzLmRhdGEpLCBzdGF0dXNDb2RlOiByZXMuc3RhdHVzIH0pLFxuICAgIH0pO1xuICB9KTtcbiAgYXdhaXQgc2xlZXAoMzAwKTtcblxuICAvLyBFMjogQm9iIGNvbW1lbnRzIG9uIHNwcmludCBwb3N0XG4gIGF3YWl0IHN0ZXAoJ2NvbW1lbnQuY3JlYXRlW0UyXScsIGFzeW5jICgpID0+IHtcbiAgICBjb25zdCByZXMgPSBhd2FpdCBhcGlDYWxsKFxuICAgICAgJ1BPU1QnLFxuICAgICAgYC9hcGkvcm9vbXMvJHtwcm9qZWN0Um9vbUlkfS9wb3N0cy8ke3Byb2plY3RQb3N0MUlkfS9jb21tZW50c2AsXG4gICAgICBib2IudG9rZW4sXG4gICAgICB7IGNvbnRlbnQ6ICdJIHRoaW5rIHdlIHNob3VsZCBmb2N1cyBvbiB0aGUgQVBJIGludGVncmF0aW9uJyB9LFxuICAgICk7XG4gICAgaWYgKHJlcy5vaykgY291bnRlcnMuY29tbWVudHMrKztcbiAgICBsb2dBY3Rpb24oe1xuICAgICAgdGltZXN0YW1wOiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCksXG4gICAgICBhY3RvcjogYm9iLmRpc3BsYXlOYW1lLFxuICAgICAgYWN0aW9uOiAnY29tbWVudC5jcmVhdGUnLFxuICAgICAgcmVzb3VyY2U6IGBwb3N0OiR7cHJvamVjdFBvc3QxSWR9YCxcbiAgICAgIHJlc3VsdDogcmVzLm9rID8gJ29rJyA6ICdlcnJvcicsXG4gICAgICAuLi4ocmVzLm9rID8ge30gOiB7IGVycm9yOiBKU09OLnN0cmluZ2lmeShyZXMuZGF0YSksIHN0YXR1c0NvZGU6IHJlcy5zdGF0dXMgfSksXG4gICAgfSk7XG4gIH0pO1xuICBhd2FpdCBzbGVlcCgzMDApO1xuXG4gIC8vIEUzOiBDaGFybGllIGNvbW1lbnRzXG4gIGF3YWl0IHN0ZXAoJ2NvbW1lbnQuY3JlYXRlW0UzXScsIGFzeW5jICgpID0+IHtcbiAgICBjb25zdCByZXMgPSBhd2FpdCBhcGlDYWxsKFxuICAgICAgJ1BPU1QnLFxuICAgICAgYC9hcGkvcm9vbXMvJHtwcm9qZWN0Um9vbUlkfS9wb3N0cy8ke3Byb2plY3RQb3N0MUlkfS9jb21tZW50c2AsXG4gICAgICBjaGFybGllLnRva2VuLFxuICAgICAgeyBjb250ZW50OiAnQWdyZWUgd2l0aCBCb2IsIHBsdXMgd2UgbmVlZCB0byB1cGRhdGUgdGhlIGRvY3MnIH0sXG4gICAgKTtcbiAgICBpZiAocmVzLm9rKSBjb3VudGVycy5jb21tZW50cysrO1xuICAgIGxvZ0FjdGlvbih7XG4gICAgICB0aW1lc3RhbXA6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKSxcbiAgICAgIGFjdG9yOiBjaGFybGllLmRpc3BsYXlOYW1lLFxuICAgICAgYWN0aW9uOiAnY29tbWVudC5jcmVhdGUnLFxuICAgICAgcmVzb3VyY2U6IGBwb3N0OiR7cHJvamVjdFBvc3QxSWR9YCxcbiAgICAgIHJlc3VsdDogcmVzLm9rID8gJ29rJyA6ICdlcnJvcicsXG4gICAgICAuLi4ocmVzLm9rID8ge30gOiB7IGVycm9yOiBKU09OLnN0cmluZ2lmeShyZXMuZGF0YSksIHN0YXR1c0NvZGU6IHJlcy5zdGF0dXMgfSksXG4gICAgfSk7XG4gIH0pO1xuICBhd2FpdCBzbGVlcCgzMDApO1xuXG4gIC8vIEU0OiBBbGljZSBsaWtlcyB0aGUgc3ByaW50IHBvc3QgKGxpa2luZyB0aGUgcG9zdCBpdHNlbGYpXG4gIGF3YWl0IHN0ZXAoJ2xpa2UuYWRkW0U0XScsIGFzeW5jICgpID0+IHtcbiAgICBjb25zdCByZXMgPSBhd2FpdCBhcGlDYWxsKFxuICAgICAgJ1BPU1QnLFxuICAgICAgYC9hcGkvcm9vbXMvJHtwcm9qZWN0Um9vbUlkfS9wb3N0cy8ke3Byb2plY3RQb3N0MUlkfS9saWtlc2AsXG4gICAgICBhbGljZS50b2tlbixcbiAgICApO1xuICAgIGlmIChyZXMub2spIGNvdW50ZXJzLmxpa2VzKys7XG4gICAgbG9nQWN0aW9uKHtcbiAgICAgIHRpbWVzdGFtcDogbmV3IERhdGUoKS50b0lTT1N0cmluZygpLFxuICAgICAgYWN0b3I6IGFsaWNlLmRpc3BsYXlOYW1lLFxuICAgICAgYWN0aW9uOiAnbGlrZS5hZGQnLFxuICAgICAgcmVzb3VyY2U6IGBwb3N0OiR7cHJvamVjdFBvc3QxSWR9YCxcbiAgICAgIHJlc3VsdDogcmVzLm9rID8gJ29rJyA6ICdlcnJvcicsXG4gICAgICAuLi4ocmVzLm9rID8ge30gOiB7IGVycm9yOiBKU09OLnN0cmluZ2lmeShyZXMuZGF0YSksIHN0YXR1c0NvZGU6IHJlcy5zdGF0dXMgfSksXG4gICAgfSk7XG4gIH0pO1xuICBhd2FpdCBzbGVlcCgzMDApO1xuXG4gIC8vIEU1OiBCb2IgcmVhY3RzIHdpdGggdGh1bWJzdXAgdG8gQWxpY2UncyBwb3N0XG4gIGF3YWl0IHN0ZXAoJ3JlYWN0aW9uLmFkZFtFNV0nLCBhc3luYyAoKSA9PiB7XG4gICAgY29uc3QgcmVzID0gYXdhaXQgYXBpQ2FsbChcbiAgICAgICdQT1NUJyxcbiAgICAgIGAvYXBpL3Jvb21zLyR7cHJvamVjdFJvb21JZH0vcG9zdHMvJHtwcm9qZWN0UG9zdDFJZH0vcmVhY3Rpb25zYCxcbiAgICAgIGJvYi50b2tlbixcbiAgICAgIHsgZW1vamk6ICdcXHVEODNEXFx1REM0RCcgfSwgLy8gdGh1bWJzdXAgZW1vamlcbiAgICApO1xuICAgIGlmIChyZXMub2spIGNvdW50ZXJzLnJlYWN0aW9ucysrO1xuICAgIGxvZ0FjdGlvbih7XG4gICAgICB0aW1lc3RhbXA6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKSxcbiAgICAgIGFjdG9yOiBib2IuZGlzcGxheU5hbWUsXG4gICAgICBhY3Rpb246ICdyZWFjdGlvbi5hZGQnLFxuICAgICAgcmVzb3VyY2U6IGBwb3N0OiR7cHJvamVjdFBvc3QxSWR9YCxcbiAgICAgIHJlc3VsdDogcmVzLm9rID8gJ29rJyA6ICdlcnJvcicsXG4gICAgICAuLi4ocmVzLm9rID8ge30gOiB7IGVycm9yOiBKU09OLnN0cmluZ2lmeShyZXMuZGF0YSksIHN0YXR1c0NvZGU6IHJlcy5zdGF0dXMgfSksXG4gICAgfSk7XG4gIH0pO1xuXG4gIC8vIOKUgOKUgCBGaW5hbCBTdW1tYXJ5IOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgFxuXG4gIGxvZ0FjdGlvbih7XG4gICAgdGltZXN0YW1wOiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCksXG4gICAgYWN0b3I6ICdzY2VuYXJpbycsXG4gICAgYWN0aW9uOiAnc3VtbWFyeScsXG4gICAgcmVzb3VyY2U6ICduL2EnLFxuICAgIHJlc3VsdDogJ29rJyxcbiAgICBzdGF0czoge1xuICAgICAgdXNlcnM6IGNvdW50ZXJzLnVzZXJzLFxuICAgICAgcm9vbXM6IGNvdW50ZXJzLnJvb21zLFxuICAgICAgcG9zdHM6IGNvdW50ZXJzLnBvc3RzLFxuICAgICAgY29tbWVudHM6IGNvdW50ZXJzLmNvbW1lbnRzLFxuICAgICAgcmVhY3Rpb25zOiBjb3VudGVycy5yZWFjdGlvbnMsXG4gICAgICBsaWtlczogY291bnRlcnMubGlrZXMsXG4gICAgICBmb2xsb3dzOiBjb3VudGVycy5mb2xsb3dzLFxuICAgIH0sXG4gIH0pO1xufVxuXG5tYWluKCkuY2F0Y2goKGVycikgPT4ge1xuICBsb2dBY3Rpb24oe1xuICAgIHRpbWVzdGFtcDogbmV3IERhdGUoKS50b0lTT1N0cmluZygpLFxuICAgIGFjdG9yOiAnc2NlbmFyaW8nLFxuICAgIGFjdGlvbjogJ2ZhdGFsJyxcbiAgICByZXNvdXJjZTogJ24vYScsXG4gICAgcmVzdWx0OiAnZXJyb3InLFxuICAgIGVycm9yOiBTdHJpbmcoZXJyKSxcbiAgfSk7XG4gIHByb2Nlc3MuZXhpdCgxKTtcbn0pO1xuIl19