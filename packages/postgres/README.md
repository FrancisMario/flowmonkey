# @flowmonkey/postgres

PostgreSQL persistence layer for FlowMonkey workflows.

This package provides production-ready PostgreSQL implementations of FlowMonkey's storage interfaces for executions, flows, jobs, events, and resume tokens.

## Table of Contents

- [Installation](#installation)
- [Quick Start](#quick-start)
- [Schema](#schema)
- [Stores](#stores)
  - [PgExecutionStore](#pgexecutionstore)
  - [PgFlowStore](#pgflowstore)
  - [PgJobStore](#pgjobstore)
  - [PgEventStore](#pgeventstore)
  - [PgContextStorage](#pgcontextstorage)
  - [PgResumeTokenManager](#pgresumetokenmanager)
- [Factory Function](#factory-function)
- [Connection Management](#connection-management)
- [Migrations](#migrations)
- [Performance](#performance)
- [API Reference](#api-reference)

## Installation

```bash
pnpm add @flowmonkey/postgres pg
pnpm add -D @types/pg
```

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

// Apply schema (run once at startup or via migrations)
await applySchema(pool);

// Create stores using factory
const { executionStore, flowStore, jobStore, eventStore } = createPgStores(pool);

// Set up engine with PostgreSQL persistence
const handlers = new DefaultHandlerRegistry();
const flows = new DefaultFlowRegistry();

const engine = new Engine(executionStore, handlers, flows);

// Use normally - all state persisted to PostgreSQL
const { execution } = await engine.create('my-flow', { data: 'value' });
await engine.run(execution.id);
```

## Schema

The package creates the following tables. You can apply the schema using `applySchema(pool)` or by running the SQL directly in your migration tool.

### Executions Table

Stores execution state and context:

```sql
CREATE TABLE fm_executions (
  id                    TEXT PRIMARY KEY,
  flow_id               TEXT NOT NULL,
  flow_version          TEXT NOT NULL,
  current_step          TEXT NOT NULL,
  status                TEXT NOT NULL,
  context               JSONB NOT NULL DEFAULT '{}',
  wake_at               BIGINT,
  wait_reason           TEXT,
  error                 JSONB,
  step_count            INTEGER NOT NULL DEFAULT 0,
  history               JSONB,
  tenant_id             TEXT,
  metadata              JSONB,
  created_at            BIGINT NOT NULL,
  updated_at            BIGINT NOT NULL,
  
  -- Idempotency
  idempotency_key       TEXT,
  idempotency_expires_at BIGINT,
  
  -- Cancellation
  cancellation          JSONB,
  
  -- Parent-child relationships
  parent_execution_id   TEXT,
  
  -- Wait tracking
  wait_started_at       BIGINT,
  
  -- Timeouts
  timeout_config        JSONB
);

-- Indexes for common queries
CREATE INDEX idx_fm_exec_status ON fm_executions(status);
CREATE INDEX idx_fm_exec_wake ON fm_executions(wake_at) WHERE wake_at IS NOT NULL;
CREATE INDEX idx_fm_exec_tenant ON fm_executions(tenant_id) WHERE tenant_id IS NOT NULL;
CREATE INDEX idx_fm_exec_idemp ON fm_executions(flow_id, idempotency_key) 
  WHERE idempotency_key IS NOT NULL;
CREATE INDEX idx_fm_exec_parent ON fm_executions(parent_execution_id) 
  WHERE parent_execution_id IS NOT NULL;
```

### Flows Table

Stores flow definitions with versioning:

```sql
CREATE TABLE fm_flows (
  id          TEXT NOT NULL,
  version     TEXT NOT NULL,
  name        TEXT,
  definition  JSONB NOT NULL,
  created_at  BIGINT NOT NULL,
  PRIMARY KEY (id, version)
);
```

### Jobs Table

Stores background jobs for stateful handlers:

```sql
CREATE TABLE fm_jobs (
  id            TEXT PRIMARY KEY,
  execution_id  TEXT NOT NULL REFERENCES fm_executions(id),
  step_id       TEXT NOT NULL,
  handler       TEXT NOT NULL,
  status        TEXT NOT NULL,
  input         JSONB NOT NULL,
  result        JSONB,
  error         JSONB,
  runner_id     TEXT,
  heartbeat_at  BIGINT,
  attempts      INTEGER NOT NULL DEFAULT 0,
  max_attempts  INTEGER NOT NULL DEFAULT 3,
  created_at    BIGINT NOT NULL,
  updated_at    BIGINT NOT NULL
);

CREATE INDEX idx_fm_jobs_status ON fm_jobs(status);
CREATE INDEX idx_fm_jobs_exec ON fm_jobs(execution_id);
CREATE INDEX idx_fm_jobs_stalled ON fm_jobs(heartbeat_at) 
  WHERE status = 'running';
```

### Events Table

Stores audit events:

```sql
CREATE TABLE fm_events (
  id            BIGSERIAL PRIMARY KEY,
  execution_id  TEXT NOT NULL,
  event_type    TEXT NOT NULL,
  step_id       TEXT,
  data          JSONB,
  created_at    BIGINT NOT NULL
);

CREATE INDEX idx_fm_events_exec ON fm_events(execution_id);
CREATE INDEX idx_fm_events_type ON fm_events(event_type);
```

### Resume Tokens Table

Stores tokens for resuming paused executions:

```sql
CREATE TABLE fm_resume_tokens (
  token         TEXT PRIMARY KEY,
  execution_id  TEXT NOT NULL REFERENCES fm_executions(id),
  step_id       TEXT NOT NULL,
  status        TEXT NOT NULL,
  metadata      JSONB,
  created_at    BIGINT NOT NULL,
  expires_at    BIGINT NOT NULL
);

CREATE INDEX idx_fm_tokens_exec ON fm_resume_tokens(execution_id);
CREATE INDEX idx_fm_tokens_expires ON fm_resume_tokens(expires_at);
```

## Stores

### PgExecutionStore

Implements `StateStore` for execution persistence:

```typescript
import { PgExecutionStore } from '@flowmonkey/postgres';

const store = new PgExecutionStore(pool);

// Basic CRUD
await store.create(execution);
const exec = await store.get(executionId);
await store.update(execution);
await store.delete(executionId);

// Query by status
const running = await store.findByStatus('running', 100);
const waiting = await store.findByStatus('waiting', 100);

// Find executions ready to wake
const toWake = await store.findWaiting(100);

// Idempotency lookup
const existing = await store.findByIdempotencyKey('flow-id', 'unique-key');

// Parent-child relationships
const children = await store.findChildren(parentExecutionId);

// Timeout queries
const timedOutExecutions = await store.findTimedOutExecutions(100);
const timedOutWaits = await store.findTimedOutWaits(100);
```

The store includes automatic JSON serialization for context, history, error, and other complex fields.

### PgFlowStore

Stores flow definitions with versioning:

```typescript
import { PgFlowStore } from '@flowmonkey/postgres';

const flowStore = new PgFlowStore(pool);

// Save a flow (creates new version if exists)
await flowStore.save(flow);

// Retrieve flows
const flow = flowStore.get('order-flow');          // Latest version
const v1 = flowStore.get('order-flow', '1.0.0');   // Specific version
const latest = flowStore.latest('order-flow');     // Latest version info
const versions = flowStore.versions('order-flow'); // All versions

// List all flows
const allFlows = flowStore.list();

// Load all flows from database into memory
await flowStore.loadAll();
```

The flow store caches flows in memory after loading. Call `loadAll()` at startup to populate the cache.

### PgJobStore

Manages background jobs for stateful handlers:

```typescript
import { PgJobStore } from '@flowmonkey/postgres';

const jobStore = new PgJobStore(pool);

// Create a job
const job = await jobStore.create({
  executionId: 'exec-123',
  stepId: 'send-email',
  handler: 'email-send',
  input: { to: 'user@example.com', subject: 'Hello' },
  maxAttempts: 3,
});

// Claim a job for processing (atomic operation)
const claimed = await jobStore.claim(job.id, 'worker-1');

// Update heartbeat while processing
await jobStore.heartbeat(job.id);

// Complete successfully
await jobStore.complete(job.id, { sent: true, messageId: 'msg-456' });

// Or fail with error
await jobStore.fail(job.id, { code: 'SMTP_ERROR', message: 'Connection refused' });

// Query jobs
const pending = await jobStore.listByStatus('pending', 10);
const stalled = await jobStore.findStalled(Date.now() - 60000, 10);
const forExecution = await jobStore.getByExecution('exec-123');

// Cleanup
const deleted = await jobStore.deleteOld(Date.now() - 7 * 24 * 60 * 60 * 1000);
```

Job states: `pending`, `running`, `completed`, `failed`

### PgEventStore

Records and queries execution events:

```typescript
import { PgEventStore } from '@flowmonkey/postgres';

const eventStore = new PgEventStore(pool);

// Record an event
await eventStore.record({
  executionId: 'exec-123',
  eventType: 'step.completed',
  stepId: 'validate-order',
  data: {
    duration: 150,
    output: { validated: true },
  },
});

// Query events
const events = await eventStore.query({
  executionId: 'exec-123',
  eventTypes: ['step.started', 'step.completed', 'step.failed'],
  after: startTimestamp,
  before: endTimestamp,
  limit: 100,
});

// Get all events for an execution
const allEvents = await eventStore.getByExecution('exec-123');

// Cleanup old events
const deleted = await eventStore.deleteOld(Date.now() - 30 * 24 * 60 * 60 * 1000);
```

Event types include:
- `execution.created`, `execution.started`, `execution.completed`, `execution.failed`, `execution.cancelled`
- `step.started`, `step.completed`, `step.failed`, `step.waiting`
- `job.created`, `job.claimed`, `job.completed`, `job.failed`

### PgContextStorage

Stores large context data separately from executions:

```typescript
import { PgContextStorage } from '@flowmonkey/postgres';

const contextStorage = new PgContextStorage(pool);

// Store context data
await contextStorage.set(executionId, 'largeData', bigJsonObject);

// Retrieve context data
const data = await contextStorage.get(executionId, 'largeData');

// Delete context data
await contextStorage.delete(executionId, 'largeData');

// Clear all context for an execution
await contextStorage.clearExecution(executionId);
```

Use this for storing large intermediate results that should not bloat the main execution record.

### PgResumeTokenManager

Manages resume tokens for paused executions:

```typescript
import { PgResumeTokenManager } from '@flowmonkey/postgres';

const tokenManager = new PgResumeTokenManager(pool);

// Generate a token
const token = await tokenManager.generate('exec-123', 'approval-step', {
  expiresIn: 7 * 24 * 60 * 60 * 1000, // 7 days
  metadata: {
    approver: 'manager@company.com',
    requestedBy: 'user@company.com',
  },
});

// Get token info
const info = await tokenManager.get(token);
// { executionId, stepId, status, metadata, createdAt, expiresAt }

// Validate before use
const isValid = await tokenManager.validate(token);

// Mark as used
await tokenManager.markUsed(token);

// Revoke (cancel) a token
await tokenManager.revoke(token);

// Get all tokens for an execution
const tokens = await tokenManager.getByExecution('exec-123');

// Cleanup expired tokens
const cleaned = await tokenManager.cleanupExpired();
```

Token states: `pending`, `used`, `revoked`, `expired`

## Factory Function

The `createPgStores` function creates all stores with shared configuration:

```typescript
import { createPgStores } from '@flowmonkey/postgres';

const stores = createPgStores(pool, {
  tablePrefix: 'fm_',  // Optional: customize table prefix
});

// Destructure the stores you need
const {
  executionStore,
  flowStore,
  jobStore,
  eventStore,
  contextStorage,
  resumeTokenManager,
} = stores;
```

## Connection Management

### Production Configuration

```typescript
import { Pool } from 'pg';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  
  // Pool sizing - adjust based on your workload
  max: 20,                        // Maximum connections
  min: 5,                         // Minimum connections
  idleTimeoutMillis: 30000,       // Close idle connections after 30s
  connectionTimeoutMillis: 5000,  // Connection attempt timeout
  
  // SSL for production
  ssl: process.env.NODE_ENV === 'production' ? {
    rejectUnauthorized: true,
    ca: process.env.PG_CA_CERT,
  } : false,
  
  // Statement timeout prevents runaway queries
  statement_timeout: 30000,
});

// Handle pool errors
pool.on('error', (err) => {
  console.error('Unexpected pool error:', err);
  // Consider alerting/restarting based on error type
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('Shutting down gracefully...');
  await pool.end();
  process.exit(0);
});
```

### Connection Health Check

```typescript
async function checkDatabaseHealth(): Promise<boolean> {
  try {
    const client = await pool.connect();
    await client.query('SELECT 1');
    client.release();
    return true;
  } catch (error) {
    console.error('Database health check failed:', error);
    return false;
  }
}
```

## Migrations

### Using applySchema

For development or simple deployments:

```typescript
import { applySchema } from '@flowmonkey/postgres';

// Creates all tables if they don't exist
await applySchema(pool);
```

### Using Migration Tools

For production, use a migration tool like node-pg-migrate or Knex:

```typescript
// migrations/001_initial_flowmonkey.ts
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
    DROP TABLE IF EXISTS fm_executions;
  `);
}
```

### Schema Versioning

The package exports the schema version for tracking:

```typescript
import { schemaVersion } from '@flowmonkey/postgres';

console.log(`FlowMonkey schema version: ${schemaVersion}`);
```

## Performance

### Indexing Recommendations

The default schema includes indexes for common queries. Add custom indexes based on your query patterns:

```sql
-- If you frequently query by tenant
CREATE INDEX idx_exec_tenant_status ON fm_executions(tenant_id, status);

-- If you query by metadata fields
CREATE INDEX idx_exec_customer ON fm_executions((metadata->>'customerId'));

-- If you have many events
CREATE INDEX idx_events_time ON fm_events(created_at DESC);
```

### Partitioning for Large Tables

For high-volume deployments, partition the events table:

```sql
-- Partition by month
CREATE TABLE fm_events (
  id BIGSERIAL,
  execution_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  step_id TEXT,
  data JSONB,
  created_at BIGINT NOT NULL
) PARTITION BY RANGE (created_at);

-- Create monthly partitions
CREATE TABLE fm_events_2024_01 PARTITION OF fm_events
  FOR VALUES FROM (1704067200000) TO (1706745600000);
  
CREATE TABLE fm_events_2024_02 PARTITION OF fm_events
  FOR VALUES FROM (1706745600000) TO (1709251200000);
```

### Archiving Old Data

Move old completed executions to an archive table:

```sql
-- Create archive table with same structure
CREATE TABLE fm_executions_archive (LIKE fm_executions INCLUDING ALL);

-- Archive completed executions older than 30 days
INSERT INTO fm_executions_archive
SELECT * FROM fm_executions
WHERE status IN ('completed', 'failed', 'cancelled')
  AND updated_at < extract(epoch from now() - interval '30 days') * 1000;

DELETE FROM fm_executions
WHERE status IN ('completed', 'failed', 'cancelled')
  AND updated_at < extract(epoch from now() - interval '30 days') * 1000;
```

### Monitoring Connection Pool

```typescript
setInterval(() => {
  console.log('Pool stats:', {
    total: pool.totalCount,
    idle: pool.idleCount,
    waiting: pool.waitingCount,
  });
}, 60000);
```

## API Reference

### Exports

```typescript
// Schema
export { schema, schemaVersion, applySchema } from './schema';

// Stores
export { PgExecutionStore } from './execution-store';
export { PgFlowStore } from './flow-store';
export { PgJobStore } from './job-store';
export { PgEventStore } from './event-store';
export { PgContextStorage } from './context-storage';
export { PgResumeTokenManager } from './resume-token-manager';

// Factory
export { createPgStores } from './factory';

// Types
export type { PgStoreOptions } from './factory';
```

### Store Interfaces

All stores implement their corresponding interfaces from `@flowmonkey/core`:

- `PgExecutionStore` implements `StateStore`
- `PgFlowStore` implements `FlowRegistry`
- `PgJobStore` implements `JobStore`
- `PgEventStore` implements `EventStore`
- `PgResumeTokenManager` implements `ResumeTokenManager`

## License

MIT
