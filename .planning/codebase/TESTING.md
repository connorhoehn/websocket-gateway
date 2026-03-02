# Testing Patterns

**Analysis Date:** 2026-03-02

## Test Framework

**Runner:**
- Jest 29.7.0
- Config: `jest.config.js` (root level)
- TypeScript support: ts-jest 29.2.5

**Environment:**
- Node.js test environment (not jsdom or browser)

**Run Commands:**
```bash
npm test              # Run all tests
npm run watch        # Not configured in package.json; would be "jest --watch"
npm run test         # Jest with default config
```

## Jest Configuration

**File:** `/Users/connorhoehn/Projects/websocker_gateway/jest.config.js`

```javascript
module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/test'],
  testMatch: ['**/*.test.ts'],
  transform: {
    '^.+\\.tsx?$': 'ts-jest'
  }
};
```

**Key Settings:**
- `roots: ['<rootDir>/test']` - All tests located in `test/` directory
- `testMatch: ['**/*.test.ts']` - Test file naming: `.test.ts` suffix
- `transform`: ts-jest transpiles TypeScript test files on the fly

## Test File Organization

**Location Pattern:**
- Co-located in `test/` directory (not alongside source files)
- Single test file present: `test/websocker_gateway.test.ts`

**Naming Convention:**
- Pattern: `[name].test.ts`
- Example: `websocker_gateway.test.ts`

**Directory Structure:**
```
websocker_gateway/
├── test/
│   ├── websocker_gateway.test.ts    # Main test file
│   └── websocker_gateway.test.d.ts  # Generated type definitions
├── lib/                              # Infrastructure code (TypeScript)
├── src/                              # Runtime code (JavaScript)
└── jest.config.js
```

## Test Structure

**Current State:**
The single test file is mostly commented out, indicating test migration or setup in progress:

```typescript
// import * as cdk from 'aws-cdk-lib';
// import { Template } from 'aws-cdk-lib/assertions';
// import * as WebsockerGateway from '../lib/websocker_gateway-stack';

test('SQS Queue Created', () => {
//   const app = new cdk.App();
//     // WHEN
//   const stack = new WebsockerGateway.WebsockerGatewayStack(app, 'MyTestStack');
//     // THEN
//   const template = Template.fromStack(stack);
//
//   template.hasResourceProperties('AWS::SQS::Queue', {
//     VisibilityTimeout: 300
//   });
});
```

**Pattern (when active):**
- Arrange-Act-Assert (AAA) structure implied by comments: `// WHEN` and `// THEN`
- AWS CDK specific: Uses `Template` assertion library from `aws-cdk-lib/assertions`
- Single test with minimal setup (no describe blocks observed)

## Testing Strategy

**AWS CDK Infrastructure Testing:**
- Tests focus on CloudFormation template assertions
- Use `Template.fromStack(stack)` to verify resource properties
- Check specific resource configurations (e.g., SQS queue settings)

**Runtime Code (src/):**
- No test files present for JavaScript runtime code
- Services (`ChatService`, `PresenceService`, etc.) lack unit tests
- Core components (`MessageRouter`, `NodeManager`) lack test coverage

## Assertion Library

**AWS CDK Assertions:**
- `Template.fromStack()` - Creates assertion context from CDK Stack
- `template.hasResourceProperties()` - Verifies resource exists with properties
- Example: Check SQS Queue visibility timeout of 300 seconds

**Jest Matchers:**
- Default Jest matchers (not explicitly configured)
- Not actively used in current test suite (tests commented out)

## Test Coverage

**Status:** No coverage reports configured or enforced

**Current Coverage:**
- Infrastructure code (lib/): Minimal (1 partially-disabled test)
- Runtime code (src/): Zero test coverage
  - No tests for WebSocket server (`server.js`)
  - No tests for message routing (`message-router.js`)
  - No tests for services (Chat, Presence, Cursor, Reaction)
  - No tests for utilities (`logger.js`)

**Gaps:**
- No unit tests for service action handlers
- No integration tests for message routing
- No tests for Redis connection handling and fallback logic
- No tests for client lifecycle (connect/disconnect)
- No tests for channel management and subscriptions

## Mocking Strategy

**Not Implemented:**
- No mock libraries configured (jest.mock, sinon, etc.)
- No mock services or fixtures visible
- Current test file commented out, so mocking patterns not established

**Expected Patterns (for future tests):**
Based on code structure, would need to mock:
- Redis connections (`ioredis` or `redis` client)
- WebSocket connections (ws library)
- Node.js built-in modules (http, crypto)
- Logger outputs for verification

## Dependencies

**Test-Specific Dependencies (package.json):**
- `@types/jest@^29.5.14` - Jest type definitions
- `jest@^29.7.0` - Test framework
- `ts-jest@^29.2.5` - TypeScript transpiler for tests

**Development Dependencies Required:**
- `@types/node@22.7.9` - Node.js types
- `typescript@~5.6.3` - TypeScript compiler

## Test Execution

**Via npm:**
```bash
npm test
```

**Direct Jest:**
```bash
npx jest
npx jest --watch
npx jest --coverage
```

**With TypeScript:**
- ts-jest automatically transpiles `.ts` test files
- Source maps enabled via `inlineSourceMap: true` in tsconfig.json

## Notes on Test Infrastructure

**Limitations:**
- Test suite is mostly disabled (commented out code)
- No established testing patterns for runtime JavaScript code
- AWS CDK template assertions work well for infrastructure code
- Would need additional libraries for mocking WebSocket and Redis in runtime tests

**Setup Recommendations (if expanding tests):**

For Infrastructure Tests:
```typescript
import * as cdk from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { WebsocketGatewayStack } from '../lib/websocket-gateway-stack';

describe('WebsocketGatewayStack', () => {
  let template: Template;

  beforeAll(() => {
    const app = new cdk.App();
    const stack = new WebsocketGatewayStack(app, 'TestStack');
    template = Template.fromStack(stack);
  });

  test('creates VPC', () => {
    template.resourceCountIs('AWS::EC2::VPC', 1);
  });

  test('creates ECS Cluster', () => {
    template.resourceCountIs('AWS::ECS::Cluster', 1);
  });
});
```

For Runtime Tests (would require mocking):
```typescript
import { ChatService } from '../src/services/chat-service';
import { Logger } from '../src/utils/logger';

describe('ChatService', () => {
  let service: ChatService;
  let mockRouter: jest.Mocked<MessageRouter>;
  let mockLogger: jest.Mocked<Logger>;

  beforeEach(() => {
    mockRouter = jest.createMockFromModule('../src/core/message-router');
    mockLogger = jest.createMockFromModule('../src/utils/logger');
    service = new ChatService(mockRouter, mockLogger);
  });

  test('joins channel', async () => {
    await service.handleAction('client1', 'join', { channel: 'test' });
    expect(mockRouter.subscribeToChannel).toHaveBeenCalledWith('client1', 'test');
  });
});
```

---

*Testing analysis: 2026-03-02*
