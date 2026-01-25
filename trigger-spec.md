# FlowMonkey Triggers Specification

**Version:** 0.0.1  
**Status:** Draft  
**Last Updated:** January 2026
**Depends On:** `@flowmonkey/core`, `@flowmonkey/postgres`

---

## Table of Contents

1. [Overview](#1-overview)
2. [Trigger Types](#2-trigger-types)
3. [Database Schema](#3-database-schema)
4. [Trigger Definitions](#4-trigger-definitions)
5. [Trigger Execution](#5-trigger-execution)
6. [History & Logging](#6-history--logging)
7. [Trigger Store Interface](#7-trigger-store-interface)
8. [HTTP Endpoint](#8-http-endpoint)
9. [Schedule Runner](#9-schedule-runner)
10. [Implementation](#10-implementation)
11. [TriggerService (Unified API)](#11-triggerservice-unified-api)

---

## 1. Overview

### 1.1 What Are Triggers?

Triggers are **dynamic, database-stored** configurations that create flow executions from external events.

### 1.2 Key Properties

- **Dynamic** — create/update/disable without redeploy
- **Validated** — incoming payloads validated against JSON Schema
- **Logged** — every trigger invocation is recorded
- **Two types** — HTTP webhooks and scheduled (cron)

### 1.3 Single Endpoint Pattern

All HTTP triggers go through one endpoint:

```
POST /trigger/:triggerId
```

No hardcoded routes. The trigger ID determines which flow runs and how the payload is validated.

---

## 2. Trigger Types

### 2.1 HTTP Triggers

Receive external webhooks/API calls.

```typescript
{
  type: 'http',
  inputSchema: { ... },  // JSON Schema for validation
  contextKey: 'payload', // Where validated input lands in context
}
```

**Flow:**
```
Request → Validate → Create Execution → Response
```

### 2.2 Schedule Triggers

Run on a cron schedule.

```typescript
{
  type: 'schedule',
  schedule: '0 9 * * *',   // Cron expression
  timezone: 'UTC',          // Timezone for cron
  staticContext: { ... },   // Context passed to flow
}
```

**Flow:**
```
Cron fires → Create Execution → Done
```

---

## 3. Database Schema

### 3.1 Triggers Table

```sql
CREATE TABLE IF NOT EXISTS fm_triggers (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  description     TEXT,
  flow_id         TEXT NOT NULL,
  type            TEXT NOT NULL CHECK (type IN ('http', 'schedule')),
  enabled         BOOLEAN NOT NULL DEFAULT true,
  
  -- HTTP triggers
  input_schema    JSONB,           -- JSON Schema for validation
  context_key     TEXT,            -- Where payload goes in context
  
  -- Schedule triggers
  schedule        TEXT,            -- Cron expression
  timezone        TEXT DEFAULT 'UTC',
  static_context  JSONB,           -- Context for scheduled runs
  
  -- Schedule state
  last_run_at     BIGINT,          -- Last successful trigger time
  next_run_at     BIGINT,          -- Computed next run time
  
  -- Metadata
  created_at      BIGINT NOT NULL,
  updated_at      BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_fm_triggers_flow ON fm_triggers(flow_id);
CREATE INDEX IF NOT EXISTS idx_fm_triggers_type ON fm_triggers(type);
CREATE INDEX IF NOT EXISTS idx_fm_triggers_enabled ON fm_triggers(enabled) WHERE enabled = true;
CREATE INDEX IF NOT EXISTS idx_fm_triggers_next_run ON fm_triggers(next_run_at) 
  WHERE type = 'schedule' AND enabled = true;
```

### 3.2 Trigger History Table

```sql
CREATE TABLE IF NOT EXISTS fm_trigger_history (
  id              BIGSERIAL PRIMARY KEY,
  trigger_id      TEXT NOT NULL,
  execution_id    TEXT,            -- NULL if failed before execution created
  
  status          TEXT NOT NULL CHECK (status IN ('success', 'validation_failed', 'flow_not_found', 'error')),
  
  -- Request details (HTTP only)
  request_body    JSONB,
  request_headers JSONB,
  request_ip      TEXT,
  
  -- Validation errors (if any)
  validation_errors JSONB,
  
  -- Error details (if status = 'error')
  error_code      TEXT,
  error_message   TEXT,
  
  -- Timing
  duration_ms     INTEGER,
  timestamp       BIGINT NOT NULL,
  
  CONSTRAINT fk_trigger FOREIGN KEY (trigger_id) 
    REFERENCES fm_triggers(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_fm_trigger_history_trigger ON fm_trigger_history(trigger_id);
CREATE INDEX IF NOT EXISTS idx_fm_trigger_history_status ON fm_trigger_history(status);
CREATE INDEX IF NOT EXISTS idx_fm_trigger_history_ts ON fm_trigger_history(timestamp);
CREATE INDEX IF NOT EXISTS idx_fm_trigger_history_exec ON fm_trigger_history(execution_id) 
  WHERE execution_id IS NOT NULL;
```

---

## 4. Trigger Definitions

### 4.1 Base Trigger

```typescript
interface BaseTrigger {
  id: string;
  name: string;
  description?: string;
  flowId: string;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
}
```

### 4.2 HTTP Trigger

```typescript
interface HttpTrigger extends BaseTrigger {
  type: 'http';
  
  /**
   * JSON Schema for validating incoming requests.
   * Standard JSON Schema draft-07.
   */
  inputSchema: JSONSchema;
  
  /**
   * Key in flow context where validated payload is stored.
   * e.g., "order" → context.order = payload
   */
  contextKey: string;
}
```

### 4.3 Schedule Trigger

```typescript
interface ScheduleTrigger extends BaseTrigger {
  type: 'schedule';
  
  /**
   * Cron expression (5 or 6 fields).
   * e.g., "0 9 * * *" = daily at 9am
   */
  schedule: string;
  
  /**
   * Timezone for cron evaluation.
   * Default: 'UTC'
   */
  timezone: string;
  
  /**
   * Static context passed to flow on each run.
   */
  staticContext: Record<string, unknown>;
  
  /**
   * Last successful run timestamp.
   */
  lastRunAt?: number;
  
  /**
   * Computed next run timestamp.
   */
  nextRunAt?: number;
}

type Trigger = HttpTrigger | ScheduleTrigger;
```

### 4.4 JSON Schema Example

```typescript
// HTTP Trigger for order webhooks
const orderTrigger: HttpTrigger = {
  id: 'trg_order_webhook',
  name: 'Order Webhook',
  description: 'Receives new orders from e-commerce platform',
  flowId: 'order-processing',
  type: 'http',
  enabled: true,
  
  inputSchema: {
    type: 'object',
    properties: {
      orderId: { type: 'string', minLength: 1 },
      amount: { type: 'number', minimum: 0 },
      currency: { type: 'string', enum: ['USD', 'EUR', 'GBP'] },
      customer: {
        type: 'object',
        properties: {
          email: { type: 'string', format: 'email' },
          name: { type: 'string' },
        },
        required: ['email'],
      },
      items: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            sku: { type: 'string' },
            quantity: { type: 'integer', minimum: 1 },
            price: { type: 'number' },
          },
          required: ['sku', 'quantity'],
        },
        minItems: 1,
      },
    },
    required: ['orderId', 'amount', 'customer', 'items'],
  },
  
  contextKey: 'order',
  createdAt: Date.now(),
  updatedAt: Date.now(),
};
```

### 4.5 Schedule Trigger Example

```typescript
const dailyReportTrigger: ScheduleTrigger = {
  id: 'trg_daily_report',
  name: 'Daily Report',
  description: 'Generates daily sales report at 9am',
  flowId: 'generate-report',
  type: 'schedule',
  enabled: true,
  
  schedule: '0 9 * * *',  // Every day at 9:00 AM
  timezone: 'America/New_York',
  
  staticContext: {
    reportType: 'daily-sales',
    recipients: ['team@company.com'],
  },
  
  createdAt: Date.now(),
  updatedAt: Date.now(),
};
```

---

## 5. Trigger Execution

### 5.1 HTTP Trigger Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                    POST /trigger/:triggerId                     │
└─────────────────────────────┬───────────────────────────────────┘
                              │
                              ▼
                    ┌─────────────────┐
                    │  Load Trigger   │
                    └────────┬────────┘
                             │
              ┌──────────────┴──────────────┐
              │                             │
              ▼                             ▼
        ┌───────────┐                ┌─────────────┐
        │  Found?   │───── No ────── │ 404 + Log   │
        └─────┬─────┘                └─────────────┘
              │ Yes
              ▼
        ┌───────────┐                ┌─────────────┐
        │ Enabled?  │───── No ────── │ 403 + Log   │
        └─────┬─────┘                └─────────────┘
              │ Yes
              ▼
        ┌───────────┐                ┌─────────────┐
        │ Validate  │───── Fail ──── │ 400 + Log   │
        │  Schema   │                │ (errors)    │
        └─────┬─────┘                └─────────────┘
              │ Pass
              ▼
        ┌───────────┐                ┌─────────────┐
        │ Flow      │───── No ────── │ 500 + Log   │
        │ Exists?   │                └─────────────┘
        └─────┬─────┘
              │ Yes
              ▼
        ┌───────────────┐
        │ Create        │
        │ Execution     │
        └───────┬───────┘
                │
                ▼
        ┌───────────────┐
        │ Log Success   │
        └───────┬───────┘
                │
                ▼
        ┌───────────────┐
        │ 201 Created   │
        │ {executionId} │
        └───────────────┘
```

### 5.2 Schedule Trigger Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                    Schedule Runner (every minute)               │
└─────────────────────────────┬───────────────────────────────────┘
                              │
                              ▼
                    ┌─────────────────────┐
                    │ Find due triggers   │
                    │ WHERE next_run_at   │
                    │   <= now            │
                    │   AND enabled       │
                    └──────────┬──────────┘
                               │
                               ▼
                    ┌─────────────────────┐
                    │  For each trigger   │
                    └──────────┬──────────┘
                               │
              ┌────────────────┴────────────────┐
              │                                 │
              ▼                                 ▼
        ┌───────────┐                    ┌───────────┐
        │ Flow      │───── No ────────── │ Log Error │
        │ Exists?   │                    │ Skip      │
        └─────┬─────┘                    └───────────┘
              │ Yes
              ▼
        ┌───────────────┐
        │ Create        │
        │ Execution     │
        └───────┬───────┘
                │
                ▼
        ┌───────────────┐
        │ Update        │
        │ last_run_at   │
        │ next_run_at   │
        └───────┬───────┘
                │
                ▼
        ┌───────────────┐
        │ Log Success   │
        └───────────────┘
```

---

## 6. History & Logging

### 6.1 History Record

```typescript
interface TriggerHistoryRecord {
  id: number;
  triggerId: string;
  executionId?: string;  // null if failed before execution
  
  status: 'success' | 'validation_failed' | 'flow_not_found' | 'error';
  
  // HTTP request details
  requestBody?: unknown;
  requestHeaders?: Record<string, string>;
  requestIp?: string;
  
  // Validation errors
  validationErrors?: ValidationError[];
  
  // Error details
  errorCode?: string;
  errorMessage?: string;
  
  // Timing
  durationMs: number;
  timestamp: number;
}

interface ValidationError {
  path: string;       // JSON path to field, e.g., "customer.email"
  message: string;    // Human-readable error
  keyword: string;    // JSON Schema keyword, e.g., "required", "format"
}
```

### 6.2 What Gets Logged

**Always logged:**
- Trigger ID
- Timestamp
- Duration
- Status

**HTTP triggers also log:**
- Request body (can redact sensitive fields)
- Request headers (selected, not auth headers)
- Request IP
- Validation errors (if any)

**Schedule triggers also log:**
- Scheduled time vs actual time

### 6.3 Log Examples

**Success:**
```json
{
  "id": 12345,
  "triggerId": "trg_order_webhook",
  "executionId": "exec_abc123",
  "status": "success",
  "requestBody": { "orderId": "ORD-001", "amount": 99.99 },
  "requestIp": "203.0.113.42",
  "durationMs": 23,
  "timestamp": 1706000000000
}
```

**Validation Failed:**
```json
{
  "id": 12346,
  "triggerId": "trg_order_webhook",
  "executionId": null,
  "status": "validation_failed",
  "requestBody": { "orderId": "ORD-001" },
  "validationErrors": [
    { "path": "amount", "message": "is required", "keyword": "required" },
    { "path": "customer", "message": "is required", "keyword": "required" },
    { "path": "items", "message": "is required", "keyword": "required" }
  ],
  "durationMs": 2,
  "timestamp": 1706000001000
}
```

**Flow Not Found:**
```json
{
  "id": 12347,
  "triggerId": "trg_old_webhook",
  "executionId": null,
  "status": "flow_not_found",
  "errorCode": "FLOW_NOT_FOUND",
  "errorMessage": "Flow 'deleted-flow' not found",
  "durationMs": 5,
  "timestamp": 1706000002000
}
```

### 6.4 Retention

Cleanup job (configurable):

```sql
-- Delete history older than 30 days, keeping at least last 100 per trigger
DELETE FROM fm_trigger_history
WHERE timestamp < (EXTRACT(EPOCH FROM NOW()) * 1000) - (30 * 24 * 60 * 60 * 1000)
  AND id NOT IN (
    SELECT id FROM (
      SELECT id, ROW_NUMBER() OVER (PARTITION BY trigger_id ORDER BY timestamp DESC) as rn
      FROM fm_trigger_history
    ) sub WHERE rn <= 100
  );
```

---

## 7. Trigger Store Interface

### 7.1 Interface

```typescript
interface TriggerStore {
  // CRUD
  create(trigger: Omit<Trigger, 'id' | 'createdAt' | 'updatedAt'>): Promise<Trigger>;
  get(id: string): Promise<Trigger | null>;
  update(id: string, updates: Partial<Trigger>): Promise<Trigger | null>;
  delete(id: string): Promise<boolean>;
  
  // Queries
  list(options?: { flowId?: string; type?: 'http' | 'schedule'; enabled?: boolean }): Promise<Trigger[]>;
  listDueSchedules(now: number): Promise<ScheduleTrigger[]>;
  
  // Schedule management
  updateScheduleRun(id: string, lastRunAt: number, nextRunAt: number): Promise<void>;
  
  // History
  logInvocation(record: Omit<TriggerHistoryRecord, 'id'>): Promise<void>;
  getHistory(triggerId: string, options?: { limit?: number; status?: string }): Promise<TriggerHistoryRecord[]>;
  getHistoryStats(triggerId: string, since: number): Promise<TriggerStats>;
}

interface TriggerStats {
  total: number;
  success: number;
  validationFailed: number;
  flowNotFound: number;
  error: number;
  avgDurationMs: number;
}
```

### 7.2 Implementation

```typescript
import type { Pool } from 'pg';
import { generateId } from '@flowmonkey/core';

export class PgTriggerStore implements TriggerStore {
  constructor(private pool: Pool) {}

  async create(data: Omit<Trigger, 'id' | 'createdAt' | 'updatedAt'>): Promise<Trigger> {
    const id = `trg_${generateId().slice(0, 12)}`;
    const now = Date.now();

    const trigger: Trigger = {
      ...data,
      id,
      createdAt: now,
      updatedAt: now,
    } as Trigger;

    // Compute next run for schedules
    if (trigger.type === 'schedule') {
      (trigger as ScheduleTrigger).nextRunAt = this.computeNextRun(
        trigger.schedule,
        trigger.timezone
      );
    }

    await this.pool.query(
      `INSERT INTO fm_triggers (
        id, name, description, flow_id, type, enabled,
        input_schema, context_key,
        schedule, timezone, static_context, next_run_at,
        created_at, updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [
        trigger.id,
        trigger.name,
        trigger.description ?? null,
        trigger.flowId,
        trigger.type,
        trigger.enabled,
        trigger.type === 'http' ? JSON.stringify(trigger.inputSchema) : null,
        trigger.type === 'http' ? trigger.contextKey : null,
        trigger.type === 'schedule' ? trigger.schedule : null,
        trigger.type === 'schedule' ? trigger.timezone : null,
        trigger.type === 'schedule' ? JSON.stringify(trigger.staticContext) : null,
        trigger.type === 'schedule' ? trigger.nextRunAt : null,
        now,
        now,
      ]
    );

    return trigger;
  }

  async get(id: string): Promise<Trigger | null> {
    const { rows } = await this.pool.query(
      `SELECT * FROM fm_triggers WHERE id = $1`,
      [id]
    );
    return rows[0] ? this.rowToTrigger(rows[0]) : null;
  }

  async update(id: string, updates: Partial<Trigger>): Promise<Trigger | null> {
    const current = await this.get(id);
    if (!current) return null;

    const updated = { ...current, ...updates, updatedAt: Date.now() };

    // Recompute next run if schedule changed
    if (updated.type === 'schedule' && 
        (updates.schedule || updates.timezone || updates.enabled !== undefined)) {
      (updated as ScheduleTrigger).nextRunAt = updated.enabled
        ? this.computeNextRun(updated.schedule, updated.timezone)
        : undefined;
    }

    await this.pool.query(
      `UPDATE fm_triggers SET
        name = $2,
        description = $3,
        flow_id = $4,
        enabled = $5,
        input_schema = $6,
        context_key = $7,
        schedule = $8,
        timezone = $9,
        static_context = $10,
        next_run_at = $11,
        updated_at = $12
      WHERE id = $1`,
      [
        id,
        updated.name,
        updated.description ?? null,
        updated.flowId,
        updated.enabled,
        updated.type === 'http' ? JSON.stringify((updated as HttpTrigger).inputSchema) : null,
        updated.type === 'http' ? (updated as HttpTrigger).contextKey : null,
        updated.type === 'schedule' ? (updated as ScheduleTrigger).schedule : null,
        updated.type === 'schedule' ? (updated as ScheduleTrigger).timezone : null,
        updated.type === 'schedule' ? JSON.stringify((updated as ScheduleTrigger).staticContext) : null,
        updated.type === 'schedule' ? (updated as ScheduleTrigger).nextRunAt : null,
        updated.updatedAt,
      ]
    );

    return updated;
  }

  async delete(id: string): Promise<boolean> {
    const { rowCount } = await this.pool.query(
      `DELETE FROM fm_triggers WHERE id = $1`,
      [id]
    );
    return (rowCount ?? 0) > 0;
  }

  async list(options?: { flowId?: string; type?: 'http' | 'schedule'; enabled?: boolean }): Promise<Trigger[]> {
    const conditions: string[] = [];
    const params: any[] = [];
    let paramIndex = 1;

    if (options?.flowId) {
      conditions.push(`flow_id = $${paramIndex++}`);
      params.push(options.flowId);
    }
    if (options?.type) {
      conditions.push(`type = $${paramIndex++}`);
      params.push(options.type);
    }
    if (options?.enabled !== undefined) {
      conditions.push(`enabled = $${paramIndex++}`);
      params.push(options.enabled);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const { rows } = await this.pool.query(
      `SELECT * FROM fm_triggers ${where} ORDER BY created_at DESC`,
      params
    );

    return rows.map(r => this.rowToTrigger(r));
  }

  async listDueSchedules(now: number): Promise<ScheduleTrigger[]> {
    const { rows } = await this.pool.query(
      `SELECT * FROM fm_triggers
       WHERE type = 'schedule'
         AND enabled = true
         AND next_run_at <= $1
       ORDER BY next_run_at ASC`,
      [now]
    );
    return rows.map(r => this.rowToTrigger(r) as ScheduleTrigger);
  }

  async updateScheduleRun(id: string, lastRunAt: number, nextRunAt: number): Promise<void> {
    await this.pool.query(
      `UPDATE fm_triggers
       SET last_run_at = $2, next_run_at = $3, updated_at = $4
       WHERE id = $1`,
      [id, lastRunAt, nextRunAt, Date.now()]
    );
  }

  async logInvocation(record: Omit<TriggerHistoryRecord, 'id'>): Promise<void> {
    await this.pool.query(
      `INSERT INTO fm_trigger_history (
        trigger_id, execution_id, status,
        request_body, request_headers, request_ip,
        validation_errors, error_code, error_message,
        duration_ms, timestamp
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        record.triggerId,
        record.executionId ?? null,
        record.status,
        record.requestBody ? JSON.stringify(record.requestBody) : null,
        record.requestHeaders ? JSON.stringify(record.requestHeaders) : null,
        record.requestIp ?? null,
        record.validationErrors ? JSON.stringify(record.validationErrors) : null,
        record.errorCode ?? null,
        record.errorMessage ?? null,
        record.durationMs,
        record.timestamp,
      ]
    );
  }

  async getHistory(triggerId: string, options?: { limit?: number; status?: string }): Promise<TriggerHistoryRecord[]> {
    const conditions = ['trigger_id = $1'];
    const params: any[] = [triggerId];
    let paramIndex = 2;

    if (options?.status) {
      conditions.push(`status = $${paramIndex++}`);
      params.push(options.status);
    }

    const limit = options?.limit ?? 100;

    const { rows } = await this.pool.query(
      `SELECT * FROM fm_trigger_history
       WHERE ${conditions.join(' AND ')}
       ORDER BY timestamp DESC
       LIMIT ${limit}`,
      params
    );

    return rows.map(r => this.rowToHistory(r));
  }

  async getHistoryStats(triggerId: string, since: number): Promise<TriggerStats> {
    const { rows } = await this.pool.query(
      `SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE status = 'success') as success,
        COUNT(*) FILTER (WHERE status = 'validation_failed') as validation_failed,
        COUNT(*) FILTER (WHERE status = 'flow_not_found') as flow_not_found,
        COUNT(*) FILTER (WHERE status = 'error') as error,
        AVG(duration_ms) as avg_duration_ms
       FROM fm_trigger_history
       WHERE trigger_id = $1 AND timestamp >= $2`,
      [triggerId, since]
    );

    const r = rows[0];
    return {
      total: Number(r.total),
      success: Number(r.success),
      validationFailed: Number(r.validation_failed),
      flowNotFound: Number(r.flow_not_found),
      error: Number(r.error),
      avgDurationMs: Number(r.avg_duration_ms) || 0,
    };
  }

  private computeNextRun(schedule: string, timezone: string): number {
    // Use cron-parser library
    const parser = require('cron-parser');
    const interval = parser.parseExpression(schedule, { tz: timezone });
    return interval.next().getTime();
  }

  private rowToTrigger(row: any): Trigger {
    const base = {
      id: row.id,
      name: row.name,
      description: row.description ?? undefined,
      flowId: row.flow_id,
      enabled: row.enabled,
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at),
    };

    if (row.type === 'http') {
      return {
        ...base,
        type: 'http',
        inputSchema: row.input_schema,
        contextKey: row.context_key,
      } as HttpTrigger;
    } else {
      return {
        ...base,
        type: 'schedule',
        schedule: row.schedule,
        timezone: row.timezone,
        staticContext: row.static_context ?? {},
        lastRunAt: row.last_run_at ? Number(row.last_run_at) : undefined,
        nextRunAt: row.next_run_at ? Number(row.next_run_at) : undefined,
      } as ScheduleTrigger;
    }
  }

  private rowToHistory(row: any): TriggerHistoryRecord {
    return {
      id: Number(row.id),
      triggerId: row.trigger_id,
      executionId: row.execution_id ?? undefined,
      status: row.status,
      requestBody: row.request_body ?? undefined,
      requestHeaders: row.request_headers ?? undefined,
      requestIp: row.request_ip ?? undefined,
      validationErrors: row.validation_errors ?? undefined,
      errorCode: row.error_code ?? undefined,
      errorMessage: row.error_message ?? undefined,
      durationMs: row.duration_ms,
      timestamp: Number(row.timestamp),
    };
  }
}
```

---

## 8. HTTP Endpoint

### 8.1 Handler Function

```typescript
import Ajv from 'ajv';
import addFormats from 'ajv-formats';

const ajv = new Ajv({ allErrors: true });
addFormats(ajv);

interface TriggerHandlerDeps {
  triggerStore: TriggerStore;
  flowRegistry: FlowRegistry;
  engine: Engine;
  signals?: WakeSignaler;
}

export interface TriggerResult {
  status: number;
  body: unknown;
}

export async function handleTrigger(
  deps: TriggerHandlerDeps,
  triggerId: string,
  body: unknown,
  meta: { headers?: Record<string, string>; ip?: string }
): Promise<TriggerResult> {
  const startTime = Date.now();

  // Load trigger
  const trigger = await deps.triggerStore.get(triggerId);
  
  if (!trigger) {
    return { status: 404, body: { error: 'Trigger not found' } };
  }

  if (!trigger.enabled) {
    await deps.triggerStore.logInvocation({
      triggerId,
      status: 'error',
      errorCode: 'TRIGGER_DISABLED',
      errorMessage: 'Trigger is disabled',
      requestBody: body,
      requestIp: meta.ip,
      durationMs: Date.now() - startTime,
      timestamp: Date.now(),
    });
    return { status: 403, body: { error: 'Trigger is disabled' } };
  }

  if (trigger.type !== 'http') {
    return { status: 400, body: { error: 'Not an HTTP trigger' } };
  }

  // Validate input
  const validate = ajv.compile(trigger.inputSchema);
  const valid = validate(body);

  if (!valid) {
    const errors = (validate.errors ?? []).map(e => ({
      path: e.instancePath || e.params?.missingProperty || '',
      message: e.message ?? 'Invalid',
      keyword: e.keyword,
    }));

    await deps.triggerStore.logInvocation({
      triggerId,
      status: 'validation_failed',
      requestBody: body,
      requestIp: meta.ip,
      validationErrors: errors,
      durationMs: Date.now() - startTime,
      timestamp: Date.now(),
    });

    return { status: 400, body: { error: 'Validation failed', errors } };
  }

  // Check flow exists
  const flow = deps.flowRegistry.get(trigger.flowId);
  if (!flow) {
    await deps.triggerStore.logInvocation({
      triggerId,
      status: 'flow_not_found',
      errorCode: 'FLOW_NOT_FOUND',
      errorMessage: `Flow '${trigger.flowId}' not found`,
      requestBody: body,
      requestIp: meta.ip,
      durationMs: Date.now() - startTime,
      timestamp: Date.now(),
    });
    return { status: 500, body: { error: 'Flow not found' } };
  }

  // Create execution
  try {
    const context = { [trigger.contextKey]: body };

    const execution = await deps.engine.create(trigger.flowId, context, {
      metadata: {
        trigger: { id: triggerId, type: 'http', receivedAt: startTime },
      },
    });

    // Signal worker
    await deps.signals?.signal(execution.id);

    await deps.triggerStore.logInvocation({
      triggerId,
      executionId: execution.id,
      status: 'success',
      requestBody: body,
      requestIp: meta.ip,
      durationMs: Date.now() - startTime,
      timestamp: Date.now(),
    });

    return { status: 201, body: { executionId: execution.id } };
  } catch (err) {
    await deps.triggerStore.logInvocation({
      triggerId,
      status: 'error',
      errorCode: 'EXECUTION_ERROR',
      errorMessage: err instanceof Error ? err.message : 'Unknown error',
      requestBody: body,
      requestIp: meta.ip,
      durationMs: Date.now() - startTime,
      timestamp: Date.now(),
    });
    return { status: 500, body: { error: 'Failed to create execution' } };
  }
}
```

### 8.2 Express Integration

```typescript
import express from 'express';

app.post('/trigger/:triggerId', async (req, res) => {
  const result = await handleTrigger(deps, req.params.triggerId, req.body, {
    headers: req.headers as Record<string, string>,
    ip: req.ip,
  });
  res.status(result.status).json(result.body);
});
```

---

## 9. Schedule Runner

```typescript
import parser from 'cron-parser';

export class ScheduleRunner {
  private running = false;
  private timer: NodeJS.Timeout | null = null;
  private intervalMs: number;

  constructor(
    private deps: {
      triggerStore: TriggerStore;
      flowRegistry: FlowRegistry;
      engine: Engine;
      signals?: WakeSignaler;
    },
    options?: { intervalMs?: number }
  ) {
    this.intervalMs = options?.intervalMs ?? 60000;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.tick();
  }

  stop(): void {
    this.running = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private async tick(): Promise<void> {
    if (!this.running) return;

    try {
      const now = Date.now();
      const dueTriggers = await this.deps.triggerStore.listDueSchedules(now);

      for (const trigger of dueTriggers) {
        await this.fireTrigger(trigger, now);
      }
    } catch (err) {
      console.error('Schedule runner error:', err);
    }

    this.timer = setTimeout(() => this.tick(), this.intervalMs);
  }

  private async fireTrigger(trigger: ScheduleTrigger, now: number): Promise<void> {
    const startTime = Date.now();

    const flow = this.deps.flowRegistry.get(trigger.flowId);
    if (!flow) {
      await this.deps.triggerStore.logInvocation({
        triggerId: trigger.id,
        status: 'flow_not_found',
        errorCode: 'FLOW_NOT_FOUND',
        errorMessage: `Flow '${trigger.flowId}' not found`,
        durationMs: Date.now() - startTime,
        timestamp: now,
      });
      // Still advance schedule
      const nextRunAt = this.computeNextRun(trigger.schedule, trigger.timezone);
      await this.deps.triggerStore.updateScheduleRun(trigger.id, now, nextRunAt);
      return;
    }

    try {
      const execution = await this.deps.engine.create(trigger.flowId, trigger.staticContext, {
        metadata: {
          trigger: {
            id: trigger.id,
            type: 'schedule',
            scheduledAt: trigger.nextRunAt,
            firedAt: now,
          },
        },
      });

      await this.deps.signals?.signal(execution.id);

      await this.deps.triggerStore.logInvocation({
        triggerId: trigger.id,
        executionId: execution.id,
        status: 'success',
        durationMs: Date.now() - startTime,
        timestamp: now,
      });

      const nextRunAt = this.computeNextRun(trigger.schedule, trigger.timezone);
      await this.deps.triggerStore.updateScheduleRun(trigger.id, now, nextRunAt);
    } catch (err) {
      await this.deps.triggerStore.logInvocation({
        triggerId: trigger.id,
        status: 'error',
        errorCode: 'EXECUTION_ERROR',
        errorMessage: err instanceof Error ? err.message : 'Unknown error',
        durationMs: Date.now() - startTime,
        timestamp: now,
      });
      const nextRunAt = this.computeNextRun(trigger.schedule, trigger.timezone);
      await this.deps.triggerStore.updateScheduleRun(trigger.id, now, nextRunAt);
    }
  }

  private computeNextRun(schedule: string, timezone: string): number {
    const interval = parser.parseExpression(schedule, { tz: timezone });
    return interval.next().getTime();
  }
}
```

---

## 10. Implementation

### 10.1 Package Structure

```
packages/triggers/
├── src/
│   ├── index.ts
│   ├── types.ts
│   ├── schema.ts
│   ├── store.ts
│   ├── http-handler.ts
│   └── schedule-runner.ts
├── test/
│   ├── store.test.ts
│   ├── http-handler.test.ts
│   └── schedule-runner.test.ts
├── package.json
├── tsconfig.json
└── tsup.config.ts
```

### 10.2 package.json

```json
{
  "name": "@flowmonkey/triggers",
  "version": "0.0.1",
  "type": "module",
  "main": "./dist/index.cjs",
  "module": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "dependencies": {
    "@flowmonkey/core": "workspace:*",
    "ajv": "^8.12.0",
    "ajv-formats": "^2.1.1",
    "cron-parser": "^4.9.0"
  },
  "peerDependencies": {
    "pg": "^8.0.0"
  }
}
```

### 10.3 Exports

```typescript
// Types
export type { Trigger, HttpTrigger, ScheduleTrigger, TriggerHistoryRecord, TriggerStats, ValidationError } from './types';

// Store
export { PgTriggerStore, type TriggerStore } from './store';

// HTTP Handler
export { handleTrigger, type TriggerResult } from './http-handler';

// Schedule Runner
export { ScheduleRunner } from './schedule-runner';

// Schema
export { triggerSchema, applyTriggerSchema } from './schema';
```

---

---

## 11. TriggerService (Unified API)

The `TriggerService` wraps all trigger functionality in a single, user-friendly class. This is the **recommended entry point** for most applications.

### 11.1 User Code Example

```typescript
import { TriggerService } from '@flowmonkey/triggers';

// Setup
const triggers = new TriggerService({
  triggerStore,   // TriggerStore (e.g., PgTriggerStore)
  flowRegistry,   // FlowRegistry
  engine,         // Engine
  signals,        // Optional: WakeSignaler for worker coordination
});

// Mount HTTP endpoint — framework detected internally
triggers.mount(app);

// Start schedule runner
triggers.startScheduler();

// Graceful shutdown
process.on('SIGTERM', async () => {
  await triggers.stop();
});
```

### 11.2 TriggerService Interface

```typescript
export interface TriggerServiceOptions {
  triggerStore: TriggerStore;
  flowRegistry: FlowRegistry;
  engine: Engine;
  signals?: WakeSignaler;

  /** Path prefix for trigger endpoint (default: '/trigger') */
  basePath?: string;
  /** Schedule runner poll interval in ms (default: 60000) */
  scheduleIntervalMs?: number;
}

export class TriggerService {
  constructor(options: TriggerServiceOptions);

  /**
   * Mount the HTTP trigger endpoint on a server/app.
   * Auto-detects Express, Fastify, Hono, or raw Node http.Server.
   *
   * @param app - Express app, Fastify instance, Hono app, or http.Server
   * @param options - Override basePath if needed
   */
  mount(app: unknown, options?: { basePath?: string }): void;

  /**
   * Start the schedule runner (polls for due triggers).
   * Idempotent — calling multiple times has no effect.
   */
  startScheduler(): void;

  /**
   * Stop the schedule runner gracefully.
   */
  stopScheduler(): void;

  /**
   * Stop all services (scheduler, etc).
   */
  async stop(): Promise<void>;

  /**
   * Direct access to handleTrigger for custom integrations.
   */
  async handleTrigger(
    triggerId: string,
    body: unknown,
    meta?: { headers?: Record<string, string>; ip?: string }
  ): Promise<TriggerResult>;

  /**
   * Direct access to the schedule runner for testing/advanced use.
   */
  get scheduler(): ScheduleRunner;
}
```

### 11.3 Framework Auto-Detection

`mount()` inspects the provided object to determine the framework:

```typescript
mount(app: unknown, options?: { basePath?: string }): void {
  const path = options?.basePath ?? this.basePath;

  if (this.isExpress(app)) {
    this.mountExpress(app, path);
  } else if (this.isFastify(app)) {
    this.mountFastify(app, path);
  } else if (this.isHono(app)) {
    this.mountHono(app, path);
  } else if (this.isHttpServer(app)) {
    this.mountHttpServer(app, path);
  } else {
    throw new Error(
      'Unsupported server type. Pass Express, Fastify, Hono, or http.Server.'
    );
  }
}

private isExpress(app: any): boolean {
  return typeof app?.post === 'function' && typeof app?.use === 'function';
}

private isFastify(app: any): boolean {
  return typeof app?.register === 'function' && typeof app?.route === 'function';
}

private isHono(app: any): boolean {
  return typeof app?.post === 'function' && app?.constructor?.name === 'Hono';
}

private isHttpServer(app: any): boolean {
  return app instanceof require('http').Server;
}
```

### 11.4 Express Mount

```typescript
private mountExpress(app: any, basePath: string): void {
  const router = require('express').Router();

  router.post('/:triggerId', async (req: any, res: any) => {
    const result = await this.handleTrigger(req.params.triggerId, req.body, {
      headers: req.headers,
      ip: req.ip,
    });
    res.status(result.status).json(result.body);
  });

  app.use(basePath, router);
}
```

### 11.5 Fastify Mount

```typescript
private mountFastify(app: any, basePath: string): void {
  app.post(`${basePath}/:triggerId`, async (request: any, reply: any) => {
    const result = await this.handleTrigger(
      request.params.triggerId,
      request.body,
      { headers: request.headers, ip: request.ip }
    );
    return reply.status(result.status).send(result.body);
  });
}
```

### 11.6 Hono Mount

```typescript
private mountHono(app: any, basePath: string): void {
  app.post(`${basePath}/:triggerId`, async (c: any) => {
    const triggerId = c.req.param('triggerId');
    const body = await c.req.json();
    const result = await this.handleTrigger(triggerId, body, {
      headers: Object.fromEntries(c.req.headers),
      ip: c.req.header('x-forwarded-for') ?? c.req.raw?.socket?.remoteAddress,
    });
    return c.json(result.body, result.status);
  });
}
```

### 11.7 Full Implementation

```typescript
import Ajv from 'ajv';
import addFormats from 'ajv-formats';

const ajv = new Ajv({ allErrors: true });
addFormats(ajv);

export class TriggerService {
  private readonly store: TriggerStore;
  private readonly flows: FlowRegistry;
  private readonly engine: Engine;
  private readonly signals?: WakeSignaler;
  private readonly basePath: string;
  private readonly scheduleRunner: ScheduleRunner;

  constructor(options: TriggerServiceOptions) {
    this.store = options.triggerStore;
    this.flows = options.flowRegistry;
    this.engine = options.engine;
    this.signals = options.signals;
    this.basePath = options.basePath ?? '/trigger';

    this.scheduleRunner = new ScheduleRunner(
      {
        triggerStore: this.store,
        flowRegistry: this.flows,
        engine: this.engine,
        signals: this.signals,
      },
      { intervalMs: options.scheduleIntervalMs }
    );
  }

  mount(app: unknown, options?: { basePath?: string }): void {
    const path = options?.basePath ?? this.basePath;

    if (this.isExpress(app)) {
      this.mountExpress(app, path);
    } else if (this.isFastify(app)) {
      this.mountFastify(app, path);
    } else if (this.isHono(app)) {
      this.mountHono(app, path);
    } else {
      throw new Error(
        'Unsupported server type. Pass Express, Fastify, Hono, or http.Server.'
      );
    }
  }

  startScheduler(): void {
    this.scheduleRunner.start();
  }

  stopScheduler(): void {
    this.scheduleRunner.stop();
  }

  async stop(): Promise<void> {
    this.stopScheduler();
  }

  async handleTrigger(
    triggerId: string,
    body: unknown,
    meta: { headers?: Record<string, string>; ip?: string } = {}
  ): Promise<TriggerResult> {
    return handleTrigger(
      {
        triggerStore: this.store,
        flowRegistry: this.flows,
        engine: this.engine,
        signals: this.signals,
      },
      triggerId,
      body,
      meta
    );
  }

  get scheduler(): ScheduleRunner {
    return this.scheduleRunner;
  }

  // --- Framework detection (see 11.3) ---
  private isExpress(app: any): boolean { /* ... */ }
  private isFastify(app: any): boolean { /* ... */ }
  private isHono(app: any): boolean { /* ... */ }
  private mountExpress(app: any, path: string): void { /* ... */ }
  private mountFastify(app: any, path: string): void { /* ... */ }
  private mountHono(app: any, path: string): void { /* ... */ }
}
```

### 11.8 Usage Patterns

**Minimal setup (Express):**

```typescript
import express from 'express';
import { TriggerService, PgTriggerStore } from '@flowmonkey/triggers';
import { Engine, DefaultFlowRegistry, DefaultHandlerRegistry } from '@flowmonkey/core';
import { PgExecutionStore } from '@flowmonkey/postgres';
import { Pool } from 'pg';

const pool = new Pool();
const triggerStore = new PgTriggerStore(pool);
const execStore = new PgExecutionStore(pool);
const flowRegistry = new DefaultFlowRegistry();
const handlers = new DefaultHandlerRegistry();
const engine = new Engine(execStore, handlers, flowRegistry);

const triggers = new TriggerService({
  triggerStore,
  flowRegistry,
  engine,
});

const app = express();
app.use(express.json());

triggers.mount(app);
triggers.startScheduler();

app.listen(3000);
```

**With Redis signals (distributed workers):**

```typescript
import { WakeSignaler } from '@flowmonkey/redis';

const signals = new WakeSignaler(redisClient);

const triggers = new TriggerService({
  triggerStore,
  flowRegistry,
  engine,
  signals,  // Workers wake immediately when executions are created
});
```

**Custom base path:**

```typescript
triggers.mount(app, { basePath: '/api/webhooks' });
// Endpoint: POST /api/webhooks/:triggerId
```

**Fastify example:**

```typescript
import Fastify from 'fastify';

const fastify = Fastify();
triggers.mount(fastify);

await fastify.listen({ port: 3000 });
```

**Hono (edge/Cloudflare Workers):**

```typescript
import { Hono } from 'hono';

const app = new Hono();
triggers.mount(app);

export default app;
```

---

## Implementation Checklist

- [ ] Add tables to schema (`fm_triggers`, `fm_trigger_history`)
- [ ] Implement `PgTriggerStore`
- [ ] Implement `handleTrigger` function
- [ ] Implement `ScheduleRunner`
- [ ] **Implement `TriggerService` (unified API)**
- [ ] Add Ajv validation
- [ ] Add cron-parser
- [ ] Add framework adapters (Express, Fastify, Hono)
- [ ] Tests
- [ ] Update examples

---

**End of Specification**