# @flowmonkey/triggers

HTTP and schedule triggers for starting FlowMonkey workflows.

## Installation

```bash
pnpm add @flowmonkey/triggers
```

## Overview

This package provides triggers to start workflows from external events:

- **HTTP Triggers** — Receive webhooks/API calls
- **Schedule Triggers** — Run on cron schedules
- **TriggerService** — Trigger management and execution

## Quick Start

```typescript
import express from 'express';
import { TriggerService } from '@flowmonkey/triggers';
import { PgTriggerStore } from '@flowmonkey/triggers';
import { Engine } from '@flowmonkey/core';

const app = express();
app.use(express.json());

// Create trigger store
const triggerStore = new PgTriggerStore(pool);

// Create trigger service with HTTP and schedule adapters
const triggers = new TriggerService(triggerStore, engine, {
  // HTTP adapter - routes auto-registered
  http: {
    app,
    framework: 'express',    // 'express' | 'fastify' | 'hono' | 'koa'
    basePath: '/webhooks',   // POST /webhooks/:triggerId
    middleware: [],          // Optional auth middleware
  },
  // Schedule adapter - cron runner auto-started
  schedule: {
    enabled: true,
    timezone: 'UTC',
    checkInterval: 60000,
  },
});

// Register HTTP trigger - route auto-created
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
      customer: { type: 'object' },
      items: { type: 'array' },
    },
    required: ['orderId', 'items'],
  },
  contextKey: 'order',
});
// -> Route registered: POST /webhooks/order-webhook

// Register schedule trigger - auto-scheduled
await triggers.register({
  id: 'daily-report',
  type: 'schedule',
  name: 'Daily Report',
  flowId: 'generate-report',
  enabled: true,
  schedule: '0 9 * * *',  // 9am daily
  timezone: 'America/New_York',
  staticContext: { reportType: 'daily' },
});
// -> Scheduled: daily-report (next run: 2024-01-02 09:00 EST)
```

## HTTP Triggers

### Framework Adapters

The TriggerService automatically registers routes when you provide an app instance:

```typescript
// Express
import express from 'express';
const app = express();

const triggers = new TriggerService(store, engine, {
  http: { app, framework: 'express', basePath: '/webhooks' },
});

// Fastify
import Fastify from 'fastify';
const fastify = Fastify();

const triggers = new TriggerService(store, engine, {
  http: { app: fastify, framework: 'fastify', basePath: '/webhooks' },
});

// Hono
import { Hono } from 'hono';
const hono = new Hono();

const triggers = new TriggerService(store, engine, {
  http: { app: hono, framework: 'hono', basePath: '/webhooks' },
});
```

### Auto-Registered Routes

When a trigger is registered, routes are automatically created:

| Method | Path | Description |
|--------|------|-------------|
| POST | `/webhooks/:triggerId` | Fire trigger with payload |
| GET | `/webhooks/:triggerId` | Get trigger info (if enabled) |

### No App Instance Warning

If you register an HTTP trigger without providing an app instance:

```typescript
const triggers = new TriggerService(store, engine); // No http config!

await triggers.register({
  id: 'my-webhook',
  type: 'http',
  // ...
});
// Warning: HTTP trigger 'my-webhook' registered but no HTTP adapter configured.
//          Trigger endpoint will not be accessible.
//          To fix: Pass { http: { app, framework } } to TriggerService constructor.
```

### Custom Response Handling

Customize responses via config:

```typescript
const triggers = new TriggerService(store, engine, {
  http: {
    app,
    framework: 'express',
    basePath: '/webhooks',
    // Custom response formatter
    formatResponse: (result) => ({
      ok: true,
      execution_id: result.executionId,
      triggered_at: result.firedAt,
    }),
    // Custom error formatter
    formatError: (error) => ({
      ok: false,
      error: error.code,
      message: error.message,
      details: error.details,
    }),
  },
});
```

### Input Validation

HTTP triggers validate incoming payloads against JSON Schema:

