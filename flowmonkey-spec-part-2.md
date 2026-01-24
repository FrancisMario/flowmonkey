# FlowMonkey Specification — Part 2

**Subtitle:** Storage, Jobs, Handlers, Triggers, Providers, Observability  
**Version:** 0.0.1  
**Status:** Draft  
**Last Updated:** January 2025  
**Depends On:** `@flowmonkey/core` (Part 1 — already implemented)

---

## Table of Contents

1. [Overview](#1-overview)
2. [Updates to Core (Part 1)](#2-updates-to-core-part-1)
3. [Package: @flowmonkey/postgres](#3-package-flowmonkeypostgres)
4. [Package: @flowmonkey/redis](#4-package-flowmonkeyredis)
5. [Package: @flowmonkey/jobs](#5-package-flowmonkeyjobs)
6. [Package: @flowmonkey/handlers](#6-package-flowmonkeyhandlers)
7. [Package: @flowmonkey/triggers](#7-package-flowmonkeytriggers)
8. [Observability](#8-observability)
9. [Integration Examples](#9-integration-examples)
10. [Implementation Checklist](#10-implementation-checklist)

---

## 1. Overview

### 1.1 What This Spec Covers

Part 1 defined the **core execution engine** — the law of how flows advance.

Part 2 defines the **execution fabric** — everything that makes the core usable at scale:

| Layer | Purpose | Package |
|-------|---------|---------|
| Storage | Durable state persistence | `@flowmonkey/postgres` |
| Coordination | Locking, signals | `@flowmonkey/redis` |
| Jobs | Long-running stateful work | `@flowmonkey/jobs` |
| Handlers | Built-in step implementations | `@flowmonkey/handlers` |
| Triggers | External event → execution | `@flowmonkey/triggers` |

### 1.2 Architectural Principles

1. **Flows are data, not code** — enables hot loading, versioning, AI authoring
2. **Handlers are bounded programs** — no open-ended behavior at runtime
3. **Long work must survive process death** — no in-process long execution
4. **No component assumes another is alive** — crash tolerance by construction
5. **Correctness lives in durable state** — not in providers or schedulers
6. **Observability is first-class** — no black boxes

### 1.3 System Layers

```
External World
      ↓
┌─────────────────┐
│    Triggers     │  ← Boundary adapters (HTTP, cron, kafka, etc.)
└────────┬────────┘
         ↓
┌─────────────────┐
│  FlowMonkey     │  ← Core engine (Part 1)
│     Engine      │
└────────┬────────┘
         ↓
┌─────────────────┐
│    Handlers     │  ← Stateless (inline) + Stateful (jobs)
└────────┬────────┘
         ↓
┌─────────────────┐
│   Job System    │  ← Lease-based execution
└────────┬────────┘
         ↓
┌─────────────────┐
│   Providers     │  ← In-process, external process, Docker, K8s
└─────────────────┘
```

### 1.4 Monorepo Structure (Updated)

```
flowmonkey/
├── packages/
│   ├── core/           # @flowmonkey/core (Part 1 ✓)
│   ├── postgres/       # @flowmonkey/postgres
│   ├── redis/          # @flowmonkey/redis
│   ├── jobs/           # @flowmonkey/jobs
│   ├── handlers/       # @flowmonkey/handlers
│   └── triggers/       # @flowmonkey/triggers
├── package.json
├── pnpm-workspace.yaml
└── tsconfig.base.json
```

---

## 2. Updates to Core (Part 1)

> ⚠️ **These changes must be applied to `@flowmonkey/core` before implementing Part 2**

### 2.1 Add Lock Interface to StateStore

**File:** `packages/core/src/interfaces/state-store.ts`

```typescript
// ADD these types

export interface Lock {
  /** Release the lock. Safe to call multiple times. */
  release(): Promise<void>;
  /** Extend the lock TTL. Returns false if lock was lost. */
  extend(ttlMs: number): Promise<boolean>;
}

// ADD this optional method to StateStore interface

export interface StateStore {
  // ... existing methods ...

  /**
   * Acquire a lock on an execution (optional).
   * For distributed deployments with multiple workers.
   * Single-instance deployments can skip this.
   *
   * @returns Lock if acquired, null if already locked
   */
  acquireLock?(id: string, ttlMs: number): Promise<Lock | null>;
}
```

### 2.2 Add versions() to FlowRegistry

**File:** `packages/core/src/interfaces/flow-registry.ts`

```typescript
// ADD this method to FlowRegistry interface

export interface FlowRegistry {
  // ... existing methods ...

  /** Get all versions of a flow, newest first */
  versions(id: string): string[];
}
```

### 2.3 Update DefaultFlowRegistry Implementation

**File:** `packages/core/src/impl/flow-registry.ts`

```typescript
// ADD this method to DefaultFlowRegistry class

versions(id: string): string[] {
  const versions = this.flows.get(id);
  if (!versions) return [];
  return [...versions.keys()].sort().reverse();
}
```

### 2.4 Export validateFlow

**File:** `packages/core/src/index.ts`

```typescript
// ENSURE this is exported
export { validateFlow } from './utils/validation';
```

### 2.5 Add HandlerType Metadata (Optional Enhancement)

**File:** `packages/core/src/interfaces/step-handler.ts`

```typescript
// ADD optional metadata to StepHandler

export interface StepHandler {
  readonly type: string;
  
  /**
   * Whether this handler is stateful (runs as a job).
   * Default: false (stateless, runs inline)
   */
  readonly stateful?: boolean;

  execute(params: HandlerParams): Promise<StepResult>;
}
```

---

## 3. Package: @flowmonkey/postgres

### 3.1 Overview

Postgres is the **durable source of truth** for:
- Executions (implements `StateStore`)
- Flows (implements `FlowRegistry`)
- Jobs (new `JobStore` interface)
- Events (implements `EventBus` for observability)

### 3.2 Structure

```
packages/postgres/
├── src/
│   ├── index.ts
│   ├── schema.ts
│   ├── execution-store.ts
│   ├── flow-store.ts
│   ├── job-store.ts
│   ├── event-store.ts
│   └── factory.ts
├── test/
│   ├── execution-store.test.ts
│   ├── flow-store.test.ts
│   ├── job-store.test.ts
│   └── setup.ts
├── package.json
├── tsconfig.json
├── tsup.config.ts
└── vitest.config.ts
```

### 3.3 package.json

```json
{
  "name": "@flowmonkey/postgres",
  "version": "0.0.1",
  "description": "Postgres storage for FlowMonkey",
  "type": "module",
  "main": "./dist/index.cjs",
  "module": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "import": { "types": "./dist/index.d.ts", "default": "./dist/index.js" },
      "require": { "types": "./dist/index.d.cts", "default": "./dist/index.cjs" }
    }
  },
  "files": ["dist"],
  "scripts": {
    "build": "tsup",
    "dev": "tsup --watch",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit",
    "clean": "rm -rf dist"
  },
  "dependencies": {
    "@flowmonkey/core": "workspace:*"
  },
  "peerDependencies": {
    "pg": "^8.0.0"
  },
  "devDependencies": {
    "@types/pg": "^8.10.0",
    "pg": "^8.11.0",
    "tsup": "^8.0.0",
    "typescript": "^5.4.0",
    "vitest": "^2.0.0"
  }
}
```

### 3.4 Schema

**File:** `src/schema.ts`

```typescript
export const SCHEMA_VERSION = '0.0.1';

export const schema = `
-- ============================================
-- FlowMonkey Postgres Schema v${SCHEMA_VERSION}
-- ============================================

-- Executions
CREATE TABLE IF NOT EXISTS fm_executions (
  id              TEXT PRIMARY KEY,
  flow_id         TEXT NOT NULL,
  flow_version    TEXT NOT NULL,
  current_step    TEXT NOT NULL,
  status          TEXT NOT NULL CHECK (status IN ('pending', 'running', 'waiting', 'completed', 'failed')),
  context         JSONB NOT NULL DEFAULT '{}',
  wake_at         BIGINT,
  wait_reason     TEXT,
  error           JSONB,
  step_count      INTEGER NOT NULL DEFAULT 0,
  history         JSONB,
  tenant_id       TEXT,
  metadata        JSONB,
  created_at      BIGINT NOT NULL,
  updated_at      BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_fm_exec_status ON fm_executions(status);
CREATE INDEX IF NOT EXISTS idx_fm_exec_wake ON fm_executions(wake_at) WHERE status = 'waiting';
CREATE INDEX IF NOT EXISTS idx_fm_exec_tenant ON fm_executions(tenant_id) WHERE tenant_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_fm_exec_flow ON fm_executions(flow_id);
CREATE INDEX IF NOT EXISTS idx_fm_exec_updated ON fm_executions(updated_at);

-- Flows
CREATE TABLE IF NOT EXISTS fm_flows (
  id              TEXT NOT NULL,
  version         TEXT NOT NULL,
  name            TEXT,
  definition      JSONB NOT NULL,
  created_at      BIGINT NOT NULL,
  PRIMARY KEY (id, version)
);

CREATE INDEX IF NOT EXISTS idx_fm_flows_id ON fm_flows(id);

-- Jobs (stateful handlers)
CREATE TABLE IF NOT EXISTS fm_jobs (
  id              TEXT PRIMARY KEY,
  execution_id    TEXT NOT NULL,
  step_id         TEXT NOT NULL,
  handler         TEXT NOT NULL,
  status          TEXT NOT NULL CHECK (status IN ('pending', 'running', 'completed', 'failed')),
  input           JSONB NOT NULL,
  result          JSONB,
  error           JSONB,
  runner_id       TEXT,
  heartbeat_at    BIGINT,
  heartbeat_ms    INTEGER NOT NULL DEFAULT 30000,
  attempts        INTEGER NOT NULL DEFAULT 0,
  max_attempts    INTEGER NOT NULL DEFAULT 3,
  created_at      BIGINT NOT NULL,
  updated_at      BIGINT NOT NULL,
  
  CONSTRAINT fk_job_execution FOREIGN KEY (execution_id) 
    REFERENCES fm_executions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_fm_jobs_exec ON fm_jobs(execution_id);
CREATE INDEX IF NOT EXISTS idx_fm_jobs_status ON fm_jobs(status);
CREATE INDEX IF NOT EXISTS idx_fm_jobs_stalled ON fm_jobs(heartbeat_at) WHERE status = 'running';
CREATE INDEX IF NOT EXISTS idx_fm_jobs_step ON fm_jobs(execution_id, step_id);

-- Events (audit log / observability)
CREATE TABLE IF NOT EXISTS fm_events (
  id              BIGSERIAL PRIMARY KEY,
  execution_id    TEXT NOT NULL,
  type            TEXT NOT NULL,
  step_id         TEXT,
  payload         JSONB NOT NULL DEFAULT '{}',
  timestamp       BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_fm_events_exec ON fm_events(execution_id);
CREATE INDEX IF NOT EXISTS idx_fm_events_type ON fm_events(type);
CREATE INDEX IF NOT EXISTS idx_fm_events_ts ON fm_events(timestamp);

-- Locks (advisory locks alternative - optional)
CREATE TABLE IF NOT EXISTS fm_locks (
  key             TEXT PRIMARY KEY,
  owner           TEXT NOT NULL,
  expires_at      BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_fm_locks_expires ON fm_locks(expires_at);
`;

/**
 * Apply schema to database.
 */
export async function applySchema(pool: import('pg').Pool): Promise<void> {
  await pool.query(schema);
}
```

### 3.5 Execution Store

**File:** `src/execution-store.ts`

```typescript
import type { Pool } from 'pg';
import type { Execution, ExecutionStatus, StateStore, Lock } from '@flowmonkey/core';

export class PgExecutionStore implements StateStore {
  constructor(private pool: Pool) {}

  async load(id: string): Promise<Execution | null> {
    const { rows } = await this.pool.query(
      `SELECT * FROM fm_executions WHERE id = $1`,
      [id]
    );
    return rows[0] ? this.toExecution(rows[0]) : null;
  }

  async save(execution: Execution): Promise<void> {
    await this.pool.query(
      `INSERT INTO fm_executions (
        id, flow_id, flow_version, current_step, status, context,
        wake_at, wait_reason, error, step_count, history,
        tenant_id, metadata, created_at, updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
      ON CONFLICT (id) DO UPDATE SET
        current_step = EXCLUDED.current_step,
        status = EXCLUDED.status,
        context = EXCLUDED.context,
        wake_at = EXCLUDED.wake_at,
        wait_reason = EXCLUDED.wait_reason,
        error = EXCLUDED.error,
        step_count = EXCLUDED.step_count,
        history = EXCLUDED.history,
        metadata = EXCLUDED.metadata,
        updated_at = EXCLUDED.updated_at`,
      [
        execution.id,
        execution.flowId,
        execution.flowVersion,
        execution.currentStepId,
        execution.status,
        JSON.stringify(execution.context),
        execution.wakeAt ?? null,
        execution.waitReason ?? null,
        execution.error ? JSON.stringify(execution.error) : null,
        execution.stepCount,
        execution.history ? JSON.stringify(execution.history) : null,
        execution.tenantId ?? null,
        execution.metadata ? JSON.stringify(execution.metadata) : null,
        execution.createdAt,
        execution.updatedAt,
      ]
    );
  }

  async delete(id: string): Promise<boolean> {
    const { rowCount } = await this.pool.query(
      `DELETE FROM fm_executions WHERE id = $1`,
      [id]
    );
    return (rowCount ?? 0) > 0;
  }

  async listWakeReady(now: number, limit = 100): Promise<string[]> {
    const { rows } = await this.pool.query(
      `SELECT id FROM fm_executions
       WHERE status = 'waiting' AND wake_at <= $1
       ORDER BY wake_at ASC LIMIT $2`,
      [now, limit]
    );
    return rows.map(r => r.id);
  }

  async listByStatus(status: ExecutionStatus, limit = 100): Promise<Execution[]> {
    const { rows } = await this.pool.query(
      `SELECT * FROM fm_executions
       WHERE status = $1
       ORDER BY created_at DESC LIMIT $2`,
      [status, limit]
    );
    return rows.map(r => this.toExecution(r));
  }

  async acquireLock(id: string, ttlMs: number): Promise<Lock | null> {
    const owner = crypto.randomUUID();
    const expiresAt = Date.now() + ttlMs;

    // Try to acquire
    const { rowCount } = await this.pool.query(
      `INSERT INTO fm_locks (key, owner, expires_at)
       VALUES ($1, $2, $3)
       ON CONFLICT (key) DO UPDATE
       SET owner = EXCLUDED.owner, expires_at = EXCLUDED.expires_at
       WHERE fm_locks.expires_at < $4`,
      [`exec:${id}`, owner, expiresAt, Date.now()]
    );

    if ((rowCount ?? 0) === 0) {
      return null; // Lock held by someone else
    }

    return {
      release: async () => {
        await this.pool.query(
          `DELETE FROM fm_locks WHERE key = $1 AND owner = $2`,
          [`exec:${id}`, owner]
        );
      },
      extend: async (newTtlMs: number) => {
        const newExpiresAt = Date.now() + newTtlMs;
        const { rowCount } = await this.pool.query(
          `UPDATE fm_locks SET expires_at = $3
           WHERE key = $1 AND owner = $2`,
          [`exec:${id}`, owner, newExpiresAt]
        );
        return (rowCount ?? 0) > 0;
      },
    };
  }

  private toExecution(row: any): Execution {
    return {
      id: row.id,
      flowId: row.flow_id,
      flowVersion: row.flow_version,
      currentStepId: row.current_step,
      status: row.status,
      context: row.context ?? {},
      wakeAt: row.wake_at ? Number(row.wake_at) : undefined,
      waitReason: row.wait_reason ?? undefined,
      error: row.error ?? undefined,
      stepCount: row.step_count,
      history: row.history ?? undefined,
      tenantId: row.tenant_id ?? undefined,
      metadata: row.metadata ?? undefined,
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at),
    };
  }
}
```

### 3.6 Flow Store

**File:** `src/flow-store.ts`

```typescript
import type { Pool } from 'pg';
import type { Flow, FlowRegistry, ValidationIssue } from '@flowmonkey/core';
import { FlowValidationError, validateFlow } from '@flowmonkey/core';

export class PgFlowStore implements FlowRegistry {
  private cache = new Map<string, Flow>(); // key: "id@version"
  private latest = new Map<string, string>(); // key: id, value: version
  private versionMap = new Map<string, Set<string>>(); // key: id, value: Set<version>

  constructor(private pool: Pool) {}

  /** Load all flows into cache. Call on startup. */
  async init(): Promise<void> {
    const { rows } = await this.pool.query(
      `SELECT id, version, definition FROM fm_flows ORDER BY id, version`
    );

    for (const row of rows) {
      const flow = row.definition as Flow;
      this.cacheFlow(flow);
    }
  }

  register(flow: Flow): void {
    const issues = this.validate(flow);
    const errors = issues.filter(i => i.severity === 'error');
    if (errors.length > 0) {
      throw new FlowValidationError(flow.id, errors);
    }

    // Check for duplicate
    if (this.cache.has(`${flow.id}@${flow.version}`)) {
      throw new Error(`Flow "${flow.id}@${flow.version}" already registered`);
    }

    // Persist (fire and forget - cache is authoritative for reads)
    this.pool.query(
      `INSERT INTO fm_flows (id, version, name, definition, created_at)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (id, version) DO NOTHING`,
      [flow.id, flow.version, flow.name ?? null, JSON.stringify(flow), Date.now()]
    ).catch(err => console.error('Failed to persist flow:', err));

    this.cacheFlow(flow);
  }

  get(id: string, version?: string): Flow | undefined {
    const v = version ?? this.latest.get(id);
    if (!v) return undefined;
    return this.cache.get(`${id}@${v}`);
  }

  has(id: string): boolean {
    return this.latest.has(id);
  }

  flowIds(): string[] {
    return [...this.latest.keys()];
  }

  versions(id: string): string[] {
    const versions = this.versionMap.get(id);
    if (!versions) return [];
    return [...versions].sort().reverse();
  }

  validate(flow: Flow): ValidationIssue[] {
    return validateFlow(flow);
  }

  private cacheFlow(flow: Flow): void {
    this.cache.set(`${flow.id}@${flow.version}`, flow);

    // Update version tracking
    let versions = this.versionMap.get(flow.id);
    if (!versions) {
      versions = new Set();
      this.versionMap.set(flow.id, versions);
    }
    versions.add(flow.version);

    // Update latest
    const current = this.latest.get(flow.id);
    if (!current || flow.version > current) {
      this.latest.set(flow.id, flow.version);
    }
  }
}
```

### 3.7 Job Store

**File:** `src/job-store.ts`

```typescript
import type { Pool } from 'pg';
import { createHash } from 'crypto';

// ============================================
// Types
// ============================================

export type JobStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface Job {
  id: string;
  executionId: string;
  stepId: string;
  handler: string;
  status: JobStatus;
  input: unknown;
  result?: unknown;
  error?: JobError;
  runnerId?: string;
  heartbeatAt?: number;
  heartbeatMs: number;
  attempts: number;
  maxAttempts: number;
  createdAt: number;
  updatedAt: number;
}

export interface JobError {
  code: string;
  message: string;
  details?: unknown;
}

export interface CreateJobParams {
  executionId: string;
  stepId: string;
  handler: string;
  input: unknown;
  maxAttempts?: number;
  heartbeatMs?: number;
}

// ============================================
// Interface
// ============================================

export interface JobStore {
  /** Get or create a job (idempotent via deterministic ID) */
  getOrCreate(params: CreateJobParams): Promise<Job>;

  /** Get job by ID */
  get(jobId: string): Promise<Job | null>;

  /** Get job for execution step */
  getForStep(executionId: string, stepId: string): Promise<Job | null>;

  /** Claim job (acquire lease) */
  claim(jobId: string, runnerId: string): Promise<boolean>;

  /** Heartbeat (extend lease) */
  heartbeat(jobId: string, runnerId: string): Promise<boolean>;

  /** Complete job with result */
  complete(jobId: string, runnerId: string, result: unknown): Promise<boolean>;

  /** Fail job with error */
  fail(jobId: string, runnerId: string, error: JobError): Promise<boolean>;

  /** Find stalled jobs (lease expired) */
  findStalled(now: number, limit?: number): Promise<Job[]>;

  /** Reset stalled job to pending */
  resetStalled(jobId: string): Promise<boolean>;

  /** List jobs by status */
  listByStatus(status: JobStatus, limit?: number): Promise<Job[]>;

  /** List jobs for execution */
  listForExecution(executionId: string): Promise<Job[]>;
}

// ============================================
// Implementation
// ============================================

export class PgJobStore implements JobStore {
  constructor(private pool: Pool) {}

  async getOrCreate(params: CreateJobParams): Promise<Job> {
    const jobId = this.computeJobId(params);
    const now = Date.now();

    await this.pool.query(
      `INSERT INTO fm_jobs (
        id, execution_id, step_id, handler, status, input,
        heartbeat_ms, attempts, max_attempts, created_at, updated_at
      ) VALUES ($1,$2,$3,$4,'pending',$5,$6,0,$7,$8,$8)
      ON CONFLICT (id) DO NOTHING`,
      [
        jobId,
        params.executionId,
        params.stepId,
        params.handler,
        JSON.stringify(params.input),
        params.heartbeatMs ?? 30000,
        params.maxAttempts ?? 3,
        now,
      ]
    );

    return (await this.get(jobId))!;
  }

  async get(jobId: string): Promise<Job | null> {
    const { rows } = await this.pool.query(
      `SELECT * FROM fm_jobs WHERE id = $1`,
      [jobId]
    );
    return rows[0] ? this.toJob(rows[0]) : null;
  }

  async getForStep(executionId: string, stepId: string): Promise<Job | null> {
    const { rows } = await this.pool.query(
      `SELECT * FROM fm_jobs WHERE execution_id = $1 AND step_id = $2`,
      [executionId, stepId]
    );
    return rows[0] ? this.toJob(rows[0]) : null;
  }

  async claim(jobId: string, runnerId: string): Promise<boolean> {
    const now = Date.now();
    const { rowCount } = await this.pool.query(
      `UPDATE fm_jobs SET
        status = 'running',
        runner_id = $2,
        heartbeat_at = $3,
        attempts = attempts + 1,
        updated_at = $3
       WHERE id = $1
         AND status = 'pending'
         AND attempts < max_attempts`,
      [jobId, runnerId, now]
    );
    return (rowCount ?? 0) > 0;
  }

  async heartbeat(jobId: string, runnerId: string): Promise<boolean> {
    const now = Date.now();
    const { rowCount } = await this.pool.query(
      `UPDATE fm_jobs SET heartbeat_at = $3, updated_at = $3
       WHERE id = $1 AND runner_id = $2 AND status = 'running'`,
      [jobId, runnerId, now]
    );
    return (rowCount ?? 0) > 0;
  }

  async complete(jobId: string, runnerId: string, result: unknown): Promise<boolean> {
    const now = Date.now();
    const { rowCount } = await this.pool.query(
      `UPDATE fm_jobs SET
        status = 'completed',
        result = $3,
        updated_at = $4
       WHERE id = $1 AND runner_id = $2 AND status = 'running'`,
      [jobId, runnerId, JSON.stringify(result), now]
    );
    return (rowCount ?? 0) > 0;
  }

  async fail(jobId: string, runnerId: string, error: JobError): Promise<boolean> {
    const now = Date.now();
    const { rowCount } = await this.pool.query(
      `UPDATE fm_jobs SET
        status = 'failed',
        error = $3,
        updated_at = $4
       WHERE id = $1 AND runner_id = $2 AND status = 'running'`,
      [jobId, runnerId, JSON.stringify(error), now]
    );
    return (rowCount ?? 0) > 0;
  }

  async findStalled(now: number, limit = 100): Promise<Job[]> {
    // Stalled = running but no heartbeat for 3x heartbeat interval
    const { rows } = await this.pool.query(
      `SELECT * FROM fm_jobs
       WHERE status = 'running'
         AND heartbeat_at < $1 - (heartbeat_ms * 3)
       ORDER BY heartbeat_at ASC
       LIMIT $2`,
      [now, limit]
    );
    return rows.map(r => this.toJob(r));
  }

  async resetStalled(jobId: string): Promise<boolean> {
    const now = Date.now();
    const { rowCount } = await this.pool.query(
      `UPDATE fm_jobs SET
        status = 'pending',
        runner_id = NULL,
        heartbeat_at = NULL,
        updated_at = $2
       WHERE id = $1
         AND status = 'running'
         AND attempts < max_attempts`,
      [jobId, now]
    );
    return (rowCount ?? 0) > 0;
  }

  async listByStatus(status: JobStatus, limit = 100): Promise<Job[]> {
    const { rows } = await this.pool.query(
      `SELECT * FROM fm_jobs WHERE status = $1 ORDER BY created_at DESC LIMIT $2`,
      [status, limit]
    );
    return rows.map(r => this.toJob(r));
  }

  async listForExecution(executionId: string): Promise<Job[]> {
    const { rows } = await this.pool.query(
      `SELECT * FROM fm_jobs WHERE execution_id = $1 ORDER BY created_at ASC`,
      [executionId]
    );
    return rows.map(r => this.toJob(r));
  }

  /**
   * Deterministic job ID ensures idempotency.
   * Same execution + step + handler + input = same job ID.
   */
  private computeJobId(params: CreateJobParams): string {
    const data = JSON.stringify({
      e: params.executionId,
      s: params.stepId,
      h: params.handler,
      i: params.input,
    });
    return createHash('sha256').update(data).digest('hex').slice(0, 32);
  }

  private toJob(row: any): Job {
    return {
      id: row.id,
      executionId: row.execution_id,
      stepId: row.step_id,
      handler: row.handler,
      status: row.status,
      input: row.input,
      result: row.result ?? undefined,
      error: row.error ?? undefined,
      runnerId: row.runner_id ?? undefined,
      heartbeatAt: row.heartbeat_at ? Number(row.heartbeat_at) : undefined,
      heartbeatMs: row.heartbeat_ms,
      attempts: row.attempts,
      maxAttempts: row.max_attempts,
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at),
    };
  }
}
```

### 3.8 Event Store

**File:** `src/event-store.ts`

```typescript
import type { Pool } from 'pg';
import type { EventBus } from '@flowmonkey/core';

// ============================================
// Types
// ============================================

export interface StoredEvent {
  id: number;
  executionId: string;
  type: string;
  stepId?: string;
  payload: Record<string, unknown>;
  timestamp: number;
}

export interface EventQuery {
  executionId?: string;
  type?: string;
  from?: number;
  to?: number;
  limit?: number;
}

// ============================================
// Implementation
// ============================================

export class PgEventStore implements EventBus {
  constructor(private pool: Pool) {}

  // --- EventBus implementation (fire and forget) ---

  onExecutionCreated(e: any) {
    this.insert('execution.created', e.executionId, undefined, e);
  }

  onExecutionStarted(e: any) {
    this.insert('execution.started', e.executionId, e.stepId, e);
  }

  onStepStarted(e: any) {
    this.insert('step.started', e.executionId, e.stepId, e);
  }

  onStepCompleted(e: any) {
    this.insert('step.completed', e.executionId, e.stepId, e);
  }

  onExecutionCompleted(e: any) {
    this.insert('execution.completed', e.executionId, undefined, e);
  }

  onExecutionFailed(e: any) {
    this.insert('execution.failed', e.executionId, e.stepId, e);
  }

  onExecutionWaiting(e: any) {
    this.insert('execution.waiting', e.executionId, e.stepId, e);
  }

  // --- Query methods ---

  async query(q: EventQuery): Promise<StoredEvent[]> {
    const conditions: string[] = [];
    const params: any[] = [];
    let paramIndex = 1;

    if (q.executionId) {
      conditions.push(`execution_id = $${paramIndex++}`);
      params.push(q.executionId);
    }
    if (q.type) {
      conditions.push(`type = $${paramIndex++}`);
      params.push(q.type);
    }
    if (q.from) {
      conditions.push(`timestamp >= $${paramIndex++}`);
      params.push(q.from);
    }
    if (q.to) {
      conditions.push(`timestamp <= $${paramIndex++}`);
      params.push(q.to);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = q.limit ?? 1000;

    const { rows } = await this.pool.query(
      `SELECT * FROM fm_events ${where} ORDER BY timestamp ASC LIMIT ${limit}`,
      params
    );

    return rows.map(r => this.toEvent(r));
  }

  async forExecution(executionId: string): Promise<StoredEvent[]> {
    return this.query({ executionId });
  }

  async byType(type: string, limit = 100): Promise<StoredEvent[]> {
    const { rows } = await this.pool.query(
      `SELECT * FROM fm_events WHERE type = $1 ORDER BY timestamp DESC LIMIT $2`,
      [type, limit]
    );
    return rows.map(r => this.toEvent(r));
  }

  // --- Internal ---

  private insert(type: string, executionId: string, stepId: string | undefined, payload: any) {
    // Fire and forget - don't block execution for observability
    this.pool.query(
      `INSERT INTO fm_events (execution_id, type, step_id, payload, timestamp)
       VALUES ($1, $2, $3, $4, $5)`,
      [executionId, type, stepId ?? null, JSON.stringify(payload), Date.now()]
    ).catch(() => {}); // Silently ignore errors
  }

  private toEvent(row: any): StoredEvent {
    return {
      id: Number(row.id),
      executionId: row.execution_id,
      type: row.type,
      stepId: row.step_id ?? undefined,
      payload: row.payload ?? {},
      timestamp: Number(row.timestamp),
    };
  }
}
```

### 3.9 Factory

**File:** `src/factory.ts`

```typescript
import type { Pool } from 'pg';
import { PgExecutionStore } from './execution-store';
import { PgFlowStore } from './flow-store';
import { PgJobStore } from './job-store';
import { PgEventStore } from './event-store';

export interface PgStores {
  executions: PgExecutionStore;
  flows: PgFlowStore;
  jobs: PgJobStore;
  events: PgEventStore;
}

/**
 * Create all Postgres stores from a single pool.
 * Call flows.init() before using.
 */
export async function createPgStores(pool: Pool): Promise<PgStores> {
  const flows = new PgFlowStore(pool);
  await flows.init();

  return {
    executions: new PgExecutionStore(pool),
    flows,
    jobs: new PgJobStore(pool),
    events: new PgEventStore(pool),
  };
}
```

### 3.10 Package Exports

**File:** `src/index.ts`

```typescript
// Schema
export { schema, SCHEMA_VERSION, applySchema } from './schema';

// Stores
export { PgExecutionStore } from './execution-store';
export { PgFlowStore } from './flow-store';
export {
  PgJobStore,
  type Job,
  type JobStatus,
  type JobError,
  type JobStore,
  type CreateJobParams,
} from './job-store';
export {
  PgEventStore,
  type StoredEvent,
  type EventQuery,
} from './event-store';

// Factory
export { createPgStores, type PgStores } from './factory';
```

---

## 4. Package: @flowmonkey/redis

### 4.1 Overview

Redis provides:
- **Distributed locking** — prevent duplicate job/tick execution
- **Pub/sub wake signals** — faster than polling for wake-ready executions
- **Optional hot cache** — for ultra-high throughput

### 4.2 Structure

```
packages/redis/
├── src/
│   ├── index.ts
│   ├── lock.ts
│   ├── signals.ts
│   └── cache.ts
├── test/
│   ├── lock.test.ts
│   └── signals.test.ts
├── package.json
├── tsconfig.json
├── tsup.config.ts
└── vitest.config.ts
```

### 4.3 package.json

```json
{
  "name": "@flowmonkey/redis",
  "version": "0.0.1",
  "description": "Redis coordination for FlowMonkey",
  "type": "module",
  "main": "./dist/index.cjs",
  "module": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "import": { "types": "./dist/index.d.ts", "default": "./dist/index.js" },
      "require": { "types": "./dist/index.d.cts", "default": "./dist/index.cjs" }
    }
  },
  "files": ["dist"],
  "scripts": {
    "build": "tsup",
    "dev": "tsup --watch",
    "test": "vitest run",
    "typecheck": "tsc --noEmit",
    "clean": "rm -rf dist"
  },
  "dependencies": {
    "@flowmonkey/core": "workspace:*"
  },
  "peerDependencies": {
    "redis": "^4.0.0"
  },
  "devDependencies": {
    "redis": "^4.6.0",
    "tsup": "^8.0.0",
    "typescript": "^5.4.0",
    "vitest": "^2.0.0"
  }
}
```

### 4.4 Lock Manager

**File:** `src/lock.ts`

```typescript
import type { RedisClientType } from 'redis';
import type { Lock } from '@flowmonkey/core';

export interface LockManager {
  /** Try to acquire a lock. Returns null if already held. */
  acquire(key: string, ttlMs: number): Promise<Lock | null>;
}

export class RedisLockManager implements LockManager {
  private readonly prefix = 'fm:lock:';

  constructor(private redis: RedisClientType) {}

  async acquire(key: string, ttlMs: number): Promise<Lock | null> {
    const lockKey = `${this.prefix}${key}`;
    const token = crypto.randomUUID();

    // SET NX PX = set if not exists with expiry
    const acquired = await this.redis.set(lockKey, token, {
      NX: true,
      PX: ttlMs,
    });

    if (!acquired) return null;

    return this.createLock(lockKey, token);
  }

  private createLock(lockKey: string, token: string): Lock {
    return {
      release: async () => {
        // Only delete if we still own it
        await this.redis.eval(
          `if redis.call("get", KEYS[1]) == ARGV[1] then
             return redis.call("del", KEYS[1])
           else
             return 0
           end`,
          { keys: [lockKey], arguments: [token] }
        );
      },

      extend: async (ttlMs: number) => {
        // Only extend if we still own it
        const result = await this.redis.eval(
          `if redis.call("get", KEYS[1]) == ARGV[1] then
             return redis.call("pexpire", KEYS[1], ARGV[2])
           else
             return 0
           end`,
          { keys: [lockKey], arguments: [token, String(ttlMs)] }
        );
        return result === 1;
      },
    };
  }
}
```

### 4.5 Wake Signals

**File:** `src/signals.ts`

```typescript
import type { RedisClientType } from 'redis';

const CHANNEL = 'fm:wake';

export interface WakeSignaler {
  /** Signal that an execution is ready to wake */
  signal(executionId: string): Promise<void>;

  /** Subscribe to wake signals */
  subscribe(handler: (executionId: string) => void): Promise<Unsubscribe>;
}

export type Unsubscribe = () => Promise<void>;

export class RedisWakeSignaler implements WakeSignaler {
  private subscriber: RedisClientType | null = null;

  constructor(private redis: RedisClientType) {}

  async signal(executionId: string): Promise<void> {
    await this.redis.publish(CHANNEL, executionId);
  }

  async subscribe(handler: (executionId: string) => void): Promise<Unsubscribe> {
    // Create dedicated connection for subscribing
    this.subscriber = this.redis.duplicate();
    await this.subscriber.connect();

    await this.subscriber.subscribe(CHANNEL, handler);

    return async () => {
      if (this.subscriber) {
        await this.subscriber.unsubscribe(CHANNEL);
        await this.subscriber.quit();
        this.subscriber = null;
      }
    };
  }
}
```

### 4.6 Optional Execution Cache

**File:** `src/cache.ts`

```typescript
import type { RedisClientType } from 'redis';
import type { Execution, ExecutionStatus, StateStore, Lock } from '@flowmonkey/core';

const PREFIX = 'fm:exec:';
const WAKE_SET = 'fm:wake-set';

/**
 * Redis-backed StateStore for hot executions.
 * 
 * Use this for:
 * - High-throughput scenarios (10K+ executions/sec)
 * - Low-latency requirements
 * 
 * Note: Does NOT persist completed executions long-term.
 * Use with PgExecutionStore for archival.
 */
export class RedisExecutionCache implements StateStore {
  constructor(private redis: RedisClientType) {}

  async load(id: string): Promise<Execution | null> {
    const data = await this.redis.get(`${PREFIX}${id}`);
    return data ? JSON.parse(data) : null;
  }

  async save(execution: Execution): Promise<void> {
    const key = `${PREFIX}${execution.id}`;
    await this.redis.set(key, JSON.stringify(execution));

    // Maintain sorted set for wake queries
    if (execution.status === 'waiting' && execution.wakeAt) {
      await this.redis.zAdd(WAKE_SET, { score: execution.wakeAt, value: execution.id });
    } else {
      await this.redis.zRem(WAKE_SET, execution.id);
    }
  }

  async delete(id: string): Promise<boolean> {
    const result = await this.redis.del(`${PREFIX}${id}`);
    await this.redis.zRem(WAKE_SET, id);
    return result > 0;
  }

  async listWakeReady(now: number, limit = 100): Promise<string[]> {
    return this.redis.zRangeByScore(WAKE_SET, 0, now, {
      LIMIT: { offset: 0, count: limit },
    });
  }

  async listByStatus(status: ExecutionStatus, limit = 100): Promise<Execution[]> {
    // Redis doesn't support efficient status queries
    // For this, use Postgres
    console.warn('RedisExecutionCache.listByStatus is inefficient - use Postgres');

    const keys = await this.redis.keys(`${PREFIX}*`);
    const results: Execution[] = [];

    for (const key of keys) {
      if (results.length >= limit) break;
      const data = await this.redis.get(key);
      if (data) {
        const exec = JSON.parse(data) as Execution;
        if (exec.status === status) {
          results.push(exec);
        }
      }
    }

    return results;
  }

  // Locking should use RedisLockManager instead
  acquireLock = undefined;
}
```

### 4.7 Package Exports

**File:** `src/index.ts`

```typescript
export { RedisLockManager, type LockManager } from './lock';
export { RedisWakeSignaler, type WakeSignaler, type Unsubscribe } from './signals';
export { RedisExecutionCache } from './cache';
```

---

## 5. Package: @flowmonkey/jobs

### 5.1 Overview

The job system handles **stateful handlers** — long-running work that must survive process death.

Key concepts:
- **Jobs** are tracked in the Job Store (Postgres)
- **Runners** execute jobs under a **lease**
- **Providers** launch runners (in-process, external process, Docker, K8s)
- **Reaper** recovers stalled jobs

### 5.2 Structure

```
packages/jobs/
├── src/
│   ├── index.ts
│   ├── types.ts
│   ├── runner.ts
│   ├── scheduler.ts
│   ├── reaper.ts
│   └── providers/
│       ├── index.ts
│       ├── in-process.ts
│       └── external-process.ts
├── test/
│   ├── runner.test.ts
│   ├── scheduler.test.ts
│   └── reaper.test.ts
├── package.json
├── tsconfig.json
├── tsup.config.ts
└── vitest.config.ts
```

### 5.3 package.json

```json
{
  "name": "@flowmonkey/jobs",
  "version": "0.0.1",
  "description": "Job system for FlowMonkey stateful handlers",
  "type": "module",
  "main": "./dist/index.cjs",
  "module": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "import": { "types": "./dist/index.d.ts", "default": "./dist/index.js" },
      "require": { "types": "./dist/index.d.cts", "default": "./dist/index.cjs" }
    }
  },
  "files": ["dist"],
  "scripts": {
    "build": "tsup",
    "dev": "tsup --watch",
    "test": "vitest run",
    "typecheck": "tsc --noEmit",
    "clean": "rm -rf dist"
  },
  "dependencies": {
    "@flowmonkey/core": "workspace:*",
    "@flowmonkey/postgres": "workspace:*"
  },
  "devDependencies": {
    "tsup": "^8.0.0",
    "typescript": "^5.4.0",
    "vitest": "^2.0.0"
  }
}
```

### 5.4 Types

**File:** `src/types.ts`

```typescript
import type { Job, JobStore, JobError } from '@flowmonkey/postgres';
import type { StepHandler } from '@flowmonkey/core';

/**
 * A stateful handler that runs as a job.
 */
export interface StatefulHandler extends StepHandler {
  readonly stateful: true;
}

/**
 * Provider launches job runners.
 */
export interface JobProvider {
  /** Launch a runner for a job */
  submit(job: Job, handler: StatefulHandler): Promise<void>;

  /** Cancel a running job (optional) */
  cancel?(jobId: string): Promise<void>;

  /** Shutdown provider */
  shutdown?(): Promise<void>;
}

/**
 * Context available to running jobs.
 */
export interface JobContext {
  readonly job: Job;
  readonly runnerId: string;

  /** Send heartbeat - call periodically */
  heartbeat(): Promise<boolean>;

  /** Check if lease is still valid */
  isLeaseValid(): Promise<boolean>;

  /** Complete the job */
  complete(result: unknown): Promise<void>;

  /** Fail the job */
  fail(error: JobError): Promise<void>;
}

/**
 * Runner configuration.
 */
export interface RunnerConfig {
  /** How often to heartbeat (ms). Default: 10000 */
  heartbeatIntervalMs?: number;

  /** Abort if heartbeat fails. Default: true */
  abortOnHeartbeatFailure?: boolean;
}
```

### 5.5 Job Runner

**File:** `src/runner.ts`

```typescript
import type { JobStore, Job, JobError } from '@flowmonkey/postgres';
import type { StatefulHandler, JobContext, RunnerConfig } from './types';
import { Result } from '@flowmonkey/core';

/**
 * Runs a single job with lease management.
 */
export class JobRunner {
  private readonly runnerId = crypto.randomUUID();
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private aborted = false;

  constructor(
    private jobStore: JobStore,
    private config: RunnerConfig = {}
  ) {}

  /**
   * Run a job to completion.
   */
  async run(job: Job, handler: StatefulHandler): Promise<void> {
    // Claim the job
    const claimed = await this.jobStore.claim(job.id, this.runnerId);
    if (!claimed) {
      throw new Error(`Failed to claim job ${job.id}`);
    }

    // Start heartbeat
    this.startHeartbeat(job.id);

    try {
      // Create context
      const context = this.createContext(job);

      // Execute handler
      const result = await handler.execute({
        input: job.input,
        step: { id: job.stepId, type: job.handler, config: {}, input: { type: 'static', value: job.input }, transitions: {} },
        context: {},
        execution: { id: job.executionId, flowId: '', stepCount: 0 },
        signal: this.createAbortSignal(),
      });

      // Handle result
      if (this.aborted) {
        return; // Lease was lost
      }

      if (result.outcome === 'success') {
        await context.complete(result.output);
      } else if (result.outcome === 'failure') {
        await context.fail(result.error ?? { code: 'UNKNOWN', message: 'Handler failed' });
      } else {
        // 'wait' - stateful handlers shouldn't return wait, but handle gracefully
        await context.fail({ code: 'INVALID_OUTCOME', message: 'Stateful handlers cannot return wait' });
      }
    } finally {
      this.stopHeartbeat();
    }
  }

  private createContext(job: Job): JobContext {
    return {
      job,
      runnerId: this.runnerId,

      heartbeat: async () => {
        return this.jobStore.heartbeat(job.id, this.runnerId);
      },

      isLeaseValid: async () => {
        const current = await this.jobStore.get(job.id);
        return current?.runnerId === this.runnerId && current?.status === 'running';
      },

      complete: async (result: unknown) => {
        const ok = await this.jobStore.complete(job.id, this.runnerId, result);
        if (!ok) {
          throw new Error('Failed to complete job - lease may have been lost');
        }
      },

      fail: async (error: JobError) => {
        const ok = await this.jobStore.fail(job.id, this.runnerId, error);
        if (!ok) {
          throw new Error('Failed to fail job - lease may have been lost');
        }
      },
    };
  }

  private startHeartbeat(jobId: string): void {
    const intervalMs = this.config.heartbeatIntervalMs ?? 10000;

    this.heartbeatTimer = setInterval(async () => {
      const ok = await this.jobStore.heartbeat(jobId, this.runnerId);
      if (!ok && this.config.abortOnHeartbeatFailure !== false) {
        this.aborted = true;
        this.stopHeartbeat();
      }
    }, intervalMs);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private createAbortSignal(): AbortSignal {
    const controller = new AbortController();

    // Check periodically if aborted
    const checkInterval = setInterval(() => {
      if (this.aborted) {
        controller.abort();
        clearInterval(checkInterval);
      }
    }, 1000);

    return controller.signal;
  }
}
```

### 5.6 Job Scheduler

**File:** `src/scheduler.ts`

```typescript
import type { JobStore, Job } from '@flowmonkey/postgres';
import type { JobProvider, StatefulHandler } from './types';

export interface SchedulerConfig {
  /** How often to poll for pending jobs (ms). Default: 1000 */
  pollIntervalMs?: number;

  /** Max jobs to process per poll. Default: 10 */
  batchSize?: number;
}

/**
 * Polls for pending jobs and submits them to a provider.
 */
export class JobScheduler {
  private running = false;
  private timer: NodeJS.Timeout | null = null;
  private handlers = new Map<string, StatefulHandler>();

  constructor(
    private jobStore: JobStore,
    private provider: JobProvider,
    private config: SchedulerConfig = {}
  ) {}

  /** Register a stateful handler */
  registerHandler(handler: StatefulHandler): void {
    this.handlers.set(handler.type, handler);
  }

  /** Start polling for jobs */
  start(): void {
    if (this.running) return;
    this.running = true;
    this.poll();
  }

  /** Stop polling */
  stop(): void {
    this.running = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private async poll(): Promise<void> {
    if (!this.running) return;

    try {
      const jobs = await this.jobStore.listByStatus('pending', this.config.batchSize ?? 10);

      for (const job of jobs) {
        const handler = this.handlers.get(job.handler);
        if (!handler) {
          console.warn(`No handler registered for ${job.handler}`);
          continue;
        }

        try {
          await this.provider.submit(job, handler);
        } catch (err) {
          console.error(`Failed to submit job ${job.id}:`, err);
        }
      }
    } catch (err) {
      console.error('Poll error:', err);
    }

    // Schedule next poll
    this.timer = setTimeout(() => this.poll(), this.config.pollIntervalMs ?? 1000);
  }
}
```

### 5.7 Job Reaper

**File:** `src/reaper.ts`

```typescript
import type { JobStore } from '@flowmonkey/postgres';

export interface ReaperConfig {
  /** How often to scan for stalled jobs (ms). Default: 30000 */
  intervalMs?: number;

  /** Max stalled jobs to process per scan. Default: 100 */
  batchSize?: number;
}

/**
 * Recovers stalled jobs (runners that died without completing).
 */
export class JobReaper {
  private running = false;
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private jobStore: JobStore,
    private config: ReaperConfig = {}
  ) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.scan();
  }

  stop(): void {
    this.running = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private async scan(): Promise<void> {
    if (!this.running) return;

    try {
      const stalled = await this.jobStore.findStalled(Date.now(), this.config.batchSize ?? 100);

      for (const job of stalled) {
        try {
          const reset = await this.jobStore.resetStalled(job.id);
          if (reset) {
            console.log(`Reset stalled job ${job.id} (attempts: ${job.attempts})`);
          }
        } catch (err) {
          console.error(`Failed to reset job ${job.id}:`, err);
        }
      }
    } catch (err) {
      console.error('Reaper scan error:', err);
    }

    this.timer = setTimeout(() => this.scan(), this.config.intervalMs ?? 30000);
  }
}
```

### 5.8 In-Process Provider

**File:** `src/providers/in-process.ts`

```typescript
import type { Job } from '@flowmonkey/postgres';
import type { JobProvider, StatefulHandler } from '../types';
import { JobRunner } from '../runner';
import type { JobStore } from '@flowmonkey/postgres';

/**
 * Runs jobs in the current process.
 * Use for development and testing.
 */
export class InProcessProvider implements JobProvider {
  private runners = new Map<string, JobRunner>();

  constructor(private jobStore: JobStore) {}

  async submit(job: Job, handler: StatefulHandler): Promise<void> {
    const runner = new JobRunner(this.jobStore);
    this.runners.set(job.id, runner);

    // Run async (don't await)
    runner.run(job, handler)
      .catch(err => console.error(`Job ${job.id} failed:`, err))
      .finally(() => this.runners.delete(job.id));
  }

  async cancel(jobId: string): Promise<void> {
    // In-process jobs can't be easily cancelled
    // The runner will abort on next heartbeat check if job is marked failed
  }

  async shutdown(): Promise<void> {
    // Wait for all runners to complete (with timeout)
    const timeout = setTimeout(() => {
      console.warn('Shutdown timeout - some jobs may not have completed');
    }, 30000);

    while (this.runners.size > 0) {
      await new Promise(r => setTimeout(r, 100));
    }

    clearTimeout(timeout);
  }
}
```

### 5.9 External Process Provider

**File:** `src/providers/external-process.ts`

```typescript
import { spawn, type ChildProcess } from 'child_process';
import type { Job } from '@flowmonkey/postgres';
import type { JobProvider, StatefulHandler } from '../types';

export interface ExternalProcessConfig {
  /** Path to runner script/executable */
  runnerPath: string;

  /** Additional environment variables */
  env?: Record<string, string>;
}

/**
 * Spawns jobs as separate OS processes.
 * More isolated than in-process, simpler than containers.
 */
export class ExternalProcessProvider implements JobProvider {
  private processes = new Map<string, ChildProcess>();

  constructor(private config: ExternalProcessConfig) {}

  async submit(job: Job, handler: StatefulHandler): Promise<void> {
    const proc = spawn(this.config.runnerPath, [], {
      env: {
        ...process.env,
        ...this.config.env,
        FM_JOB_ID: job.id,
        FM_HANDLER: job.handler,
        FM_INPUT: JSON.stringify(job.input),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    this.processes.set(job.id, proc);

    proc.stdout?.on('data', (data) => {
      console.log(`[job:${job.id}] ${data.toString().trim()}`);
    });

    proc.stderr?.on('data', (data) => {
      console.error(`[job:${job.id}] ${data.toString().trim()}`);
    });

    proc.on('exit', (code) => {
      this.processes.delete(job.id);
      if (code !== 0) {
        console.error(`Job ${job.id} exited with code ${code}`);
      }
    });
  }

  async cancel(jobId: string): Promise<void> {
    const proc = this.processes.get(jobId);
    if (proc) {
      proc.kill('SIGTERM');
      this.processes.delete(jobId);
    }
  }

  async shutdown(): Promise<void> {
    for (const [jobId, proc] of this.processes) {
      proc.kill('SIGTERM');
    }
    this.processes.clear();
  }
}
```

### 5.10 Package Exports

**File:** `src/index.ts`

```typescript
// Types
export type { StatefulHandler, JobProvider, JobContext, RunnerConfig } from './types';

// Core
export { JobRunner } from './runner';
export { JobScheduler, type SchedulerConfig } from './scheduler';
export { JobReaper, type ReaperConfig } from './reaper';

// Providers
export { InProcessProvider } from './providers/in-process';
export { ExternalProcessProvider, type ExternalProcessConfig } from './providers/external-process';
```

---

## 6. Package: @flowmonkey/handlers

### 6.1 Overview

Built-in handlers for common operations. These are **stateless** handlers that run inline.

### 6.2 Structure

```
packages/handlers/
├── src/
│   ├── index.ts
│   ├── http.ts
│   ├── delay.ts
│   ├── branch.ts
│   ├── transform.ts
│   ├── parallel.ts
│   └── set.ts
├── test/
│   └── handlers.test.ts
├── package.json
├── tsconfig.json
├── tsup.config.ts
└── vitest.config.ts
```

### 6.3 package.json

```json
{
  "name": "@flowmonkey/handlers",
  "version": "0.0.1",
  "description": "Built-in handlers for FlowMonkey",
  "type": "module",
  "main": "./dist/index.cjs",
  "module": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "import": { "types": "./dist/index.d.ts", "default": "./dist/index.js" },
      "require": { "types": "./dist/index.d.cts", "default": "./dist/index.cjs" }
    }
  },
  "files": ["dist"],
  "scripts": {
    "build": "tsup",
    "dev": "tsup --watch",
    "test": "vitest run",
    "typecheck": "tsc --noEmit",
    "clean": "rm -rf dist"
  },
  "dependencies": {
    "@flowmonkey/core": "workspace:*"
  },
  "devDependencies": {
    "tsup": "^8.0.0",
    "typescript": "^5.4.0",
    "vitest": "^2.0.0"
  }
}
```

### 6.4 HTTP Handler

**File:** `src/http.ts`

```typescript
import type { StepHandler } from '@flowmonkey/core';
import { Result } from '@flowmonkey/core';

export interface HttpConfig {
  url: string;
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  headers?: Record<string, string>;
  body?: unknown;
  timeoutMs?: number;
}

/**
 * HTTP request handler.
 * 
 * Config:
 * - url: Request URL (supports ${path} interpolation from input)
 * - method: HTTP method (default: GET)
 * - headers: Request headers
 * - body: Request body (for POST/PUT/PATCH)
 * - timeoutMs: Request timeout (default: 30000)
 */
export const httpHandler: StepHandler = {
  type: 'http',

  async execute({ input, step, signal }) {
    const config = step.config as HttpConfig;
    const method = config.method ?? 'GET';
    const timeoutMs = config.timeoutMs ?? 30000;

    // Interpolate URL with input
    let url = config.url;
    if (typeof input === 'object' && input !== null) {
      for (const [key, value] of Object.entries(input)) {
        url = url.replace(`\${${key}}`, String(value));
      }
    }

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);

      // Merge abort signals
      signal?.addEventListener('abort', () => controller.abort());

      const response = await fetch(url, {
        method,
        headers: config.headers,
        body: config.body ? JSON.stringify(config.body) : undefined,
        signal: controller.signal,
      });

      clearTimeout(timeout);

      const contentType = response.headers.get('content-type');
      const isJson = contentType?.includes('application/json');
      const body = isJson ? await response.json() : await response.text();

      if (!response.ok) {
        return Result.failure('HTTP_ERROR', `${response.status} ${response.statusText}`, { body });
      }

      return Result.success({
        status: response.status,
        headers: Object.fromEntries(response.headers.entries()),
        body,
      });
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        return Result.failure('TIMEOUT', `Request timed out after ${timeoutMs}ms`);
      }
      return Result.failure('HTTP_ERROR', err instanceof Error ? err.message : 'Request failed');
    }
  },
};
```

### 6.5 Delay Handler

**File:** `src/delay.ts`

```typescript
import type { StepHandler } from '@flowmonkey/core';
import { Result } from '@flowmonkey/core';

export interface DelayConfig {
  ms: number;
}

/**
 * Delay handler - waits for a specified duration.
 * 
 * Config:
 * - ms: Duration in milliseconds
 */
export const delayHandler: StepHandler = {
  type: 'delay',

  async execute({ step }) {
    const config = step.config as DelayConfig;
    return Result.wait(config.ms, `Waiting ${config.ms}ms`);
  },
};
```

### 6.6 Branch Handler

**File:** `src/branch.ts`

```typescript
import type { StepHandler } from '@flowmonkey/core';
import { Result } from '@flowmonkey/core';

export interface BranchCondition {
  path: string;
  op: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'exists' | 'notExists';
  value?: unknown;
  goto: string;
}

export interface BranchConfig {
  conditions: BranchCondition[];
  default?: string;
}

/**
 * Branch handler - conditional routing.
 * 
 * Config:
 * - conditions: Array of { path, op, value, goto }
 * - default: Default step if no condition matches
 */
export const branchHandler: StepHandler = {
  type: 'branch',

  async execute({ context, step }) {
    const config = step.config as BranchConfig;

    for (const cond of config.conditions) {
      const actual = getPath(context, cond.path);

      if (evaluate(actual, cond.op, cond.value)) {
        return { outcome: 'success', nextStepOverride: cond.goto };
      }
    }

    if (config.default) {
      return { outcome: 'success', nextStepOverride: config.default };
    }

    return Result.failure('NO_MATCH', 'No condition matched and no default');
  },
};

function getPath(obj: unknown, path: string): unknown {
  let current: any = obj;
  for (const part of path.split('.')) {
    if (current == null) return undefined;
    current = current[part];
  }
  return current;
}

function evaluate(actual: unknown, op: BranchCondition['op'], expected: unknown): boolean {
  switch (op) {
    case 'eq': return actual === expected;
    case 'neq': return actual !== expected;
    case 'gt': return (actual as number) > (expected as number);
    case 'gte': return (actual as number) >= (expected as number);
    case 'lt': return (actual as number) < (expected as number);
    case 'lte': return (actual as number) <= (expected as number);
    case 'exists': return actual !== undefined && actual !== null;
    case 'notExists': return actual === undefined || actual === null;
    default: return false;
  }
}
```

### 6.7 Transform Handler

**File:** `src/transform.ts`

```typescript
import type { StepHandler } from '@flowmonkey/core';
import { Result } from '@flowmonkey/core';

export interface TransformConfig {
  /** JavaScript expression or preset */
  transform: string | 'upper' | 'lower' | 'trim' | 'json.parse' | 'json.stringify';
}

/**
 * Transform handler - transform input data.
 * 
 * Config:
 * - transform: Preset name or custom expression
 */
export const transformHandler: StepHandler = {
  type: 'transform',

  async execute({ input, step }) {
    const config = step.config as TransformConfig;
    const t = config.transform;

    try {
      let result: unknown;

      switch (t) {
        case 'upper':
          result = String(input).toUpperCase();
          break;
        case 'lower':
          result = String(input).toLowerCase();
          break;
        case 'trim':
          result = String(input).trim();
          break;
        case 'json.parse':
          result = JSON.parse(String(input));
          break;
        case 'json.stringify':
          result = JSON.stringify(input);
          break;
        default:
          // Custom expression (sandboxed eval - use with caution)
          const fn = new Function('input', `return ${t}`);
          result = fn(input);
      }

      return Result.success(result);
    } catch (err) {
      return Result.failure('TRANSFORM_ERROR', err instanceof Error ? err.message : 'Transform failed');
    }
  },
};
```

### 6.8 Set Handler

**File:** `src/set.ts`

```typescript
import type { StepHandler } from '@flowmonkey/core';
import { Result } from '@flowmonkey/core';

export interface SetConfig {
  value: unknown;
}

/**
 * Set handler - sets a static value.
 * 
 * Config:
 * - value: The value to set
 */
export const setHandler: StepHandler = {
  type: 'set',

  async execute({ step }) {
    const config = step.config as SetConfig;
    return Result.success(config.value);
  },
};
```

### 6.9 Package Exports

**File:** `src/index.ts`

```typescript
export { httpHandler, type HttpConfig } from './http';
export { delayHandler, type DelayConfig } from './delay';
export { branchHandler, type BranchConfig, type BranchCondition } from './branch';
export { transformHandler, type TransformConfig } from './transform';
export { setHandler, type SetConfig } from './set';

// Convenience: all handlers
import { httpHandler } from './http';
import { delayHandler } from './delay';
import { branchHandler } from './branch';
import { transformHandler } from './transform';
import { setHandler } from './set';

export const allHandlers = [
  httpHandler,
  delayHandler,
  branchHandler,
  transformHandler,
  setHandler,
];
```

---

## 7. Package: @flowmonkey/triggers

### 7.1 Overview

Triggers are **boundary adapters** that create executions from external events.

Key rules:
- Triggers **only** call `engine.create()`
- Triggers never advance executions
- Triggers are versioned
- Triggers attach provenance metadata

### 7.2 Structure

```
packages/triggers/
├── src/
│   ├── index.ts
│   ├── types.ts
│   ├── http.ts
│   ├── cron.ts
│   └── manual.ts
├── test/
│   └── triggers.test.ts
├── package.json
├── tsconfig.json
├── tsup.config.ts
└── vitest.config.ts
```

### 7.3 package.json

```json
{
  "name": "@flowmonkey/triggers",
  "version": "0.0.1",
  "description": "Trigger adapters for FlowMonkey",
  "type": "module",
  "main": "./dist/index.cjs",
  "module": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "import": { "types": "./dist/index.d.ts", "default": "./dist/index.js" },
      "require": { "types": "./dist/index.d.cts", "default": "./dist/index.cjs" }
    }
  },
  "files": ["dist"],
  "scripts": {
    "build": "tsup",
    "dev": "tsup --watch",
    "test": "vitest run",
    "typecheck": "tsc --noEmit",
    "clean": "rm -rf dist"
  },
  "dependencies": {
    "@flowmonkey/core": "workspace:*"
  },
  "devDependencies": {
    "tsup": "^8.0.0",
    "typescript": "^5.4.0",
    "vitest": "^2.0.0"
  }
}
```

### 7.4 Types

**File:** `src/types.ts`

```typescript
import type { Engine, Execution } from '@flowmonkey/core';

/**
 * Trigger metadata attached to executions.
 */
export interface TriggerMetadata {
  trigger: {
    type: string;
    version: string;
    source?: string;
    receivedAt: number;
    requestId?: string;
    [key: string]: unknown;
  };
}

/**
 * Base trigger interface.
 */
export interface Trigger {
  /** Trigger type identifier */
  readonly type: string;

  /** Trigger version */
  readonly version: string;

  /** Start listening for events */
  start(): Promise<void>;

  /** Stop listening */
  stop(): Promise<void>;
}

/**
 * Creates trigger metadata.
 */
export function createTriggerMeta(
  type: string,
  version: string,
  extra?: Record<string, unknown>
): TriggerMetadata {
  return {
    trigger: {
      type,
      version,
      receivedAt: Date.now(),
      ...extra,
    },
  };
}
```

### 7.5 HTTP Trigger

**File:** `src/http.ts`

```typescript
import type { Engine, Execution } from '@flowmonkey/core';
import type { Trigger, TriggerMetadata } from './types';
import { createTriggerMeta } from './types';
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'http';

export interface HttpTriggerConfig {
  port: number;
  host?: string;
  routes: HttpRoute[];
}

export interface HttpRoute {
  /** HTTP method */
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  /** URL path pattern */
  path: string;
  /** Flow to trigger */
  flowId: string;
  /** Map request to context */
  mapContext?: (req: ParsedRequest) => Record<string, unknown>;
}

export interface ParsedRequest {
  method: string;
  path: string;
  params: Record<string, string>;
  query: Record<string, string>;
  headers: Record<string, string>;
  body: unknown;
}

/**
 * HTTP trigger - creates executions from HTTP requests.
 */
export class HttpTrigger implements Trigger {
  readonly type = 'http';
  readonly version = '1';

  private server: Server | null = null;

  constructor(
    private engine: Engine,
    private config: HttpTriggerConfig
  ) {}

  async start(): Promise<void> {
    this.server = createServer(async (req, res) => {
      await this.handleRequest(req, res);
    });

    return new Promise((resolve) => {
      this.server!.listen(this.config.port, this.config.host ?? '0.0.0.0', () => {
        console.log(`HTTP trigger listening on ${this.config.host ?? '0.0.0.0'}:${this.config.port}`);
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => resolve());
      } else {
        resolve();
      }
    });
  }

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const parsed = await this.parseRequest(req);
    const route = this.matchRoute(parsed);

    if (!route) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }

    try {
      const context = route.mapContext?.(parsed) ?? parsed;
      const meta = createTriggerMeta(this.type, this.version, {
        source: route.path,
        requestId: crypto.randomUUID(),
      });

      const execution = await this.engine.create(route.flowId, context, {
        metadata: meta,
      });

      res.writeHead(201, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ executionId: execution.id }));
    } catch (err) {
      console.error('Trigger error:', err);
      res.writeHead(500);
      res.end('Internal error');
    }
  }

  private async parseRequest(req: IncomingMessage): Promise<ParsedRequest> {
    const url = new URL(req.url ?? '/', `http://${req.headers.host}`);

    let body: unknown = undefined;
    if (req.method === 'POST' || req.method === 'PUT') {
      body = await this.readBody(req);
    }

    return {
      method: req.method ?? 'GET',
      path: url.pathname,
      params: {},
      query: Object.fromEntries(url.searchParams),
      headers: req.headers as Record<string, string>,
      body,
    };
  }

  private readBody(req: IncomingMessage): Promise<unknown> {
    return new Promise((resolve, reject) => {
      let data = '';
      req.on('data', chunk => data += chunk);
      req.on('end', () => {
        try {
          resolve(data ? JSON.parse(data) : undefined);
        } catch {
          resolve(data);
        }
      });
      req.on('error', reject);
    });
  }

  private matchRoute(req: ParsedRequest): HttpRoute | undefined {
    return this.config.routes.find(r =>
      r.method === req.method && this.pathMatches(r.path, req.path)
    );
  }

  private pathMatches(pattern: string, actual: string): boolean {
    // Simple matching - could be enhanced with params
    return pattern === actual;
  }
}
```

### 7.6 Manual Trigger

**File:** `src/manual.ts`

```typescript
import type { Engine, Execution } from '@flowmonkey/core';
import { createTriggerMeta } from './types';

/**
 * Manual trigger - for programmatic triggering.
 */
export class ManualTrigger {
  readonly type = 'manual';
  readonly version = '1';

  constructor(private engine: Engine) {}

  /**
   * Trigger a flow execution.
   */
  async trigger(
    flowId: string,
    context: Record<string, unknown> = {},
    source?: string
  ): Promise<Execution> {
    const meta = createTriggerMeta(this.type, this.version, { source });
    return this.engine.create(flowId, context, { metadata: meta });
  }
}
```

### 7.7 Package Exports

**File:** `src/index.ts`

```typescript
export type { Trigger, TriggerMetadata } from './types';
export { createTriggerMeta } from './types';
export { HttpTrigger, type HttpTriggerConfig, type HttpRoute, type ParsedRequest } from './http';
export { ManualTrigger } from './manual';
```

---

## 8. Observability

### 8.1 Metrics (Derived from Event Store)

All metrics are derived from the `fm_events` table and `fm_jobs` table:

```sql
-- Executions created per minute
SELECT
  date_trunc('minute', to_timestamp(timestamp/1000)) as minute,
  count(*) as count
FROM fm_events
WHERE type = 'execution.created'
GROUP BY 1 ORDER BY 1;

-- Step latency percentiles
SELECT
  step_id,
  percentile_cont(0.50) WITHIN GROUP (ORDER BY (payload->>'durationMs')::int) as p50,
  percentile_cont(0.95) WITHIN GROUP (ORDER BY (payload->>'durationMs')::int) as p95,
  percentile_cont(0.99) WITHIN GROUP (ORDER BY (payload->>'durationMs')::int) as p99
FROM fm_events
WHERE type = 'step.completed'
GROUP BY step_id;

-- Job status distribution
SELECT status, count(*) FROM fm_jobs GROUP BY status;

-- Stalled jobs
SELECT * FROM fm_jobs
WHERE status = 'running'
  AND heartbeat_at < extract(epoch from now()) * 1000 - (heartbeat_ms * 3);
```

### 8.2 Recommended Metrics

| Metric | Source | Type |
|--------|--------|------|
| `fm_executions_created_total` | Events | Counter |
| `fm_executions_completed_total` | Events | Counter |
| `fm_executions_failed_total` | Events | Counter |
| `fm_executions_active` | Executions table | Gauge |
| `fm_step_duration_seconds` | Events | Histogram |
| `fm_jobs_pending` | Jobs table | Gauge |
| `fm_jobs_running` | Jobs table | Gauge |
| `fm_jobs_stalled_total` | Reaper | Counter |

### 8.3 APIs

Expose these endpoints for debugging:

```
GET /api/executions              - List executions
GET /api/executions/:id          - Get execution
GET /api/executions/:id/events   - Get execution events
GET /api/executions/:id/jobs     - Get execution jobs

GET /api/jobs                    - List jobs
GET /api/jobs/:id                - Get job
GET /api/jobs?status=running     - Filter by status
GET /api/jobs?stalled=true       - Find stalled jobs

GET /api/flows                   - List flows
GET /api/flows/:id               - Get flow
GET /api/flows/:id/versions      - List versions
```

---

## 9. Integration Examples

### 9.1 Simple Setup (Single Instance)

```typescript
import { Pool } from 'pg';
import { Engine, DefaultHandlerRegistry } from '@flowmonkey/core';
import { createPgStores, applySchema } from '@flowmonkey/postgres';
import { allHandlers } from '@flowmonkey/handlers';
import { ManualTrigger } from '@flowmonkey/triggers';

async function main() {
  // Database
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  await applySchema(pool);

  // Stores
  const stores = await createPgStores(pool);

  // Handlers
  const handlers = new DefaultHandlerRegistry();
  handlers.registerAll(allHandlers);

  // Engine
  const engine = new Engine(
    stores.executions,
    handlers,
    stores.flows,
    stores.events
  );

  // Register a flow
  stores.flows.register({
    id: 'hello-world',
    version: '1.0.0',
    initialStepId: 'greet',
    steps: {
      greet: {
        id: 'greet',
        type: 'set',
        config: { value: 'Hello, World!' },
        input: { type: 'static', value: null },
        outputKey: 'message',
        transitions: { onSuccess: null },
      },
    },
  });

  // Trigger
  const trigger = new ManualTrigger(engine);
  const execution = await trigger.trigger('hello-world');
  
  // Run
  await engine.run(execution.id);
  
  const result = await engine.get(execution.id);
  console.log(result?.context.message); // "Hello, World!"
}
```

### 9.2 Production Setup (Distributed)

```typescript
import { Pool } from 'pg';
import { createClient } from 'redis';
import { Engine, DefaultHandlerRegistry } from '@flowmonkey/core';
import { createPgStores } from '@flowmonkey/postgres';
import { RedisLockManager, RedisWakeSignaler } from '@flowmonkey/redis';
import { JobScheduler, JobReaper, InProcessProvider } from '@flowmonkey/jobs';
import { HttpTrigger } from '@flowmonkey/triggers';
import { allHandlers } from '@flowmonkey/handlers';

async function main() {
  // Connections
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const redis = createClient({ url: process.env.REDIS_URL });
  await redis.connect();

  // Stores
  const stores = await createPgStores(pool);
  const locks = new RedisLockManager(redis);
  const signals = new RedisWakeSignaler(redis);

  // Handlers
  const handlers = new DefaultHandlerRegistry();
  handlers.registerAll(allHandlers);

  // Engine
  const engine = new Engine(
    stores.executions,
    handlers,
    stores.flows,
    stores.events
  );

  // Job system
  const provider = new InProcessProvider(stores.jobs);
  const scheduler = new JobScheduler(stores.jobs, provider);
  const reaper = new JobReaper(stores.jobs);

  scheduler.start();
  reaper.start();

  // HTTP trigger
  const httpTrigger = new HttpTrigger(engine, {
    port: 3000,
    routes: [
      { method: 'POST', path: '/trigger/hello', flowId: 'hello-world' },
    ],
  });
  await httpTrigger.start();

  // Worker loop
  async function worker() {
    await signals.subscribe(async (executionId) => {
      const lock = await locks.acquire(executionId, 30000);
      if (!lock) return;

      try {
        const result = await engine.tick(executionId);
        if (!result.done && result.status === 'running') {
          await signals.signal(executionId);
        }
      } finally {
        await lock.release();
      }
    });

    // Also poll for missed wakes
    setInterval(async () => {
      const ready = await stores.executions.listWakeReady(Date.now());
      for (const id of ready) {
        await signals.signal(id);
      }
    }, 5000);
  }

  worker();
  console.log('FlowMonkey running');
}
```

---

## 10. Implementation Checklist

### Core Updates (from Part 1)
- [ ] Add `Lock` interface to `state-store.ts`
- [ ] Add `acquireLock?()` to `StateStore`
- [ ] Add `versions()` to `FlowRegistry`
- [ ] Update `DefaultFlowRegistry` with `versions()`
- [ ] Export `validateFlow` from index

### @flowmonkey/postgres
- [ ] `package.json`
- [ ] `tsconfig.json`, `tsup.config.ts`, `vitest.config.ts`
- [ ] `src/schema.ts`
- [ ] `src/execution-store.ts`
- [ ] `src/flow-store.ts`
- [ ] `src/job-store.ts`
- [ ] `src/event-store.ts`
- [ ] `src/factory.ts`
- [ ] `src/index.ts`
- [ ] Tests

### @flowmonkey/redis
- [ ] `package.json`
- [ ] `tsconfig.json`, `tsup.config.ts`, `vitest.config.ts`
- [ ] `src/lock.ts`
- [ ] `src/signals.ts`
- [ ] `src/cache.ts`
- [ ] `src/index.ts`
- [ ] Tests

### @flowmonkey/jobs
- [ ] `package.json`
- [ ] `tsconfig.json`, `tsup.config.ts`, `vitest.config.ts`
- [ ] `src/types.ts`
- [ ] `src/runner.ts`
- [ ] `src/scheduler.ts`
- [ ] `src/reaper.ts`
- [ ] `src/providers/in-process.ts`
- [ ] `src/providers/external-process.ts`
- [ ] `src/index.ts`
- [ ] Tests

### @flowmonkey/handlers
- [ ] `package.json`
- [ ] `tsconfig.json`, `tsup.config.ts`, `vitest.config.ts`
- [ ] `src/http.ts`
- [ ] `src/delay.ts`
- [ ] `src/branch.ts`
- [ ] `src/transform.ts`
- [ ] `src/set.ts`
- [ ] `src/index.ts`
- [ ] Tests

### @flowmonkey/triggers
- [ ] `package.json`
- [ ] `tsconfig.json`, `tsup.config.ts`, `vitest.config.ts`
- [ ] `src/types.ts`
- [ ] `src/http.ts`
- [ ] `src/manual.ts`
- [ ] `src/index.ts`
- [ ] Tests

---

**End of Specification — Part 2**