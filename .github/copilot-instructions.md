## FlowMonkey — AI Agent Guide

FlowMonkey is a **stateless**, production-ready workflow execution engine for TypeScript/Node.js. The repo uses pnpm workspaces with focused packages. Make minimal, safe changes and follow conventions from existing tests.

**Quick links:**
- [README.md](../../README.md) — project overview, quick start
- [CONTRIBUTING.md](../../CONTRIBUTING.md) — PR guidelines, commit conventions
- [packages/core/README.md](../../packages/core/README.md) — core API docs
- [packages/core/examples/](../../packages/core/examples/) — runnable examples (12 files covering all core features)

### 🏗️ Architecture (read first)

**Critical concept:** The `Engine` is **stateless**—all mutable state lives in `Execution` objects persisted via `StateStore` implementations.

```
┌──────────────────────────────────────────────────────────────┐
│ Engine (stateless)                                           │
│  ├─ FlowRegistry (flow definitions)                          │
│  ├─ HandlerRegistry (step implementations)                   │
│  ├─ StateStore (persistence: Memory/Postgres/Redis)          │
│  ├─ EventBus / EventDispatcher (observability)               │
│  ├─ TableStore + TableRegistry (DataStore for pipes)         │
│  └─ WriteAheadLog (WAL for failed pipe inserts)              │
└──────────────────────────────────────────────────────────────┘
         ↓ creates & mutates
┌──────────────────────────────────────────────────────────────┐
│ Execution (mutable state)                                    │
│  ├─ id, flowId, flowVersion, status                          │
│  ├─ currentStep, context (data), history, retryAttempts      │
│  ├─ wakeAt (for waiting), error, metadata                    │
│  └─ idempotencyKey, timeoutConfig, cancellation              │
└──────────────────────────────────────────────────────────────┘
```

**Key packages:**
- `packages/core` — engine, types, interfaces, registries, `MemoryStore`, `TestHarness`, `EventDispatcher`
  - `src/engine/execution-engine.ts` — core `Engine` class (stateless orchestrator)
  - `src/types/flow.ts` — `Flow`, `Step`, input selectors, transitions, `RetryConfig`
  - `src/types/execution.ts` — `Execution` state model
  - `src/types/table.ts` — `TableDef`, `ColumnDef`, `PipeDef`, `Row`, `RowQuery`, `WALEntry`
  - `src/types/result.ts` — `StepResult`, `Result` helpers (success/failure/wait)
  - `src/impl/event-dispatcher.ts` — `EventDispatcher` with sync/async, wildcard, multi-listener
  - `src/impl/memory-table-*.ts` — in-memory DataStore (`MemoryTableRegistry`, `MemoryTableStore`, `MemoryWAL`)
  - `src/impl/event-emitting-*.ts` — 5 decorators that emit events on mutations
  - `src/test/harness.ts` — testing utility with `simulateTime`, tables, dispatcher
  - `examples/` — 12 runnable examples covering all core features
- `packages/handlers` — built-in handlers (http, delay, transform, conditional, switch, sub-flow, etc.)
  - `src/handlers.ts` — function-based handlers (`StepHandler` interface)
  - `src/conditional.ts` — conditional (13 operators) and switch routing handlers
  - `src/sub-flow.ts` — `createSubFlowHandler()` factory for parent/child workflows
  - `src/class/*.ts` — class-based handlers using decorators (`@Handler`, `@Input`)
- `packages/postgres` / `packages/redis` — production stores
  - `packages/postgres/src/schema.ts` — SQL schema, `applySchema(pool)` helper, migration v0.4.0
  - `packages/postgres/src/execution-store.ts` — `StateStore` implementation
  - `packages/postgres/src/table-registry.ts` — `PgTableRegistry` (DataStore)
  - `packages/postgres/src/table-store.ts` — `PgTableStore` (DataStore)
  - `packages/postgres/src/wal-store.ts` — `PgWALStore` (DataStore)
- `packages/jobs` — stateful handler job runner (claim/process/complete pattern)
- `packages/express` — REST API with dependency injection (`ServiceContainer`)
- `packages/forms` — form submission service with validation, captcha, rate-limiting
- `packages/triggers` — HTTP webhooks, cron schedules, event-driven flow starters

### 📐 Patterns & Conventions

#### **Execution Lifecycle & Statuses**
Executions transition through these statuses:
```
pending → running → completed
                 ↘ failed
                 ↘ waiting → running (resumed)
                          ↘ cancelled
                 ↘ cancelling → cancelled
```
- `pending` — Created but not started
- `running` — Currently executing a step
- `waiting` — Paused, waiting for external event or time
- `cancelling` — Cancellation requested, cleanup in progress
- `cancelled` — Stopped by cancellation
- `completed` — Successfully finished
- `failed` — Terminated with error

**Cancellable statuses:** `pending`, `running`, `waiting`

