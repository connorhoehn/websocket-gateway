/**
 * Test: Stage CRUD API (Days 8-9)
 * Tests CreateStage, GetStage, ListStages, UpdateStage, DeleteStage + participant tokens
 */
const { assert } = require('./test-harness');

const BASE = process.env.SIGNALING_URL || 'http://localhost:3000';
async function api(method, path, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const r = await fetch(`${BASE}${path}`, opts);
  return { status: r.status, body: await r.json() };
}

async function main() {
  const result = { test: 'stage-crud', passed: false, metrics: {} };
  try {
    // 1. Create stage
    const create = await api('POST', '/api/stages', { name: 'test-stage', maxParticipants: 6 });
    assert(create.status === 200, `Create status: ${create.status}`);
    assert(create.body.stage.stageId.startsWith('stg_'), `Bad stageId: ${create.body.stage.stageId}`);
    assert(create.body.stage.state === 'IDLE', `State: ${create.body.stage.state}`);
    assert(create.body.stage.maxParticipants === 6, 'maxParticipants wrong');
    const stageId = create.body.stage.stageId;

    // 2. List stages
    const list = await api('GET', '/api/stages');
    assert(list.status === 200, 'List failed');
    assert(list.body.stages.some(s => s.stageId === stageId), 'Stage not in list');

    // 3. Get stage
    const get = await api('GET', `/api/stages/${stageId}`);
    assert(get.status === 200, 'Get failed');
    assert(get.body.stage.name === 'test-stage', `Name: ${get.body.stage.name}`);
    assert(get.body.stage.maxParticipants === 6, 'maxParticipants wrong');

    // 4. Update stage
    const patch = await api('PATCH', `/api/stages/${stageId}`, { name: 'renamed-stage' });
    assert(patch.status === 200, 'Patch failed');
    assert(patch.body.stage.name === 'renamed-stage', `Patched name: ${patch.body.stage.name}`);

    // 5. Create stage with participant tokens
    const create2 = await api('POST', '/api/stages', {
      name: 'token-stage',
      participantTokenConfigurations: [
        { userId: 'alice', capabilities: ['PUBLISH', 'SUBSCRIBE'] },
        { userId: 'bob', capabilities: ['SUBSCRIBE'], duration: 60 },
      ],
    });
    assert(create2.status === 200, `Create2 status: ${create2.status}`);
    assert(create2.body.participantTokens.length === 2, `Token count: ${create2.body.participantTokens.length}`);
    assert(create2.body.participantTokens[0].userId === 'alice', 'Token 0 userId wrong');
    assert(create2.body.participantTokens[1].capabilities.length === 1, 'Token 1 should be subscribe only');
    assert(create2.body.participantTokens[0].token.length > 20, 'Token too short (not JWT?)');
    const stageId2 = create2.body.stage.stageId;

    // 6. Create participant token separately
    const tokenResp = await api('POST', `/api/stages/${stageId}/participants`, {
      userId: 'charlie', capabilities: ['PUBLISH'], duration: 30, attributes: { role: 'host' },
    });
    assert(tokenResp.status === 200, 'Token create failed');
    assert(tokenResp.body.participantToken.participantId.startsWith('pid_'), 'Bad participantId');
    assert(tokenResp.body.participantToken.capabilities[0] === 'PUBLISH', 'Wrong capability');

    // 7. Delete first stage
    const del = await api('DELETE', `/api/stages/${stageId}`);
    assert(del.status === 200, 'Delete failed');

    // 8. Verify deleted
    const list2 = await api('GET', '/api/stages');
    assert(!list2.body.stages.some(s => s.stageId === stageId), 'Deleted stage still in list');

    // 9. Delete nonexistent
    const del404 = await api('DELETE', '/api/stages/stg_nonexistent');
    assert(del404.status === 404, `Delete nonexistent: ${del404.status}`);

    // 10. Validation error
    const badCreate = await api('POST', '/api/stages', { maxParticipants: 999 });
    assert(badCreate.status === 400, `Bad create: ${badCreate.status}`);

    // Cleanup
    await api('DELETE', `/api/stages/${stageId2}`);

    result.passed = true;
    result.metrics = { stagesCreated: 2, tokensGenerated: 3 };
  } catch (err) {
    result.error = err.message;
  }
  console.log(JSON.stringify(result));
  process.exit(result.passed ? 0 : 1);
}
main();
