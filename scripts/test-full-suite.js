/**
 * Full test suite runner — runs all tests in sequence, reports results.
 */
const { execSync } = require('child_process');
const path = require('path');

const SIG = process.env.SIGNALING_URL || 'http://localhost:3000';
const MS = process.env.MEDIASOUP_URL || 'http://localhost:3001';

const tests = [
  // Week 1: Foundation
  { name: 'test-dual-track', week: 1, env: { SERVER_URL: MS } },
  { name: 'test-room-isolation', week: 1, env: { SERVER_URL: MS } },
  { name: 'test-multi-worker', week: 1, env: { SERVER_URL: MS } },
  { name: 'test-gateway', week: 1, env: { SIGNALING_URL: SIG, SERVER_URL: SIG, MEDIASOUP_URL: MS } },

  // Week 2: IVS API
  { name: 'test-stage-crud', week: 2, env: { SIGNALING_URL: SIG, SERVER_URL: SIG } },
  { name: 'test-participant-flow', week: 2, env: { SIGNALING_URL: SIG, SERVER_URL: SIG } },
  { name: 'test-chat', week: 2, env: { SIGNALING_URL: SIG, SERVER_URL: SIG } },

  // Week 3: Scaling
  { name: 'test-fan-out', week: 3, env: { SIGNALING_URL: SIG, MEDIASOUP_URL: MS, SERVER_URL: SIG } },
  { name: 'test-broadcast', week: 3, env: { SIGNALING_URL: SIG, SERVER_URL: SIG } },
  { name: 'test-observability', week: 3, env: { SIGNALING_URL: SIG, MEDIASOUP_URL: MS } },

  // Week 4: Polish
  { name: 'test-recording', week: 4, env: { SIGNALING_URL: SIG, MEDIASOUP_URL: MS } },
  { name: 'test-reconnect', week: 4, env: { SIGNALING_URL: SIG, SERVER_URL: SIG } },
];

async function main() {
  const results = [];
  let pass = 0, fail = 0;

  console.log('==========================================');
  console.log(' Live Video Broadcaster — Full Test Suite');
  console.log('==========================================\n');

  for (const test of tests) {
    const startTime = Date.now();
    process.stdout.write(`  [W${test.week}] ${test.name} ... `);

    try {
      const envStr = Object.entries(test.env).map(([k, v]) => `${k}=${v}`).join(' ');
      const cmd = `${envStr} node ${path.join(__dirname, `${test.name}.js`)} 2>/dev/null`;
      const output = execSync(cmd, { encoding: 'utf-8', timeout: 30000 }).trim();
      const lastLine = output.split('\n').pop();
      const parsed = JSON.parse(lastLine);
      const duration = Date.now() - startTime;

      if (parsed.passed) {
        console.log(`PASS (${duration}ms)`);
        pass++;
      } else {
        console.log(`FAIL: ${parsed.error}`);
        fail++;
      }
      results.push({ ...test, passed: parsed.passed, duration, error: parsed.error });
    } catch (e) {
      const duration = Date.now() - startTime;
      console.log(`FAIL: ${e.message.split('\n')[0]}`);
      fail++;
      results.push({ ...test, passed: false, duration, error: e.message.split('\n')[0] });
    }
  }

  console.log('\n==========================================');
  console.log(` Results: ${pass} passed, ${fail} failed out of ${tests.length}`);
  console.log('==========================================');

  if (fail > 0) {
    console.log('\nFailed tests:');
    results.filter(r => !r.passed).forEach(r => {
      console.log(`  [W${r.week}] ${r.name}: ${r.error}`);
    });
  }

  console.log(JSON.stringify({ suite: 'full', passed: fail === 0, pass, fail, total: tests.length }));
  process.exit(fail > 0 ? 1 : 0);
}

main();
