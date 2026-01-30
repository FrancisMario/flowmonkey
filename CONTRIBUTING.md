# Contributing to FlowMonkey

Thank you for your interest in contributing to FlowMonkey! This guide will help you get started.

## Table of Contents

- [Getting Started](#getting-started)
- [Development Workflow](#development-workflow)
- [Code Style](#code-style)
- [Testing](#testing)
- [Pull Request Guidelines](#pull-request-guidelines)
- [Package Structure](#package-structure)

## Getting Started

### Prerequisites

- Node.js 20+
- pnpm 8+
- Git

### Setup

```bash
# Clone the repository
git clone https://github.com/francismario/flowmonkey.git
cd flowmonkey

# Install dependencies
pnpm install

# Build all packages
pnpm build

# Run tests
pnpm test
```

### Development Mode

```bash
# Watch mode for all packages
pnpm dev

# Test in watch mode
pnpm test:watch

# Type check
pnpm typecheck
```

## Development Workflow

### 1. Create a Branch

```bash
git checkout -b feature/my-feature
# or
git checkout -b fix/my-bug-fix
```

### 2. Make Changes

- Follow the existing code style
- Add tests for new functionality
- Update documentation as needed

### 3. Test Your Changes

```bash
# Run all tests
pnpm test

# Run tests for specific package
pnpm --filter @flowmonkey/core test

# Type check
pnpm typecheck
```

### 4. Commit

Use conventional commits:

```bash
git commit -m "feat(core): add idempotency support"
git commit -m "fix(postgres): handle connection timeout"
git commit -m "docs: update deployment guide"
git commit -m "test(handlers): add HTTP handler tests"
```

Commit types:
- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation changes
- `test`: Test changes
- `refactor`: Code refactoring
- `chore`: Build/tooling changes

### 5. Push and Create PR

```bash
git push origin feature/my-feature
```

Then create a Pull Request on GitHub.

## Code Style

### TypeScript

- Use strict TypeScript (`strict: true`)
- Prefer `interface` over `type` for object shapes
- Use `readonly` for immutable properties
- Export types explicitly

```typescript
// Good
export interface FlowConfig {
  readonly id: string;
  readonly version: string;
}

// Avoid
export type FlowConfig = {
  id: string;
  version: string;
};
```

### Naming Conventions

- **Files**: kebab-case (`execution-engine.ts`)
- **Classes**: PascalCase (`ExecutionEngine`)
- **Functions**: camelCase (`createExecution`)
- **Constants**: UPPER_SNAKE_CASE (`MAX_STEPS`)
- **Interfaces**: PascalCase (`StateStore`)
- **Types**: PascalCase (`ExecutionStatus`)

### Error Handling

- Use typed error classes
- Include error codes for programmatic handling
- Provide helpful error messages

```typescript
export class FlowNotFoundError extends Error {
  readonly code = 'FLOW_NOT_FOUND';
  
  constructor(flowId: string) {
    super(`Flow not found: ${flowId}`);
    this.name = 'FlowNotFoundError';
  }
}
```

### Async/Await

- Always use async/await over raw promises
- Handle errors with try/catch
- Don't forget `await`

```typescript
// Good
async function getExecution(id: string) {
  const execution = await store.get(id);
  if (!execution) {
    throw new ExecutionNotFoundError(id);
  }
  return execution;
}

// Avoid
function getExecution(id: string) {
  return store.get(id).then(execution => {
    if (!execution) throw new Error('Not found');
    return execution;
  });
}
```

## Testing

### Test Structure

Tests are located in `packages/*/src/test/` directories:

```
packages/core/src/test/
├── engine.test.ts        # Engine tests
├── memory-store.test.ts  # MemoryStore tests
├── handler-registry.test.ts
├── flow-registry.test.ts
├── input-resolver.test.ts
├── handlers.ts           # Test handlers
├── flows.ts              # Test flows
├── harness.ts            # Test harness
└── README.md             # Test documentation
```

### Writing Tests

Use Vitest and the `TestHarness`:

```typescript
import { describe, it, expect } from 'vitest';
import { TestHarness } from './harness';
import { myHandler } from './handlers';
import { myFlow } from './flows';

describe('My Feature', () => {
  const harness = new TestHarness({
    handlers: [myHandler],
    flows: [myFlow],
  });

  it('should complete successfully', async () => {
    const { execution } = await harness.run('my-flow', { input: 'data' });
    
    harness.assertCompleted(execution);
    harness.assertContext(execution, { expected: 'output' });
  });

  it('should handle errors', async () => {
    const { execution } = await harness.run('my-flow', { invalid: true });
    
    harness.assertFailed(execution);
    harness.assertError(execution, 'VALIDATION_ERROR');
  });
});
```

### Test Categories

1. **Unit Tests**: Test individual functions/classes
2. **Integration Tests**: Test component interactions
3. **E2E Tests**: Test complete flows

### Running Tests

```bash
# All tests
pnpm test

# Watch mode
pnpm test:watch

# Single package
pnpm --filter @flowmonkey/core test

# With coverage
pnpm test -- --coverage
```

## Pull Request Guidelines

### Before Submitting

- [ ] Tests pass (`pnpm test`)
- [ ] Types check (`pnpm typecheck`)
- [ ] Code is formatted
- [ ] Documentation is updated
- [ ] Commit messages follow conventions

### PR Description

Include:
1. **What**: Brief description of changes
2. **Why**: Motivation for the change
3. **How**: Technical approach (if complex)
4. **Testing**: How you tested the changes

### Review Process

1. Automated checks run (tests, types, lint)
2. Maintainer reviews code
3. Address feedback
4. Maintainer merges

## Package Structure

### Adding a New Package

```bash
mkdir packages/my-package
cd packages/my-package
```

Create `package.json`:

```json
{
  "name": "@flowmonkey/my-package",
  "version": "0.1.0",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "scripts": {
    "build": "tsup",
    "dev": "tsup --watch",
    "test": "vitest",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@flowmonkey/core": "workspace:*"
  },
  "devDependencies": {
    "tsup": "^8.0.0",
    "typescript": "^5.0.0",
    "vitest": "^1.0.0"
  }
}
```

Create `tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"]
}
```

Create `tsup.config.ts`:

```typescript
import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
});
```

### Adding a Handler

1. Create handler in `packages/handlers/src/`:

```typescript
// packages/handlers/src/my-handler.ts
import type { StepHandler, HandlerParams } from '@flowmonkey/core';
import { Result } from '@flowmonkey/core';

export const myHandler: StepHandler = {
  type: 'my-handler',
  metadata: {
    type: 'my-handler',
    name: 'My Handler',
    description: 'Does something useful',
    category: 'utility',
    stateful: false,
    configSchema: {},
  },
  async execute(params: HandlerParams) {
    const { input } = params;
    // Handler logic
    return Result.success({ result: 'done' });
  },
};
```

2. Export from `packages/handlers/src/index.ts`:

```typescript
export { myHandler } from './my-handler';
```

3. Add tests in `packages/handlers/src/test/`:

```typescript
import { describe, it, expect } from 'vitest';
import { TestHarness } from '@flowmonkey/core/test';
import { myHandler } from '../my-handler';

describe('myHandler', () => {
  it('should execute successfully', async () => {
    // Test implementation
  });
});
```

### Adding Store Implementation

1. Create store in `packages/my-store/src/`:

```typescript
// packages/my-store/src/execution-store.ts
import type { StateStore, Execution } from '@flowmonkey/core';

export class MyExecutionStore implements StateStore {
  async get(id: string): Promise<Execution | undefined> {
    // Implementation
  }
  
  async create(execution: Execution): Promise<void> {
    // Implementation
  }
  
  // ... other methods
}
```

2. Add integration tests with real database

## Questions?

- Open an issue for bugs or feature requests
- Start a discussion for questions
- Check existing issues/discussions first

Thank you for contributing.