```typescript
await triggerService.register({
  id: 'user-signup',
  type: 'http',
  name: 'User Signup',
  flowId: 'onboard-user',
  enabled: true,
  inputSchema: {
    type: 'object',
    properties: {
      email: {
        type: 'string',
        format: 'email',
      },
      name: {
        type: 'string',
        minLength: 1,
        maxLength: 100,
      },
      plan: {
        type: 'string',
        enum: ['free', 'pro', 'enterprise'],
      },
    },
    required: ['email', 'name'],
    additionalProperties: false,
  },
  contextKey: 'user',  // Payload stored at context.user
});
```

### Validation Errors

```typescript
// Invalid request
POST /webhooks/user-signup
{
  "email": "invalid-email",
  "name": ""
}

// Response (400)
{
  "error": "Validation failed",
  "details": [
    { "path": "email", "message": "must be a valid email" },
    { "path": "name", "message": "must have at least 1 character" }
  ]
}
```

## Schedule Triggers

### Cron Syntax

```
┌───────────── minute (0-59)
│ ┌───────────── hour (0-23)
│ │ ┌───────────── day of month (1-31)
│ │ │ ┌───────────── month (1-12)
│ │ │ │ ┌───────────── day of week (0-7, 0 and 7 are Sunday)
│ │ │ │ │
* * * * *
```

### Examples

```typescript
// Every minute
schedule: '* * * * *'

// Every hour at minute 0
schedule: '0 * * * *'

// Daily at 9am
schedule: '0 9 * * *'

// Monday-Friday at 9am
schedule: '0 9 * * 1-5'

// First day of month at midnight
schedule: '0 0 1 * *'

// Every 15 minutes
schedule: '*/15 * * * *'
```

## Schedule Triggers

### Enabling the Scheduler

```typescript
const triggers = new TriggerService(store, engine, {
  schedule: {
    enabled: true,           // Auto-start scheduler
    checkInterval: 60000,    // Check every minute
    timezone: 'UTC',         // Default timezone
  },
});
```

### No Scheduler Warning

If you register a schedule trigger without enabling the scheduler:

```typescript
const triggers = new TriggerService(store, engine); // No schedule config!

await triggers.register({
  id: 'daily-report',
  type: 'schedule',
  schedule: '0 9 * * *',
  // ...
});
// Warning: Schedule trigger 'daily-report' registered but scheduler not enabled.
//          Trigger will never fire.
//          To fix: Pass { schedule: { enabled: true } } to TriggerService constructor.
```

### Timezone Support

```typescript
await triggerService.register({
  id: 'daily-report',
  type: 'schedule',
  flowId: 'generate-report',
  enabled: true,
  schedule: '0 9 * * *',
  timezone: 'America/New_York',  // Runs at 9am ET
  staticContext: {},
});
```

## Trigger Service API

```typescript
interface TriggerServiceConfig {
  // HTTP adapter for webhook triggers
  http?: {
    app: any;                      // Express, Fastify, Hono, etc.
    framework: 'express' | 'fastify' | 'hono' | 'koa';
    basePath?: string;             // Default: '/triggers'
    middleware?: Function[];       // Global middleware
    formatResponse?: (result: FireResult) => unknown;
    formatError?: (error: Error) => unknown;
    infoEndpoint?: boolean;        // Enable GET /:triggerId (default: false)
  };
  
  // Schedule adapter for cron triggers
  schedule?: {
    enabled: boolean;              // Enable scheduler
    checkInterval?: number;        // Default: 60000 (1 min)
    timezone?: string;             // Default: 'UTC'
  };
}

interface TriggerService {
  // Register a new trigger (auto-registers routes/schedules)
  register(trigger: Trigger): Promise<void>;
  
  // Update trigger (updates routes/schedules)
  update(id: string, updates: Partial<Trigger>): Promise<void>;
  
  // Delete trigger (removes routes/schedules)
  delete(id: string): Promise<void>;
  
  // Get trigger by ID
  get(id: string): Promise<Trigger | undefined>;
  
  // List all triggers
  list(filter?: TriggerFilter): Promise<Trigger[]>;
  
  // Fire a trigger programmatically
  fire(triggerId: string, payload: unknown): Promise<FireResult>;
  
  // Enable/disable trigger
  enable(id: string): Promise<void>;
  disable(id: string): Promise<void>;
  
  // Graceful shutdown
  shutdown(): Promise<void>;
  
  // Health check
  isHealthy(): Promise<boolean>;
}

interface FireResult {
  executionId: string;
  triggerId: string;
  flowId: string;
  firedAt: number;
}
```

