# @flowmonkey/triggers

Trigger management and webhook handling for starting workflows from external events.

This package provides trigger stores and handlers. HTTP endpoints are exposed through `@flowmonkey/express`.

---

## Overview

Triggers allow workflows to be started from external events:

- **HTTP triggers** - Webhooks that validate input and start workflows
- **Schedule triggers** - Cron-based execution (via `ScheduleRunner`)

---

## HTTP Trigger Flow

```
External Request → Trigger Validation → Workflow Start → Response
```

The trigger route is defined in `@flowmonkey/express`:

```
POST /api/triggers/:triggerId
```

See [@flowmonkey/express](express.md#fire-trigger) for endpoint documentation.

---

## Trigger Types

### HTTP Trigger

Receives webhooks and validates against a JSON Schema before starting a workflow.

```typescript
interface HttpTrigger {
  id: string;
  type: 'http';
  flowId: string;
  inputSchema: JSONSchema;
  enabled: boolean;
  tenantId?: string;
  createdAt: number;
  updatedAt: number;
}
```

### Schedule Trigger

Executes workflows on a cron schedule.

```typescript
interface ScheduleTrigger {
  id: string;
  type: 'schedule';
  flowId: string;
  schedule: string;        // Cron expression
  timezone?: string;
  enabled: boolean;
  tenantId?: string;
  lastRunAt?: number;
  nextRunAt?: number;
  createdAt: number;
  updatedAt: number;
}
```

---

## Programmatic Usage

### Handle Trigger Invocation

```typescript
import { handleTrigger, TriggerHandlerDeps } from '@flowmonkey/triggers';

const deps: TriggerHandlerDeps = {
  triggerStore,
  flowRegistry,
  engine,
  signals,  // Optional: wake signaler for job runner
};

const result = await handleTrigger(deps, triggerId, requestBody, {
  headers: req.headers,
  ip: req.ip,
});

// result.status: 200 | 400 | 403 | 404
// result.body: { executionId, ... } | { error, ... }
```

### Trigger Result

```typescript
interface TriggerResult {
  status: number;
  body: {
    executionId?: string;
    triggerId?: string;
    flowId?: string;
    firedAt?: number;
    error?: string;
    errors?: ValidationError[];
  };
}
```

---

## Stores

### TriggerStore Interface

```typescript
interface TriggerStore {
  get(id: string): Promise<Trigger | null>;
  create(trigger: CreateTrigger): Promise<Trigger>;
  update(id: string, updates: Partial<Trigger>): Promise<Trigger | null>;
  delete(id: string): Promise<boolean>;
  list(filter?: TriggerFilter): Promise<Trigger[]>;
  logInvocation(record: TriggerHistoryRecord): Promise<void>;
  getStats(triggerId: string): Promise<TriggerStats>;
}
```

### Available Stores

| Store | Package | Description |
|-------|---------|-------------|
| `PgTriggerStore` | `@flowmonkey/triggers` | PostgreSQL-backed (production) |
| `MemoryTriggerStore` | `@flowmonkey/triggers` | In-memory (testing) |

---

## Schedule Runner

Processes schedule triggers on their cron intervals.

```typescript
import { ScheduleRunner } from '@flowmonkey/triggers';

const runner = new ScheduleRunner({
  triggerStore,
  flowRegistry,
  engine,
  pollInterval: 60000,    // Check every 60s
  lockDuration: 300000,   // 5 min lock
});

await runner.start();
// ... later
await runner.stop();
```

---

## Validation

HTTP triggers validate request bodies against JSON Schema using AJV.

**Validation Error Format:**

```json
{
  "error": "Validation failed",
  "errors": [
    {
      "path": "data.orderId",
      "message": "is required",
      "keyword": "required"
    }
  ]
}
```

---

## Invocation Logging

All trigger invocations are logged for debugging and analytics:

```typescript
interface TriggerHistoryRecord {
  triggerId: string;
  status: 'success' | 'validation_failed' | 'error';
  executionId?: string;
  errorCode?: string;
  errorMessage?: string;
  requestBody?: unknown;
  requestIp?: string;
  validationErrors?: ValidationError[];
  durationMs: number;
  timestamp: number;
}
```

---

## Database Schema

Applied via `applyTriggerSchema(pool)`:

```sql
CREATE TABLE fm_triggers (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  flow_id TEXT NOT NULL,
  tenant_id TEXT,
  enabled BOOLEAN DEFAULT true,
  config JSONB NOT NULL,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);

CREATE TABLE fm_trigger_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trigger_id TEXT NOT NULL REFERENCES fm_triggers(id),
  status TEXT NOT NULL,
  execution_id TEXT,
  request_body JSONB,
  request_ip TEXT,
  error_code TEXT,
  error_message TEXT,
  validation_errors JSONB,
  duration_ms INTEGER,
  timestamp BIGINT NOT NULL
);
```
