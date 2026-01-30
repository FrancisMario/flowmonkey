---
title: Execution Lifecycle
description: Understanding execution states and transitions in FlowMonkey.
---

# Execution Lifecycle

An **Execution** represents a running instance of a flow. This document describes all possible states and transitions.

## Execution States

| Status | Description |
|--------|-------------|
| `pending` | Created but not yet started |
| `running` | Currently executing steps |
| `waiting` | Paused, awaiting resume or wake time |
| `completed` | Successfully finished |
| `failed` | Terminated due to error |
| `cancelled` | Terminated by cancellation request |

## State Machine

```
                    ┌─────────────────────────────────────────┐
                    │                                         │
                    ▼                                         │
┌─────────┐    ┌─────────┐    ┌───────────┐              │
│ pending │───▶│ running │───▶│ completed │              │
└─────────┘    └────┬────┘    └───────────┘              │
                    │                                         │
                    ├──────────▶┌────────┐                   │
                    │           │ failed │                   │
                    │           └────────┘                   │
                    │                                         │
                    ├──────────▶┌───────────┐                │
                    │           │ cancelled │                │
                    │           └───────────┘                │
                    │                                         │
                    └──────────▶┌─────────┐                  │
                                │ waiting │──────────────────┘
                                └─────────┘
                                     │
                                     ▼
                                ┌───────────┐
                                │ cancelled │
                                └───────────┘
```

## State Transitions

### pending → running

Triggered by `engine.run()` or `engine.step()`:

```typescript
const { execution } = await engine.create('flow-id', context);
// execution.status = 'pending'

await engine.run(execution.id);
// execution.status = 'running' (during execution)
```

### running → completed

When execution reaches a step with `onSuccess: null`:

```typescript
transitions: { onSuccess: null }  // Terminal step

// After running:
// execution.status = 'completed'
// execution.completedAt = timestamp
```

### running → failed

When a handler fails without an `onFailure` transition:

```typescript
// Handler returns failure
return Result.failure({ code: 'ERROR', message: 'Something went wrong' });

// No onFailure defined
transitions: { onSuccess: 'next' }  // No onFailure

// Result:
// execution.status = 'failed'
// execution.error = { code: 'ERROR', message: '...' }
// execution.failedAt = timestamp
```

### running → waiting

When a handler returns `Result.wait()`:

```typescript
return Result.wait({
  wakeAt: Date.now() + 3600000,  // 1 hour
  reason: 'Waiting for external callback'
});

// Result:
// execution.status = 'waiting'
// execution.waitMetadata = { wakeAt: ..., reason: '...' }
```

### waiting → running

Triggered by `engine.resume()`:

```typescript
await engine.resume(executionId, { approved: true });

// execution.status = 'running'
// context.resumeData = { approved: true }
```

Or by automatic wake when `wakeAt` time is reached (requires job runner).

### running → cancelled

Triggered by `engine.cancel()`:

```typescript
await engine.cancel(executionId, {
  source: 'user',
  reason: 'No longer needed'
});

// execution.status = 'cancelled'
// execution.cancellation = { source: 'user', reason: '...' }
// execution.cancelledAt = timestamp
```

### waiting → cancelled

Waiting executions can also be cancelled:

```typescript
// While execution.status = 'waiting'
await engine.cancel(executionId, { source: 'timeout' });

// execution.status = 'cancelled'
```

## Execution Structure

```typescript
interface Execution {
  // Identity
  id: string;
  flowId: string;
  flowVersion: string;
  tenantId?: string;
  
  // Status
  status: ExecutionStatus;
  currentStepId: string | null;
  
  // Data
  context: Record<string, unknown>;
  
  // History
  history: StepHistoryEntry[];
  
  // Error (if failed)
  error?: ExecutionError;
  
  // Wait metadata (if waiting)
  waitMetadata?: WaitMetadata;
  
  // Cancellation (if cancelled)
  cancellation?: CancellationInfo;
  
  // Timestamps
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
  failedAt?: number;
  cancelledAt?: number;
  
  // Options
  idempotencyKey?: string;
  idempotencyExpiresAt?: number;
  parentExecutionId?: string;
  metadata?: Record<string, unknown>;
}
```

## Step History

Every executed step is recorded in `history`:

```typescript
interface StepHistoryEntry {
  stepId: string;
  type: string;
  status: 'success' | 'failure' | 'wait';
  input: unknown;
  output?: unknown;
  error?: ExecutionError;
  startedAt: number;
  completedAt: number;
  duration: number;
}
```

Example history:

```typescript
execution.history = [
  {
    stepId: 'validate',
    type: 'validate-order',
    status: 'success',
    input: { orderId: '123' },
    output: { valid: true, total: 99.99 },
    startedAt: 1706300000000,
    completedAt: 1706300000050,
    duration: 50
  },
  {
    stepId: 'charge-payment',
    type: 'http',
    status: 'success',
    input: { url: '...', method: 'POST' },
    output: { chargeId: 'ch_xxx' },
    startedAt: 1706300000051,
    completedAt: 1706300000200,
    duration: 149
  }
];
```

## Querying Executions

Find executions by various criteria:

```typescript
// By ID
const execution = await store.load(executionId);

// By idempotency key
const existing = await store.findByIdempotencyKey('order-123');

// By status (PostgreSQL store)
const waiting = await store.findByStatus('waiting');

// By tenant
const tenantExecutions = await store.findByTenant('tenant-1');
```

## Terminal States

These states are final—no further transitions are possible:

- `completed` - Success
- `failed` - Error
- `cancelled` - Cancelled

Attempting to run, resume, or cancel a terminal execution returns an error.

## Next Steps

- [Error Handling](/advanced/error-handling/) - Handling failures
- [Cancellation](/advanced/cancellation/) - Cancellation patterns
- [Waiting & Resume](/advanced/waiting-resume/) - Wait/resume details