#### **Engine Options**
Configure engine behavior at initialization:
```typescript
const engine = new Engine(store, handlers, flows, eventBus, {
  recordHistory: true,       // Store step history (default: false)
  maxSteps: 1000,            // Max steps per execution (default: 1000)
  timeoutMs: 30000,          // Handler timeout in ms (default: 30000)
  contextLimits: {           // Context size limits
    maxSizeBytes: 1048576,   // 1MB max context size
    maxDepth: 32,            // Max nesting depth
    maxKeys: 1000            // Max number of keys
  },
  tokenManager: myTokenMgr,  // Custom resume token manager
  tableStore: myTableStore,  // DataStore for pipe row inserts
  tableRegistry: myTableReg, // DataStore table definitions
  pipeWAL: myWAL             // Write-ahead log for failed pipe inserts
});
```

#### **Flows & Steps**
Flows are **immutable** definitions with versioning. Steps define transitions:
```typescript
const flow: Flow = {
  id: 'my-flow',
  version: '1.0.0',
  initialStepId: 'step1',
  steps: {
    step1: {
      id: 'step1',
      type: 'http',  // handler type
      config: { url: 'https://api.example.com' },
      input: { type: 'key', key: 'requestData' },  // 6 selector types: key|keys|path|template|full|static
      outputKey: 'response',  // stores result in context.response
      transitions: { onSuccess: 'step2', onFailure: null },  // null = end flow
      retry: {                   // optional retry config
        maxAttempts: 3,
        backoffMs: 1000,
        backoffMultiplier: 2
      }
    }
  },
  // Pipes: route step outputs to DataStore tables (fire-and-forget)
  pipes: [{
    id: 'pipe-1', stepId: 'step1', on: 'success',
    tableId: 'my-table',
    mappings: [{ sourcePath: 'body.id', columnId: 'response_id' }]
  }]
};
```

#### **Handlers**
Two styles: **function-based** (simple) and **class-based** (with decorators/validation).

**Function-based** (`packages/handlers/src/handlers.ts`):
```typescript
export const myHandler: StepHandler = {
  type: 'my-handler',
  async execute(params: HandlerParams) {
    const { input, context, execution } = params;
    // Do work...
    return { outcome: 'success', output: { result: 42 } };
  }
};
```

**Handler outcomes** (return from `execute()` — prefer `Result` helpers):
- `Result.success(output)` — Step succeeded, store output in context
- `Result.failure(code, message)` — Expected failure, follow onFailure transition
- `Result.wait(durationMs, reason?)` — Pause for duration (sets `wakeAt`)
- `Result.waitUntil(timestamp, reason?)` — Pause until specific time
- `Result.waitForSignal(reason)` — Pause indefinitely until external resume
- `{ outcome: 'success', nextStepOverride: 'step-id' }` — Override transition target
- Throw error — Unexpected error, execution fails immediately

**Class-based** (`packages/handlers/src/class/http.ts`):
```typescript
@Handler({ type: 'http', name: 'HTTP Request', category: 'external' })
export class HttpHandler extends StatelessHandler<Input, Output, Error> {
  @Input({ type: 'string', source: 'config', required: true })
  @Url()
  url!: string;
  
  async execute(params: HandlerParams): Promise<StepResult> {
    // this.url is validated, this.method has defaults
    const response = await fetch(this.url, { method: this.method });
    return this.success({ body: await response.text() });
  }
}
```
Register handlers: `handlerRegistry.register(myHandler)`

#### **Step Retry & Backoff**
Steps can automatically retry on failure with exponential backoff:
```typescript
const step: Step = {
  id: 'call-api',
  type: 'http',
  config: {},
  input: { type: 'full' },
  outputKey: 'response',
  transitions: { onSuccess: 'next', onFailure: null },
  retry: {
    maxAttempts: 5,            // retry up to 5 times
    backoffMs: 100,            // start at 100ms
    backoffMultiplier: 2,      // double each time: 100, 200, 400, 800...
    maxBackoffMs: 60000,       // cap at 60s
    retryOn: ['TRANSIENT'],    // only retry specific error codes (optional)
  }
};
```
- Retry state stored per-step in `execution.retryAttempts[stepId]`
- Backoff > 0: sets status to `waiting` with `wakeAt` — re-runs same step on next tick
- Backoff = 0: immediate retry within same tick
- Emits `step.retry` event with `{ attempt, maxAttempts, backoffMs, error }`
- Cleared on success or when retries exhausted

#### **Conditional & Switch Routing**
Dynamic step routing via `nextStepOverride`:

```typescript
import { conditionalHandler, switchHandler } from '@flowmonkey/handlers';

// Conditional: evaluate conditions in order, first match wins
const step: Step = {
  id: 'route',
  type: 'conditional',
  config: {
    conditions: [
      { path: 'score', op: 'gte', value: 90, target: 'grade-a' },
      { path: 'score', op: 'gte', value: 70, target: 'grade-b' },
    ],
    default: 'grade-c',
  },
  // ...
};

// Switch: direct value lookup
const switchStep: Step = {
  id: 'route',
  type: 'switch',
  config: {
    path: 'method',
    cases: { GET: 'handle-get', POST: 'handle-post' },
    default: 'handle-other',
  },
  // ...
};
```
**13 operators:** `eq`, `neq`, `gt`, `gte`, `lt`, `lte`, `in`, `nin`, `contains`, `startsWith`, `endsWith`, `exists`, `notExists`, `matches`

