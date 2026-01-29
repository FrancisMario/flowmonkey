# @flowmonkey/triggers

HTTP and schedule triggers for starting FlowMonkey workflows.

This package provides triggers that automatically start workflows based on external events like HTTP webhooks or cron schedules.

## Table of Contents

- [Installation](#installation)
- [Overview](#overview)
- [TriggerService](#triggerservice)
  - [Configuration](#configuration)
  - [Registering Triggers](#registering-triggers)
- [HTTP Triggers](#http-triggers)
  - [Basic HTTP Trigger](#basic-http-trigger)
  - [Input Validation](#input-validation)
  - [Authentication](#authentication)
  - [Framework Adapters](#framework-adapters)
- [Schedule Triggers](#schedule-triggers)
  - [Cron Expressions](#cron-expressions)
  - [Timezones](#timezones)
  - [Static Context](#static-context)
- [Trigger Management](#trigger-management)
- [Storage](#storage)
- [API Reference](#api-reference)

## Installation

```bash
pnpm add @flowmonkey/triggers
```

## Overview

Triggers start workflow executions automatically based on external events:

- **HTTP Triggers** - Start workflows when HTTP requests are received
- **Schedule Triggers** - Start workflows on cron schedules

```
                        +------------------+
HTTP Request  --------> |                  |
                        |  TriggerService  | -----> Engine.create()
Cron Schedule --------> |                  |
                        +------------------+
```

## TriggerService

The TriggerService manages trigger registration and execution.

### Configuration

```typescript
import express from 'express';
import { TriggerService, PgTriggerStore } from '@flowmonkey/triggers';
import { Engine } from '@flowmonkey/core';

const app = express();
app.use(express.json());

const triggerStore = new PgTriggerStore(pool);
const engine = new Engine(store, handlers, flows);

const triggers = new TriggerService(triggerStore, engine, {
  // HTTP adapter - auto-registers routes
  http: {
    app,                       // Express app instance
    framework: 'express',      // 'express' | 'fastify' | 'hono' | 'koa'
    basePath: '/webhooks',     // Base path for trigger routes
    middleware: [],            // Optional middleware
  },
  
  // Schedule adapter - auto-starts scheduler
  schedule: {
    enabled: true,
    timezone: 'UTC',           // Default timezone
    checkInterval: 60000,      // Check every minute
  },
});
```

### Registering Triggers

```typescript
// Register an HTTP trigger
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
// Route created: POST /webhooks/order-webhook

// Register a schedule trigger
await triggers.register({
  id: 'daily-report',
  type: 'schedule',
  name: 'Daily Report',
  flowId: 'generate-report',
  enabled: true,
  schedule: '0 9 * * *',      // 9am daily
  timezone: 'America/New_York',
  staticContext: { reportType: 'daily' },
});
// Scheduled: Next run at 9:00 AM ET
```

## HTTP Triggers

HTTP triggers create endpoints that start workflows when called.

### Basic HTTP Trigger

```typescript
await triggers.register({
  id: 'user-signup',
  type: 'http',
  name: 'User Signup Webhook',
  flowId: 'onboard-user',
  enabled: true,
  contextKey: 'user', // Request body stored at context.user
});
```

When a POST request is made to `/webhooks/user-signup`:

```bash
curl -X POST http://localhost:3000/webhooks/user-signup \
  -H "Content-Type: application/json" \
  -d '{"email": "user@example.com", "name": "Alice"}'
```

The workflow starts with context:

```typescript
{
  user: {
    email: 'user@example.com',
    name: 'Alice',
  },
  _trigger: {
    id: 'user-signup',
    type: 'http',
    timestamp: 1706500000000,
  },
}
```

### Input Validation

Validate incoming requests using JSON Schema:

```typescript
await triggers.register({
  id: 'payment-webhook',
  type: 'http',
  name: 'Payment Webhook',
  flowId: 'process-payment',
  enabled: true,
  inputSchema: {
    type: 'object',
    properties: {
      transactionId: { type: 'string', minLength: 10 },
      amount: { type: 'number', minimum: 0 },
      currency: { type: 'string', enum: ['USD', 'EUR', 'GBP'] },
      customer: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          email: { type: 'string', format: 'email' },
        },
        required: ['id'],
      },
    },
    required: ['transactionId', 'amount', 'currency'],
  },
  contextKey: 'payment',
});
```

Invalid requests receive a 400 response:

```json
{
  "error": "Validation failed",
  "details": [
    { "path": "/amount", "message": "must be >= 0" }
  ]
}
```

### Authentication

Add authentication middleware:

```typescript
const triggers = new TriggerService(triggerStore, engine, {
  http: {
    app,
    framework: 'express',
    basePath: '/webhooks',
    middleware: [
      // API key authentication
      (req, res, next) => {
        const apiKey = req.headers['x-api-key'];
        if (!apiKey || !isValidApiKey(apiKey)) {
          return res.status(401).json({ error: 'Invalid API key' });
        }
        next();
      },
    ],
  },
});
```

Or use per-trigger authentication:

```typescript
await triggers.register({
  id: 'secure-webhook',
  type: 'http',
  flowId: 'secure-flow',
  enabled: true,
  config: {
    // Webhook signature verification
    signatureHeader: 'X-Webhook-Signature',
    signatureSecret: process.env.WEBHOOK_SECRET,
    signatureAlgorithm: 'sha256',
  },
});
```

### Framework Adapters

The TriggerService supports multiple web frameworks:

#### Express

```typescript
import express from 'express';

const app = express();
app.use(express.json());

const triggers = new TriggerService(store, engine, {
  http: { app, framework: 'express', basePath: '/webhooks' },
});
```

#### Fastify

```typescript
import Fastify from 'fastify';

const app = Fastify();

const triggers = new TriggerService(store, engine, {
  http: { app, framework: 'fastify', basePath: '/webhooks' },
});
```

#### Hono

```typescript
import { Hono } from 'hono';

const app = new Hono();

const triggers = new TriggerService(store, engine, {
  http: { app, framework: 'hono', basePath: '/webhooks' },
});
```

#### Koa

```typescript
import Koa from 'koa';
import Router from '@koa/router';

const app = new Koa();
const router = new Router();

const triggers = new TriggerService(store, engine, {
  http: { app: router, framework: 'koa', basePath: '/webhooks' },
});

app.use(router.routes());
```

## Schedule Triggers

Schedule triggers start workflows on cron schedules.

### Cron Expressions

Standard cron format with optional seconds:

```
┌─────────── second (0-59) [optional]
│ ┌───────── minute (0-59)
│ │ ┌─────── hour (0-23)
│ │ │ ┌───── day of month (1-31)
│ │ │ │ ┌─── month (1-12 or JAN-DEC)
│ │ │ │ │ ┌─ day of week (0-6 or SUN-SAT)
│ │ │ │ │ │
* * * * * *
```

Examples:

```typescript
// Every minute
await triggers.register({
  id: 'every-minute',
  type: 'schedule',
  flowId: 'health-check',
  schedule: '* * * * *',
});

// Every hour at minute 0
await triggers.register({
  id: 'hourly',
  type: 'schedule',
  flowId: 'hourly-sync',
  schedule: '0 * * * *',
});

// Daily at 9am
await triggers.register({
  id: 'daily-9am',
  type: 'schedule',
  flowId: 'daily-report',
  schedule: '0 9 * * *',
});

// Every Monday at 8am
await triggers.register({
  id: 'weekly-monday',
  type: 'schedule',
  flowId: 'weekly-digest',
  schedule: '0 8 * * 1',
});

// First day of every month at midnight
await triggers.register({
  id: 'monthly',
  type: 'schedule',
  flowId: 'monthly-billing',
  schedule: '0 0 1 * *',
});

// Every 15 minutes
await triggers.register({
  id: 'every-15-min',
  type: 'schedule',
  flowId: 'queue-processor',
  schedule: '*/15 * * * *',
});

// Weekdays at 6pm
await triggers.register({
  id: 'weekday-evening',
  type: 'schedule',
  flowId: 'end-of-day',
  schedule: '0 18 * * 1-5',
});
```

### Timezones

Specify timezone for schedule interpretation:

```typescript
await triggers.register({
  id: 'daily-report-nyc',
  type: 'schedule',
  flowId: 'generate-report',
  schedule: '0 9 * * *',      // 9am
  timezone: 'America/New_York', // In Eastern Time
});

await triggers.register({
  id: 'daily-report-london',
  type: 'schedule',
  flowId: 'generate-report',
  schedule: '0 9 * * *',      // 9am
  timezone: 'Europe/London',    // In UK Time
});
```

If timezone is not specified, the service default is used (configurable, defaults to UTC).

### Static Context

Provide static data to scheduled workflows:

```typescript
await triggers.register({
  id: 'daily-sales-report',
  type: 'schedule',
  flowId: 'generate-report',
  schedule: '0 8 * * *',
  timezone: 'America/Chicago',
  staticContext: {
    reportType: 'sales',
    period: 'daily',
    recipients: ['sales@company.com', 'manager@company.com'],
  },
});
```

The workflow starts with context:

```typescript
{
  reportType: 'sales',
  period: 'daily',
  recipients: ['sales@company.com', 'manager@company.com'],
  _trigger: {
    id: 'daily-sales-report',
    type: 'schedule',
    scheduledAt: 1706500000000,
    firedAt: 1706500001234,
  },
}
```

## Trigger Management

### Listing Triggers

```typescript
// Get all triggers
const allTriggers = await triggers.list();

// Filter by type
const httpTriggers = await triggers.list({ type: 'http' });
const scheduleTriggers = await triggers.list({ type: 'schedule' });

// Filter by flow
const orderTriggers = await triggers.list({ flowId: 'process-order' });
```

### Updating Triggers

```typescript
// Disable a trigger
await triggers.update('order-webhook', { enabled: false });

// Update schedule
await triggers.update('daily-report', {
  schedule: '0 10 * * *', // Changed to 10am
});

// Update input schema
await triggers.update('user-signup', {
  inputSchema: {
    type: 'object',
    properties: {
      email: { type: 'string', format: 'email' },
      name: { type: 'string' },
      company: { type: 'string' }, // New field
    },
    required: ['email', 'name'],
  },
});
```

### Deleting Triggers

```typescript
// Delete a trigger
await triggers.delete('old-webhook');

// Delete removes route/schedule automatically
```

### Manual Trigger Execution

```typescript
// Fire a trigger manually (useful for testing)
const execution = await triggers.fire('daily-report', {
  // Optional override context
  testMode: true,
});
```

## Storage

### PgTriggerStore

Store triggers in PostgreSQL:

```typescript
import { PgTriggerStore } from '@flowmonkey/triggers';

const triggerStore = new PgTriggerStore(pool);

// The store creates this table:
// CREATE TABLE fm_triggers (
//   id TEXT PRIMARY KEY,
//   type TEXT NOT NULL,
//   name TEXT,
//   flow_id TEXT NOT NULL,
//   enabled BOOLEAN DEFAULT true,
//   config JSONB,
//   created_at BIGINT,
//   updated_at BIGINT
// );
```

### MemoryTriggerStore

For testing:

```typescript
import { MemoryTriggerStore } from '@flowmonkey/triggers';

const triggerStore = new MemoryTriggerStore();
```

## API Reference

### TriggerService

```typescript
class TriggerService {
  constructor(
    store: TriggerStore,
    engine: Engine,
    options?: TriggerServiceOptions
  );

  // Register a new trigger
  register(trigger: CreateTrigger): Promise<Trigger>;

  // Update an existing trigger
  update(id: string, updates: Partial<Trigger>): Promise<Trigger>;

  // Delete a trigger
  delete(id: string): Promise<void>;

  // Get a trigger by ID
  get(id: string): Promise<Trigger | undefined>;

  // List triggers
  list(filter?: TriggerFilter): Promise<Trigger[]>;

  // Manually fire a trigger
  fire(id: string, contextOverride?: object): Promise<Execution>;

  // Shutdown (stops scheduler)
  shutdown(): Promise<void>;
}

interface TriggerServiceOptions {
  http?: {
    app: any;
    framework: 'express' | 'fastify' | 'hono' | 'koa';
    basePath?: string;
    middleware?: any[];
  };
  schedule?: {
    enabled: boolean;
    timezone?: string;
    checkInterval?: number;
  };
}
```

### Trigger Types

```typescript
interface BaseTrigger {
  id: string;
  name?: string;
  flowId: string;
  enabled: boolean;
  createdAt?: number;
  updatedAt?: number;
}

interface HttpTrigger extends BaseTrigger {
  type: 'http';
  inputSchema?: JSONSchema;
  contextKey?: string;
  config?: {
    signatureHeader?: string;
    signatureSecret?: string;
    signatureAlgorithm?: string;
  };
}

interface ScheduleTrigger extends BaseTrigger {
  type: 'schedule';
  schedule: string;          // Cron expression
  timezone?: string;
  staticContext?: object;
  lastRunAt?: number;
  nextRunAt?: number;
}

type Trigger = HttpTrigger | ScheduleTrigger;
```

### Creating Triggers

```typescript
interface CreateHttpTrigger {
  type: 'http';
  name?: string;
  flowId: string;
  enabled?: boolean;
  inputSchema?: JSONSchema;
  contextKey?: string;
  config?: object;
}

interface CreateScheduleTrigger {
  type: 'schedule';
  name?: string;
  flowId: string;
  enabled?: boolean;
  schedule: string;
  timezone?: string;
  staticContext?: object;
}

type CreateTrigger = CreateHttpTrigger | CreateScheduleTrigger;
```

### TriggerStore Interface

```typescript
interface TriggerStore {
  create(trigger: Trigger): Promise<void>;
  get(id: string): Promise<Trigger | undefined>;
  update(id: string, trigger: Partial<Trigger>): Promise<void>;
  delete(id: string): Promise<void>;
  list(filter?: TriggerFilter): Promise<Trigger[]>;
  findSchedulesDue(before: number): Promise<ScheduleTrigger[]>;
  updateLastRun(id: string, timestamp: number): Promise<void>;
}

interface TriggerFilter {
  type?: 'http' | 'schedule';
  flowId?: string;
  enabled?: boolean;
}
```

## License

MIT
