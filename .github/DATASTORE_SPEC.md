# DataStore Spec — Tables, Pipes & Dynamic Data

**Date:** February 18, 2026
**Status:** Approved Design
**Version:** 0.1.0

---

## Executive Summary

FlowMonkey gains a **typed table store** with a **pipe-based ingestion system**. Users create arbitrary tables (Airtable-style) with defined column types. Pipes tap step outputs on the flow graph and silently route data into tables. Failed writes go to a local **write-ahead log** for eventual retry.

**Key Principles:**
- Tables are fully dynamic — users create any number with custom columns
- Pipes are silent taps — they never fail flows
- Critical writes use the `table-insert` handler (explicit step, failable)
- Type enforcement happens at hookup (flow registration) and insert time
- Shared-mode first, per-tenant-DB later — same interfaces, different `PoolProvider`

---

## Table of Contents

1. [Types & Definitions](#1-types--definitions)
2. [Pipes](#2-pipes)
3. [Interfaces](#3-interfaces)
4. [Engine Integration](#4-engine-integration)
5. [Hookup Validation](#5-hookup-validation)
6. [Write-Ahead Log (DLQ)](#6-write-ahead-log-dlq)
7. [DDL Provider](#7-ddl-provider)
8. [Pool Provider & Multi-Tenancy](#8-pool-provider--multi-tenancy)
9. [Postgres Schema](#9-postgres-schema)
10. [EventBus Extensions](#10-eventbus-extensions)
11. [Service Tokens & DI](#11-service-tokens--di)
12. [API Routes](#12-api-routes)
13. [Handler: table-insert](#13-handler-table-insert)
14. [Implementation Plan](#14-implementation-plan)
15. [Future: Per-Tenant DB Architecture](#15-future-per-tenant-db-architecture)

---

## 1. Types & Definitions

### Column Types

Five types, mapping to native Postgres types:

| ColumnType   | Postgres Type | Notes                              |
|-------------|---------------|-------------------------------------|
| `string`    | `TEXT`        | Universal text                      |
| `number`    | `NUMERIC`    | Integers and floats                 |
| `boolean`   | `BOOLEAN`    | True/false                          |
| `datetime`  | `BIGINT`     | Epoch ms (matches project convention) |
| `json`      | `JSONB`      | Escape hatch for nested/complex data |

### ColumnDef

```typescript
type ColumnType = 'string' | 'number' | 'boolean' | 'datetime' | 'json';

interface ColumnDef {
  /** UUID identifier */
  readonly id: string;
  /** Display label shown in UI (e.g., "Email", "Amount") */
  readonly name: string;
  /** Data type — validated on pipe hookup and insert */
  readonly type: ColumnType;
  /** Whether a value is required on insert */
  readonly required: boolean;
}
```

### TableDef

```typescript
interface TableDef {
  /** UUID identifier (e.g., "tbl_a1b2c3d4") */
  readonly id: string;
  /** Column definitions (ordered for display) */
  readonly columns: ColumnDef[];
  /** Creation timestamp (epoch ms) */
  readonly createdAt: number;
  /** Last modification timestamp (epoch ms) */
  readonly updatedAt: number;
}
```

**Design decisions:**
- No human-readable names on tables — the UI layer above FlowMonkey handles labeling
- Tables identified by UUID only
- Columns identified by UUID only
- No foreign keys between tables — tables are independent
- No indexes, unique constraints, or primary keys beyond `_id` — kept minimal
- Schema evolution: add columns only, remove = soft delete (column hidden, data preserved in JSONB)

### Row

```typescript
/** Row data: column UUID → value */
type Row = Record<string, unknown>;
```

Row keys are column UUIDs. The UI layer resolves UUIDs to display names using `TableDef.columns`.

Example stored row:
```json
{
  "col_abc123": "alice@example.com",
  "col_def456": 99.50,
  "col_ghi789": true
}
```

### RowFilter & RowQuery

```typescript
interface RowFilter {
  /** Column UUID */
  column: string;
  /** Comparison operator */
  op: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'like' | 'in';
  /** Value to compare against */
  value: unknown;
}

interface RowQuery {
  tableId: string;
  tenantId?: string;
  filters?: RowFilter[];
  orderBy?: { column: string; direction: 'asc' | 'desc' };
  limit?: number;
  offset?: number;
}
```

---

## 2. Pipes

Pipes are **silent taps** on step output edges. They intercept data flowing between steps and route fields into table columns.

### Data Flow

```
Step A ─── outputKey:'result' ──────────→ Step B
                    │
               ┌────┴──────────────┐
               │ Pipe 'log-calls'  │
               │  table: tbl_xyz   │
               │  mapping:         │
               │   url → col_aa    │  (string → string ✓)
               │   status → col_bb │  (number → number ✓)
               │   body → col_cc   │  (object → json ✓)
               └────┬──────────────┘
                    ↓
             Table tbl_xyz
```

### PipeDef

```typescript
interface PipeFieldMapping {
  /** Path in the step output (dot notation) */
  readonly sourcePath: string;
  /** Target column UUID in the table */
  readonly columnId: string;
}

interface PipeDef {
  /** UUID */
  readonly id: string;
  /** Which step's output to tap */
  readonly stepId: string;
  /** Which outcome to tap (default: 'success') */
  readonly on?: 'success' | 'failure' | 'any';
  /** Target table UUID */
  readonly tableId: string;
  /** Field-to-column mappings */
  readonly mappings: PipeFieldMapping[];
  /** Static values included in every row */
  readonly staticValues?: Record<string, unknown>;
  /** Enable/disable without removing (default: true) */
  readonly enabled?: boolean;
}
```

### Flow Extension

Pipes are declared at the flow level:

```typescript
interface Flow {
  // ... all existing fields unchanged ...

  /** Pipes: tap step outputs into tables */
  readonly pipes?: PipeDef[];
}
```

### Pipe Behavior

- **Fire-and-forget** — pipe failures NEVER fail the flow
- **No strict mode** — if you need a critical write, use the `table-insert` handler (explicit step)
- **Silent failures** — on error, emit `onPipeFailed` event + write to WAL
- **Type validation at hookup** — caught at flow registration, not runtime

### Example Flow with Pipes

```typescript
const flow: Flow = {
  id: 'process-order',
  version: '1.0.0',
  initialStepId: 'validate',
  steps: {
    validate: {
      id: 'validate',
      type: 'transform',
      config: {},
      input: { type: 'key', key: 'order' },
      outputKey: 'validated',
      transitions: { onSuccess: 'charge' }
    },
    charge: {
      id: 'charge',
      type: 'http',
      config: { url: 'https://pay.example.com/charge' },
      input: { type: 'key', key: 'validated' },
      outputKey: 'payment',
      transitions: { onSuccess: null, onFailure: 'notify-failure' }
    }
  },
  pipes: [
    {
      id: 'pipe_001',
      stepId: 'charge',
      on: 'success',
      tableId: 'tbl_payments',
      mappings: [
        { sourcePath: 'transactionId', column: 'col_txn_id' },
        { sourcePath: 'amount',        column: 'col_amount' },
        { sourcePath: 'currency',      column: 'col_currency' },
      ],
      staticValues: { col_source: 'process-order' }
    },
    {
      id: 'pipe_002',
      stepId: 'charge',
      on: 'failure',
      tableId: 'tbl_payment_errors',
      mappings: [
        { sourcePath: 'code',    column: 'col_err_code' },
        { sourcePath: 'message', column: 'col_err_msg' },
      ]
    }
  ]
};
```

---

## 3. Interfaces

### TableRegistry

```typescript
interface TableRegistry {
  /** Create a new table — triggers DDL (CREATE TABLE) */
  create(table: TableDef): Promise<void>;

  /** Get table definition by ID */
  get(id: string): Promise<TableDef | undefined>;

  /** List all table definitions */
  list(): Promise<TableDef[]>;

  /** Delete a table and all its data — triggers DDL (DROP TABLE) */
  delete(id: string): Promise<boolean>;

  /** Add a column to an existing table — triggers DDL (ALTER TABLE ADD COLUMN) */
  addColumn(tableId: string, column: ColumnDef): Promise<void>;

  /** Remove a column (soft delete: column hidden, data preserved) */
  removeColumn(tableId: string, columnId: string): Promise<void>;

  /** Validate all pipes in a flow against registered tables */
  validatePipes(flow: Flow): Promise<HookupResult>;
}
```

### TableStore

```typescript
interface TableStore {
  /** Insert a row — returns generated row ID */
  insert(tableId: string, row: Row, tenantId?: string): Promise<string>;

  /** Insert multiple rows — returns generated row IDs */
  insertBatch(tableId: string, rows: Row[], tenantId?: string): Promise<string[]>;

  /** Get a row by ID */
  get(tableId: string, rowId: string, tenantId?: string): Promise<Row | null>;

  /** Query rows with filters */
  query(query: RowQuery): Promise<{ rows: Row[]; total: number }>;

  /** Update a row by ID */
  update(tableId: string, rowId: string, changes: Partial<Row>, tenantId?: string): Promise<boolean>;

  /** Delete a row by ID */
  delete(tableId: string, rowId: string, tenantId?: string): Promise<boolean>;

  /** Count rows matching query */
  count(query: Omit<RowQuery, 'limit' | 'offset' | 'orderBy'>): Promise<number>;
}
```

### PoolProvider

The abstraction that enables shared-mode and per-tenant-mode:

```typescript
interface PoolProvider {
  /** Get a pool for table operations. Shared mode ignores tenantId. */
  acquire(tenantId?: string): Promise<Pool>;

  /** Release pool resources (no-op for shared mode) */
  release(tenantId?: string): Promise<void>;
}
```

**Implementations:**

| Class | Mode | Behavior |
|---|---|---|
| `SharedPoolProvider` | Build now | Returns the same pool for all tenants |
| `TenantPoolProvider` | Build later | Returns tenant-specific pool, auto-wakes stopped containers |

---

## 4. Engine Integration

### Pipeline Position

Pipes execute in `applyResult()`, **after** storing output and saving execution state, **before** transitioning:

```
resolve input → execute handler → store output → save execution
                                                       ↓
                                                  execute matching pipes
                                                  (fire-and-forget)
                                                       │
                                              ┌────────┼────────┐
                                              ↓        ↓        ↓
                                          success   success   FAIL
                                            ↓         ↓        ↓
                                     table insert  table ins  WAL append
                                            ↓         ↓        ↓
                                     onPipeInserted  ...    onPipeFailed
                                                       ↓
                                                  transition to next step
```

**Critical:** execution state is saved BEFORE pipes run. If all pipes fail, the execution still transitions correctly. Pipes have zero impact on the execution pipeline.

### Engine Options Extension

```typescript
interface EngineOptions {
  // ... all existing fields unchanged ...

  /** Table store for pipe writes (optional — pipes skipped if absent) */
  tableStore?: TableStore;

  /** Table registry for pipe validation (optional) */
  tableRegistry?: TableRegistry;

  /** Write-ahead log for failed pipe writes (optional — failures silent if absent) */
  pipeWAL?: WriteAheadLog;
}
```

All three are optional. If `tableStore` is not provided, pipes in flows are silently skipped. Full backward compatibility.

### Pipe Execution in Engine

```typescript
// Inside applyResult(), after saving execution, before transition:

if (this.tableStore && flow.pipes?.length) {
  const outcome = result.outcome === 'success' ? 'success' : 'failure';
  const matchingPipes = flow.pipes.filter(p =>
    p.enabled !== false &&
    p.stepId === step.id &&
    (p.on === 'any' || (p.on ?? 'success') === outcome)
  );

  for (const pipe of matchingPipes) {
    try {
      const row = this.buildPipeRow(pipe, result.output, execution);
      const rowId = await this.tableStore.insert(
        pipe.tableId, row, execution.tenantId
      );
      this.events?.onPipeInserted?.({
        executionId: execution.id,
        stepId: step.id,
        pipeId: pipe.id,
        tableId: pipe.tableId,
        rowId,
      });
    } catch (err) {
      this.events?.onPipeFailed?.({
        executionId: execution.id,
        stepId: step.id,
        pipeId: pipe.id,
        tableId: pipe.tableId,
        error: { code: 'PIPE_ERROR', message: err.message },
      });

      // Queue for retry via WAL
      await this.pipeWAL?.append({
        id: generateId(),
        tableId: pipe.tableId,
        tenantId: execution.tenantId,
        data: row,
        pipeId: pipe.id,
        executionId: execution.id,
        flowId: execution.flowId,
        stepId: step.id,
        error: err.message,
        attempts: 0,
        createdAt: now(),
      });
    }
  }
}
```

### Build Pipe Row

```typescript
private buildPipeRow(
  pipe: PipeDef,
  output: unknown,
  execution: Execution
): Row {
  const row: Row = {};

  // Map step output fields to column IDs
  for (const mapping of pipe.mappings) {
    row[mapping.columnId] = getPath(output, mapping.sourcePath);
  }

  // Add static values
  if (pipe.staticValues) {
    Object.assign(row, pipe.staticValues);
  }

  return row;
}
```

---

## 5. Hookup Validation

When a flow is registered, pipes are validated against the table registry. This catches errors at build time, not runtime.

### Validation Result

```typescript
interface HookupResult {
  valid: boolean;
  errors: HookupError[];
}

interface HookupError {
  pipeId: string;
  field: string;
  code: 'TABLE_NOT_FOUND' | 'COLUMN_NOT_FOUND' | 'TYPE_MISMATCH' | 'MISSING_REQUIRED';
  message: string;
}
```

### Validation Rules

1. **Table exists:** `tableId` must exist in `TableRegistry`
2. **Columns exist:** every `mapping.columnId` must exist in the table
3. **Type compatibility:** source type (inferred from handler metadata) must match column type
4. **Required columns mapped:** all columns with `required: true` must appear in mappings or `staticValues`

### Row Validation on Insert

Type enforcement also happens at insert time (defense in depth):

```typescript
function validateRow(table: TableDef, row: Row): void {
  for (const col of table.columns) {
    const value = row[col.id];

    if (value === undefined || value === null) {
      if (col.required) {
        throw new Error(`Column "${col.name}" (${col.id}) is required`);
      }
      continue;
    }

    switch (col.type) {
      case 'string':
        if (typeof value !== 'string')
          throw new TypeError(`${col.name}: expected string, got ${typeof value}`);
        break;
      case 'number':
        if (typeof value !== 'number')
          throw new TypeError(`${col.name}: expected number, got ${typeof value}`);
        break;
      case 'boolean':
        if (typeof value !== 'boolean')
          throw new TypeError(`${col.name}: expected boolean, got ${typeof value}`);
        break;
      case 'datetime':
        if (typeof value !== 'number')
          throw new TypeError(`${col.name}: expected epoch ms (number), got ${typeof value}`);
        break;
      case 'json':
        break; // any JSON-serializable value
    }
  }
}
```

---

## 6. Write-Ahead Log (DLQ)

Failed pipe writes go to a local WAL file for eventual retry. The WAL lives on **local disk**, not in the database — because the most likely failure mode is the database being down.

### Why Not Database DLQ?

```
Postgres down
  → pipe write to user table fails
    → DLQ write to Postgres also fails (same infra!)
      → data lost

With WAL:
Postgres down
  → pipe write fails
    → WAL appends to local disk (almost never fails)
      → background job retries when DB is back
```

### WAL Interface

```typescript
interface WALEntry {
  id: string;
  tableId: string;
  tenantId?: string;
  data: Row;
  pipeId: string;
  executionId: string;
  flowId: string;
  stepId: string;
  error: string;
  attempts: number;
  createdAt: number;
}

interface WriteAheadLog {
  /** Append a failed row — single write, minimal failure modes */
  append(entry: WALEntry): Promise<void>;

  /** Read entries ready for retry */
  readPending(limit?: number): Promise<WALEntry[]>;

  /** Mark entry as successfully replayed */
  ack(id: string): Promise<void>;

  /** Compact — remove acked entries, reclaim disk space */
  compact(): Promise<void>;
}
```

### Implementations

| Class | Use Case | Storage |
|---|---|---|
| `MemoryWAL` | Dev/testing | In-memory buffer, lost on restart |
| `FileWAL` | Production single-instance | JSONL file on disk |

### FileWAL Storage Format

Append-only JSONL (one JSON object per line):

```
data/pipes.wal:
{"id":"w_1","tableId":"tbl_abc","data":{"col_xx":99},"attempts":0,"createdAt":1739900000000,...}
{"id":"w_2","tableId":"tbl_def","data":{"col_yy":"hello"},"attempts":0,"createdAt":1739900001000,...}

data/pipes.wal.acked:
w_1
```

- **Write:** `fs.appendFile()` — one syscall, atomic for small writes
- **Read:** Stream file line by line, skip IDs in `.acked` file
- **Ack:** Append ID to `.acked` sidecar file
- **Compact:** Rewrite main file excluding acked entries (periodic)

### WAL Replay Job

Background job retries failed writes with exponential backoff:

```typescript
const BACKOFF = [5_000, 30_000, 120_000, 600_000, 3_600_000]; // 5s, 30s, 2m, 10m, 1h
const MAX_ATTEMPTS = 5;

async function replayWAL(
  wal: WriteAheadLog,
  tableStore: TableStore,
  events?: EventBus
) {
  const entries = await wal.readPending(50);

  for (const entry of entries) {
    try {
      await tableStore.insert(entry.tableId, entry.data, entry.tenantId);
      await wal.ack(entry.id);
    } catch (err) {
      const attempt = entry.attempts + 1;
      if (attempt >= MAX_ATTEMPTS) {
        await wal.ack(entry.id); // give up, remove from WAL
        events?.onPipeDiscarded?.({
          executionId: entry.executionId,
          pipeId: entry.pipeId,
          tableId: entry.tableId,
          attempts: attempt,
          error: err.message,
        });
      }
      // else: leave in WAL, retry on next pass
    }
  }

  await wal.compact();
}
```

### Ordering Note

Rows from the WAL will appear **out of order** relative to the execution timeline. A row from execution #100 might land after rows from execution #200. This is acceptable because:
- Every row has `_created_at` (original timestamp, not retry timestamp)
- Every row has `_execution_id` — timeline can be reconstructed
- Tables are analytical/operational stores, not event logs

---

## 7. DDL Provider

Table management operations (CREATE TABLE, ALTER TABLE, DROP TABLE) go through a `DDLProvider`. This enables direct execution now and infrastructure-as-code integration later.

### Interface

```typescript
interface DDLOperation {
  type: 'create-table' | 'drop-table' | 'add-column' | 'remove-column';
  tableId: string;
  pgTableName: string;
  spec: unknown;    // TableDef for create, ColumnDef for add-column, etc.
  sql: string;      // the SQL FlowMonkey would run — IaC can use or ignore
  timestamp: number;
}

interface DDLProvider {
  /** Emit a DDL operation. Returns when acknowledged. */
  emit(op: DDLOperation): Promise<void>;
}
```

### Implementations

| Class | Mode | Behavior |
|---|---|---|
| `DirectDDLProvider` | Default | Runs `pool.query(op.sql)` immediately |
| `FileDDLProvider` | IaC | Appends SQL to migration files for human review |
| `WebhookDDLProvider` | IaC | POSTs to external system (Terraform Cloud, CI pipeline) |

### DirectDDLProvider (Default)

```typescript
class DirectDDLProvider implements DDLProvider {
  constructor(private pool: Pool) {}

  async emit(op: DDLOperation): Promise<void> {
    await this.pool.query(op.sql);
  }
}
```

### Safe Name Generation

Since user-created table/column IDs are UUIDs, they must be sanitized for use as Postgres identifiers:

```typescript
function pgTableName(tableId: string): string {
  return 'fm_tbl_' + tableId.replace(/[^a-z0-9]/gi, '_').toLowerCase();
}

function pgColumnName(columnId: string): string {
  return 'col_' + columnId.replace(/[^a-z0-9]/gi, '_').toLowerCase();
}

function safeName(name: string): string {
  if (!/^[a-z0-9_]+$/.test(name)) {
    throw new Error(`Invalid identifier: ${name}`);
  }
  return `"${name}"`;
}
```

All generated names go through `pgTableName()` / `pgColumnName()` → `safeName()` before hitting SQL. No user-supplied strings are ever interpolated directly.

---

## 8. Pool Provider & Multi-Tenancy

### Core Interface

```typescript
interface PoolProvider {
  /** Get a pool for table operations. Shared mode ignores tenantId. */
  acquire(tenantId?: string): Promise<Pool>;

  /** Release pool resources (no-op for shared mode) */
  release(tenantId?: string): Promise<void>;
}
```

### Mode 1: Shared (Build Now)

All tenants share one Postgres instance. Tables have a `_tenant_id` column for row isolation.

```typescript
class SharedPoolProvider implements PoolProvider {
  constructor(private pool: Pool) {}

  async acquire(): Promise<Pool> {
    return this.pool;
  }

  async release(): Promise<void> {
    // no-op
  }
}
```

Row layout in shared mode:
```
fm_tbl_abc123
┌──────┬────────────┬──────────┬──────────┬──────────────┬────────────┐
│ _id  │ _tenant_id │ col_xx   │ col_yy   │ _created_at  │ _updated_at│
├──────┼────────────┼──────────┼──────────┼──────────────┼────────────┤
│ r_1  │ tenant-a   │ "hello"  │ 42       │ 173990...    │ 173990...  │
│ r_2  │ tenant-b   │ "world"  │ 99       │ 173990...    │ 173990...  │
└──────┴────────────┴──────────┴──────────┴──────────────┴────────────┘
```

### Mode 2: Per-Tenant DB (Build Later)

Each tenant gets a dedicated Postgres container. No `_tenant_id` column needed — the entire DB is the tenant's isolation boundary.

```typescript
class TenantPoolProvider implements PoolProvider {
  private pools = new Map<string, Pool>();

  async acquire(tenantId: string): Promise<Pool> {
    if (this.pools.has(tenantId)) return this.pools.get(tenantId)!;

    const config = await this.lookupTenantDb(tenantId);

    if (config.status === 'stopped') {
      await this.wake(tenantId);
    }

    const pool = new Pool(config);
    this.pools.set(tenantId, pool);
    return pool;
  }

  async release(tenantId: string): Promise<void> {
    const pool = this.pools.get(tenantId);
    if (pool) {
      await pool.end();
      this.pools.delete(tenantId);
    }
  }
}
```

Row layout in per-tenant mode:
```
fm_tbl_abc123  (in tenant-a's dedicated DB)
┌──────┬──────────┬──────────┬──────────────┬────────────┐
│ _id  │ col_xx   │ col_yy   │ _created_at  │ _updated_at│
├──────┼──────────┼──────────┼──────────────┼────────────┤
│ r_1  │ "hello"  │ 42       │ 173990...    │ 173990...  │
└──────┴──────────┴──────────┴──────────────┴────────────┘
```

### Extended Interface (Platform Layer, Not Core)

```typescript
type TenantTier = 'shared' | 'dedicated' | 'enterprise';

interface ManagedPoolProvider extends PoolProvider {
  provision(tenantId: string, tier?: TenantTier): Promise<void>;
  deprovision(tenantId: string, removeData?: boolean): Promise<void>;
  upgrade(tenantId: string, newTier: TenantTier): Promise<void>;
  downgrade(tenantId: string, newTier: TenantTier): Promise<void>;
  hibernate(tenantId: string): Promise<void>;
  wake(tenantId: string): Promise<void>;
  health(tenantId: string): Promise<'active' | 'stopped' | 'unhealthy' | 'not_found'>;
}
```

FlowMonkey core only knows `PoolProvider`. The platform layer optionally uses `ManagedPoolProvider` for full lifecycle management.

---

## 9. Postgres Schema

### Shared DB: Table Metadata

```sql
-- Table definitions (metadata for all user-created tables)
CREATE TABLE IF NOT EXISTS fm_tables (
  id          TEXT PRIMARY KEY,
  columns     JSONB NOT NULL,      -- ColumnDef[]
  pg_table    TEXT NOT NULL,        -- actual postgres table name: "fm_tbl_abc123"
  created_at  BIGINT NOT NULL,
  updated_at  BIGINT NOT NULL
);
```

### Dynamically Created User Tables

Each user table gets a real Postgres table via DDLProvider:

```sql
-- Example: user creates a table with 3 columns
CREATE TABLE fm_tbl_abc123 (
  _id          TEXT PRIMARY KEY,
  _tenant_id   TEXT,                 -- only in shared mode
  _created_at  BIGINT NOT NULL,
  _updated_at  BIGINT NOT NULL,
  col_aaa111   TEXT NOT NULL,        -- "Email" (string, required)
  col_bbb222   NUMERIC,             -- "Amount" (number, optional)
  col_ccc333   BOOLEAN NOT NULL      -- "Active" (boolean, required)
);

-- Standard indexes on every user table
CREATE INDEX IF NOT EXISTS idx_fm_tbl_abc123_tenant
  ON fm_tbl_abc123(_tenant_id) WHERE _tenant_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_fm_tbl_abc123_created
  ON fm_tbl_abc123(_created_at);
```

### Auto-Generated Row Metadata Columns

Every user table row automatically gets:

| Column | Type | Source |
|---|---|---|
| `_id` | TEXT (UUID) | Auto-generated |
| `_tenant_id` | TEXT | From execution (shared mode only) |
| `_created_at` | BIGINT | Insertion timestamp (epoch ms) |
| `_updated_at` | BIGINT | Last update timestamp (epoch ms) |

These are real Postgres columns (not in JSONB), always available for filtering.

### Schema Operations

```sql
-- Add column
ALTER TABLE fm_tbl_abc123 ADD COLUMN col_ddd444 JSONB;

-- Soft-remove column (rename to hide, data preserved)
ALTER TABLE fm_tbl_abc123 RENAME COLUMN col_ddd444 TO _deleted_col_ddd444;

-- Drop table
DROP TABLE IF EXISTS fm_tbl_abc123;
```

### Future: Tenant DB Registry

```sql
-- Only needed for per-tenant mode (built later)
CREATE TABLE IF NOT EXISTS fm_tenant_placements (
  tenant_id     TEXT PRIMARY KEY,
  tier          TEXT NOT NULL CHECK (tier IN ('shared', 'dedicated', 'enterprise')),
  pool_id       TEXT,
  host          TEXT NOT NULL,
  port          INTEGER NOT NULL,
  database      TEXT NOT NULL,
  schema_name   TEXT,
  container_id  TEXT,
  volume_name   TEXT,
  status        TEXT NOT NULL DEFAULT 'active',
  created_at    BIGINT NOT NULL,
  updated_at    BIGINT NOT NULL
);
```

---

## 10. EventBus Extensions

```typescript
interface EventBus {
  // ... all existing events unchanged ...

  /** Emitted when a pipe successfully inserts a row */
  onPipeInserted?(e: {
    executionId: string;
    stepId: string;
    pipeId: string;
    tableId: string;
    rowId: string;
  }): void;

  /** Emitted when a pipe fails to insert (row queued in WAL) */
  onPipeFailed?(e: {
    executionId: string;
    stepId: string;
    pipeId: string;
    tableId: string;
    error: { code: string; message: string };
  }): void;

  /** Emitted when a WAL entry permanently fails after max retry attempts */
  onPipeDiscarded?(e: {
    executionId: string;
    pipeId: string;
    tableId: string;
    attempts: number;
    error: string;
  }): void;
}
```

---

## 11. Service Tokens & DI

### New Service Tokens

```typescript
const ServiceTokens = {
  // ... all existing tokens unchanged ...

  TableRegistry:   Symbol.for('fm:TableRegistry'),
  TableStore:      Symbol.for('fm:TableStore'),
  PoolProvider:    Symbol.for('fm:PoolProvider'),
  WriteAheadLog:   Symbol.for('fm:WriteAheadLog'),
  DDLProvider:     Symbol.for('fm:DDLProvider'),
};
```

### Container Wiring

```typescript
const container = new ServiceContainer();

// Existing (unchanged)
container.registerInstance(ServiceTokens.StateStore, stateStore);
container.registerInstance(ServiceTokens.FlowRegistry, flowRegistry);
container.registerInstance(ServiceTokens.HandlerRegistry, handlerRegistry);

// New — tables
container.registerInstance(ServiceTokens.PoolProvider, new SharedPoolProvider(pool));
container.registerInstance(ServiceTokens.DDLProvider, new DirectDDLProvider(pool));
container.registerInstance(ServiceTokens.TableRegistry, tableRegistry);
container.registerInstance(ServiceTokens.TableStore, tableStore);
container.registerInstance(ServiceTokens.WriteAheadLog, new FileWAL('./data'));

// Engine gets table access via options
container.registerFactory(ServiceTokens.ExecutionEngine, (c) =>
  new Engine(
    c.resolve(ServiceTokens.StateStore),
    c.resolve(ServiceTokens.HandlerRegistry),
    c.resolve(ServiceTokens.FlowRegistry),
    c.resolve(ServiceTokens.EventBus),
    {
      tableStore: c.resolve(ServiceTokens.TableStore),
      tableRegistry: c.resolve(ServiceTokens.TableRegistry),
      pipeWAL: c.resolve(ServiceTokens.WriteAheadLog),
    }
  )
);
```

---

## 12. API Routes

### Route Definitions

```typescript
const Routes = {
  // ... all existing routes unchanged ...

  // ── Table Management ──────────────────────────────────
  ListTables:     '/api/tables',
  CreateTable:    '/api/tables',
  GetTable:       '/api/tables/:tableId',
  DeleteTable:    '/api/tables/:tableId',

  // ── Row Operations ────────────────────────────────────
  InsertRow:      '/api/tables/:tableId/rows',
  InsertBatch:    '/api/tables/:tableId/rows/batch',
  QueryRows:      '/api/tables/:tableId/rows',       // GET with query params
  CountRows:      '/api/tables/:tableId/rows/count',
  GetRow:         '/api/tables/:tableId/rows/:rowId',
  UpdateRow:      '/api/tables/:tableId/rows/:rowId',
  DeleteRow:      '/api/tables/:tableId/rows/:rowId',

  // ── Pipe Visibility (read-only) ───────────────────────
  ListFlowPipes:  '/api/flows/:flowId/pipes',
  ListTablePipes: '/api/tables/:tableId/pipes',

  // ── WAL Monitoring (admin only) ───────────────────────
  WALStatus:      '/api/admin/wal/status',
  WALReplay:      '/api/admin/wal/replay',
  WALEntries:     '/api/admin/wal/entries',
};
```

### Route Config Extension

```typescript
interface RouteConfig {
  // ... existing unchanged ...
  tables?: boolean;    // table + row endpoints
  wal?: boolean;       // WAL admin monitoring
}
```

### Method → Route Mapping

| Method | Route | HTTP |
|---|---|---|
| `TableRegistry.create()` | POST `/api/tables` | 201 |
| `TableRegistry.get()` | GET `/api/tables/:tableId` | 200 |
| `TableRegistry.list()` | GET `/api/tables` | 200 |
| `TableRegistry.delete()` | DELETE `/api/tables/:tableId` | 200 |
| `TableRegistry.addColumn()` | POST `/api/tables/:tableId/columns` | 200 |
| `TableRegistry.removeColumn()` | DELETE `/api/tables/:tableId/columns/:columnId` | 200 |
| `TableStore.insert()` | POST `/api/tables/:tableId/rows` | 201 |
| `TableStore.insertBatch()` | POST `/api/tables/:tableId/rows/batch` | 201 |
| `TableStore.get()` | GET `/api/tables/:tableId/rows/:rowId` | 200 |
| `TableStore.query()` | GET `/api/tables/:tableId/rows` | 200 |
| `TableStore.update()` | PATCH `/api/tables/:tableId/rows/:rowId` | 200 |
| `TableStore.delete()` | DELETE `/api/tables/:tableId/rows/:rowId` | 200 |
| `TableStore.count()` | GET `/api/tables/:tableId/rows/count` | 200 |

---

## 13. Handler: table-insert

For **critical writes** that must succeed as part of the flow, use the `table-insert` handler as an explicit step. Unlike pipes, this handler is failable and follows `onFailure` transitions.

### Step Config

```typescript
{
  id: 'save-payment',
  type: 'table-insert',
  config: {
    tableId: 'tbl_payments',
    mappings: [
      { sourcePath: 'transactionId', column: 'col_txn_id' },
      { sourcePath: 'amount',        column: 'col_amount' },
    ],
  },
  input: { type: 'key', key: 'paymentResult' },
  outputKey: 'insertResult',       // { rowId: '...', success: true }
  transitions: {
    onSuccess: 'send-receipt',
    onFailure: 'handle-write-error'
  }
}
```

### Handler Implementation

Lives in `packages/handlers`. Returns `success` with `{ rowId }` or `failure` with error details.

### Pipe vs table-insert

| | Pipe | `table-insert` handler |
|---|---|---|
| **Purpose** | Analytics, logging, data collection | Critical writes (the write IS the business logic) |
| **Failure mode** | Silent, WAL + event only | Follows `onFailure` transition |
| **Declared in** | `flow.pipes[]` | `flow.steps{}` |
| **Validated at** | Flow registration (hookup) | Flow registration (hookup) |
| **Guidance** | Use for any data you want to capture | Use when the write must succeed to continue |

---

## 14. Implementation Plan

### What We Build Now (Shared Mode)

| Component | Location | Type |
|---|---|---|
| Types: `ColumnDef`, `TableDef`, `PipeDef`, `Row`, `RowQuery`, etc. | `packages/core/src/types/` | Types |
| `TableRegistry` interface | `packages/core/src/interfaces/` | Interface |
| `TableStore` interface | `packages/core/src/interfaces/` | Interface |
| `PoolProvider` interface | `packages/core/src/interfaces/` | Interface |
| `WriteAheadLog` interface | `packages/core/src/interfaces/` | Interface |
| `DDLProvider` interface | `packages/core/src/interfaces/` | Interface |
| `HookupResult`, `HookupError` types | `packages/core/src/types/` | Types |
| `MemoryTableRegistry` | `packages/core/src/impl/` | Implementation |
| `MemoryTableStore` | `packages/core/src/impl/` | Implementation |
| `MemoryWAL` | `packages/core/src/impl/` | Implementation |
| `SharedPoolProvider` | `packages/core/src/impl/` | Implementation |
| `validateRow()` utility | `packages/core/src/utils/` | Utility |
| `pgTableName()`, `pgColumnName()`, `safeName()` | `packages/postgres/src/` | Utility |
| `PgTableRegistry` | `packages/postgres/src/` | Implementation |
| `PgTableStore` | `packages/postgres/src/` | Implementation |
| `DirectDDLProvider` | `packages/postgres/src/` | Implementation |
| `FileWAL` | `packages/core/src/impl/` | Implementation |
| `fm_tables` schema addition | `packages/postgres/src/schema.ts` | Schema |
| Pipe execution in engine `applyResult()` | `packages/core/src/engine/` | Engine change |
| `table-insert` handler | `packages/handlers/src/` | Handler |
| EventBus extensions | `packages/core/src/interfaces/` | Interface change |
| Service tokens | `packages/express/src/tokens.ts` | Tokens |
| Test coverage via `TestHarness` | `packages/core/src/test/` | Tests |

### What We Build Later (Per-Tenant Mode)

| Component | Notes |
|---|---|
| `TenantPoolProvider` | Docker API / Compose / K8s based |
| `ManagedPoolProvider` interface | provision, deprovision, hibernate, wake, upgrade, downgrade |
| `fm_tenant_placements` schema | Tier tracking, container registry |
| Tiered pool assignment | shared pools for free, dedicated for paid |
| Auto-hibernate / auto-wake | Background job for idle containers |
| Backup/restore pipeline | Volume snapshots, pg_dump per tenant |
| `FileDDLProvider` / `WebhookDDLProvider` | IaC integration |
| Schema migration helper (shared → dedicated) | pg_dump + pg_restore on upgrade |

---

## 15. Future: Per-Tenant DB Architecture

Reference architecture for the scalable mode (not built now, interfaces support it).

### Infrastructure Tiers

```
Tier 1: Shared Pool (free / low-tier)
  - Multiple tenants per Postgres instance
  - Schema-per-tenant isolation (Postgres schemas)
  - Max ~50 tenants per pool
  - Cost: ~$0.10-0.30/tenant/month

Tier 2: Dedicated Container (paid)
  - One Docker container per tenant
  - postgres:16-alpine, 128-512MB RAM
  - Docker volume for data persistence
  - Cost: ~$3-8/tenant/month

Tier 3: Dedicated VM/RDS (enterprise)
  - Full dedicated instance
  - Point-in-time recovery, read replicas
  - Cost: ~$50-200/tenant/month
```

### Container Orchestration

Tenant containers join a shared Docker network for DNS-based addressing:

```
FlowMonkey Process
  └── Docker Network (fm-tenant-net)
        ├── fm-db-tenant-abc (postgres:16-alpine)
        ├── fm-db-tenant-xyz (postgres:16-alpine)
        └── fm-db-tenant-new (postgres:16-alpine)
```

Containers addressed by name (Docker DNS), no port mapping needed.

### Lifecycle

```
Tenant signs up → place(tenantId, 'shared')
Tenant upgrades → upgrade(tenantId, 'dedicated') → migrate data → provision container
Tenant idle 4h  → hibernate(tenantId) → stop container, keep volume
Tenant returns  → acquire(tenantId) → wake(tenantId) → start container
Tenant deletes  → deprovision(tenantId, removeData: true) → rm container + volume
```

### Backup Strategy

| Tier | Backup Method |
|---|---|
| Shared | `pg_dump --schema=fm_tenant_abc` per tenant within pool |
| Dedicated | `docker volume` tar.gz snapshot |
| Enterprise | RDS automated backups / point-in-time recovery |

---

## Appendix: Complete Type Reference

```typescript
// ── Column & Table ──────────────────────────────────────
type ColumnType = 'string' | 'number' | 'boolean' | 'datetime' | 'json';

interface ColumnDef {
  readonly id: string;
  readonly name: string;
  readonly type: ColumnType;
  readonly required: boolean;
}

interface TableDef {
  readonly id: string;
  readonly columns: ColumnDef[];
  readonly createdAt: number;
  readonly updatedAt: number;
}

// ── Pipe ────────────────────────────────────────────────
interface PipeFieldMapping {
  readonly sourcePath: string;
  readonly columnId: string;
}

interface PipeDef {
  readonly id: string;
  readonly stepId: string;
  readonly on?: 'success' | 'failure' | 'any';
  readonly tableId: string;
  readonly mappings: PipeFieldMapping[];
  readonly staticValues?: Record<string, unknown>;
  readonly enabled?: boolean;
}

// ── Row ─────────────────────────────────────────────────
type Row = Record<string, unknown>;

interface RowFilter {
  column: string;
  op: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'like' | 'in';
  value: unknown;
}

interface RowQuery {
  tableId: string;
  tenantId?: string;
  filters?: RowFilter[];
  orderBy?: { column: string; direction: 'asc' | 'desc' };
  limit?: number;
  offset?: number;
}

// ── Hookup Validation ───────────────────────────────────
interface HookupResult {
  valid: boolean;
  errors: HookupError[];
}

interface HookupError {
  pipeId: string;
  field: string;
  code: 'TABLE_NOT_FOUND' | 'COLUMN_NOT_FOUND' | 'TYPE_MISMATCH' | 'MISSING_REQUIRED';
  message: string;
}

// ── WAL ─────────────────────────────────────────────────
interface WALEntry {
  id: string;
  tableId: string;
  tenantId?: string;
  data: Row;
  pipeId: string;
  executionId: string;
  flowId: string;
  stepId: string;
  error: string;
  attempts: number;
  createdAt: number;
}

// ── DDL ─────────────────────────────────────────────────
interface DDLOperation {
  type: 'create-table' | 'drop-table' | 'add-column' | 'remove-column';
  tableId: string;
  pgTableName: string;
  spec: unknown;
  sql: string;
  timestamp: number;
}

// ── Interfaces ──────────────────────────────────────────
interface PoolProvider {
  acquire(tenantId?: string): Promise<Pool>;
  release(tenantId?: string): Promise<void>;
}

interface TableRegistry {
  create(table: TableDef): Promise<void>;
  get(id: string): Promise<TableDef | undefined>;
  list(): Promise<TableDef[]>;
  delete(id: string): Promise<boolean>;
  addColumn(tableId: string, column: ColumnDef): Promise<void>;
  removeColumn(tableId: string, columnId: string): Promise<void>;
  validatePipes(flow: Flow): Promise<HookupResult>;
}

interface TableStore {
  insert(tableId: string, row: Row, tenantId?: string): Promise<string>;
  insertBatch(tableId: string, rows: Row[], tenantId?: string): Promise<string[]>;
  get(tableId: string, rowId: string, tenantId?: string): Promise<Row | null>;
  query(query: RowQuery): Promise<{ rows: Row[]; total: number }>;
  update(tableId: string, rowId: string, changes: Partial<Row>, tenantId?: string): Promise<boolean>;
  delete(tableId: string, rowId: string, tenantId?: string): Promise<boolean>;
  count(query: Omit<RowQuery, 'limit' | 'offset' | 'orderBy'>): Promise<number>;
}

interface WriteAheadLog {
  append(entry: WALEntry): Promise<void>;
  readPending(limit?: number): Promise<WALEntry[]>;
  ack(id: string): Promise<void>;
  compact(): Promise<void>;
}

interface DDLProvider {
  emit(op: DDLOperation): Promise<void>;
}
```
