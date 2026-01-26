# @flowmonkey/postgres

PostgreSQL persistence layer for FlowMonkey workflows.

## Installation

```bash
pnpm add @flowmonkey/postgres pg
pnpm add -D @types/pg
```

## Overview

This package provides PostgreSQL implementations of FlowMonkey's storage interfaces:

- **PgExecutionStore** — Execution persistence
- **PgFlowStore** — Flow definition storage
- **PgJobStore** — Background job queue
- **PgEventStore** — Event/audit logging
- **PgContextStorage** — Large context storage
- **PgResumeTokenManager** — Resume token management

## Quick Start

```typescript
import { Pool } from 'pg';
import { Engine, DefaultFlowRegistry, DefaultHandlerRegistry } from '@flowmonkey/core';
import { createPgStores, applySchema } from '@flowmonkey/postgres';

// Create connection pool
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

// Apply schema (run once at startup/migration)
await applySchema(pool);

// Create stores
const { executionStore, flowStore, jobStore, eventStore } = createPgStores(pool);

// Create engine with Postgres stores
const handlers = new DefaultHandlerRegistry();
const flows = new DefaultFlowRegistry();

const engine = new Engine(executionStore, handlers, flows);

// Use normally
const { execution } = await engine.create('my-flow', { data: 'value' });
await engine.run(execution.id);
```

## Schema

The schema creates the following tables:

```sql
-- Executions
CREATE TABLE fm_executions (
  id              TEXT PRIMARY KEY,
  flow_id         TEXT NOT NULL,
  flow_version    TEXT NOT NULL,
  current_step    TEXT NOT NULL,
  status          TEXT NOT NULL,
  context         JSONB NOT NULL DEFAULT '{}',
  wake_at         BIGINT,
  wait_reason     TEXT,
  error           JSONB,
  step_count      INTEGER NOT NULL DEFAULT 0,
  history         JSONB,
  tenant_id       TEXT,
  metadata        JSONB,
  created_at      BIGINT NOT NULL,
  updated_at      BIGINT NOT NULL,
  -- V1 fields
  idempotency_key       TEXT,
  idempotency_expires_at BIGINT,
  cancellation          JSONB,
  parent_execution_id   TEXT,
  wait_started_at       BIGINT,
  timeout_config        JSONB
);

-- Flows
CREATE TABLE fm_flows (
  id              TEXT NOT NULL,
  version         TEXT NOT NULL,
  name            TEXT,
  definition      JSONB NOT NULL,
  created_at      BIGINT NOT NULL,
  PRIMARY KEY (id, version)
);

-- Jobs (for stateful handlers)
CREATE TABLE fm_jobs (
  id              TEXT PRIMARY KEY,
  execution_id    TEXT NOT NULL REFERENCES fm_executions(id),
  step_id         TEXT NOT NULL,
  handler         TEXT NOT NULL,
  status          TEXT NOT NULL,
  input           JSONB NOT NULL,
  result          JSONB,
  error           JSONB,
  runner_id       TEXT,
  heartbeat_at    BIGINT,
  attempts        INTEGER NOT NULL DEFAULT 0,
  max_attempts    INTEGER NOT NULL DEFAULT 3,
  created_at      BIGINT NOT NULL,
  updated_at      BIGINT NOT NULL
);

-- Events (audit log)
CREATE TABLE fm_events (
  id              BIGSERIAL PRIMARY KEY,
  execution_id    TEXT NOT NULL,
  event_type      TEXT NOT NULL,
  step_id         TEXT,
  data            JSONB,
  created_at      BIGINT NOT NULL
);

-- Resume tokens
CREATE TABLE fm_resume_tokens (
  token           TEXT PRIMARY KEY,
  execution_id    TEXT NOT NULL REFERENCES fm_executions(id),
  step_id         TEXT NOT NULL,
  status          TEXT NOT NULL,
  metadata        JSONB,
  created_at      BIGINT NOT NULL,
  expires_at      BIGINT NOT NULL
);
```

## Store APIs

### PgExecutionStore

```typescript
import { PgExecutionStore } from '@flowmonkey/postgres';

const store = new PgExecutionStore(pool);

// CRUD operations
await store.create(execution);
const exec = await store.get(executionId);
await store.update(execution);
await store.delete(executionId);

// Query operations
const waiting = await store.findWaiting(100);
const running = await store.findByStatus('running', 50);

// V1 operations
const existing = await store.findByIdempotencyKey('flow-id', 'key');
const children = await store.findChildren(parentExecutionId);
const timedOut = await store.findTimedOutExecutions(100);
const timedOutWaits = await store.findTimedOutWaits(100);
```

### PgFlowStore