## Trigger Types

### HTTP Trigger

```typescript
interface HttpTrigger {
  id: string;
  type: 'http';
  name: string;
  description?: string;
  flowId: string;
  enabled: boolean;
  inputSchema: JSONSchema;  // Validation schema
  contextKey: string;       // Where to store payload
  createdAt: number;
  updatedAt: number;
}
```

### Schedule Trigger

```typescript
interface ScheduleTrigger {
  id: string;
  type: 'schedule';
  name: string;
  description?: string;
  flowId: string;
  enabled: boolean;
  schedule: string;         // Cron expression
  timezone: string;         // IANA timezone
  staticContext: object;    // Context passed to flow
  lastRunAt?: number;       // Last execution time
  nextRunAt?: number;       // Computed next run
  createdAt: number;
  updatedAt: number;
}
```

## Authentication

Pass authentication middleware via config:

```typescript
// API key middleware
const apiKeyAuth = (req, res, next) => {
  const apiKey = req.headers['x-api-key'];
  if (!apiKey || !isValidApiKey(apiKey)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
};

// Webhook signature verification
const verifySignature = (req, res, next) => {
  const signature = req.headers['x-webhook-signature'];
  const payload = JSON.stringify(req.body);
  
  const expected = crypto
    .createHmac('sha256', process.env.WEBHOOK_SECRET)
    .update(payload)
    .digest('hex');
  
  if (signature !== expected) {
    return res.status(401).json({ error: 'Invalid signature' });
  }
  
  next();
};

// Apply middleware to all trigger routes
const triggers = new TriggerService(store, engine, {
  http: {
    app,
    framework: 'express',
    basePath: '/webhooks',
    middleware: [apiKeyAuth, verifySignature], // Applied to all routes
  },
});

// Or per-trigger authentication via trigger config
await triggers.register({
  id: 'secure-webhook',
  type: 'http',
  flowId: 'process-secure',
  enabled: true,
  auth: {
    type: 'hmac',
    secret: process.env.WEBHOOK_SECRET,
    header: 'x-signature',
  },
  // ...
});
```

## Monitoring

```typescript
// Track trigger executions
triggerService.on('fired', ({ triggerId, executionId, duration }) => {
  metrics.histogram('trigger.fire.duration', duration, { triggerId });
  metrics.increment('trigger.fired', { triggerId });
});

triggerService.on('error', ({ triggerId, error }) => {
  metrics.increment('trigger.error', { triggerId, code: error.code });
});

// Track schedule runs
scheduler.on('run', ({ triggerId, nextRunAt }) => {
  metrics.increment('schedule.run', { triggerId });
});

scheduler.on('missed', ({ triggerId, expectedAt }) => {
  metrics.increment('schedule.missed', { triggerId });
});
```

## Database Schema

```sql
CREATE TABLE fm_triggers (
  id              TEXT PRIMARY KEY,
  type            TEXT NOT NULL CHECK (type IN ('http', 'schedule')),
  name            TEXT NOT NULL,
  description     TEXT,
  flow_id         TEXT NOT NULL,
  enabled         BOOLEAN NOT NULL DEFAULT true,
  config          JSONB NOT NULL,
  last_run_at     BIGINT,
  next_run_at     BIGINT,
  created_at      BIGINT NOT NULL,
  updated_at      BIGINT NOT NULL
);

CREATE INDEX idx_triggers_flow ON fm_triggers(flow_id);
CREATE INDEX idx_triggers_enabled ON fm_triggers(enabled) WHERE enabled = true;
CREATE INDEX idx_triggers_next_run ON fm_triggers(next_run_at) WHERE type = 'schedule';
```

## License

MIT