#### **Sub-flow Handler**
Spawn child executions from within a flow:
```typescript
import { createSubFlowHandler } from '@flowmonkey/handlers';

// Factory — needs engine reference
const subFlowHandler = createSubFlowHandler(engine);
handlers.register(subFlowHandler);

// Step config
const step: Step = {
  id: 'run-child',
  type: 'sub-flow',
  config: {
    flowId: 'child-flow',           // required
    waitForCompletion: true,         // default: true (blocks until child finishes)
    // waitForCompletion: false      // fire-and-forget mode
  },
  input: { type: 'key', key: 'childInput' },
  outputKey: 'childResult',
  transitions: { onSuccess: 'next', onFailure: 'handle-error' },
};
```
- Child linked via `parentExecutionId`
- Wait mode: runs child inline, returns `{ childExecutionId, status, context }`
- Fire-and-forget: spawns child, returns immediately with `{ childExecutionId, mode: 'fire-and-forget' }`

#### **Persistence**
- **Tests:** Use `MemoryStore` (in-memory, no external deps)
- **Production:** Use `PgExecutionStore` or `RedisExecutionStore`
- **Schema:** `packages/postgres/src/schema.ts` — use `applySchema(pool)` in integration tests
- **Jobs:** Stateful handlers (long-running) use `JobStore` (create/claim/complete/fail pattern) managed by `packages/jobs/src/runner.ts`

#### **Testing with TestHarness**
```typescript
import { TestHarness } from '@flowmonkey/core/test';

const t = new TestHarness({
  handlers: [myHandler],
  flows: [myFlow],
  recordHistory: true,  // default: true (Engine default is false)
  maxSteps: 100,        // default: 100 (Engine default is 1000)
  tables: [myTable],    // optional: pre-register DataStore tables for pipe testing
});

// Run flow to completion
const { execution, result, events } = await t.run('my-flow', { input: 'data' });

// Assertions
t.assertCompleted(execution);
t.assertFailed(execution, 'ERROR_CODE');  // optional code check
t.assertCancelled(execution);
t.assertContext(execution, { expectedKey: 'value' });

// Inspect events (auto-captured by wildcard listener)
const stepEvents = events.filter(e => e.type === 'step.completed');

// Use dispatcher for typed subscriptions
t.dispatcher.on('step.completed', (e) => { /* typed event */ });

// Access internal stores
t.store;           // MemoryStore
t.tableStore;      // MemoryTableStore
t.tableRegistry;   // MemoryTableRegistry
t.wal;             // MemoryWAL
```
- `t.run()` executes with `simulateTime: true` by default — skips real delays for fast tests
- `t.events` — captured engine events via EventDispatcher wildcard `'*'` in sync mode
- `t.dispatcher` — `EventDispatcher` (sync mode) for typed subscriptions
- `t.create()` — create execution without running (manual tick control)
- `t.createWithResult()` — create and return `CreateResult` with idempotency info
- `t.reset()` — clears all stores, events, registries
- All stores wrapped with `EventEmitting*` decorators for automatic event capture
- Use for unit tests, integration tests, flow validation

#### **Context Helpers**
Access execution context with helper methods:
```typescript
// In handler
const helpers = params.helpers;

// Read values
const value = helpers.get('user.profile.email');  // dot notation
const safe = helpers.getSafe('maybe.missing.key', 'default');

// Write values
helpers.set('result.status', 'success');  // dot notation creates nested objects
helpers.merge({ newKey: 'value' });       // shallow merge

// Validate size limits (automatic)
helpers.set('bigData', largeObject);  // throws if exceeds maxSizeBytes
```

#### **Input Selectors** (6 types)
```typescript
{ type: 'key', key: 'user' }                    // context.user
{ type: 'keys', keys: ['a', 'b'] }              // { a: context.a, b: context.b }
{ type: 'path', path: 'user.profile.email' }    // dot notation
{ type: 'template', template: 'Hello ${user.name}' } // string interpolation
{ type: 'full' }                                // entire context
{ type: 'static', value: 42 }                   // hardcoded value
```

#### **Error Handling**
- Use `ExecutionError` types from `packages/core/src/types/errors.ts`
- Engine handles handler errors, input resolution errors, invalid transitions
- Handlers return `{ outcome: 'failure', output: { code, message } }` for expected failures

#### **Idempotency** (Deduplication)
Prevent duplicate executions with idempotency keys:
```typescript
const { execution, created, idempotencyHit } = await engine.create('my-flow', context, {
  idempotencyKey: 'user-123-action-abc',  // unique key for this operation
  idempotencyWindowMs: 24 * 60 * 60 * 1000  // 24h window (default), max 7 days
});

if (idempotencyHit) {
  // Execution already exists, return existing result
  console.log('Duplicate request detected');
}
```
- Keys expire after `idempotencyWindowMs` (default: 24h, max: 7 days)
- Stored in `fm_executions.idempotency_key` and `idempotency_expires_at`
- Indexed: `idx_fm_exec_idempotency` on `(flow_id, idempotency_key)`

#### **Multi-Tenancy**
Isolate executions by tenant:
```typescript
const { execution } = await engine.create('my-flow', context, {
  tenantId: 'tenant-abc-123'  // all executions for this tenant
});

// Query by tenant
const executions = await store.list({ tenantId: 'tenant-abc-123' });
```
- Stored in `fm_executions.tenant_id`
- Indexed: `idx_fm_exec_tenant` (partial, only where `tenant_id IS NOT NULL`)
- Use for SaaS applications with isolated customer data

