# FlowMonkey

<p align="center">
  <img src="assets/mascot.png" alt="FlowMonkey" width="400" />
</p>

A minimal, production-ready workflow execution engine for TypeScript/Node.js.

[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-blue.svg)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-20+-green.svg)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

## Features

- **Stateless Engine** — Horizontal scaling without coordination
- **Pluggable Storage** — Memory, PostgreSQL, Redis support
- **Durable Execution** — Survives restarts, supports long-running workflows
- **Async & Wait** — Built-in pause/resume with wake scheduling
- **Flexible Input Resolution** — Key, path, template, and static selectors
- **Idempotency** — Built-in deduplication with configurable TTL
- **Timeouts** — Execution and wait timeouts with auto-cancellation
- **Extensible Handlers** — HTTP, delay, LLM, webhooks, and custom handlers
- **Triggers** — HTTP webhooks, cron schedules, and event-driven triggers

## Quick Start

### Installation

```bash
# Using pnpm (recommended)
pnpm add @flowmonkey/core

# Optional: Add production stores
pnpm add @flowmonkey/postgres @flowmonkey/redis

# Optional: Pre-built handlers
pnpm add @flowmonkey/handlers
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
      transitions: { onSuccess: null }, // null = complete
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
const { execution, created } = await engine.create('greeting', {
  user: { name: 'World' },
});

const result = await engine.run(execution.id, { simulateTime: true });

console.log(result.status);               // 'completed'
console.log(result.context.greeting);     // { message: 'Hello, World!' }
```

## Core Concepts

### Flows

A **Flow** is a workflow definition with steps and transitions:

```typescript
const orderFlow: Flow = {
  id: 'process-order',
  version: '1.0.0',
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
      input: { type: 'full' }, // entire context
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

### Input Selectors

Control how step input is resolved from execution context:

| Type | Example | Description |
|------|---------|-------------|
| `key` | `{ type: 'key', key: 'user' }` | Single key from context |
| `keys` | `{ type: 'keys', keys: ['user', 'order'] }` | Multiple keys |
| `path` | `{ type: 'path', path: 'user.address.city' }` | Dot notation path |
| `template` | `{ type: 'template', template: { url: '${api.url}' } }` | String interpolation |
| `full` | `{ type: 'full' }` | Entire context |
| `static` | `{ type: 'static', value: { foo: 'bar' } }` | Static value |

### Handlers

**Handlers** execute individual step types:

```typescript
const httpHandler: StepHandler = {
  type: 'http',
  metadata: {
    type: 'http',
    name: 'HTTP Request',
    description: 'Make HTTP requests',
    category: 'external', // 'control' | 'data' | 'external' | 'ai' | 'utility'
    stateful: false,
    configSchema: { /* JSON Schema */ },
  },
  async execute(params) {
    const { url, method, body } = params.input as RequestConfig;
    
    const response = await fetch(url, { method, body: JSON.stringify(body) });
    
    if (!response.ok) {
      return Result.failure({
        code: 'HTTP_ERROR',
        message: `HTTP ${response.status}`,
      });
    }
    
    return Result.success({
      status: response.status,
      body: await response.json(),
    });
  },
};
```

### Waiting & Resume

Handlers can pause execution to wait for external events:

```typescript
const approvalHandler: StepHandler = {
  type: 'wait-for-approval',
  async execute({ context }) {
    // Return a wait result
    return Result.wait({
      wakeAt: Date.now() + 7 * 24 * 60 * 60 * 1000, // 7 days
      reason: 'Waiting for manager approval',
    });
  },
};

// Later: resume with external data
await engine.resume(executionId, { approved: true, approvedBy: 'manager@co.com' });
```

### Idempotency

Prevent duplicate executions with idempotency keys:

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

## Packages

| Package | Description |
|---------|-------------|
| [@flowmonkey/core](./packages/core) | Core execution engine, types, in-memory store |
| [@flowmonkey/handlers](./packages/handlers) | Pre-built handlers (HTTP, delay, LLM, webhook) |
| [@flowmonkey/postgres](./packages/postgres) | PostgreSQL persistence (executions, flows, jobs) |
| [@flowmonkey/redis](./packages/redis) | Redis caching, locking, and signaling |
| [@flowmonkey/jobs](./packages/jobs) | Background job runner for stateful handlers |
| [@flowmonkey/triggers](./packages/triggers) | HTTP and cron triggers for starting flows |

## Production Setup

### PostgreSQL Store

```typescript
import { Pool } from 'pg';
import { createPgStores, applySchema } from '@flowmonkey/postgres';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// Apply schema (run once at startup/migration)
await applySchema(pool);

