# @flowmonkey/core

Core execution engine for FlowMonkey workflows.

This package contains the fundamental building blocks of FlowMonkey: the Engine, type definitions, registries, and base classes for building handlers.

## Table of Contents

- [Installation](#installation)
- [Overview](#overview)
- [Engine](#engine)
  - [Creating Executions](#creating-executions)
  - [Running Executions](#running-executions)
  - [Resuming Executions](#resuming-executions)
  - [Cancelling Executions](#cancelling-executions)
- [Flows and Steps](#flows-and-steps)
  - [Flow Structure](#flow-structure)
  - [Step Structure](#step-structure)
  - [Input Selectors](#input-selectors)
  - [Transitions](#transitions)
- [Handlers](#handlers)
  - [Function-Based Handlers](#function-based-handlers)
  - [Class-Based Handlers](#class-based-handlers)
  - [Handler Decorators](#handler-decorators)
  - [Validation Decorators](#validation-decorators)
  - [Stateful Handlers](#stateful-handlers)
- [Registries](#registries)
  - [FlowRegistry](#flowregistry)
  - [HandlerRegistry](#handlerregistry)
- [State Store](#state-store)
- [Testing](#testing)
- [Error Handling](#error-handling)
- [API Reference](#api-reference)

## Installation

```bash
pnpm add @flowmonkey/core
```

## Overview

The core package provides:

- **Engine** - Stateless execution orchestrator
- **StateStore** - Persistence interface with `MemoryStore` for testing
- **FlowRegistry** - Flow definition storage and versioning
- **HandlerRegistry** - Step handler registration
- **Base Classes** - `StatelessHandler` and `StatefulHandler` for building handlers
- **Decorators** - `@Handler`, `@Input`, validation decorators
- **Types** - TypeScript definitions for flows, executions, and results
- **TestHarness** - Testing utility for flows and handlers

The Engine is the central orchestrator. It does not contain execution state; all state is stored externally via a StateStore implementation. This stateless design allows horizontal scaling without coordination.

## Engine

The Engine orchestrates workflow execution. It coordinates between the flow definitions (what to do), handlers (how to do it), and state store (tracking progress).

```typescript
import {
  Engine,
  DefaultFlowRegistry,
  DefaultHandlerRegistry,
  MemoryStore,
} from '@flowmonkey/core';

const store = new MemoryStore();
const handlers = new DefaultHandlerRegistry();
const flows = new DefaultFlowRegistry();

// Register handlers and flows...

const engine = new Engine(store, handlers, flows);
```

### Creating Executions

Create a new execution from a flow definition:

```typescript
const { execution, created } = await engine.create('my-flow', {
  // Initial context data
  user: { id: '123', name: 'Alice' },
  order: { total: 99.99 },
});

console.log(execution.id);     // Unique execution ID
console.log(execution.status); // 'pending'
console.log(created);          // true if new, false if idempotent match
```

#### Create Options

```typescript
const { execution } = await engine.create('my-flow', initialContext, {
  // Tenant isolation
  tenantId: 'tenant-123',
  
  // Prevent duplicate executions
  idempotencyKey: 'unique-request-id',
  idempotencyTTL: 24 * 60 * 60 * 1000, // 24 hours
  
  // Link to parent execution
  parentExecutionId: 'parent-exec-id',
  
  // Timeout configuration
  timeoutConfig: {
    executionTimeoutMs: 60 * 60 * 1000,      // 1 hour max execution time
    waitTimeoutMs: 7 * 24 * 60 * 60 * 1000,  // 7 day max wait time
  },
  
  // Custom metadata
  metadata: {
    source: 'api',
    requestId: 'req-456',
  },
});
```

### Running Executions

Run an execution to completion (or until it waits):

```typescript
// Run to completion
const result = await engine.run(execution.id);

console.log(result.status);  // 'completed', 'failed', or 'waiting'
console.log(result.context); // Accumulated context from all steps

// Run with options
const result = await engine.run(execution.id, {
  maxSteps: 100,       // Limit steps to prevent infinite loops
  simulateTime: true,  // Skip wait delays (useful for testing)
});
```

#### Single Step Execution

For fine-grained control, execute one step at a time:

```typescript
const { execution, step, result } = await engine.step(execution.id);

console.log(step.id);           // Step that was executed
console.log(result.status);     // 'success', 'failure', or 'wait'
console.log(execution.status);  // Updated execution status
```

### Resuming Executions

Resume a waiting execution with external data:

```typescript
// Execution paused waiting for approval
const execution = await engine.resume(executionId, {
  approved: true,
  approvedBy: 'manager@company.com',
  approvedAt: Date.now(),
});

// The resume data is merged into context
console.log(execution.context.approved); // true
```

The resume data becomes available in the execution context for subsequent steps to access via input selectors.

### Cancelling Executions

Cancel a running or waiting execution:

```typescript
const { cancelled, error } = await engine.cancel(executionId, {
  source: 'user',  // 'user' | 'timeout' | 'system' | 'parent'
  reason: 'Customer cancelled the order',
});

if (cancelled) {
  console.log('Execution cancelled successfully');
} else {
  console.log('Could not cancel:', error);
}
```

Cancellation:
- Sets status to `cancelling` then `cancelled`
- Stores cancellation info (source, reason, timestamp)
- Cannot cancel already completed or failed executions

## Flows and Steps

### Flow Structure

A Flow defines a workflow as a collection of steps with transitions between them:

```typescript
interface Flow {
  id: string;            // Unique identifier
  version: string;       // Semantic version
  name?: string;         // Display name
  initialStepId: string; // Entry point step
  steps: Record<string, Step>;
}
```

Flows are **versioned**. You can have multiple versions of the same flow ID, allowing you to update workflows without affecting running executions.

```typescript
const flow: Flow = {
  id: 'process-order',
  version: '2.0.0',
  name: 'Order Processing v2',
  initialStepId: 'validate',
  steps: {
    // Step definitions...
  },
};
```

### Step Structure

Each step defines what handler to run and how to wire it into the flow:

```typescript
interface Step {
  id: string;
  type: string;           // Handler type to execute
  config: object;         // Static configuration
  input: InputSelector;   // How to resolve input
  outputKey?: string;     // Where to store output in context
  transitions: {
    onSuccess?: string | null;  // Next step on success
    onFailure?: string | null;  // Next step on failure
    onResume?: string;          // Step after wait resume
  };
}
```

Example step:

```typescript
const step: Step = {
  id: 'fetch-user',
  type: 'http',
  config: {
    retries: 3,
  },
  input: {
    type: 'template',
    template: {
      url: 'https://api.example.com/users/${userId}',
      method: 'GET',
    },
  },
  outputKey: 'user',
  transitions: {
    onSuccess: 'process-user',
    onFailure: 'handle-error',
  },
};
```

### Input Selectors

Input selectors define how to extract data from the execution context for a step:

#### Key Selector

Get a single value from context:

```typescript
{ type: 'key', key: 'user' }
// context.user -> handler input
```

#### Keys Selector

Get multiple values as an object:

```typescript
{ type: 'keys', keys: ['user', 'order', 'config'] }
// { user: context.user, order: context.order, config: context.config }
```

#### Path Selector

Navigate nested objects with dot notation:

```typescript
{ type: 'path', path: 'user.address.city' }
// context.user.address.city -> handler input
```

#### Template Selector

Interpolate values into a template structure:

```typescript
{
  type: 'template',
  template: {
    url: 'https://api.example.com/users/${userId}',
    headers: {
      'Authorization': 'Bearer ${auth.token}',
    },
    body: {
      name: '${user.name}',
      email: '${user.email}',
    },
  },
}
```

Template interpolation:
- Uses `${path}` syntax
- Supports nested paths: `${user.address.city}`
- Works in strings and object values
- Non-string values are preserved

#### Full Selector

Pass the entire context:

```typescript
{ type: 'full' }
// entire context object -> handler input
```

#### Static Selector

Pass a hardcoded value:

```typescript
{ type: 'static', value: { defaultTimeout: 5000 } }
// { defaultTimeout: 5000 } -> handler input (no context lookup)
```

### Transitions

Transitions define flow control based on step results:

```typescript
transitions: {
  onSuccess: 'next-step',    // Go to 'next-step' on success
  onFailure: 'error-handler', // Go to 'error-handler' on failure
  onResume: 'after-wait',    // Go to 'after-wait' after resume
}
```

Special values:
- `null` - Complete the flow (terminal state)
- `undefined` - Missing transition causes flow to fail with error

Example flow with branching:

```typescript
const flow: Flow = {
  id: 'approval-flow',
  version: '1.0.0',
  initialStepId: 'request-approval',
  steps: {
    'request-approval': {
      id: 'request-approval',
      type: 'wait-for-approval',
      config: {},
      input: { type: 'key', key: 'request' },
      outputKey: 'approval',
      transitions: {
        onSuccess: 'check-approved',
        onResume: 'check-approved',
      },
    },
    'check-approved': {
      id: 'check-approved',
      type: 'condition',
      config: { expression: '${approval.approved} === true' },
      input: { type: 'key', key: 'approval' },
      transitions: {
        onSuccess: 'process-approved',
        onFailure: 'process-rejected',
      },
    },
    'process-approved': {
      id: 'process-approved',
      type: 'notify',
      config: {},
      input: { type: 'static', value: { message: 'Approved!' } },
      transitions: { onSuccess: null },
    },
    'process-rejected': {
      id: 'process-rejected',
      type: 'notify',
      config: {},
      input: { type: 'static', value: { message: 'Rejected' } },
      transitions: { onSuccess: null },
    },
  },
};
```

## Handlers

Handlers implement the business logic for each step type. FlowMonkey supports two patterns: function-based and class-based.

### Function-Based Handlers

Simple handlers can be defined as objects implementing `StepHandler`:

```typescript
import { Result, type StepHandler } from '@flowmonkey/core';

const logHandler: StepHandler = {
  type: 'log',
  metadata: {
    type: 'log',
    name: 'Logger',
    description: 'Logs data to console',
    category: 'utility',
    stateful: false,
    configSchema: { type: 'object' },
  },
  async execute({ input, config, context, execution, step }) {
    console.log(`[${execution.id}] Step ${step.id}:`, input);
    return Result.success({ logged: true, timestamp: Date.now() });
  },
};
```

Handler parameters:

| Parameter | Description |
|-----------|-------------|
| `input` | Resolved input from input selector |
| `config` | Step configuration object |
| `context` | Helper functions for reading/writing context |
| `execution` | Current execution state |
| `step` | Current step definition |

### Class-Based Handlers

For more complex handlers, extend `StatelessHandler` or `StatefulHandler`. Both base classes have full access to all decorators (`@Handler`, `@Input`, validation decorators). The only difference is the lifecycle:

- **StatelessHandler** - Executes and completes immediately. Use for quick operations like HTTP calls, data transforms, or notifications.
- **StatefulHandler** - Can pause with `wait()`, persist checkpoints, and resume later. Use for long-running operations, external approvals, or batch processing.

```typescript
import { Handler, Input, StatelessHandler } from '@flowmonkey/core';
import type { StepResult } from '@flowmonkey/core';

@Handler({
  type: 'transform',
  name: 'Data Transform',
  description: 'Transform data using mapping rules',
  category: 'data',
})
export class TransformHandler extends StatelessHandler<TransformInput, TransformOutput> {
  @Input({ type: 'object', source: 'config', required: true })
  mapping!: Record<string, string>;

  @Input({ type: 'any', source: 'previous' })
  data!: unknown;

  async execute(): Promise<StepResult> {
    const result: Record<string, unknown> = {};
    
    for (const [key, path] of Object.entries(this.mapping)) {
      result[key] = this.getByPath(this.data, path);
    }
    
    return this.success(result);
  }
  
  private getByPath(obj: unknown, path: string): unknown {
    return path.split('.').reduce((o, k) => (o as any)?.[k], obj);
  }
}
```

Class-based handlers provide:
- Type-safe input declarations via `@Input`
- Automatic input resolution and validation
- Access to `this.success()`, `this.failure()`, `this.wait()` helpers
- Built-in context access via `this.ctx`, `this.execution`, `this.step`

### Handler Decorators

#### @Handler

Marks a class as a handler and provides metadata:

```typescript
@Handler({
  type: 'http',              // Unique type identifier
  name: 'HTTP Request',      // Display name
  description: 'Make HTTP requests',
  category: 'external',      // 'control' | 'data' | 'external' | 'ai' | 'utility'
  stateful: false,           // Whether handler uses checkpoints
  defaultTimeout: 30000,     // Default timeout in ms
  retryable: true,           // Whether failures can be retried
  visual: {
    icon: 'globe',
    color: '#0078d4',
    tags: ['network', 'api'],
  },
  links: {
    docs: 'https://docs.example.com/http',
  },
})
export class HttpHandler extends StatelessHandler { }
```

#### @Input

Declares an input property with source and validation:

```typescript
@Input({
  type: 'string',           // Primitive type for schema
  source: 'config',         // 'config' | 'context' | 'vault' | 'previous'
  key: 'apiUrl',            // Key to read (defaults to property name)
  required: true,           // Whether input is required
  defaultValue: 'GET',      // Default if not provided
  description: 'Target URL for the request',
})
url!: string;
```

Input sources:
- `config` - Read from step configuration
- `context` - Read from execution context
- `vault` - Read from secrets vault (requires VaultProvider)
- `previous` - Read from previous step's output (resolved input)

### Validation Decorators

Add validation rules to inputs:

```typescript
import {
  Min, Max, Range,
  MinLength, MaxLength, Length,
  Pattern, Email, Url,
  NotEmpty, ArrayMinSize, ArrayMaxSize,
} from '@flowmonkey/core';

export class MyHandler extends StatelessHandler {
  @Input({ type: 'number', source: 'config' })
  @Min(0)
  @Max(100)
  percentage!: number;

  @Input({ type: 'string', source: 'config' })
  @MinLength(1)
  @MaxLength(255)
  name!: string;

  @Input({ type: 'string', source: 'config' })
  @Email()
  email!: string;

  @Input({ type: 'string', source: 'config' })
  @Url()
  endpoint!: string;

  @Input({ type: 'string', source: 'config' })
  @Pattern(/^[A-Z]{3}$/, 'Must be 3 uppercase letters')
  code!: string;

  @Input({ type: 'array', source: 'config' })
  @ArrayMinSize(1)
  @ArrayMaxSize(10)
  items!: string[];
}
```

Validation runs automatically during input resolution. Invalid inputs cause the handler to fail with a validation error.

### Stateful Handlers

Stateful handlers can persist checkpoints and resume later. They extend `StatefulHandler` and have full access to all the same decorators (`@Input`, `@Min`, `@Max`, `@Email`, etc.) as `StatelessHandler`:

```typescript
import { Handler, Input, StatefulHandler } from '@flowmonkey/core';
import type { StepResult } from '@flowmonkey/core';

interface BatchCheckpoint {
  processedCount: number;
  currentBatch: number;
  results: unknown[];
}

@Handler({
  type: 'batch-process',
  name: 'Batch Processor',
  description: 'Process items in batches with checkpoints',
  category: 'data',
  stateful: true,
})
export class BatchProcessHandler extends StatefulHandler<
  BatchInput,
  BatchCheckpoint,
  BatchOutput
> {
  @Input({ type: 'array', source: 'config', required: true })
  items!: unknown[];

  @Input({ type: 'number', source: 'config', defaultValue: 10 })
  batchSize!: number;

  async execute(): Promise<StepResult> {
    // Load checkpoint or start fresh
    const checkpoint = await this.loadCheckpoint() ?? {
      processedCount: 0,
      currentBatch: 0,
      results: [],
    };

    // Process next batch
    const start = checkpoint.currentBatch * this.batchSize;
    const batch = this.items.slice(start, start + this.batchSize);
    
    for (const item of batch) {
      const result = await this.processItem(item);
      checkpoint.results.push(result);
      checkpoint.processedCount++;
    }

    checkpoint.currentBatch++;

    // More batches remaining?
    if (checkpoint.processedCount < this.items.length) {
      await this.saveCheckpoint(checkpoint);
      return this.wait({
        wakeAt: Date.now() + 100, // Continue immediately
        reason: `Processed ${checkpoint.processedCount}/${this.items.length} items`,
      });
    }

    // All done
    return this.success({
      totalProcessed: checkpoint.processedCount,
      results: checkpoint.results,
    });
  }
  
  private async processItem(item: unknown): Promise<unknown> {
    // Process logic here
    return item;
  }
}
```

Stateful handlers can:
- Save checkpoints with `this.saveCheckpoint(data)`
- Load checkpoints with `this.loadCheckpoint()`
- Return `wait` results to pause and resume later

## Registries

### FlowRegistry

Stores and retrieves flow definitions:

```typescript
import { DefaultFlowRegistry } from '@flowmonkey/core';

const flows = new DefaultFlowRegistry();

// Register a flow
flows.register(myFlow);

// Get latest version
const flow = flows.get('my-flow');

// Get specific version
const flowV1 = flows.get('my-flow', '1.0.0');

// List all flows
const allFlows = flows.list();

// Get all versions of a flow
const versions = flows.versions('my-flow'); // ['1.0.0', '2.0.0']

// Get latest version info
const latest = flows.latest('my-flow');
```

### HandlerRegistry

Stores and retrieves handlers:

```typescript
import { DefaultHandlerRegistry } from '@flowmonkey/core';

const handlers = new DefaultHandlerRegistry();

// Register function-based handler
handlers.register(logHandler);

// Register class-based handler (instantiate first)
handlers.register(new HttpHandler());

// Get a handler
const handler = handlers.get('http');

// List all handlers
const allHandlers = handlers.list();

// Get handler metadata
const metadata = handlers.metadata('http');
```

## State Store

The StateStore interface defines how executions are persisted:

```typescript
interface StateStore {
  // Basic CRUD
  get(id: string): Promise<Execution | undefined>;
  create(execution: Execution): Promise<void>;
  update(execution: Execution): Promise<void>;
  delete(id: string): Promise<void>;
  
  // Query methods
  findWaiting(limit: number): Promise<Execution[]>;
  findByStatus(status: ExecutionStatus, limit: number): Promise<Execution[]>;
  findByIdempotencyKey(flowId: string, key: string): Promise<Execution | undefined>;
  findChildren(parentId: string): Promise<Execution[]>;
  findTimedOutExecutions(limit: number): Promise<Execution[]>;
  findTimedOutWaits(limit: number): Promise<Execution[]>;
}
```

### MemoryStore

For testing, use the in-memory store:

```typescript
import { MemoryStore } from '@flowmonkey/core';

const store = new MemoryStore();
const engine = new Engine(store, handlers, flows);
```

For production, use `@flowmonkey/postgres`:

```typescript
import { PgExecutionStore } from '@flowmonkey/postgres';

const store = new PgExecutionStore(pool);
const engine = new Engine(store, handlers, flows);
```

## Testing

### TestHarness

The TestHarness simplifies testing flows and handlers:

```typescript
import { TestHarness } from '@flowmonkey/core/test';

describe('My Flow', () => {
  const harness = new TestHarness({
    handlers: [handler1, handler2],
    flows: [myFlow],
  });

  it('completes successfully', async () => {
    const { execution } = await harness.run('my-flow', {
      input: 'test data',
    });
    
    // Assert completion
    harness.assertCompleted(execution);
    
    // Assert specific context values
    harness.assertContext(execution, {
      result: { status: 'ok' },
    });
  });

  it('handles failures', async () => {
    const { execution } = await harness.run('my-flow', {
      shouldFail: true,
    });
    
    harness.assertFailed(execution);
    harness.assertError(execution, 'VALIDATION_ERROR');
  });

  it('pauses and resumes', async () => {
    const { execution } = await harness.run('my-flow', {
      needsApproval: true,
    });
    
    harness.assertWaiting(execution);
    
    // Resume with data
    const resumed = await harness.resume(execution.id, {
      approved: true,
    });
    
    harness.assertCompleted(resumed);
  });
});
```

### Testing Handlers Directly

```typescript
import { TestHarness } from '@flowmonkey/core/test';

describe('HttpHandler', () => {
  const harness = new TestHarness({
    handlers: [new HttpHandler()],
    flows: [{
      id: 'test-http',
      version: '1.0.0',
      initialStepId: 'fetch',
      steps: {
        fetch: {
          id: 'fetch',
          type: 'http',
          config: {
            url: 'https://api.example.com/data',
            method: 'GET',
          },
          input: { type: 'static', value: {} },
          outputKey: 'response',
          transitions: { onSuccess: null },
        },
      },
    }],
  });

  it('makes HTTP requests', async () => {
    const { execution } = await harness.run('test-http', {});
    
    harness.assertCompleted(execution);
    expect(execution.context.response).toHaveProperty('status');
  });
});
```

## Error Handling

FlowMonkey provides specific error types for different failure modes:

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
  ValidationError,
} from '@flowmonkey/core';
```

### Error Types

| Error | When Thrown |
|-------|-------------|
| `FlowNotFoundError` | Flow ID does not exist in registry |
| `StepNotFoundError` | Step ID does not exist in flow |
| `HandlerNotFoundError` | Handler type not registered |
| `InvalidExecutionStateError` | Invalid state transition (e.g., resuming completed execution) |
| `InputResolutionError` | Failed to resolve step input |
| `MaxStepsExceededError` | Execution exceeded maxSteps limit |
| `ContextKeyLimitError` | Too many keys in context |
| `ContextSizeLimitError` | Context data too large |
| `ContextDepthLimitError` | Context nesting too deep |
| `ValidationError` | Handler input validation failed |

### Handler Failures

Handlers return failure results (not throw errors):

```typescript
async execute(): Promise<StepResult> {
  if (!this.url) {
    return this.failure('MISSING_URL', 'URL is required');
  }
  
  try {
    const response = await fetch(this.url);
    return this.success({ status: response.status });
  } catch (error) {
    return this.failure('FETCH_ERROR', error.message);
  }
}
```

Failure results:
- Are stored in execution error field
- Trigger the `onFailure` transition if defined
- Do not throw exceptions

## API Reference

### Result Helpers

```typescript
import { Result } from '@flowmonkey/core';

// Success result - continues to onSuccess transition
Result.success(output);

// Failure result - continues to onFailure transition
Result.failure({
  code: 'ERROR_CODE',
  message: 'Human readable message',
});

// Wait result - pauses execution
Result.wait({
  wakeAt: Date.now() + 3600000, // When to wake
  reason: 'Waiting for approval', // Why waiting
});
```

### Execution Status

```typescript
type ExecutionStatus = 
  | 'pending'     // Created, not started
  | 'running'     // Executing steps
  | 'waiting'     // Paused, waiting for wake/resume
  | 'cancelling'  // Cancel requested
  | 'cancelled'   // Cancelled
  | 'completed'   // Successfully finished
  | 'failed';     // Failed with error
```

### Exports

```typescript
// Main classes
export { Engine } from './engine/execution-engine';
export { MemoryStore } from './impl/memory-store';
export { DefaultFlowRegistry } from './impl/flow-registry';
export { DefaultHandlerRegistry } from './impl/handler-registry';

// Base handler classes
export { StatelessHandler, StatefulHandler } from './handlers/base';

// Decorators
export { Handler, Input } from './decorators/handler';
export {
  Min, Max, Range,
  MinLength, MaxLength, Length,
  Pattern, Email, Url,
  NotEmpty, ArrayMinSize, ArrayMaxSize,
} from './decorators/validation';

// Types
export type { Flow, Step, InputSelector } from './types/flow';
export type { Execution, ExecutionStatus } from './types/execution';
export type { StepHandler, HandlerParams, HandlerResult } from './interfaces/step-handler';
export type { StateStore } from './interfaces/state-store';
export type { FlowRegistry } from './interfaces/flow-registry';
export type { HandlerRegistry } from './interfaces/handler-registry';

// Utilities
export { Result } from './types/result';
export { generateId } from './utils/id';

// Testing
export { TestHarness } from './test/harness';
```

## License

MIT
