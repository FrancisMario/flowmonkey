# @flowmonkey/core

Core execution engine for FlowMonkey workflows.

## Installation

```bash
pnpm add @flowmonkey/core
```

## Overview

This package provides:

- **Engine** — Stateless execution orchestrator
- **StateStore** — Persistence interface (with `MemoryStore` for testing)
- **FlowRegistry** — Flow definition storage and validation
- **HandlerRegistry** — Step handler registration
- **Types** — TypeScript definitions for flows, executions, and results

## Quick Start

```typescript
import {
  Engine,
  DefaultFlowRegistry,
  DefaultHandlerRegistry,
  MemoryStore,
  Result,
  type Flow,
  type StepHandler,
} from '@flowmonkey/core';

// Define a handler
const echoHandler: StepHandler = {
  type: 'echo',
  async execute({ input }) {
    return Result.success(input);
  },
};

// Define a flow
const flow: Flow = {
  id: 'greeting',
  version: '1.0.0',
  initialStepId: 'say-hello',
  steps: {
    'say-hello': {
      id: 'say-hello',
      type: 'echo',
      config: {},
      input: { type: 'key', key: 'name' },
      outputKey: 'greeting',
      transitions: { onSuccess: null },
    },
  },
};

// Set up engine
const store = new MemoryStore();
const handlers = new DefaultHandlerRegistry();
const flows = new DefaultFlowRegistry();

handlers.register(echoHandler);
flows.register(flow);

const engine = new Engine(store, handlers, flows);

// Run a flow
const { execution } = await engine.create('greeting', { name: 'World' });
const result = await engine.run(execution.id, { simulateTime: true });

console.log(result.status);           // 'completed'
console.log(result.context.greeting); // 'World'
```

## Key Concepts

### Flows

A `Flow` defines a workflow with steps and transitions:

```typescript
interface Flow {
  id: string;           // Unique identifier
  version: string;      // Semantic version
  name?: string;        // Display name
  initialStepId: string; // Starting step
  steps: Record<string, Step>;
}

interface Step {
  id: string;
  type: string;         // Handler type
  config: object;       // Handler config
  input: InputSelector; // How to resolve input
  outputKey?: string;   // Where to store output
  transitions: {
    onSuccess?: string | null;  // null = complete
    onFailure?: string | null;
    onResume?: string;
  };
}
```

### Input Selectors

```typescript
// Single key from context
{ type: 'key', key: 'user' }

// Multiple keys
{ type: 'keys', keys: ['user', 'order'] }

// Dot notation path
{ type: 'path', path: 'user.address.city' }

// Template interpolation
{ type: 'template', template: { url: '${api.baseUrl}/users' } }

// Entire context
{ type: 'full' }

// Static value
{ type: 'static', value: { foo: 'bar' } }
```

### Handlers

```typescript
interface StepHandler {
  type: string;
  metadata?: HandlerMetadata;
  execute(params: HandlerParams): Promise<HandlerResult>;
}

interface HandlerParams {
  input: unknown;
  config: object;
  context: ContextHelpers;
  execution: Execution;
  step: Step;
}

// Result helpers
Result.success(output);
Result.failure({ code: 'ERROR', message: 'Description' });
Result.wait({ wakeAt: timestamp, reason: 'Waiting...' });
```

### Executions

```typescript
interface Execution {
  id: string;
  flowId: string;
  flowVersion: string;
  currentStepId: string;
  status: ExecutionStatus;
  context: Record<string, unknown>;
  wakeAt?: number;
  waitReason?: string;
  error?: ExecutionError;
  stepCount: number;
  history?: StepHistory[];
  createdAt: number;
  updatedAt: number;
  
  // V1 features
  idempotencyKey?: string;
  cancellation?: CancellationInfo;
  parentExecutionId?: string;
  timeoutConfig?: TimeoutConfig;
}

type ExecutionStatus = 
  | 'pending' 
  | 'running' 
  | 'waiting' 
  | 'cancelling'
  | 'cancelled' 
  | 'completed' 
  | 'failed';
```

## Engine API

### create()

Create a new execution:

