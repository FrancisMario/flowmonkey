# FlowMonkey

<p align="center">
  <img src="assets/mascot.png" alt="FlowMonkey" width="400" />
</p>

A minimal, production-ready workflow execution engine for TypeScript and Node.js.

[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-blue.svg)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-20+-green.svg)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

## Table of Contents

- [Overview](#overview)
- [Features](#features)
- [Quick Start](#quick-start)
- [Core Concepts](#core-concepts)
  - [Flows](#flows)
  - [Steps](#steps)
  - [Input Selectors](#input-selectors)
  - [Handlers](#handlers)
  - [Executions](#executions)
- [Packages](#packages)
- [Architecture](#architecture)
- [Production Setup](#production-setup)
- [Development](#development)
- [API Reference](#api-reference)
- [License](#license)

## Overview

FlowMonkey is a workflow execution engine designed for building reliable, stateful workflows in Node.js applications. It provides a clean separation between workflow definitions (flows), step implementations (handlers), and execution state (executions).

The engine is **stateless by design**, meaning all mutable state lives in external stores (PostgreSQL, Redis). This enables horizontal scaling without coordination between instances.

## Features

- **Stateless Engine** - Horizontal scaling without coordination
- **Pluggable Storage** - Memory, PostgreSQL, Redis support
- **Durable Execution** - Survives restarts, supports long-running workflows
- **Async and Wait** - Built-in pause/resume with wake scheduling
- **Flexible Input Resolution** - Key, path, template, and static selectors
- **Idempotency** - Built-in deduplication with configurable TTL
- **Timeouts** - Execution and wait timeouts with auto-cancellation
- **Extensible Handlers** - HTTP, delay, transform, webhooks, and custom handlers
- **Class-Based Handlers** - Decorator-driven handler development with validation
- **Triggers** - HTTP webhooks, cron schedules, and event-driven triggers
- **Express Integration** - Ready-to-use REST API with dependency injection

## Quick Start

### Installation

```bash
# Core package (required)
pnpm add @flowmonkey/core

# Production stores (recommended)
pnpm add @flowmonkey/postgres @flowmonkey/redis

# Pre-built handlers
pnpm add @flowmonkey/handlers

# Express integration
pnpm add @flowmonkey/express
```

### Basic Example

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

// 1. Define a handler
const greetHandler: StepHandler = {
  type: 'greet',
  async execute({ input }) {
    const { name } = input as { name: string };
    return Result.success({ message: `Hello, ${name}!` });
  },
};

// 2. Define a flow
const greetingFlow: Flow = {
  id: 'greeting',
  version: '1.0.0',
  name: 'Greeting Flow',
  initialStepId: 'say-hello',
  steps: {
    'say-hello': {
      id: 'say-hello',
      type: 'greet',
      config: {},
      input: { type: 'key', key: 'user' },
      outputKey: 'greeting',
      transitions: { onSuccess: null }, // null means flow complete
    },
  },
};

// 3. Set up engine
const store = new MemoryStore();
const handlers = new DefaultHandlerRegistry();
const flows = new DefaultFlowRegistry();

handlers.register(greetHandler);
flows.register(greetingFlow);

const engine = new Engine(store, handlers, flows);

// 4. Run a flow
const { execution } = await engine.create('greeting', {
  user: { name: 'World' },
});

const result = await engine.run(execution.id);
console.log(result.status);  // 'completed'

// Fetch execution to get the context
const completed = await store.load(execution.id);
console.log(completed.context.greeting);  // { message: 'Hello, World!' }
```

## Core Concepts

### Flows

A **Flow** is a workflow definition that describes the sequence of steps to execute. Flows are immutable, versioned configurations that the engine uses to orchestrate executions.

```typescript
interface Flow {
  id: string;            // Unique identifier
  version: string;       // Semantic version (allows multiple versions)
  name?: string;         // Human-readable name
  initialStepId: string; // Starting step
  steps: Record<string, Step>;
}
```

Flows define **what** should happen. They do not contain execution state or business logic. A single flow definition can have many concurrent executions.

Example:

```typescript
const orderFlow: Flow = {
  id: 'process-order',
  version: '1.0.0',
  name: 'Order Processing',
  initialStepId: 'validate',
  steps: {
    validate: {
      id: 'validate',
      type: 'validate-order',
      config: {},
      input: { type: 'key', key: 'order' },
      outputKey: 'validated',
      transitions: {
        onSuccess: 'charge-payment',
        onFailure: 'notify-invalid',
      },
    },
    'charge-payment': {
      id: 'charge-payment',
      type: 'http',
      config: {},
      input: {
        type: 'template',
        template: {
          url: 'https://api.stripe.com/v1/charges',
          method: 'POST',
          body: { amount: '${validated.total}' },
        },
      },
      outputKey: 'payment',
      transitions: { onSuccess: 'send-confirmation' },
    },
    'send-confirmation': {
      id: 'send-confirmation',
      type: 'email',
      config: {},
      input: { type: 'full' },
      transitions: { onSuccess: null },
    },
    'notify-invalid': {
      id: 'notify-invalid',
      type: 'log',
      config: {},
      input: { type: 'static', value: { error: 'Invalid order' } },
      transitions: { onSuccess: null },
    },
  },
};
```

### Steps

A **Step** is an individual unit of work within a flow. Each step specifies:

- **type**: Which handler executes this step
- **config**: Static configuration passed to the handler
- **input**: How to resolve input from execution context
- **outputKey**: Where to store the handler's output in context
- **transitions**: Which step to execute next based on the result

```typescript
interface Step {
  id: string;
  type: string;           // Handler type (e.g., 'http', 'delay')
  config: object;         // Static handler configuration
  input: InputSelector;   // How to resolve input
  outputKey?: string;     // Where to store output
  transitions: {
    onSuccess?: string | null;  // Next step on success (null = complete)
    onFailure?: string | null;  // Next step on failure
    onResume?: string;          // Step after wait resume
  };
}
```

Transitions control flow:
- Setting a transition to a step ID moves to that step
- Setting a transition to `null` completes the flow
- If a transition is not defined, the flow fails with an error

### Input Selectors

**Input Selectors** control how a step receives data from the execution context. The context accumulates outputs from previous steps, and input selectors allow you to pick exactly what each step needs.

| Type | Example | Description |
|------|---------|-------------|
| `key` | `{ type: 'key', key: 'user' }` | Get a single key from context |
| `keys` | `{ type: 'keys', keys: ['user', 'order'] }` | Get multiple keys as an object |
| `path` | `{ type: 'path', path: 'user.address.city' }` | Dot notation for nested values |
| `template` | `{ type: 'template', template: { url: '${api.url}' } }` | String interpolation |
| `full` | `{ type: 'full' }` | Pass entire context |
| `static` | `{ type: 'static', value: { foo: 'bar' } }` | Pass a static value |

The `template` selector is particularly powerful for constructing API requests:

```typescript
input: {
  type: 'template',
  template: {
    url: 'https://api.example.com/users/${userId}',
    headers: {
      'Authorization': 'Bearer ${auth.token}',
      'Content-Type': 'application/json',
    },
    body: {
      name: '${user.name}',
      email: '${user.email}',
    },
  },
}
```

### Handlers

**Handlers** implement the actual logic for each step type. A handler receives resolved input and returns a result indicating success, failure, or wait.

FlowMonkey supports two handler styles:

#### Function-Based Handlers

Simple handlers can be defined as objects:

```typescript
const validateHandler: StepHandler = {
  type: 'validate-order',
  metadata: {
    type: 'validate-order',
    name: 'Validate Order',
    description: 'Validates order data',
    category: 'data',
    stateful: false,
    configSchema: { type: 'object' },
  },
  async execute({ input, config, context, execution, step }) {
    const order = input as Order;
    
    if (order.total <= 0) {
      return Result.failure({
        code: 'INVALID_TOTAL',
        message: 'Order total must be positive',
      });
    }
    
    return Result.success({
      ...order,
      validated: true,
      validatedAt: Date.now(),
    });
  },
};
```

#### Class-Based Handlers

For more complex handlers, use the decorator-based class system:

```typescript
import { Handler, Input, StatelessHandler, Url, Min, Max } from '@flowmonkey/core';

@Handler({
  type: 'http',
  name: 'HTTP Request',
  description: 'Make HTTP requests to external APIs',
  category: 'external',
  defaultTimeout: 30000,
  retryable: true,
})
export class HttpHandler extends StatelessHandler<HttpInput, HttpOutput> {
  @Input({ type: 'string', source: 'config', required: true })
  @Url()
  url!: string;

  @Input({ type: 'string', source: 'config', defaultValue: 'GET' })
  method!: 'GET' | 'POST' | 'PUT' | 'DELETE';

  @Input({ type: 'number', source: 'config', defaultValue: 30000 })
  @Min(100)
  @Max(300000)
  timeout!: number;

  async execute(): Promise<StepResult> {
    const response = await fetch(this.url, {
      method: this.method,
      signal: AbortSignal.timeout(this.timeout),
    });

    return this.success({
      status: response.status,
      body: await response.text(),
    });
  }
}
```

Class-based handlers provide:
- Automatic input validation via decorators
- Clear type definitions for inputs and outputs
- Stateful handler support with checkpoints
- Built-in access to context, step, and execution

#### Handler Results

Handlers return one of three result types:

```typescript
// Success - continue to onSuccess transition
return Result.success({ data: 'value' });

// Failure - continue to onFailure transition
return Result.failure({
  code: 'ERROR_CODE',
  message: 'Human-readable message',
});

// Wait - pause execution until wakeAt or resume
return Result.wait({
  wakeAt: Date.now() + 3600000, // Wake in 1 hour
  reason: 'Waiting for approval',
});
```

### Executions

An **Execution** is a running instance of a flow. It tracks:

- Current position in the flow (current step)
- Accumulated context (outputs from completed steps)
- Status (pending, running, waiting, completed, failed, cancelled)
- History of executed steps
- Wake schedule for waiting executions

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
  
  // Optional features
  idempotencyKey?: string;
  parentExecutionId?: string;
  timeoutConfig?: TimeoutConfig;
}

type ExecutionStatus = 
  | 'pending'     // Created but not started
  | 'running'     // Currently executing steps
  | 'waiting'     // Paused, waiting for wake or resume
  | 'cancelling'  // Cancel requested, cleaning up
  | 'cancelled'   // Cancelled by user/system
  | 'completed'   // Successfully finished
  | 'failed';     // Failed with error
```

The relationship between these concepts:

```
Flow (template)       Execution (instance)
-------------         -------------------
1 flow definition --> many executions
                      each execution has:
                      - its own context
                      - its own position
                      - its own status
```

## Packages

FlowMonkey is organized as a monorepo with focused packages:

| Package | Description |
|---------|-------------|
| [@flowmonkey/core](./packages/core) | Core execution engine, types, in-memory store |
| [@flowmonkey/handlers](./packages/handlers) | Pre-built handlers (HTTP, delay, transform, batch) |
| [@flowmonkey/express](./packages/express) | Express integration with REST API |
| [@flowmonkey/postgres](./packages/postgres) | PostgreSQL persistence (executions, flows, jobs) |
| [@flowmonkey/redis](./packages/redis) | Redis caching, locking, and signaling |
| [@flowmonkey/jobs](./packages/jobs) | Background job runner for stateful handlers |
| [@flowmonkey/triggers](./packages/triggers) | HTTP and cron triggers for starting flows |

### Package Dependencies

```
@flowmonkey/express
    |
    +-- @flowmonkey/core (required)
    +-- @flowmonkey/postgres (optional, recommended)
    +-- @flowmonkey/handlers (optional)
    
@flowmonkey/jobs
    |
    +-- @flowmonkey/core (required)
    +-- @flowmonkey/postgres (required)
    
@flowmonkey/triggers
    |
    +-- @flowmonkey/core (required)
    +-- @flowmonkey/postgres (optional)
```

## Architecture

### Engine Design

The Engine is **stateless**. It does not hold any execution state in memory. All state is persisted to a StateStore immediately after each step.

```
                    +-----------------+
                    |     Engine      |
                    | (orchestrator)  |
                    +--------+--------+
                             |
         +-------------------+-------------------+
         |                   |                   |
+--------v--------+  +-------v-------+  +-------v--------+
|   StateStore    |  | FlowRegistry  |  | HandlerRegistry|
| (persistence)   |  | (definitions) |  | (step logic)   |
+-----------------+  +---------------+  +----------------+
```

This design enables:

1. **Horizontal Scaling**: Run multiple engine instances without coordination
2. **Durability**: Executions survive process restarts
3. **Isolation**: Each step is persisted before the next begins

### Execution Flow

```
1. engine.create(flowId, context)
   - Validates flow exists
   - Creates execution record
   - Sets status to 'pending'

2. engine.run(executionId)
   - Loads execution from store
   - Enters step loop:
   
   while (not terminal state) {
     3. Load current step from flow
     4. Resolve step input from context
     5. Execute handler
     6. Process result:
        - success: store output, transition to onSuccess
        - failure: store error, transition to onFailure
        - wait: set wakeAt, pause execution
     7. Save execution to store
   }

3. Return final execution state
```

### Waiting and Resumption

When a handler returns `Result.wait()`, the execution pauses:

```typescript
// Handler returns wait
return Result.wait({
  wakeAt: Date.now() + 3600000,
  reason: 'Waiting for external approval',
});

// Later: resume with data
await engine.resume(executionId, { approved: true });
```

The engine supports two wake mechanisms:

1. **Scheduled Wake**: A background process polls for executions where `wakeAt <= now`
2. **External Resume**: Call `engine.resume()` with data to immediately continue

## Production Setup

### PostgreSQL Store

```typescript
import { Pool } from 'pg';
import { createPgStores, applySchema } from '@flowmonkey/postgres';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// Apply schema (run once at startup or in migrations)
await applySchema(pool);

// Create stores
const { executionStore, flowStore, jobStore, eventStore } = createPgStores(pool);

const engine = new Engine(executionStore, handlers, flows);
```

### Redis Coordination

For distributed deployments, use Redis for locking and signaling:

```typescript
import Redis from 'ioredis';
import { RedisLockManager, RedisWakeSignaler } from '@flowmonkey/redis';

const redis = new Redis(process.env.REDIS_URL);

// Distributed locking prevents concurrent execution of same workflow
const lockManager = new RedisLockManager(redis);

// Wake signaling notifies other instances when an execution should wake
const signaler = new RedisWakeSignaler(redis);
```

### Express Integration

For a complete REST API:

```typescript
import express from 'express';
import { Pool } from 'pg';
import { FlowMonkeyExpress } from '@flowmonkey/express';
import { httpHandler, delayHandler } from '@flowmonkey/handlers';

const app = express();
app.use(express.json());

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const flowmonkey = await FlowMonkeyExpress.builder()
  .app(app)
  .database(pool)
  .handler(httpHandler)
  .handler(delayHandler)
  .flow(myWorkflow)
  .build();

app.listen(3000);
```

This registers routes for:
- `POST /api/flows/:flowId/start` - Start execution
- `GET /api/executions/:executionId` - Get status
- `POST /api/executions/:executionId/cancel` - Cancel execution
- `POST /api/tokens/:token/resume` - Resume with token
- `GET /health` - Health check

### Triggers

Start flows from HTTP webhooks or cron schedules:

```typescript
import { TriggerService } from '@flowmonkey/triggers';

const triggers = new TriggerService(triggerStore, engine, {
  http: { app, framework: 'express', basePath: '/webhooks' },
  schedule: { enabled: true, timezone: 'UTC' },
});

// HTTP trigger - creates route POST /webhooks/order-webhook
await triggers.register({
  id: 'order-webhook',
  type: 'http',
  flowId: 'process-order',
  enabled: true,
  inputSchema: { type: 'object', required: ['orderId'] },
  contextKey: 'order',
});

// Schedule trigger - runs daily at 9am
await triggers.register({
  id: 'daily-report',
  type: 'schedule',
  flowId: 'generate-report',
  enabled: true,
  schedule: '0 9 * * *',
  timezone: 'America/New_York',
});
```

## Development

### Prerequisites

- Node.js 20+
- pnpm 8+

### Setup

```bash
# Clone repository
git clone https://github.com/francismario/flowmonkey.git
cd flowmonkey

# Install dependencies
pnpm install

# Build all packages
pnpm build
```

### Commands

```bash
# Run all tests
pnpm test

# Run tests in watch mode
pnpm test:watch

# Type check all packages
pnpm typecheck

# Development mode (watch)
pnpm dev

# Run tests for specific package
pnpm --filter @flowmonkey/core test
```

### Project Structure

```
flowmonkey/
  packages/
    core/          # Engine, types, interfaces, memory store
    handlers/      # Pre-built step handlers
    express/       # Express integration
    postgres/      # PostgreSQL persistence
    redis/         # Redis caching and coordination
    jobs/          # Background job runner
    triggers/      # HTTP and cron triggers
  docs/            # Additional documentation
  package.json     # Root workspace config
  pnpm-workspace.yaml
```

### Testing

Use the `TestHarness` for easy flow testing:

```typescript
import { TestHarness } from '@flowmonkey/core/test';

describe('Order Flow', () => {
  const harness = new TestHarness({
    handlers: [validateHandler, paymentHandler],
    flows: [orderFlow],
  });

  it('completes valid orders', async () => {
    const { execution } = await harness.run('process-order', {
      order: { id: '123', total: 100 },
    });
    
    harness.assertCompleted(execution);
    harness.assertContext(execution, {
      payment: { status: 'success' },
    });
  });

  it('fails invalid orders', async () => {
    const { execution } = await harness.run('process-order', {
      order: { id: '123', total: -100 },
    });
    
    harness.assertFailed(execution);
  });
});
```

## API Reference

### Engine

```typescript
class Engine {
  // Create a new execution
  create(flowId: string, context: object, options?: CreateOptions): Promise<CreateResult>
  
  // Run an execution to completion or wait
  run(executionId: string, options?: RunOptions): Promise<Execution>
  
  // Execute a single step
  step(executionId: string): Promise<StepResult>
  
  // Resume a waiting execution
  resume(executionId: string, data?: object): Promise<Execution>
  
  // Cancel an execution
  cancel(executionId: string, options?: CancelOptions): Promise<CancelResult>
}

interface CreateOptions {
  tenantId?: string;
  idempotencyKey?: string;
  idempotencyTTL?: number;
  parentExecutionId?: string;
  timeoutConfig?: TimeoutConfig;
  metadata?: Record<string, unknown>;
}
```

### Result Helpers

```typescript
import { Result } from '@flowmonkey/core';

// Success - store output and continue
Result.success(output)

// Failure - store error and transition to onFailure
Result.failure({ code: 'ERROR_CODE', message: 'Description' })

// Wait - pause execution until wake or resume
Result.wait({ wakeAt: timestamp, reason: 'Waiting for...' })
```

### Idempotency

Prevent duplicate executions:

```typescript
const { execution, created } = await engine.create('process-order', 
  { orderId: '12345' },
  {
    idempotencyKey: 'order-12345',
    idempotencyTTL: 24 * 60 * 60 * 1000, // 24 hours
  }
);

if (!created) {
  console.log('Execution already exists:', execution.id);
}
```

### Cancellation

Cancel running or waiting executions:

```typescript
const result = await engine.cancel(executionId, {
  source: 'user',
  reason: 'Customer requested cancellation',
});

if (result.cancelled) {
  console.log('Execution cancelled');
} else {
  console.log('Cannot cancel:', result.error);
}
```

## License

MIT
