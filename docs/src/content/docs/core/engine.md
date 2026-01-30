---
title: Engine
description: Deep dive into the FlowMonkey execution engine.
---

# Engine

The **Engine** is the central component that orchestrates workflow execution. It's completely stateless—all mutable state lives in `Execution` objects persisted via a `StateStore`.

## Creating an Engine

```typescript
import {
  Engine,
  DefaultHandlerRegistry,
  DefaultFlowRegistry,
  MemoryStore,
} from '@flowmonkey/core';

const store = new MemoryStore();
const handlers = new DefaultHandlerRegistry();
const flows = new DefaultFlowRegistry();

const engine = new Engine(store, handlers, flows);
```

## Core Methods

### create()

Creates a new execution for a flow:

```typescript
const { execution, created } = await engine.create(
  'process-order',           // flow ID
  { order: { id: '123' } },  // initial context
  {
    tenantId: 'tenant-1',              // optional multi-tenancy
    idempotencyKey: 'order-123',       // prevent duplicates
    idempotencyTTL: 86400000,          // 24 hours
    metadata: { source: 'api' },       // custom metadata
  }
);

if (created) {
  console.log('New execution:', execution.id);
} else {
  console.log('Existing execution found:', execution.id);
}
```

### run()

Runs an execution to completion or until it waits:

```typescript
const result = await engine.run(execution.id);

switch (result.status) {
  case 'completed':
    console.log('Flow completed successfully');
    break;
  case 'waiting':
    console.log('Flow is waiting for:', result.waitReason);
    break;
  case 'failed':
    console.log('Flow failed:', result.error);
    break;
}
```

### step()

Executes a single step (useful for debugging or custom control):

```typescript
const stepResult = await engine.step(execution.id);

console.log('Step executed:', stepResult.stepId);
console.log('Step outcome:', stepResult.outcome);
console.log('Next step:', stepResult.nextStepId);
```

### resume()

Resumes a waiting execution with optional data:

```typescript
// After receiving external approval
await engine.resume(execution.id, {
  approved: true,
  approvedBy: 'manager@company.com',
  approvedAt: new Date().toISOString(),
});
```

### cancel()

Cancels a running or waiting execution:

```typescript
const result = await engine.cancel(execution.id, {
  source: 'user',
  reason: 'Customer requested cancellation',
});

if (result.cancelled) {
  console.log('Execution cancelled');
} else {
  console.log('Cannot cancel:', result.error);
}
```

## Execution Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                         engine.create()                         │
│                              │                                  │
│                              ▼                                  │
│                         ┌────────┐                              │
│                         │pending │                              │
│                         └────┬───┘                              │
│                              │                                  │
│                     engine.run() / step()                       │
│                              │                                  │
│                              ▼                                  │
│                         ┌────────┐                              │
│              ┌──────────│running │──────────┐                   │
│              │          └────┬───┘          │                   │
│              │               │              │                   │
│         (handler            (handler       (handler             │
│          success)            failure)       wait)               │
│              │               │              │                   │
│              ▼               ▼              ▼                   │
│         ┌─────────┐    ┌────────┐    ┌─────────┐               │
│         │completed│    │ failed │    │ waiting │               │
│         └─────────┘    └────────┘    └────┬────┘               │
│                                           │                     │
│                                   engine.resume()               │
│                                           │                     │
│                                           └──────► running      │
└─────────────────────────────────────────────────────────────────┘
```

## Error Handling

The engine handles errors at multiple levels:

### Handler Errors

If a handler throws or returns a failure:

```typescript
// Handler returns failure
return Result.failure({
  code: 'VALIDATION_ERROR',
  message: 'Invalid email format',
});

// Engine follows onFailure transition if defined
transitions: {
  onSuccess: 'next-step',
  onFailure: 'handle-error',  // goes here
}
```

### Missing Handler

If no handler is registered for a step type:

```typescript
// ExecutionError with code: 'HANDLER_NOT_FOUND'
```

### Invalid Flow

If the flow definition is invalid:

```typescript
// ExecutionError with code: 'INVALID_FLOW'
```

## Concurrency

The engine is designed for concurrent execution across multiple instances. Use a distributed lock manager for safety:

```typescript
import { RedisLockManager } from '@flowmonkey/redis';

const lockManager = new RedisLockManager(redis);

// Acquire lock before running
const lock = await lockManager.acquire(`execution:${executionId}`);
try {
  await engine.run(executionId);
} finally {
  await lock.release();
}
```

## Next Steps

- [Flows](/core/flows/) - Flow definition structure
- [Execution Lifecycle](/core/execution-lifecycle/) - Detailed state transitions
- [Error Handling](/advanced/error-handling/) - Comprehensive error handling