#### **Child Executions** (Sub-flows)
Create child workflows from parent executions:
```typescript
// In a handler, create child execution
const { execution: child } = await engine.create('child-flow', childContext, {
  parentExecutionId: params.execution.id  // link to parent
});

// Query children
const children = await store.list({ parentExecutionId: parent.id });
```
- Stored in `fm_executions.parent_execution_id`
- Indexed: `idx_fm_exec_parent` (partial)
- Useful for fan-out/fan-in patterns, parallel processing

#### **Timeouts & Cancellation**
Configure execution and wait timeouts:
```typescript
const { execution } = await engine.create('my-flow', context, {
  timeoutConfig: {
    executionTimeoutMs: 3600000,  // 1 hour total execution time
    waitTimeoutMs: 300000          // 5 min max for any wait step
  }
});

// Cancel an execution
const result = await engine.cancel(execution.id, {
  source: 'user',  // 'user' | 'system' | 'timeout' | 'parent'
  reason: 'User requested cancellation'
});
// Returns: { cancelled: true, tokensInvalidated: 2, childrenCancelled: 1 }
```
- Cancellable statuses: `pending`, `running`, `waiting`
- Cancellation cascades to child executions
- Resume tokens invalidated automatically
- Stored in `fm_executions.cancellation` (JSONB)

#### **Waiting & Resume Tokens**
Pause executions until external events:
```typescript
// Handler returns wait with resume token
return {
  outcome: 'wait',
  resumeToken: 'payment-webhook-abc123',
  waitMs: 3600000  // timeout after 1 hour
};

// External system resumes execution
await engine.resume(executionId, 'payment-webhook-abc123', {
  paymentStatus: 'completed',
  transactionId: 'txn-456'
});
```
- Tokens managed by `ResumeTokenManager` interface
- Stored in `fm_executions.wake_at` and `wait_started_at`
- Indexed: `idx_fm_exec_wake` and `idx_fm_exec_wait_started`
- Use for webhooks, human approvals, external API callbacks

#### **Visual Flow Editor**
Flows support visual metadata for UI editors:
```typescript
const flow: Flow = {
  id: 'my-flow',
  version: '1.0.0',
  visual: {
    nodes: {
      'step1': { x: 100, y: 100, width: 200, height: 80 },
      'step2': { x: 400, y: 100 }
    },
    canvas: { zoom: 1.0, offsetX: 0, offsetY: 0 },
    styles: {
      'step1': { color: '#0078d4', icon: '🌐' }
    }
  },
  // ... rest of flow
};
```
- Stored in `fm_flows.visual` (JSONB)
- Not used by engine, purely for UI/editor tools
- Positions, canvas state, custom styling per step

#### **Flow Lifecycle** (Draft/Published/Archived)
Manage flow versions through lifecycle:
```typescript
const flow: Flow = {
  id: 'my-flow',
  version: '1.0.0',
  status: 'draft',  // 'draft' | 'published' | 'archived'
  tags: ['payment', 'api'],
  description: 'Process payment workflow'
};
```
- Stored in `fm_flows.status`, indexed: `idx_fm_flows_status`
- Multiple versions can coexist (different `version` numbers)
- Executions reference specific `flowVersion`

#### **DataStore — Tables, Pipes & WAL**
FlowMonkey includes a lightweight DataStore for structured data collection from workflow outputs.

**Tables** — define schemas for structured row storage:
```typescript
const table: TableDef = {
  id: 'orders',
  columns: [
    { id: 'order_id', name: 'Order ID', type: 'string', required: true },
    { id: 'total', name: 'Total', type: 'number', required: true },
  ],
  createdAt: Date.now(), updatedAt: Date.now(),
};
await tableRegistry.create(table);
```
Column types: `'string' | 'number' | 'boolean' | 'datetime' | 'json'`

**Pipes** — automatically route step outputs to tables (fire-and-forget):
```typescript
const flow: Flow = {
  // ... steps ...
  pipes: [{
    id: 'pipe-orders',
    stepId: 'process-order',   // tap this step
    on: 'success',             // 'success' | 'failure' | 'any'
    tableId: 'orders',
    mappings: [
      { sourcePath: 'orderId', columnId: 'order_id' },
      { sourcePath: 'total', columnId: 'total' },
    ],
    staticValues: { source: 'workflow' },  // optional constant fields
  }],
};
```
- Pipes never affect execution status (fire-and-forget)
- Failed inserts go to WAL for retry
- Emits `pipe.inserted` / `pipe.failed` events

**TableStore** — CRUD operations on rows:
```typescript
const rowId = await tableStore.insert('orders', { order_id: 'ORD-1', total: 99.99 });
const { rows, total } = await tableStore.query({
  tableId: 'orders',
  filters: [{ column: 'total', op: 'gte', value: 50 }],
  orderBy: { column: 'total', direction: 'desc' },
  limit: 10,
});
```
Filter operators: `eq`, `neq`, `gt`, `gte`, `lt`, `lte`, `like`, `in`