```typescript
import { PgFlowStore } from '@flowmonkey/postgres';

const flowStore = new PgFlowStore(pool);

// Store a flow
await flowStore.save(flow);

// Retrieve flows
const flow = flowStore.get('my-flow', '1.0.0');
const latest = flowStore.latest('my-flow');
const versions = flowStore.versions('my-flow');
const all = flowStore.list();

// Load all flows from database
await flowStore.loadAll();
```

### PgJobStore

```typescript
import { PgJobStore } from '@flowmonkey/postgres';

const jobStore = new PgJobStore(pool);

// Create a job
const job = await jobStore.create({
  executionId: 'exec-123',
  stepId: 'step-1',
  handler: 'email-send',
  input: { to: 'user@example.com', subject: 'Hello' },
  maxAttempts: 3,
});

// Claim and execute jobs (used by job runner)
const claimed = await jobStore.claim(jobId, runnerId);
await jobStore.heartbeat(jobId);
await jobStore.complete(jobId, result);
await jobStore.fail(jobId, error);

// Query jobs
const pending = await jobStore.listByStatus('pending', 10);
const stalled = await jobStore.findStalled(Date.now(), 10);
const forExecution = await jobStore.getByExecution(executionId);
```

### PgEventStore

```typescript
import { PgEventStore } from '@flowmonkey/postgres';

const eventStore = new PgEventStore(pool);

// Record events
await eventStore.record({
  executionId: 'exec-123',
  eventType: 'step.completed',
  stepId: 'step-1',
  data: { output: { result: 'success' } },
});

// Query events
const events = await eventStore.query({
  executionId: 'exec-123',
  eventTypes: ['step.started', 'step.completed'],
  after: timestamp,
  limit: 100,
});
```

### PgResumeTokenManager

```typescript
import { PgResumeTokenManager } from '@flowmonkey/postgres';

const tokenManager = new PgResumeTokenManager(pool);

// Generate a resume token
const token = await tokenManager.generate(executionId, stepId, {
  expiresIn: 7 * 24 * 60 * 60 * 1000, // 7 days
  metadata: { approver: 'manager@example.com' },
});

// Validate and use tokens
const info = await tokenManager.get(token);
const isValid = await tokenManager.validate(token);
await tokenManager.markUsed(token);
await tokenManager.revoke(token);

// Cleanup
const cleaned = await tokenManager.cleanupExpired();
```

## Factory Function

Use `createPgStores` for convenient setup:

```typescript
import { createPgStores } from '@flowmonkey/postgres';

const {
  executionStore,
  flowStore,
  jobStore,
  eventStore,
  contextStorage,
  resumeTokenManager,
} = createPgStores(pool, {
  tablePrefix: 'fm_',  // Optional: customize table prefix
});
```

## Connection Management

### Production Configuration

```typescript
import { Pool } from 'pg';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  
  // Pool sizing
  max: 20,                        // Maximum connections
  min: 5,                         // Minimum connections
  idleTimeoutMillis: 30000,       // Close idle connections after 30s
  connectionTimeoutMillis: 5000,  // Connection timeout
  
  // SSL for production
  ssl: process.env.NODE_ENV === 'production' ? {
    rejectUnauthorized: true,
    ca: process.env.PG_CA_CERT,
  } : false,
  
  // Statement timeout
  statement_timeout: 30000,
});

// Health check
pool.on('error', (err) => {
  console.error('Unexpected pool error', err);
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  await pool.end();
});
```

### Migrations

For production, use a migration tool:

```typescript
// migrations/001_initial.ts
import { schema } from '@flowmonkey/postgres';

export async function up(pool: Pool) {
  await pool.query(schema);
}

export async function down(pool: Pool) {
  await pool.query(`
    DROP TABLE IF EXISTS fm_resume_tokens;
    DROP TABLE IF EXISTS fm_events;
    DROP TABLE IF EXISTS fm_jobs;
    DROP TABLE IF EXISTS fm_flows;
    DROP TABLE IF EXISTS fm_flow_versions;
    DROP TABLE IF EXISTS fm_executions;
  `);
}
```

## Performance Tips

1. **Index frequently queried fields:**
   ```sql
   CREATE INDEX idx_exec_custom ON fm_executions((metadata->>'customField'));
   ```

2. **Partition large tables by date:**
   ```sql
   CREATE TABLE fm_events (
     ...
   ) PARTITION BY RANGE (created_at);
   ```

3. **Archive old executions:**
   ```sql
   -- Move completed executions older than 30 days
   INSERT INTO fm_executions_archive
   SELECT * FROM fm_executions
   WHERE status IN ('completed', 'failed', 'cancelled')
     AND updated_at < extract(epoch from now() - interval '30 days') * 1000;
   ```

4. **Monitor connection pool:**
   ```typescript
   setInterval(() => {
     console.log({
       total: pool.totalCount,
       idle: pool.idleCount,
       waiting: pool.waitingCount,
     });
   }, 60000);
   ```

## License

MIT