```typescript
const { execution, created } = await engine.create(
  'flow-id',
  { input: 'data' },
  {
    tenantId: 'tenant-123',
    idempotencyKey: 'unique-key',
    idempotencyTTL: 24 * 60 * 60 * 1000, // 24h
    parentExecutionId: 'parent-id',
    timeoutConfig: {
      executionTimeoutMs: 60 * 60 * 1000, // 1h
      waitTimeoutMs: 7 * 24 * 60 * 60 * 1000, // 7d
    },
    metadata: { custom: 'data' },
  }
);

// `created` is false if idempotencyKey matched existing execution
```

### run()

Run execution to completion or wait:

```typescript
const execution = await engine.run(executionId, {
  maxSteps: 100,      // Default: 1000
  simulateTime: true, // Skip wait delays (testing)
});
```

### step()

Execute a single step:

```typescript
const { execution, step, result } = await engine.step(executionId);
```

### resume()

Resume a waiting execution:

```typescript
const execution = await engine.resume(executionId, {
  approvalData: { approved: true },
});
```

### cancel()

Cancel a running or waiting execution:

```typescript
const { cancelled, error } = await engine.cancel(executionId, {
  source: 'user',  // 'user' | 'timeout' | 'system' | 'parent'
  reason: 'User requested cancellation',
});
```

## Testing

Use `TestHarness` for easy flow testing:

```typescript
import { TestHarness } from '@flowmonkey/core/test';

const harness = new TestHarness({
  handlers: [myHandler],
  flows: [myFlow],
});

describe('My Flow', () => {
  it('completes successfully', async () => {
    const { execution } = await harness.run('my-flow', { input: 'data' });
    
    harness.assertCompleted(execution);
    harness.assertContext(execution, { expected: 'output' });
  });

  it('handles failures', async () => {
    const { execution } = await harness.run('my-flow', { invalid: true });
    
    harness.assertFailed(execution);
    harness.assertError(execution, 'VALIDATION_ERROR');
  });
});
```

## Interfaces

### StateStore

Implement for custom persistence:

```typescript
interface StateStore {
  get(id: string): Promise<Execution | undefined>;
  create(execution: Execution): Promise<void>;
  update(execution: Execution): Promise<void>;
  delete(id: string): Promise<void>;
  findWaiting(limit: number): Promise<Execution[]>;
  findByStatus(status: ExecutionStatus, limit: number): Promise<Execution[]>;
  findByIdempotencyKey(flowId: string, key: string): Promise<Execution | undefined>;
  findChildren(parentId: string): Promise<Execution[]>;
  findTimedOutExecutions(limit: number): Promise<Execution[]>;
  findTimedOutWaits(limit: number): Promise<Execution[]>;
}
```

### FlowRegistry

```typescript
interface FlowRegistry {
  get(flowId: string, version?: string): Flow | undefined;
  register(flow: Flow): void;
  list(): Flow[];
  versions(flowId: string): string[];
  latest(flowId: string): Flow | undefined;
}
```

### HandlerRegistry

```typescript
interface HandlerRegistry {
  get(type: string): StepHandler | undefined;
  register(handler: StepHandler): void;
  list(): StepHandler[];
  metadata(type: string): HandlerMetadata | undefined;
}
```

## Error Types

```typescript
import {
  FlowNotFoundError,
  StepNotFoundError,
  HandlerNotFoundError,
  InvalidExecutionStateError,
  InputResolutionError,
  MaxStepsExceededError,
  ContextKeyLimitError,
  ContextSizeLimitError,
  ContextDepthLimitError,
} from '@flowmonkey/core';
```

## Exports

```typescript
// Main classes
export { Engine } from './engine/execution-engine';
export { MemoryStore } from './impl/memory-store';
export { DefaultFlowRegistry } from './impl/flow-registry';
export { DefaultHandlerRegistry } from './impl/handler-registry';

// Types
export type { Flow, Step, InputSelector, StepTransitions } from './types/flow';
export type { Execution, ExecutionStatus, ExecutionError } from './types/execution';
export type { StepHandler, HandlerParams, HandlerResult } from './interfaces/step-handler';
export type { StateStore } from './interfaces/state-store';
export type { FlowRegistry } from './interfaces/flow-registry';
export type { HandlerRegistry } from './interfaces/handler-registry';

// Utilities
export { Result } from './types/result';
export { generateId } from './utils/id';
```

## License

MIT
