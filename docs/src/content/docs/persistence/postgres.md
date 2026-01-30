---
title: PostgreSQL Store
description: Production-grade PostgreSQL persistence for FlowMonkey.
---

# PostgreSQL Store

`@flowmonkey/postgres` provides production-grade persistence using PostgreSQL.

## Installation

```bash
pnpm add @flowmonkey/postgres pg
```

## Setup

```typescript
import { Pool } from 'pg';
import { PgExecutionStore, applySchema } from '@flowmonkey/postgres';

// Create connection pool
const pool = new Pool({
  host: 'localhost',
  database: 'flowmonkey',
  user: 'postgres',
  password: 'password'
});

// Apply database schema
await applySchema(pool);

// Create store
const store = new PgExecutionStore(pool);

// Use with engine
const engine = new Engine(store, handlers, flows);
```

## Schema

The schema is automatically applied with `applySchema()`:

```sql
CREATE TABLE IF NOT EXISTS executions (
  id TEXT PRIMARY KEY,
  flow_id TEXT NOT NULL,
  flow_version TEXT NOT NULL,
  tenant_id TEXT,
  status TEXT NOT NULL,
  context JSONB NOT NULL,
  history JSONB NOT NULL DEFAULT '[]',
  error JSONB,
  wait_metadata JSONB,
  cancellation JSONB,
  idempotency_key TEXT UNIQUE,
  idempotency_expires_at BIGINT,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  completed_at BIGINT,
  failed_at BIGINT,
  cancelled_at BIGINT
);

CREATE INDEX idx_executions_status ON executions(status);
CREATE INDEX idx_executions_tenant ON executions(tenant_id);
CREATE INDEX idx_executions_idempotency ON executions(idempotency_key);
```

## Additional Queries

The PostgreSQL store supports extended queries:

```typescript
// Find by status
const waiting = await store.findByStatus('waiting');

// Find by tenant
const tenantExecutions = await store.findByTenant('tenant-1');

// Find wake-ready executions
const toWake = await store.findWakeReady(Date.now());
```

## Connection Pool

For production, configure the pool appropriately:

```typescript
const pool = new Pool({
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  max: 20,              // Max connections
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000
});
```

## Transactions

For complex operations, use transactions:

```typescript
const client = await pool.connect();
try {
  await client.query('BEGIN');
  // Multiple operations...
  await client.query('COMMIT');
} catch (e) {
  await client.query('ROLLBACK');
  throw e;
} finally {
  client.release();
}
```