**WriteAheadLog (WAL)** — captures failed pipe inserts for retry:
```typescript
const pending = await wal.readPending(100);  // read up to 100 pending
await wal.ack(entry.id);                     // mark as processed
await wal.compact();                         // remove ack'd entries
```

**Implementations:**
- In-memory: `MemoryTableRegistry`, `MemoryTableStore`, `MemoryWAL` (for tests)
- Postgres: `PgTableRegistry`, `PgTableStore`, `PgWALStore` (shared-table JSONB approach)
- Tables: `fm_table_defs`, `fm_table_rows`, `fm_wal_entries` (migration v0.4.0)

#### **EventDispatcher**
Multi-listener replacement for the single-callback `EventBus`:
```typescript
import { EventDispatcher } from '@flowmonkey/core';

const dispatcher = new EventDispatcher({ mode: 'sync' }); // or 'async' (default)

// Typed subscriptions
dispatcher.on('step.completed', (e) => {
  console.log(e.stepId, e.durationMs);
});

// Wildcard — captures all events
const unsub = dispatcher.on('*', (e) => auditLog.push(e));

// Unsubscribe
unsub();

// Listener management
dispatcher.listenerCount('step.completed'); // number
dispatcher.removeAll('step.completed');     // remove all for type
dispatcher.flush();                         // drain async queue
```

**Event types (40+):**
- Execution: `execution.created`, `.started`, `.completed`, `.failed`, `.waiting`, `.resumed`, `.cancelled`
- Step: `step.started`, `step.completed`, `step.timeout`, `step.retry`
- Routing: `transition`, `idempotency.hit`
- Jobs: `job.claimed`, `.progress`, `.checkpoint`, `.completed`, `.failed`, `.superseded`, `.heartbeat`
- Pipes: `pipe.inserted`, `pipe.failed`, `pipe.discarded`
- Rows: `row.inserted`, `row.updated`, `row.deleted`
- Registry: `flow.registered`, `handler.registered`, `handler.unregistered`
- Tables: `table.created`, `table.deleted`, `table.column.added`, `table.column.removed`
- Tokens: `token.created`, `token.used`, `token.revoked`, `tokens.cleaned`
- WAL: `wal.appended`, `wal.replayed`, `wal.compacted`

**Implementation:** `EventDispatcher` implements the `EventBus` interface — pass it directly to `Engine` as the `eventBus` parameter. Async mode uses `queueMicrotask()`. Each listener is `try/catch` isolated. Events are `Object.freeze()`d with auto-added `type` and `timestamp`.

#### **EventEmitting Decorators**
Wrap stores/registries to automatically emit events on mutations:
```typescript
import {
  EventEmittingTableStore,
  EventEmittingTableRegistry,
  EventEmittingFlowRegistry,
  EventEmittingHandlerRegistry,
  EventEmittingWAL,
} from '@flowmonkey/core';

const emitting = new EventEmittingTableStore(innerStore, eventBus);
// All insert/update/delete calls now emit row.inserted, row.updated, row.deleted
```

| Decorator | Wraps | Events Emitted |
|---|---|---|
| `EventEmittingTableStore` | `TableStore` | `row.inserted`, `row.updated`, `row.deleted` |
| `EventEmittingTableRegistry` | `TableRegistry` | `table.created`, `table.deleted`, `table.column.added`, `table.column.removed` |
| `EventEmittingFlowRegistry` | `FlowRegistry` | `flow.registered` |
| `EventEmittingHandlerRegistry` | `HandlerRegistry` | `handler.registered`, `handler.unregistered` |
| `EventEmittingWAL` | `WriteAheadLog` | `wal.appended`, `wal.replayed`, `wal.compacted` |

All constructors: `(inner: Interface, events: EventBus)`. Read ops pass through.

#### **Dependency Injection** (`packages/express`)
```typescript
const container = new ServiceContainer();
container.registerInstance(ServiceTokens.StateStore, stateStore);
container.registerFactory(ServiceTokens.Engine, (c) =>
  new Engine(
    c.resolve(ServiceTokens.StateStore),
    c.resolve(ServiceTokens.HandlerRegistry),
    c.resolve(ServiceTokens.FlowRegistry)
  )
);
const engine = container.resolve(ServiceTokens.Engine);
```

### � Security & Execution Pipeline

#### **Handler Execution Pipeline**

**Stateless Handlers** (in-process, synchronous):
```
1.  Engine.tick() → Load execution from StateStore
2.  Validate status (not terminal, not cancelling)
3.  Check step limit (default: 1000 steps)
4.  Load flow definition from FlowRegistry
5.  Resolve handler from HandlerRegistry
6.  Resolve input from context using InputSelector
7.  Create AbortController with timeout (default: 30s)
8.  Create ContextHelpers with size limits
9.  Execute handler with validated params
10. Handle result (success/failure/wait)
    - On failure + retry configured → check retryOn, compute backoff, re-queue step
    - On success → clear retryAttempts for this step
11. Store output in context (if outputKey defined)
12. Execute pipes → match flow.pipes by stepId/outcome → insert rows to DataStore
    - Pipe failures → WAL append (never affects execution)
13. Resolve nextStepOverride (from conditional/switch) or transitions.onSuccess
14. Update execution state & save to StateStore
15. Emit events via EventBus / EventDispatcher
```

