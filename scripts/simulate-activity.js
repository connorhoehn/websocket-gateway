#!/usr/bin/env npx tsx --tsconfig scripts/tsconfig.scripts.json
"use strict";
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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const path_1 = __importDefault(require("path"));
const sim_helpers_1 = require("./lib/sim-helpers");
// ── State ────────────────────────────────────────────────────────────────────
const users = [];
const roomIds = [];
const postIdsByRoom = new Map();
// ── Counters ─────────────────────────────────────────────────────────────────
let totalActions = 0;
let totalErrors = 0;
const ACTION_WEIGHTS = [
    { type: 'post.create', weight: 30 },
    { type: 'comment.create', weight: 20 },
    { type: 'reaction.add', weight: 20 },
    { type: 'like.add', weight: 15 },
    { type: 'follow', weight: 10 },
    { type: 'room.create', weight: 5 },
];
const TOTAL_WEIGHT = ACTION_WEIGHTS.reduce((sum, a) => sum + a.weight, 0);
function pickWeightedAction() {
    let rand = Math.random() * TOTAL_WEIGHT;
    for (const entry of ACTION_WEIGHTS) {
        rand -= entry.weight;
        if (rand <= 0)
            return entry.type;
    }
    return ACTION_WEIGHTS[0].type;
}
// ── Helpers ──────────────────────────────────────────────────────────────────
const EMOJIS = ['❤️', '😂', '👍', '😮', '😢', '🔥', '🎉', '🚀'];
function pickRandom(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
}
function pickOtherUser(actor) {
    const others = users.filter((u) => u.userId !== actor.userId);
    return others.length > 0 ? pickRandom(others) : null;
}
function getRandomPostAndRoom() {
    const entries = Array.from(postIdsByRoom.entries()).filter(([, posts]) => posts.length > 0);
    if (entries.length === 0)
        return null;
    const [roomId, posts] = pickRandom(entries);
    const postId = pickRandom(posts);
    return { roomId, postId };
}
function randomDelay() {
    return 500 + Math.floor(Math.random() * 1500); // 500-2000ms
}
// ── Action Executors ─────────────────────────────────────────────────────────
async function executeAction(actionType, actor) {
    const ts = new Date().toISOString();
    totalActions++;
    switch (actionType) {
        case 'post.create': {
            const roomId = pickRandom(roomIds);
            const res = await (0, sim_helpers_1.apiCall)('POST', `/api/rooms/${roomId}/posts`, actor.token, {
                content: `Sim post at ${new Date().toISOString()}`,
            });
            if (res.ok && res.data?.postId) {
                const posts = postIdsByRoom.get(roomId) ?? [];
                posts.push(res.data.postId);
                // Cap at 50 posts per room
                if (posts.length > 50)
                    posts.shift();
                postIdsByRoom.set(roomId, posts);
            }
            (0, sim_helpers_1.logAction)({
                timestamp: ts,
                actor: actor.displayName,
                action: 'post.create',
                resource: `room:${roomId}`,
                result: res.ok ? 'ok' : 'error',
                ...(res.ok ? {} : { error: JSON.stringify(res.data), statusCode: res.status }),
            });
            if (!res.ok)
                totalErrors++;
            break;
        }
        case 'comment.create': {
            const target = getRandomPostAndRoom();
            if (!target) {
                (0, sim_helpers_1.logAction)({ timestamp: ts, actor: actor.displayName, action: 'comment.create', resource: 'n/a', result: 'skip' });
                break;
            }
            const res = await (0, sim_helpers_1.apiCall)('POST', `/api/rooms/${target.roomId}/posts/${target.postId}/comments`, actor.token, { content: `Sim comment ${Date.now()}` });
            (0, sim_helpers_1.logAction)({
                timestamp: ts,
                actor: actor.displayName,
                action: 'comment.create',
                resource: `post:${target.postId}`,
                result: res.ok ? 'ok' : 'error',
                ...(res.ok ? {} : { error: JSON.stringify(res.data), statusCode: res.status }),
            });
            if (!res.ok)
                totalErrors++;
            break;
        }
        case 'reaction.add': {
            const target = getRandomPostAndRoom();
            if (!target) {
                (0, sim_helpers_1.logAction)({ timestamp: ts, actor: actor.displayName, action: 'reaction.add', resource: 'n/a', result: 'skip' });
                break;
            }
            const emoji = pickRandom(EMOJIS);
            const res = await (0, sim_helpers_1.apiCall)('POST', `/api/rooms/${target.roomId}/posts/${target.postId}/reactions`, actor.token, { emoji });
            (0, sim_helpers_1.logAction)({
                timestamp: ts,
                actor: actor.displayName,
                action: 'reaction.add',
                resource: `post:${target.postId}`,
                result: res.ok ? 'ok' : 'error',
                ...(res.ok ? {} : { error: JSON.stringify(res.data), statusCode: res.status }),
            });
            if (!res.ok)
                totalErrors++;
            break;
        }
        case 'like.add': {
            const target = getRandomPostAndRoom();
            if (!target) {
                (0, sim_helpers_1.logAction)({ timestamp: ts, actor: actor.displayName, action: 'like.add', resource: 'n/a', result: 'skip' });
                break;
            }
            const res = await (0, sim_helpers_1.apiCall)('POST', `/api/rooms/${target.roomId}/posts/${target.postId}/likes`, actor.token);
            (0, sim_helpers_1.logAction)({
                timestamp: ts,
                actor: actor.displayName,
                action: 'like.add',
                resource: `post:${target.postId}`,
                result: res.ok ? 'ok' : 'error',
                ...(res.ok ? {} : { error: JSON.stringify(res.data), statusCode: res.status }),
            });
            if (!res.ok)
                totalErrors++;
            break;
        }
        case 'follow': {
            const target = pickOtherUser(actor);
            if (!target) {
                (0, sim_helpers_1.logAction)({ timestamp: ts, actor: actor.displayName, action: 'follow', resource: 'n/a', result: 'skip' });
                break;
            }
            const res = await (0, sim_helpers_1.apiCall)('POST', `/api/social/follow/${target.userId}`, actor.token);
            // 409 = already following, treat as ok (idempotent)
            const isOk = res.ok || res.status === 409;
            (0, sim_helpers_1.logAction)({
                timestamp: ts,
                actor: actor.displayName,
                action: 'follow',
                resource: `user:${target.userId}`,
                result: isOk ? 'ok' : 'error',
                ...(isOk ? {} : { error: JSON.stringify(res.data), statusCode: res.status }),
            });
            if (!isOk)
                totalErrors++;
            break;
        }
        case 'room.create': {
            const res = await (0, sim_helpers_1.apiCall)('POST', '/api/rooms', actor.token, {
                name: `Sim Room ${Date.now()}`,
            });
            if (res.ok && res.data?.roomId) {
                roomIds.push(res.data.roomId);
            }
            (0, sim_helpers_1.logAction)({
                timestamp: ts,
                actor: actor.displayName,
                action: 'room.create',
                resource: res.data?.roomId ? `room:${res.data.roomId}` : 'n/a',
                result: res.ok ? 'ok' : 'error',
                ...(res.ok ? {} : { error: JSON.stringify(res.data), statusCode: res.status }),
            });
            if (!res.ok)
                totalErrors++;
            break;
        }
    }
}
// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
    const { users: userCount, duration } = (0, sim_helpers_1.parseArgs)(process.argv);
    const config = (0, sim_helpers_1.loadEnvReal)(path_1.default.resolve(__dirname, '..'));
    const startTime = Date.now();
    // Phase 1: Provision users
    for (let i = 0; i < userCount; i++) {
        try {
            const user = await (0, sim_helpers_1.createSimUser)(config, i);
            users.push(user);
            (0, sim_helpers_1.logAction)({
                timestamp: new Date().toISOString(),
                actor: user.displayName,
                action: 'user.create',
                resource: user.email,
                result: 'ok',
            });
        }
        catch (err) {
            (0, sim_helpers_1.logAction)({
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
        (0, sim_helpers_1.logAction)({
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
            const res = await (0, sim_helpers_1.apiCall)('POST', '/api/profiles', user.token, {
                displayName: user.displayName,
                bio: 'Simulated user',
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
            if (!res.ok)
                totalErrors++;
        }
        catch (err) {
            (0, sim_helpers_1.logAction)({
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
            const res = await (0, sim_helpers_1.apiCall)('POST', '/api/rooms', firstUser.token, {
                name: `Sim Room ${r}`,
            });
            if (res.ok && res.data?.roomId) {
                roomIds.push(res.data.roomId);
                postIdsByRoom.set(res.data.roomId, []);
            }
            (0, sim_helpers_1.logAction)({
                timestamp: new Date().toISOString(),
                actor: firstUser.displayName,
                action: 'room.create',
                resource: res.data?.roomId ? `room:${res.data.roomId}` : 'n/a',
                result: res.ok ? 'ok' : 'error',
                ...(res.ok ? {} : { error: JSON.stringify(res.data), statusCode: res.status }),
            });
            if (!res.ok)
                totalErrors++;
        }
        catch (err) {
            (0, sim_helpers_1.logAction)({
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
                const res = await (0, sim_helpers_1.apiCall)('POST', `/api/rooms/${roomId}/join`, user.token);
                (0, sim_helpers_1.logAction)({
                    timestamp: new Date().toISOString(),
                    actor: user.displayName,
                    action: 'room.join',
                    resource: `room:${roomId}`,
                    result: res.ok ? 'ok' : 'error',
                    ...(res.ok ? {} : { error: JSON.stringify(res.data), statusCode: res.status }),
                });
                if (!res.ok)
                    totalErrors++;
            }
            catch (err) {
                (0, sim_helpers_1.logAction)({
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
        }
        catch (err) {
            (0, sim_helpers_1.logAction)({
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
        await (0, sim_helpers_1.sleep)(randomDelay());
    }
    // Teardown: Summary
    const durationSec = Math.round((Date.now() - startTime) / 1000);
    (0, sim_helpers_1.logAction)({
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
    (0, sim_helpers_1.logAction)({
        timestamp: new Date().toISOString(),
        actor: 'simulator',
        action: 'fatal',
        resource: 'n/a',
        result: 'error',
        error: String(err),
    });
    process.exit(1);
});
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic2ltdWxhdGUtYWN0aXZpdHkuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJzaW11bGF0ZS1hY3Rpdml0eS50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOztBQUNBOzs7Ozs7Ozs7O0dBVUc7Ozs7O0FBRUgsZ0RBQXdCO0FBQ3hCLG1EQVEyQjtBQUUzQixnRkFBZ0Y7QUFFaEYsTUFBTSxLQUFLLEdBQWMsRUFBRSxDQUFDO0FBQzVCLE1BQU0sT0FBTyxHQUFhLEVBQUUsQ0FBQztBQUM3QixNQUFNLGFBQWEsR0FBMEIsSUFBSSxHQUFHLEVBQUUsQ0FBQztBQUV2RCxnRkFBZ0Y7QUFFaEYsSUFBSSxZQUFZLEdBQUcsQ0FBQyxDQUFDO0FBQ3JCLElBQUksV0FBVyxHQUFHLENBQUMsQ0FBQztBQVNwQixNQUFNLGNBQWMsR0FBcUI7SUFDdkMsRUFBRSxJQUFJLEVBQUUsYUFBYSxFQUFFLE1BQU0sRUFBRSxFQUFFLEVBQUU7SUFDbkMsRUFBRSxJQUFJLEVBQUUsZ0JBQWdCLEVBQUUsTUFBTSxFQUFFLEVBQUUsRUFBRTtJQUN0QyxFQUFFLElBQUksRUFBRSxjQUFjLEVBQUUsTUFBTSxFQUFFLEVBQUUsRUFBRTtJQUNwQyxFQUFFLElBQUksRUFBRSxVQUFVLEVBQUUsTUFBTSxFQUFFLEVBQUUsRUFBRTtJQUNoQyxFQUFFLElBQUksRUFBRSxRQUFRLEVBQUUsTUFBTSxFQUFFLEVBQUUsRUFBRTtJQUM5QixFQUFFLElBQUksRUFBRSxhQUFhLEVBQUUsTUFBTSxFQUFFLENBQUMsRUFBRTtDQUNuQyxDQUFDO0FBRUYsTUFBTSxZQUFZLEdBQUcsY0FBYyxDQUFDLE1BQU0sQ0FBQyxDQUFDLEdBQUcsRUFBRSxDQUFDLEVBQUUsRUFBRSxDQUFDLEdBQUcsR0FBRyxDQUFDLENBQUMsTUFBTSxFQUFFLENBQUMsQ0FBQyxDQUFDO0FBRTFFLFNBQVMsa0JBQWtCO0lBQ3pCLElBQUksSUFBSSxHQUFHLElBQUksQ0FBQyxNQUFNLEVBQUUsR0FBRyxZQUFZLENBQUM7SUFDeEMs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O1lBQ25CLFdBQVc7U0FDWjtLQUNGLENBQUMsQ0FBQztBQUNMLENBQUM7QUFFRCxJQUFJLEVBQUUsQ0FBQyxLQUFLLENBQUMsQ0FBQyxHQUFHLEVBQUUsRUFBRTtJQUNuQixJQUFBLHVCQUFTLEVBQUM7UUFDUixTQUFTLEVBQUUsSUFBSSxJQUFJLEVBQUUsQ0FBQyxXQUFXLEVBQUU7UUFDbkMsS0FBSyxFQUFFLFdBQVc7UUFDbEIsTUFBTSxFQUFFLE9BQU87UUFDZixRQUFRLEVBQUUsS0FBSztRQUNmLE1BQU0sRUFBRSxPQUFPO1FBQ2YsS0FBSyxFQUFFLE1BQU0sQ0FBQyxHQUFHLENBQUM7S0FDbkIsQ0FBQyxDQUFDO0lBQ0gsT0FBTyxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUMsQ0FBQztBQUNsQixDQUFDLENBQUMsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbIiMhL3Vzci9iaW4vZW52IG5weCB0c3ggLS10c2NvbmZpZyBzY3JpcHRzL3RzY29uZmlnLnNjcmlwdHMuanNvblxuLyoqXG4gKiBSYW5kb20gYWN0aXZpdHkgc2ltdWxhdGlvbiBzY3JpcHQuXG4gKlxuICogUHJvdmlzaW9ucyBOIENvZ25pdG8gdXNlcnMsIGF1dGhlbnRpY2F0ZXMgdGhlbSwgY3JlYXRlcyBwcm9maWxlcyBhbmQgcm9vbXMsXG4gKiB0aGVuIGRyaXZlcyB3ZWlnaHRlZCByYW5kb20gc29jaWFsIGFjdGlvbnMgZm9yIGEgY29uZmlndXJhYmxlIGR1cmF0aW9uLlxuICogRXZlcnkgYWN0aW9uIGlzIGxvZ2dlZCBhcyBhIEpTT04gbGluZSB0byBzdGRvdXQuXG4gKlxuICogVXNhZ2U6XG4gKiAgIG5weCB0c3ggc2NyaXB0cy9zaW11bGF0ZS1hY3Rpdml0eS50cyAtLXVzZXJzIDUgLS1kdXJhdGlvbiA2MFxuICogICAuL3NjcmlwdHMvc2ltdWxhdGUtYWN0aXZpdHkuc2ggLS11c2VycyA1IC0tZHVyYXRpb24gNjBcbiAqL1xuXG5pbXBvcnQgcGF0aCBmcm9tICdwYXRoJztcbmltcG9ydCB7XG4gIGNyZWF0ZVNpbVVzZXIsXG4gIGxvZ0FjdGlvbixcbiAgYXBpQ2FsbCxcbiAgbG9hZEVudlJlYWwsXG4gIHBhcnNlQXJncyxcbiAgc2xlZXAsXG4gIFNpbVVzZXIsXG59IGZyb20gJy4vbGliL3NpbS1oZWxwZXJzJztcblxuLy8g4pSA4pSAIFN0YXRlIOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgFxuXG5jb25zdCB1c2VyczogU2ltVXNlcltdID0gW107XG5jb25zdCByb29tSWRzOiBzdHJpbmdbXSA9IFtdO1xuY29uc3QgcG9zdElkc0J5Um9vbTogTWFwPHN0cmluZywgc3RyaW5nW10+ID0gbmV3IE1hcCgpO1xuXG4vLyDilIDilIAgQ291bnRlcnMg4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSAXG5cbmxldCB0b3RhbEFjdGlvbnMgPSAwO1xubGV0IHRvdGFsRXJyb3JzID0gMDtcblxuLy8g4pSA4pSAIFdlaWdodGVkIEFjdGlvbiBTZWxlY3Rpb24g4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSAXG5cbmludGVyZmFjZSBXZWlnaHRlZEFjdGlvbiB7XG4gIHR5cGU6IHN0cmluZztcbiAgd2VpZ2h0OiBudW1iZXI7XG59XG5cbmNvbnN0IEFDVElPTl9XRUlHSFRTOiBXZWlnaHRlZEFjdGlvbltdID0gW1xuICB7IHR5cGU6ICdwb3N0LmNyZWF0ZScsIHdlaWdodDogMzAgfSxcbiAgeyB0eXBlOiAnY29tbWVudC5jcmVhdGUnLCB3ZWlnaHQ6IDIwIH0sXG4gIHsgdHlwZTogJ3JlYWN0aW9uLmFkZCcsIHdlaWdodDogMjAgfSxcbiAgeyB0eXBlOiAnbGlrZS5hZGQnLCB3ZWlnaHQ6IDE1IH0sXG4gIHsgdHlwZTogJ2ZvbGxvdycsIHdlaWdodDogMTAgfSxcbiAgeyB0eXBlOiAncm9vbS5jcmVhdGUnLCB3ZWlnaHQ6IDUgfSxcbl07XG5cbmNvbnN0IFRPVEFMX1dFSUdIVCA9IEFDVElPTl9XRUlHSFRTLnJlZHVjZSgoc3VtLCBhKSA9PiBzdW0gKyBhLndlaWdodCwgMCk7XG5cbmZ1bmN0aW9uIHBpY2tXZWlnaHRlZEFjdGlvbigpOiBzdHJpbmcge1xuICBsZXQgcmFuZCA9IE1hdGgucmFuZG9tKCkgKiBUT1RBTF9XRUlHSFQ7XG4gIGZvciAoY29uc3QgZW50cnkgb2YgQUNUSU9OX1dFSUdIVFMpIHtcbiAgICByYW5kIC09IGVudHJ5LndlaWdodDtcbiAgICBpZiAocmFuZCA8PSAwKSByZXR1cm4gZW50cnkudHlwZTtcbiAgfVxuICByZXR1cm4gQUNUSU9OX1dFSUdIVFNbMF0udHlwZTtcbn1cblxuLy8g4pSA4pSAIEhlbHBlcnMg4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSAXG5cbmNvbnN0IEVNT0pJUyA9IFsn4p2k77iPJywgJ/CfmIInLCAn8J+RjScsICfwn5iuJywgJ/CfmKInLCAn8J+UpScsICfwn46JJywgJ/CfmoAnXTtcblxuZnVuY3Rpb24gcGlja1JhbmRvbTxUPihhcnI6IFRbXSk6IFQge1xuICByZXR1cm4gYXJyW01hdGguZmxvb3IoTWF0aC5yYW5kb20oKSAqIGFyci5sZW5ndGgpXTtcbn1cblxuZnVuY3Rpb24gcGlja090aGVyVXNlcihhY3RvcjogU2ltVXNlcik6IFNpbVVzZXIgfCBudWxsIHtcbiAgY29uc3Qgb3RoZXJzID0gdXNlcnMuZmlsdGVyKCh1KSA9PiB1LnVzZXJJZCAhPT0gYWN0b3IudXNlcklkKTtcbiAgcmV0dXJuIG90aGVycy5sZW5ndGggPiAwID8gcGlja1JhbmRvbShvdGhlcnMpIDogbnVsbDtcbn1cblxuZnVuY3Rpb24gZ2V0UmFuZG9tUG9zdEFuZFJvb20oKTogeyByb29tSWQ6IHN0cmluZzsgcG9zdElkOiBzdHJpbmcgfSB8IG51bGwge1xuICBjb25zdCBlbnRyaWVzID0gQXJyYXkuZnJvbShwb3N0SWRzQnlSb29tLmVudHJpZXMoKSkuZmlsdGVyKFxuICAgIChbLCBwb3N0c10pID0+IHBvc3RzLmxlbmd0aCA+IDAsXG4gICk7XG4gIGlmIChlbnRyaWVzLmxlbmd0aCA9PT0gMCkgcmV0dXJuIG51bGw7XG4gIGNvbnN0IFtyb29tSWQsIHBvc3RzXSA9IHBpY2tSYW5kb20oZW50cmllcyk7XG4gIGNvbnN0IHBvc3RJZCA9IHBpY2tSYW5kb20ocG9zdHMpO1xuICByZXR1cm4geyByb29tSWQsIHBvc3RJZCB9O1xufVxuXG5mdW5jdGlvbiByYW5kb21EZWxheSgpOiBudW1iZXIge1xuICByZXR1cm4gNTAwICsgTWF0aC5mbG9vcihNYXRoLnJhbmRvbSgpICogMTUwMCk7IC8vIDUwMC0yMDAwbXNcbn1cblxuLy8g4pSA4pSAIEFjdGlvbiBFeGVjdXRvcnMg4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSAXG5cbmFzeW5jIGZ1bmN0aW9uIGV4ZWN1dGVBY3Rpb24oYWN0aW9uVHlwZTogc3RyaW5nLCBhY3RvcjogU2ltVXNlcik6IFByb21pc2U8dm9pZD4ge1xuICBjb25zdCB0cyA9IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKTtcbiAgdG90YWxBY3Rpb25zKys7XG5cbiAgc3dpdGNoIChhY3Rpb25UeXBlKSB7XG4gICAgY2FzZSAncG9zdC5jcmVhdGUnOiB7XG4gICAgICBjb25zdCByb29tSWQgPSBwaWNrUmFuZG9tKHJvb21JZHMpO1xuICAgICAgY29uc3QgcmVzID0gYXdhaXQgYXBpQ2FsbCgnUE9TVCcsIGAvYXBpL3Jvb21zLyR7cm9vbUlkfS9wb3N0c2AsIGFjdG9yLnRva2VuLCB7XG4gICAgICAgIGNvbnRlbnQ6IGBTaW0gcG9zdCBhdCAke25ldyBEYXRlKCkudG9JU09TdHJpbmcoKX1gLFxuICAgICAgfSk7XG4gICAgICBpZiAocmVzLm9rICYmIHJlcy5kYXRhPy5wb3N0SWQpIHtcbiAgICAgICAgY29uc3QgcG9zdHMgPSBwb3N0SWRzQnlSb29tLmdldChyb29tSWQpID8/IFtdO1xuICAgICAgICBwb3N0cy5wdXNoKHJlcy5kYXRhLnBvc3RJZCk7XG4gICAgICAgIC8vIENhcCBhdCA1MCBwb3N0cyBwZXIgcm9vbVxuICAgICAgICBpZiAocG9zdHMubGVuZ3RoID4gNTApIHBvc3RzLnNoaWZ0KCk7XG4gICAgICAgIHBvc3RJZHNCeVJvb20uc2V0KHJvb21JZCwgcG9zdHMpO1xuICAgICAgfVxuICAgICAgbG9nQWN0aW9uKHtcbiAgICAgICAgdGltZXN0YW1wOiB0cyxcbiAgICAgICAgYWN0b3I6IGFjdG9yLmRpc3BsYXlOYW1lLFxuICAgICAgICBhY3Rpb246ICdwb3N0LmNyZWF0ZScsXG4gICAgICAgIHJlc291cmNlOiBgcm9vbToke3Jvb21JZH1gLFxuICAgICAgICByZXN1bHQ6IHJlcy5vayA/ICdvaycgOiAnZXJyb3InLFxuICAgICAgICAuLi4ocmVzLm9rID8ge30gOiB7IGVycm9yOiBKU09OLnN0cmluZ2lmeShyZXMuZGF0YSksIHN0YXR1c0NvZGU6IHJlcy5zdGF0dXMgfSksXG4gICAgICB9KTtcbiAgICAgIGlmICghcmVzLm9rKSB0b3RhbEVycm9ycysrO1xuICAgICAgYnJlYWs7XG4gICAgfVxuXG4gICAgY2FzZSAnY29tbWVudC5jcmVhdGUnOiB7XG4gICAgICBjb25zdCB0YXJnZXQgPSBnZXRSYW5kb21Qb3N0QW5kUm9vbSgpO1xuICAgICAgaWYgKCF0YXJnZXQpIHtcbiAgICAgICAgbG9nQWN0aW9uKHsgdGltZXN0YW1wOiB0cywgYWN0b3I6IGFjdG9yLmRpc3BsYXlOYW1lLCBhY3Rpb246ICdjb21tZW50LmNyZWF0ZScsIHJlc291cmNlOiAnbi9hJywgcmVzdWx0OiAnc2tpcCcgfSk7XG4gICAgICAgIGJyZWFrO1xuICAgICAgfVxuICAgICAgY29uc3QgcmVzID0gYXdhaXQgYXBpQ2FsbChcbiAgICAgICAgJ1BPU1QnLFxuICAgICAgICBgL2FwaS9yb29tcy8ke3RhcmdldC5yb29tSWR9L3Bvc3RzLyR7dGFyZ2V0LnBvc3RJZH0vY29tbWVudHNgLFxuICAgICAgICBhY3Rvci50b2tlbixcbiAgICAgICAgeyBjb250ZW50OiBgU2ltIGNvbW1lbnQgJHtEYXRlLm5vdygpfWAgfSxcbiAgICAgICk7XG4gICAgICBsb2dBY3Rpb24oe1xuICAgICAgICB0aW1lc3RhbXA6IHRzLFxuICAgICAgICBhY3RvcjogYWN0b3IuZGlzcGxheU5hbWUsXG4gICAgICAgIGFjdGlvbjogJ2NvbW1lbnQuY3JlYXRlJyxcbiAgICAgICAgcmVzb3VyY2U6IGBwb3N0OiR7dGFyZ2V0LnBvc3RJZH1gLFxuICAgICAgICByZXN1bHQ6IHJlcy5vayA/ICdvaycgOiAnZXJyb3InLFxuICAgICAgICAuLi4ocmVzLm9rID8ge30gOiB7IGVycm9yOiBKU09OLnN0cmluZ2lmeShyZXMuZGF0YSksIHN0YXR1c0NvZGU6IHJlcy5zdGF0dXMgfSksXG4gICAgICB9KTtcbiAgICAgIGlmICghcmVzLm9rKSB0b3RhbEVycm9ycysrO1xuICAgICAgYnJlYWs7XG4gICAgfVxuXG4gICAgY2FzZSAncmVhY3Rpb24uYWRkJzoge1xuICAgICAgY29uc3QgdGFyZ2V0ID0gZ2V0UmFuZG9tUG9zdEFuZFJvb20oKTtcbiAgICAgIGlmICghdGFyZ2V0KSB7XG4gICAgICAgIGxvZ0FjdGlvbih7IHRpbWVzdGFtcDogdHMsIGFjdG9yOiBhY3Rvci5kaXNwbGF5TmFtZSwgYWN0aW9uOiAncmVhY3Rpb24uYWRkJywgcmVzb3VyY2U6ICduL2EnLCByZXN1bHQ6ICdza2lwJyB9KTtcbiAgICAgICAgYnJlYWs7XG4gICAgICB9XG4gICAgICBjb25zdCBlbW9qaSA9IHBpY2tSYW5kb20oRU1PSklTKTtcbiAgICAgIGNvbnN0IHJlcyA9IGF3YWl0IGFwaUNhbGwoXG4gICAgICAgICdQT1NUJyxcbiAgICAgICAgYC9hcGkvcm9vbXMvJHt0YXJnZXQucm9vbUlkfS9wb3N0cy8ke3RhcmdldC5wb3N0SWR9L3JlYWN0aW9uc2AsXG4gICAgICAgIGFjdG9yLnRva2VuLFxuICAgICAgICB7IGVtb2ppIH0sXG4gICAgICApO1xuICAgICAgbG9nQWN0aW9uKHtcbiAgICAgICAgdGltZXN0YW1wOiB0cyxcbiAgICAgICAgYWN0b3I6IGFjdG9yLmRpc3BsYXlOYW1lLFxuICAgICAgICBhY3Rpb246ICdyZWFjdGlvbi5hZGQnLFxuICAgICAgICByZXNvdXJjZTogYHBvc3Q6JHt0YXJnZXQucG9zdElkfWAsXG4gICAgICAgIHJlc3VsdDogcmVzLm9rID8gJ29rJyA6ICdlcnJvcicsXG4gICAgICAgIC4uLihyZXMub2sgPyB7fSA6IHsgZXJyb3I6IEpTT04uc3RyaW5naWZ5KHJlcy5kYXRhKSwgc3RhdHVzQ29kZTogcmVzLnN0YXR1cyB9KSxcbiAgICAgIH0pO1xuICAgICAgaWYgKCFyZXMub2spIHRvdGFsRXJyb3JzKys7XG4gICAgICBicmVhaztcbiAgICB9XG5cbiAgICBjYXNlICdsaWtlLmFkZCc6IHtcbiAgICAgIGNvbnN0IHRhcmdldCA9IGdldFJhbmRvbVBvc3RBbmRSb29tKCk7XG4gICAgICBpZiAoIXRhcmdldCkge1xuICAgICAgICBsb2dBY3Rpb24oeyB0aW1lc3RhbXA6IHRzLCBhY3RvcjogYWN0b3IuZGlzcGxheU5hbWUsIGFjdGlvbjogJ2xpa2UuYWRkJywgcmVzb3VyY2U6ICduL2EnLCByZXN1bHQ6ICdza2lwJyB9KTtcbiAgICAgICAgYnJlYWs7XG4gICAgICB9XG4gICAgICBjb25zdCByZXMgPSBhd2FpdCBhcGlDYWxsKFxuICAgICAgICAnUE9TVCcsXG4gICAgICAgIGAvYXBpL3Jvb21zLyR7dGFyZ2V0LnJvb21JZH0vcG9zdHMvJHt0YXJnZXQucG9zdElkfS9saWtlc2AsXG4gICAgICAgIGFjdG9yLnRva2VuLFxuICAgICAgKTtcbiAgICAgIGxvZ0FjdGlvbih7XG4gICAgICAgIHRpbWVzdGFtcDogdHMsXG4gICAgICAgIGFjdG9yOiBhY3Rvci5kaXNwbGF5TmFtZSxcbiAgICAgICAgYWN0aW9uOiAnbGlrZS5hZGQnLFxuICAgICAgICByZXNvdXJjZTogYHBvc3Q6JHt0YXJnZXQucG9zdElkfWAsXG4gICAgICAgIHJlc3VsdDogcmVzLm9rID8gJ29rJyA6ICdlcnJvcicsXG4gICAgICAgIC4uLihyZXMub2sgPyB7fSA6IHsgZXJyb3I6IEpTT04uc3RyaW5naWZ5KHJlcy5kYXRhKSwgc3RhdHVzQ29kZTogcmVzLnN0YXR1cyB9KSxcbiAgICAgIH0pO1xuICAgICAgaWYgKCFyZXMub2spIHRvdGFsRXJyb3JzKys7XG4gICAgICBicmVhaztcbiAgICB9XG5cbiAgICBjYXNlICdmb2xsb3cnOiB7XG4gICAgICBjb25zdCB0YXJnZXQgPSBwaWNrT3RoZXJVc2VyKGFjdG9yKTtcbiAgICAgIGlmICghdGFyZ2V0KSB7XG4gICAgICAgIGxvZ0FjdGlvbih7IHRpbWVzdGFtcDogdHMsIGFjdG9yOiBhY3Rvci5kaXNwbGF5TmFtZSwgYWN0aW9uOiAnZm9sbG93JywgcmVzb3VyY2U6ICduL2EnLCByZXN1bHQ6ICdza2lwJyB9KTtcbiAgICAgICAgYnJlYWs7XG4gICAgICB9XG4gICAgICBjb25zdCByZXMgPSBhd2FpdCBhcGlDYWxsKFxuICAgICAgICAnUE9TVCcsXG4gICAgICAgIGAvYXBpL3NvY2lhbC9mb2xsb3cvJHt0YXJnZXQudXNlcklkfWAsXG4gICAgICAgIGFjdG9yLnRva2VuLFxuICAgICAgKTtcbiAgICAgIC8vIDQwOSA9IGFscmVhZHkgZm9sbG93aW5nLCB0cmVhdCBhcyBvayAoaWRlbXBvdGVudClcbiAgICAgIGNvbnN0IGlzT2sgPSByZXMub2sgfHwgcmVzLnN0YXR1cyA9PT0gNDA5O1xuICAgICAgbG9nQWN0aW9uKHtcbiAgICAgICAgdGltZXN0YW1wOiB0cyxcbiAgICAgICAgYWN0b3I6IGFjdG9yLmRpc3BsYXlOYW1lLFxuICAgICAgICBhY3Rpb246ICdmb2xsb3cnLFxuICAgICAgICByZXNvdXJjZTogYHVzZXI6JHt0YXJnZXQudXNlcklkfWAsXG4gICAgICAgIHJlc3VsdDogaXNPayA/ICdvaycgOiAnZXJyb3InLFxuICAgICAgICAuLi4oaXNPayA/IHt9IDogeyBlcnJvcjogSlNPTi5zdHJpbmdpZnkocmVzLmRhdGEpLCBzdGF0dXNDb2RlOiByZXMuc3RhdHVzIH0pLFxuICAgICAgfSk7XG4gICAgICBpZiAoIWlzT2spIHRvdGFsRXJyb3JzKys7XG4gICAgICBicmVhaztcbiAgICB9XG5cbiAgICBjYXNlICdyb29tLmNyZWF0ZSc6IHtcbiAgICAgIGNvbnN0IHJlcyA9IGF3YWl0IGFwaUNhbGwoJ1BPU1QnLCAnL2FwaS9yb29tcycsIGFjdG9yLnRva2VuLCB7XG4gICAgICAgIG5hbWU6IGBTaW0gUm9vbSAke0RhdGUubm93KCl9YCxcbiAgICAgIH0pO1xuICAgICAgaWYgKHJlcy5vayAmJiByZXMuZGF0YT8ucm9vbUlkKSB7XG4gICAgICAgIHJvb21JZHMucHVzaChyZXMuZGF0YS5yb29tSWQpO1xuICAgICAgfVxuICAgICAgbG9nQWN0aW9uKHtcbiAgICAgICAgdGltZXN0YW1wOiB0cyxcbiAgICAgICAgYWN0b3I6IGFjdG9yLmRpc3BsYXlOYW1lLFxuICAgICAgICBhY3Rpb246ICdyb29tLmNyZWF0ZScsXG4gICAgICAgIHJlc291cmNlOiByZXMuZGF0YT8ucm9vbUlkID8gYHJvb206JHtyZXMuZGF0YS5yb29tSWR9YCA6ICduL2EnLFxuICAgICAgICByZXN1bHQ6IHJlcy5vayA/ICdvaycgOiAnZXJyb3InLFxuICAgICAgICAuLi4ocmVzLm9rID8ge30gOiB7IGVycm9yOiBKU09OLnN0cmluZ2lmeShyZXMuZGF0YSksIHN0YXR1c0NvZGU6IHJlcy5zdGF0dXMgfSksXG4gICAgICB9KTtcbiAgICAgIGlmICghcmVzLm9rKSB0b3RhbEVycm9ycysrO1xuICAgICAgYnJlYWs7XG4gICAgfVxuICB9XG59XG5cbi8vIOKUgOKUgCBNYWluIOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgFxuXG5hc3luYyBmdW5jdGlvbiBtYWluKCk6IFByb21pc2U8dm9pZD4ge1xuICBjb25zdCB7IHVzZXJzOiB1c2VyQ291bnQsIGR1cmF0aW9uIH0gPSBwYXJzZUFyZ3MocHJvY2Vzcy5hcmd2KTtcbiAgY29uc3QgY29uZmlnID0gbG9hZEVudlJlYWwocGF0aC5yZXNvbHZlKF9fZGlybmFtZSwgJy4uJykpO1xuXG4gIGNvbnN0IHN0YXJ0VGltZSA9IERhdGUubm93KCk7XG5cbiAgLy8gUGhhc2UgMTogUHJvdmlzaW9uIHVzZXJzXG4gIGZvciAobGV0IGkgPSAwOyBpIDwgdXNlckNvdW50OyBpKyspIHtcbiAgICB0cnkge1xuICAgICAgY29uc3QgdXNlciA9IGF3YWl0IGNyZWF0ZVNpbVVzZXIoY29uZmlnLCBpKTtcbiAgICAgIHVzZXJzLnB1c2godXNlcik7XG4gICAgICBsb2dBY3Rpb24oe1xuICAgICAgICB0aW1lc3RhbXA6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKSxcbiAgICAgICAgYWN0b3I6IHVzZXIuZGlzcGxheU5hbWUsXG4gICAgICAgIGFjdGlvbjogJ3VzZXIuY3JlYXRlJyxcbiAgICAgICAgcmVzb3VyY2U6IHVzZXIuZW1haWwsXG4gICAgICAgIHJlc3VsdDogJ29rJyxcbiAgICAgIH0pO1xuICAgIH0gY2F0Y2ggKGVycikge1xuICAgICAgbG9nQWN0aW9uKHtcbiAgICAgICAgdGltZXN0YW1wOiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCksXG4gICAgICAgIGFjdG9yOiBgU2ltIFVzZXIgJHtpfWAsXG4gICAgICAgIGFjdGlvbjogJ3VzZXIuY3JlYXRlJyxcbiAgICAgICAgcmVzb3VyY2U6IGB1c2VyLSR7aX1gLFxuICAgICAgICByZXN1bHQ6ICdlcnJvcicsXG4gICAgICAgIGVycm9yOiBTdHJpbmcoZXJyKSxcbiAgICAgIH0pO1xuICAgICAgdG90YWxFcnJvcnMrKztcbiAgICAgIC8vIENvbnRpbnVlIHByb3Zpc2lvbmluZyByZW1haW5pbmcgdXNlcnNcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgfVxuXG4gIGlmICh1c2Vycy5sZW5ndGggPT09IDApIHtcbiAgICBsb2dBY3Rpb24oe1xuICAgICAgdGltZXN0YW1wOiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCksXG4gICAgICBhY3RvcjogJ3NpbXVsYXRvcicsXG4gICAgICBhY3Rpb246ICdhYm9ydCcsXG4gICAgICByZXNvdXJjZTogJ24vYScsXG4gICAgICByZXN1bHQ6ICdlcnJvcicsXG4gICAgICBlcnJvcjogJ05vIHVzZXJzIGNvdWxkIGJlIHByb3Zpc2lvbmVkJyxcbiAgICB9KTtcbiAgICBwcm9jZXNzLmV4aXQoMSk7XG4gIH1cblxuICAvLyBQaGFzZSAyOiBDcmVhdGUgcHJvZmlsZXNcbiAgZm9yIChjb25zdCB1c2VyIG9mIHVzZXJzKSB7XG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IHJlcyA9IGF3YWl0IGFwaUNhbGwoJ1BPU1QnLCAnL2FwaS9wcm9maWxlcycsIHVzZXIudG9rZW4sIHtcbiAgICAgICAgZGlzcGxheU5hbWU6IHVzZXIuZGlzcGxheU5hbWUsXG4gICAgICAgIGJpbzogJ1NpbXVsYXRlZCB1c2VyJyxcbiAgICAgICAgYXZhdGFyVXJsOiAnJyxcbiAgICAgIH0pO1xuICAgICAgbG9nQWN0aW9uKHtcbiAgICAgICAgdGltZXN0YW1wOiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCksXG4gICAgICAgIGFjdG9yOiB1c2VyLmRpc3BsYXlOYW1lLFxuICAgICAgICBhY3Rpb246ICdwcm9maWxlLmNyZWF0ZScsXG4gICAgICAgIHJlc291cmNlOiB1c2VyLnVzZXJJZCxcbiAgICAgICAgcmVzdWx0OiByZXMub2sgPyAnb2snIDogJ2Vycm9yJyxcbiAgICAgICAgLi4uKHJlcy5vayA/IHt9IDogeyBlcnJvcjogSlNPTi5zdHJpbmdpZnkocmVzLmRhdGEpLCBzdGF0dXNDb2RlOiByZXMuc3RhdHVzIH0pLFxuICAgICAgfSk7XG4gICAgICBpZiAoIXJlcy5vaykgdG90YWxFcnJvcnMrKztcbiAgICB9IGNhdGNoIChlcnIpIHtcbiAgICAgIGxvZ0FjdGlvbih7XG4gICAgICAgIHRpbWVzdGFtcDogbmV3IERhdGUoKS50b0lTT1N0cmluZygpLFxuICAgICAgICBhY3RvcjogdXNlci5kaXNwbGF5TmFtZSxcbiAgICAgICAgYWN0aW9uOiAncHJvZmlsZS5jcmVhdGUnLFxuICAgICAgICByZXNvdXJjZTogdXNlci51c2VySWQsXG4gICAgICAgIHJlc3VsdDogJ2Vycm9yJyxcbiAgICAgICAgZXJyb3I6IFN0cmluZyhlcnIpLFxuICAgICAgfSk7XG4gICAgICB0b3RhbEVycm9ycysrO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICB9XG5cbiAgLy8gUGhhc2UgMzogQ3JlYXRlIHNoYXJlZCBpbmZyYXN0cnVjdHVyZSAocm9vbXMpXG4gIGNvbnN0IGZpcnN0VXNlciA9IHVzZXJzWzBdO1xuXG4gIGZvciAobGV0IHIgPSAxOyByIDw9IDI7IHIrKykge1xuICAgIHRyeSB7XG4gICAgICBjb25zdCByZXMgPSBhd2FpdCBhcGlDYWxsKCdQT1NUJywgJy9hcGkvcm9vbXMnLCBmaXJzdFVzZXIudG9rZW4sIHtcbiAgICAgICAgbmFtZTogYFNpbSBSb29tICR7cn1gLFxuICAgICAgfSk7XG4gICAgICBpZiAocmVzLm9rICYmIHJlcy5kYXRhPy5yb29tSWQpIHtcbiAgICAgICAgcm9vbUlkcy5wdXNoKHJlcy5kYXRhLnJvb21JZCk7XG4gICAgICAgIHBvc3RJZHNCeVJvb20uc2V0KHJlcy5kYXRhLnJvb21JZCwgW10pO1xuICAgICAgfVxuICAgICAgbG9nQWN0aW9uKHtcbiAgICAgICAgdGltZXN0YW1wOiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCksXG4gICAgICAgIGFjdG9yOiBmaXJzdFVzZXIuZGlzcGxheU5hbWUsXG4gICAgICAgIGFjdGlvbjogJ3Jvb20uY3JlYXRlJyxcbiAgICAgICAgcmVzb3VyY2U6IHJlcy5kYXRhPy5yb29tSWQgPyBgcm9vbToke3Jlcy5kYXRhLnJvb21JZH1gIDogJ24vYScsXG4gICAgICAgIHJlc3VsdDogcmVzLm9rID8gJ29rJyA6ICdlcnJvcicsXG4gICAgICAgIC4uLihyZXMub2sgPyB7fSA6IHsgZXJyb3I6IEpTT04uc3RyaW5naWZ5KHJlcy5kYXRhKSwgc3RhdHVzQ29kZTogcmVzLnN0YXR1cyB9KSxcbiAgICAgIH0pO1xuICAgICAgaWYgKCFyZXMub2spIHRvdGFsRXJyb3JzKys7XG4gICAgfSBjYXRjaCAoZXJyKSB7XG4gICAgICBsb2dBY3Rpb24oe1xuICAgICAgICB0aW1lc3RhbXA6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKSxcbiAgICAgICAgYWN0b3I6IGZpcnN0VXNlci5kaXNwbGF5TmFtZSxcbiAgICAgICAgYWN0aW9uOiAncm9vbS5jcmVhdGUnLFxuICAgICAgICByZXNvdXJjZTogYHJvb20tJHtyfWAsXG4gICAgICAgIHJlc3VsdDogJ2Vycm9yJyxcbiAgICAgICAgZXJyb3I6IFN0cmluZyhlcnIpLFxuICAgICAgfSk7XG4gICAgICB0b3RhbEVycm9ycysrO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICB9XG5cbiAgLy8gQWxsIG90aGVyIHVzZXJzIGpvaW4gcm9vbXNcbiAgZm9yIChjb25zdCB1c2VyIG9mIHVzZXJzLnNsaWNlKDEpKSB7XG4gICAgZm9yIChjb25zdCByb29tSWQgb2Ygcm9vbUlkcykge1xuICAgICAgdHJ5IHtcbiAgICAgICAgY29uc3QgcmVzID0gYXdhaXQgYXBpQ2FsbCgnUE9TVCcsIGAvYXBpL3Jvb21zLyR7cm9vbUlkfS9qb2luYCwgdXNlci50b2tlbik7XG4gICAgICAgIGxvZ0FjdGlvbih7XG4gICAgICAgICAgdGltZXN0YW1wOiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCksXG4gICAgICAgICAgYWN0b3I6IHVzZXIuZGlzcGxheU5hbWUsXG4gICAgICAgICAgYWN0aW9uOiAncm9vbS5qb2luJyxcbiAgICAgICAgICByZXNvdXJjZTogYHJvb206JHtyb29tSWR9YCxcbiAgICAgICAgICByZXN1bHQ6IHJlcy5vayA/ICdvaycgOiAnZXJyb3InLFxuICAgICAgICAgIC4uLihyZXMub2sgPyB7fSA6IHsgZXJyb3I6IEpTT04uc3RyaW5naWZ5KHJlcy5kYXRhKSwgc3RhdHVzQ29kZTogcmVzLnN0YXR1cyB9KSxcbiAgICAgICAgfSk7XG4gICAgICAgIGlmICghcmVzLm9rKSB0b3RhbEVycm9ycysrO1xuICAgICAgfSBjYXRjaCAoZXJyKSB7XG4gICAgICAgIGxvZ0FjdGlvbih7XG4gICAgICAgICAgdGltZXN0YW1wOiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCksXG4gICAgICAgICAgYWN0b3I6IHVzZXIuZGlzcGxheU5hbWUsXG4gICAgICAgICAgYWN0aW9uOiAncm9vbS5qb2luJyxcbiAgICAgICAgICByZXNvdXJjZTogYHJvb206JHtyb29tSWR9YCxcbiAgICAgICAgICByZXN1bHQ6ICdlcnJvcicsXG4gICAgICAgICAgZXJyb3I6IFN0cmluZyhlcnIpLFxuICAgICAgICB9KTtcbiAgICAgICAgdG90YWxFcnJvcnMrKztcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgLy8gUGhhc2UgNDogQWN0aXZpdHkgbG9vcFxuICB3aGlsZSAoRGF0ZS5ub3coKSAtIHN0YXJ0VGltZSA8IGR1cmF0aW9uICogMTAwMCkge1xuICAgIGNvbnN0IGFjdG9yID0gcGlja1JhbmRvbSh1c2Vycyk7XG4gICAgY29uc3QgYWN0aW9uVHlwZSA9IHBpY2tXZWlnaHRlZEFjdGlvbigpO1xuXG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IGV4ZWN1dGVBY3Rpb24oYWN0aW9uVHlwZSwgYWN0b3IpO1xuICAgIH0gY2F0Y2ggKGVycikge1xuICAgICAgbG9nQWN0aW9uKHtcbiAgICAgICAgdGltZXN0YW1wOiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCksXG4gICAgICAgIGFjdG9yOiBhY3Rvci5kaXNwbGF5TmFtZSxcbiAgICAgICAgYWN0aW9uOiBhY3Rpb25UeXBlLFxuICAgICAgICByZXNvdXJjZTogJ24vYScsXG4gICAgICAgIHJlc3VsdDogJ2Vycm9yJyxcbiAgICAgICAgZXJyb3I6IFN0cmluZyhlcnIpLFxuICAgICAgfSk7XG4gICAgICB0b3RhbEVycm9ycysrO1xuICAgICAgLy8gQ29udGludWUgb24gZmFpbHVyZSDigJQgZG8gbm90IGFib3J0XG4gICAgICBjb250aW51ZTtcbiAgICB9XG5cbiAgICBhd2FpdCBzbGVlcChyYW5kb21EZWxheSgpKTtcbiAgfVxuXG4gIC8vIFRlYXJkb3duOiBTdW1tYXJ5XG4gIGNvbnN0IGR1cmF0aW9uU2VjID0gTWF0aC5yb3VuZCgoRGF0ZS5ub3coKSAtIHN0YXJ0VGltZSkgLyAxMDAwKTtcbiAgbG9nQWN0aW9uKHtcbiAgICB0aW1lc3RhbXA6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKSxcbiAgICBhY3RvcjogJ3NpbXVsYXRvcicsXG4gICAgYWN0aW9uOiAnc3VtbWFyeScsXG4gICAgcmVzb3VyY2U6ICduL2EnLFxuICAgIHJlc3VsdDogJ29rJyxcbiAgICBzdGF0czoge1xuICAgICAgdXNlcnM6IHVzZXJzLmxlbmd0aCxcbiAgICAgIHJvb21zOiByb29tSWRzLmxlbmd0aCxcbiAgICAgIHBvc3RzOiBBcnJheS5mcm9tKHBvc3RJZHNCeVJvb20udmFsdWVzKCkpLnJlZHVjZSgoc3VtLCBwKSA9PiBzdW0gKyBwLmxlbmd0aCwgMCksXG4gICAgICBhY3Rpb25zOiB0b3RhbEFjdGlvbnMsXG4gICAgICBlcnJvcnM6IHRvdGFsRXJyb3JzLFxuICAgICAgZHVyYXRpb25TZWMsXG4gICAgfSxcbiAgfSk7XG59XG5cbm1haW4oKS5jYXRjaCgoZXJyKSA9PiB7XG4gIGxvZ0FjdGlvbih7XG4gICAgdGltZXN0YW1wOiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCksXG4gICAgYWN0b3I6ICdzaW11bGF0b3InLFxuICAgIGFjdGlvbjogJ2ZhdGFsJyxcbiAgICByZXNvdXJjZTogJ24vYScsXG4gICAgcmVzdWx0OiAnZXJyb3InLFxuICAgIGVycm9yOiBTdHJpbmcoZXJyKSxcbiAgfSk7XG4gIHByb2Nlc3MuZXhpdCgxKTtcbn0pO1xuIl19