---
title: Test Harness
description: Testing FlowMonkey workflows with TestHarness.
---

# Test Harness

`TestHarness` provides utilities for testing flows without external dependencies.

## Import

```typescript
import { TestHarness } from '@flowmonkey/core/test';
```

## Creating a Harness

```typescript
const harness = new TestHarness({
  handlers: [myHandler, anotherHandler],
  flows: [myFlow],
});
```

## Running Flows

### run()

Run a flow to completion:

```typescript
const result = await harness.run('my-flow', {
  input: { data: 'value' }
});

expect(result.status).toBe('completed');
expect(result.context.output).toEqual({ success: true });
```

### runUntil()

Run until a specific status:

```typescript
const result = await harness.runUntil('my-flow', 'waiting', {
  input: { data: 'value' }
});

expect(result.status).toBe('waiting');
```

## Simulating Time

For delay handlers:

```typescript
// Start flow with delay
const execution = await harness.create('flow-with-delay', { data: 'value' });

// Advance time
await harness.simulateTime(30000);  // 30 seconds

// Flow continues after delay
const result = await harness.getExecution(execution.id);
expect(result.status).toBe('completed');
```

## Mocking Handlers

```typescript
const mockHttp = {
  type: 'http',
  async execute({ input }) {
    // Return mock response
    return Result.success({
      status: 200,
      body: { mocked: true }
    });
  }
};

const harness = new TestHarness({
  handlers: [mockHttp],
  flows: [myFlow],
});
```

## Resuming Executions

```typescript
// Run until waiting
const execution = await harness.runUntil('approval-flow', 'waiting', context);

// Resume with data
await harness.resume(execution.id, { approved: true });

// Continue running
const result = await harness.run(execution.id);
expect(result.status).toBe('completed');
```

## Assertions

```typescript
// Check step was executed
expect(result.history).toContainEqual(
  expect.objectContaining({
    stepId: 'my-step',
    status: 'success'
  })
);

// Check context values
expect(result.context.stepOutput).toMatchObject({
  success: true
});
```

## Complete Example

```typescript
import { describe, it, expect } from 'vitest';
import { TestHarness, Result } from '@flowmonkey/core';

const greetHandler = {
  type: 'greet',
  async execute({ input }) {
    return Result.success({ message: `Hello, ${input.name}!` });
  }
};

const greetFlow = {
  id: 'greeting',
  version: '1.0.0',
  initialStepId: 'greet',
  steps: {
    greet: {
      id: 'greet',
      type: 'greet',
      config: {},
      input: { type: 'key', key: 'user' },
      outputKey: 'greeting',
      transitions: { onSuccess: null }
    }
  }
};

describe('greeting flow', () => {
  it('greets the user', async () => {
    const harness = new TestHarness({
      handlers: [greetHandler],
      flows: [greetFlow]
    });

    const result = await harness.run('greeting', {
      user: { name: 'World' }
    });

    expect(result.status).toBe('completed');
    expect(result.context.greeting).toEqual({
      message: 'Hello, World!'
    });
  });
});
```