**Stateful Handlers** (job queue, async):
```
1. Engine creates Job in JobStore (status: pending)
2. JobRunner polls for pending jobs
3. Runner claims job with unique instanceId
4. Load execution from StateStore
5. Create CheckpointManager (validates instanceId)
6. Execute handler with checkpoint/progress support
7. Handler periodically:
   - Checks assertActive() (prevents duplicate execution)
   - Saves checkpoints (survives crashes)
   - Reports progress (updateProgress())
8. On completion: mark job complete → update execution
9. On failure: mark job failed → retry logic
10. Heartbeat keeps job claimed during long execution
11. Reaper cleans stale jobs (abandoned/timeout)
```

#### **Security Boundaries**

**Input Validation** (multiple layers):
```typescript
// 1. Flow-level: Input selectors are type-safe
{ type: 'key', key: 'user' }  // No injection - key is literal

// 2. Handler-level: Decorator validation
@Input({ type: 'string', source: 'config', required: true })
@Url()  // Validates URL format
@Min(0) @Max(100)  // Numeric bounds
url!: string;

// 3. Context-level: Size & depth limits
contextLimits: {
  maxSizeBytes: 1048576,   // 1MB per value
  maxDepth: 32,            // Prevent deep nesting attacks
  maxKeys: 1000            // Prevent key explosion
}

// 4. Forms package: JSON Schema + sanitization
validateSubmission(data, schema);  // AJV validation
checkHoneypot(data, honeypotField);  // Bot detection
sanitizeSubmission(data, honeypotField);  // Remove honeypot
```

**Timeout Protection**:
```typescript
// Handler execution timeout (default: 30s)
const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), this.opts.timeoutMs);
result = await handler.execute({ ...params, signal: controller.signal });

// Execution-level timeout
const { execution } = await engine.create('flow', context, {
  timeoutConfig: {
    executionTimeoutMs: 3600000,  // Max 1h total
    waitTimeoutMs: 300000          // Max 5min per wait
  }
});

// Job-level timeout (stateful handlers)
const job = await jobStore.create({
  timeout: 600000,  // 10 min job timeout
  heartbeat: 30000  // 30s heartbeat interval
});
```

**Cancellation Safety**:
- Cancellable statuses: `pending`, `running`, `waiting`
- Cascades to child executions (prevents orphans)
- Invalidates resume tokens (prevents replay)
- Atomic state transitions (`cancelling` → `cancelled`)
- Job cleanup via reaper (handles crashes)

**Instance Deduplication** (stateful handlers):
```typescript
// Each job execution gets unique instanceId
const instanceId = crypto.randomUUID();

// Checkpoints validate instance ownership
await this.checkpoint(data);  // Throws if superseded
await this.assertActive();     // Checks if still active

// Prevents race conditions when job is re-claimed
```

**Context Isolation**:
- Each execution has isolated context (no shared state)
- Tenant isolation via `tenantId` (multi-tenancy)
- Parent-child linking via `parentExecutionId` (sub-flows)
- Resume tokens are execution-specific

**Database Security**:
```sql
-- Parameterized queries (no SQL injection)
-- Row-level security via tenantId filtering
-- Indexes prevent full table scans
-- JSONB validation in triggers (future)

-- Resume token validation
SELECT * FROM fm_resume_tokens 
WHERE token = $1 AND status = 'active' AND expires_at > NOW();
```

**Known Attack Vectors & Mitigations**:

1. **Context Bomb** (large payloads)
   - Mitigation: `maxSizeBytes`, `maxDepth`, `maxKeys` limits
   - Validation: `validateContextValue()` before storage

2. **Step Loop** (infinite workflows)
   - Mitigation: `maxSteps` limit (default: 1000)
   - Detection: `execution.stepCount` tracking

3. **Timeout Attacks** (hanging handlers)
   - Mitigation: AbortController with `timeoutMs`
   - Cleanup: Reaper cleans stale jobs

4. **Resume Token Replay**
   - Mitigation: Tokens marked `used` after resume
   - Expiration: TTL enforcement in token manager

5. **Idempotency Bypass** (duplicate operations)
   - Mitigation: `idempotencyKey` with 24h window
   - Storage: Indexed `(flow_id, idempotency_key)` unique constraint

6. **Child Execution Explosion**
   - Mitigation: Execution-level rate limiting (external)
   - Cleanup: Parent cancellation cascades to children

**No Built-in Auth/AuthZ**:
- FlowMonkey is **execution-only** — no user authentication
- Integrate with your auth system (JWT, OAuth, etc.)
- Use `tenantId` for multi-tenancy isolation
- Use `metadata` for user/request tracking
- API layer (`packages/express`) should add auth middleware

**Secrets Management**:
- **Do NOT** store secrets in flow definitions or context
- Use `@Input({ source: 'vault' })` for secret injection
- Implement `VaultProvider` interface for external secret stores
- Secrets never logged or stored in history

### �🛠️ Developer Workflows

**Setup & builds:**
```bash
pnpm install              # install all deps (monorepo)
pnpm build                # build all packages (runs pnpm -r build)
pnpm dev                  # watch mode for all packages (parallel)
```