// Create stores
const { executionStore, flowStore, jobStore } = createPgStores(pool);

const engine = new Engine(executionStore, handlers, flows);
```

### Redis Coordination

```typescript
import Redis from 'ioredis';
import { RedisLockManager, RedisWakeSignaler } from '@flowmonkey/redis';

const redis = new Redis(process.env.REDIS_URL);

// Distributed locking for execution safety
const lockManager = new RedisLockManager(redis);

// Wake sleeping executions across instances
const signaler = new RedisWakeSignaler(redis);
```

### HTTP Triggers

```typescript
import express from 'express';
import { TriggerService } from '@flowmonkey/triggers';

const app = express();

// Pass app instance - routes are registered automatically
const triggers = new TriggerService(triggerStore, engine, {
  http: {
    app,                        // Express, Fastify, Hono, etc.
    framework: 'express',       // 'express' | 'fastify' | 'hono' | 'koa'
    basePath: '/webhooks',      // Base path for trigger endpoints
    middleware: [authMiddleware], // Optional middleware
  },
});

// Register an HTTP trigger - route auto-created at POST /webhooks/order-webhook
await triggers.register({
  id: 'order-webhook',
  type: 'http',
  name: 'Order Webhook',
  flowId: 'process-order',
  enabled: true,
  inputSchema: {
    type: 'object',
    properties: {
      orderId: { type: 'string' },
      items: { type: 'array' },
    },
    required: ['orderId'],
  },
  contextKey: 'order',
});

// Routes are exposed automatically:
// POST /webhooks/:triggerId -> fires the trigger
// GET  /webhooks/:triggerId -> trigger info (optional)

// If no app instance provided and HTTP trigger registered:
// Warning: HTTP trigger 'order-webhook' registered but no HTTP adapter configured.
//          Trigger will not be accessible. Pass { http: { app } } to TriggerService.
```

### Cron Schedules

```typescript
import { TriggerService } from '@flowmonkey/triggers';

// Enable schedule runner in config
const triggers = new TriggerService(triggerStore, engine, {
  http: { app, framework: 'express', basePath: '/webhooks' },
  schedule: {
    enabled: true,
    timezone: 'America/New_York',  // Default timezone
    checkInterval: 60000,          // Check every minute
  },
});

// Register a schedule trigger - scheduler auto-starts
await triggers.register({
  id: 'daily-report',
  type: 'schedule',
  name: 'Daily Report',
  flowId: 'generate-report',
  enabled: true,
  schedule: '0 9 * * *', // Daily at 9am
  timezone: 'America/New_York',
  staticContext: { reportType: 'daily' },
});

// If schedule.enabled is false and schedule trigger registered:
// Warning: Schedule trigger 'daily-report' registered but scheduler not enabled.
//          Trigger will not fire. Pass { schedule: { enabled: true } } to TriggerService.
```

## Development

### Prerequisites

- Node.js 20+
- pnpm 8+

### Setup

```bash
# Clone repository
git clone https://github.com/yourorg/flowmonkey.git
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

# Type check
pnpm typecheck

# Development mode (watch)
pnpm dev

# Run tests for specific package
pnpm --filter @flowmonkey/core test
```

### Project Structure

```
flowmonkey/
├── packages/
│   ├── core/          # Engine, types, interfaces, memory store
│   ├── handlers/      # Pre-built step handlers
│   ├── postgres/      # PostgreSQL persistence
│   ├── redis/         # Redis caching and coordination
│   ├── jobs/          # Background job runner
│   └── triggers/      # HTTP and cron triggers
├── specs/             # Design specifications
├── package.json       # Root workspace config
└── pnpm-workspace.yaml
```

## Testing

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
  
  // Resume a waiting execution
  resume(executionId: string, data?: object): Promise<Execution>
  
  // Cancel an execution
  cancel(executionId: string, options?: CancelOptions): Promise<CancelResult>
  
  // Execute a single step
  step(executionId: string): Promise<StepResult>
}

interface CreateOptions {
  tenantId?: string;
  idempotencyKey?: string;
  idempotencyTTL?: number;
  parentExecutionId?: string;
  timeoutConfig?: TimeoutConfig;
  metadata?: Record<string, unknown>;
}

interface CancelOptions {
  source?: CancellationSource;  // 'user' | 'timeout' | 'system' | 'parent'
  reason?: string;
}
```

### Result Helpers

```typescript
import { Result } from '@flowmonkey/core';

// Success result
Result.success(output)

// Failure result
Result.failure({ code: 'ERROR_CODE', message: 'Description' })

// Wait result (pause execution)
Result.wait({ wakeAt: timestamp, reason: 'Waiting for...' })
```

## License

MIT © FlowMonkey Contributors
