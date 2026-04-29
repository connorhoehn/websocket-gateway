module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/test'],
  testMatch: ['**/*.test.ts', '**/*.test.js'],
  // Loaded once per jest worker before any test files run. Sets the
  // env vars that distributed-core v0.6.3's IS_TEST_ENV check + our
  // own WSG_TEST_FAST_MODE / PIPELINE_TEST_FAST_MODE flags read at
  // bootstrap time. Pre-existing jest defaults (NODE_ENV=test) still
  // apply; this file only fills in the holes.
  setupFiles: ['<rootDir>/test/jest.setup.js'],
  transform: {
    '^.+\\.tsx?$': 'ts-jest'
  }
};