**Testing:**
```bash
pnpm test                 # run all tests (vitest workspace config)
pnpm test:watch           # watch mode
pnpm test:coverage        # with coverage report
pnpm --filter @flowmonkey/core test  # test single package
```

**Type checking:**
```bash
pnpm typecheck            # runs tsc --noEmit in all packages
```

**Vitest workspace:** Root `vitest.workspace.ts` auto-discovers `packages/*/vitest.config.ts`.

**Package dependencies:** Use workspace protocol (`"@flowmonkey/core": "workspace:*"`) in `package.json` for local dev, published as `^1.0.0`.

### 🔌 Integration Points

**Database (Postgres):**
- Schema: `packages/postgres/src/schema.ts` — use `applySchema(pool)` to initialize
- Core tables: `fm_executions`, `fm_flows`, `fm_jobs`, `fm_events`, `fm_contexts`
- DataStore tables (v0.4.0): `fm_table_defs`, `fm_table_rows`, `fm_wal_entries`
- Indexes: optimized for `wake_at` (waiting), `status`, `tenant_id`, `idempotency_key`
- DataStore indexes: `idx_fm_rows_table`, `idx_fm_rows_tenant`, `idx_fm_rows_data` (GIN), `idx_fm_wal_pending`

**Jobs (stateful handlers):**
- Job lifecycle in `packages/postgres/src/job-store.ts`: `create → claim → complete/fail`
- Runner: `packages/jobs/src/runner.ts` polls and executes jobs with concurrency control
- Reaper: `packages/jobs/src/reaper.ts` cleans up stale jobs (timeout/abandonment)

**EventBus / EventDispatcher (observability):**
```typescript
// Preferred: Use EventDispatcher (multi-listener, wildcard, sync/async)
const dispatcher = new EventDispatcher({ mode: 'async' });
dispatcher.on('execution.completed', (e) => metrics.record(e));
dispatcher.on('*', (e) => auditLog.push(e));
const engine = new Engine(store, handlers, flows, dispatcher);

// Legacy: Single-callback EventBus still supported
const eventBus: EventBus = {
  onExecutionCreated: (e) => console.log('created', e.executionId),
  // ... 40+ hooks
};
```
See `packages/core/src/interfaces/event-bus.ts` for full interface.

**Forms service** (`packages/forms`):
- `FormService` — manages forms, submissions, validation, rate-limiting, deduplication
- Stores: `FormStore`, `SubmissionStore`, `RateLimitStore`, `DeduplicationStore`
- Validation: `packages/forms/src/validation.ts` — JSON schema, honeypot, sanitization
- Captcha: `packages/forms/src/captcha.ts` — Google reCAPTCHA, hCaptcha, Turnstile

**Triggers** (`packages/triggers`):
- HTTP webhooks — start flows from external HTTP POST requests
- Cron schedules — time-based flow execution
- Event-driven — start flows from application events

### 🎯 Built-in Handler Types

**Function-based handlers** (`packages/handlers/src/`):
- `http` — Make HTTP requests (GET, POST, PUT, DELETE, etc.)
- `delay` — Wait for a specified duration (milliseconds)
- `transform` — Transform data using JavaScript expressions
- `conditional` — Conditional branching with 13 operators (`eq`, `neq`, `gt`, `gte`, `lt`, `lte`, `in`, `nin`, `contains`, `startsWith`, `endsWith`, `exists`, `notExists`, `matches`)
- `switch` — Value-based routing with cases/default
- `sub-flow` — Spawn child executions (via `createSubFlowHandler(engine)` factory)

**Class-based handlers** (`packages/handlers/src/class/`):
- `http` — HTTP requests with validation, retries, timeout
- `delay` — Configurable delay with metadata
- `transform` — Data transformation with schema validation
- `batch-process` — Process arrays in batches
- `form-submit` — Handle form submissions
- `email-reply` — Send email responses

**Handler metadata fields:**
- `type` — Unique handler identifier (e.g., 'http', 'delay')
- `name` — Human-readable name
- `category` — Group: 'control' | 'data' | 'external' | 'ai' | 'utility'
- `stateful` — Whether handler uses job store (long-running tasks)
- `retryable` — Whether failures can be retried
- `configSchema` — JSON schema for config validation

**Stateful vs Stateless:**
- **Stateless** — Execute in-process, fast, no external state
- **Stateful** — Use job store, claim/process/complete pattern, survives restarts
- Set `stateful: true` in handler metadata for long-running operations

### 📝 PR Guidelines

**Commit conventions** (conventional commits):
- `feat(core): add idempotency support`
- `fix(postgres): handle connection timeout`
- `docs: update deployment guide`
- `test(handlers): add HTTP handler tests`

**When adding a handler:**
1. Create in `packages/handlers/src/` (function-based) or `packages/handlers/src/class/` (decorator-based)
2. Export from `packages/handlers/src/handlers.ts` or `packages/handlers/src/class/index.ts`
3. Register in tests via `TestHarness` options
4. Add tests in `packages/handlers/test/`

**When changing persistence:**
1. Update `packages/postgres/src/schema.ts`
2. Provide migration notes (SQL) — add a new `migrationVXYZ` function
3. Use `applySchema(pool)` in integration tests
4. Update `packages/postgres/src/*-store.ts` implementations

