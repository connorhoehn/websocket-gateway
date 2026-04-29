// test/jest.setup.js
//
// Gateway-wide jest hooks. Loaded via `setupFiles` in jest.config.js so it
// runs once per worker BEFORE the test framework wires up its own globals
// — early enough that the DC-side test-env detection
// (`IS_TEST_ENV = process.env.NODE_ENV === 'test' || JEST_WORKER_ID set`)
// already sees the right values when distributed-core's modules import.
//
// What we set here:
//   - NODE_ENV=test if jest didn't already set it (it usually does, but
//     `jest --env=node` paths don't always force the env). DC's
//     FrameworkLogger and CircuitBreaker / RetryManager / transport adapters
//     read this at module-load time to decide whether to emit logs.
//   - WSG_TEST_FAST_MODE / PIPELINE_TEST_FAST_MODE default-on (they're
//     opt-out in src/cluster/cluster-bootstrap.js and
//     social-api/src/pipeline/bootstrap.ts respectively). Setting them
//     explicitly here documents the intent and lets a one-off run override
//     by passing `WSG_TEST_FAST_MODE=false jest …`.
//
// NOTE: We deliberately do NOT silence jest's own framework output (suite
// names, ✓/✗ markers, summary). Only DC-internal noise is targeted.

if (!process.env.NODE_ENV) {
    process.env.NODE_ENV = 'test';
}

// Enable fast-timer + log-suppression mode unless the operator opted out
// at the shell level. The bootstraps treat unset as "on" too, but writing
// the value here makes the mode visible in process.env for any nested
// child processes (e.g. spawned workers) that inherit our environment.
if (process.env.WSG_TEST_FAST_MODE == null) {
    process.env.WSG_TEST_FAST_MODE = 'true';
}
if (process.env.PIPELINE_TEST_FAST_MODE == null) {
    process.env.PIPELINE_TEST_FAST_MODE = 'true';
}