**When adding a DataStore feature:**
1. Define interfaces in `packages/core/src/interfaces/`
2. Add memory implementation in `packages/core/src/impl/memory-*.ts`
3. Add `EventEmitting*` wrapper in `packages/core/src/impl/event-emitting-*.ts`
4. Add Postgres implementation in `packages/postgres/src/`
5. Wire into `TestHarness` if needed
6. Add schema migration in `packages/postgres/src/schema.ts`

**Test coverage:**
- All new features must have tests using `TestHarness`
- Use `simulateTime: true` in `t.run()` to avoid real delays
- Use `t.assertCompleted()`, `t.assertFailed()`, `t.assertContext()` helpers

### 📚 Files to Inspect

**Start here for context:**
- `packages/core/examples/` — **12 runnable examples** covering all core features (best starting point)
- `packages/core/src/engine/execution-engine.ts` — core orchestration logic, tick loop, retry, pipes
- `packages/core/src/types/flow.ts` — flow/step definitions, input selectors, `RetryConfig`, `PipeDef`
- `packages/core/src/types/execution.ts` — execution state model, status types
- `packages/core/src/types/result.ts` — `StepResult`, `Result` helpers (success/failure/wait)
- `packages/core/src/types/table.ts` — DataStore types: `TableDef`, `ColumnDef`, `PipeDef`, `Row`, `RowQuery`, `WALEntry`
- `packages/core/src/types/errors.ts` — error types and codes
- `packages/core/src/impl/event-dispatcher.ts` — `EventDispatcher` (sync/async, wildcard, multi-listener)
- `packages/core/src/impl/event-emitting-*.ts` — 5 EventEmitting decorators (auto-emit on mutations)
- `packages/core/src/impl/memory-table-registry.ts` — in-memory `TableRegistry`
- `packages/core/src/impl/memory-table-store.ts` — in-memory `TableStore`
- `packages/core/src/impl/memory-wal.ts` — in-memory `WriteAheadLog`
- `packages/core/src/test/harness.ts` — testing utilities, event capture, dispatcher, DataStore
- `packages/core/src/test/engine.test.ts` — comprehensive test examples
- `packages/core/src/engine/input-resolver.ts` — 6 input selector implementations
- `packages/core/src/decorators/handler.ts` — @Handler, @Input decorators
- `packages/core/src/decorators/validation.ts` — @Url, @Min, @Max validators
- `packages/handlers/src/handlers.ts` — function-based handler patterns
- `packages/handlers/src/conditional.ts` — conditional (13 ops) & switch routing handlers
- `packages/handlers/src/sub-flow.ts` — `createSubFlowHandler()` factory
- `packages/handlers/src/class/http.ts` — decorator-based handler example
- `packages/postgres/src/schema.ts` — DB schema, tables, indexes, migrations (incl. v0.4.0)
- `packages/postgres/src/execution-store.ts` — StateStore implementation
- `packages/postgres/src/table-registry.ts` — `PgTableRegistry` (DataStore)
- `packages/postgres/src/table-store.ts` — `PgTableStore` (DataStore, shared-table JSONB)
- `packages/postgres/src/wal-store.ts` — `PgWALStore` (DataStore)
- `packages/postgres/src/job-store.ts` — Job lifecycle (claim/complete/fail)
- `packages/express/src/container.ts` — dependency injection pattern
- `packages/express/src/routes.ts` — REST API endpoints
- `packages/forms/src/service.ts` — complex service with EventEmitter
- `packages/forms/src/validation.ts` — JSON schema, honeypot, sanitization
- `packages/jobs/src/runner.ts` — job polling and execution
- `packages/jobs/src/reaper.ts` — stale job cleanup

**Advanced patterns:**
- Step retry/backoff: `RetryConfig` on steps, exponential backoff, `retryOn` filter
- Conditional/switch routing: `nextStepOverride`, 13 operators, value-based cases
- Sub-flows: `createSubFlowHandler()`, wait-for-completion vs fire-and-forget
- DataStore: Tables, Pipes, WAL — structured data collection from workflow outputs
- EventDispatcher: sync/async modes, wildcard `'*'`, multi-listener, `try/catch` isolation
- EventEmitting decorators: auto-emit on store/registry mutations
- Multi-tenancy: `tenantId` in create options, indexed queries
- Idempotency: `idempotencyKey` with TTL, deduplication
- Child executions: `parentExecutionId`, cascading cancellation
- Timeouts: execution and wait timeouts, auto-cancellation
- Resume tokens: pause/resume with external events
- Visual metadata: editor node positions, canvas state
- Flow lifecycle: draft → published → archived status

**Common tasks:**
- Add handler: Create in `packages/handlers/src/`, register in tests, add tests
- Change schema: Update `schema.ts`, add `migrationVXYZ`, test with `applySchema(pool)`
- Add DataStore feature: Interface → memory impl → EventEmitting wrapper → Postgres impl → TestHarness
- Add API endpoint: Use `ServiceContainer`, register route in `packages/express/src/routes.ts`
- Test flows: Use `TestHarness` with `simulateTime: true` for fast execution
- Debug execution: Check `execution.history`, `execution.error`, captured events
- Learn features: Browse `packages/core/examples/` (12 self-contained runnable files)
