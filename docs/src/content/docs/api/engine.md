---
title: Engine API
description: Complete Engine API reference.
---

# Engine API

The `Engine` class is the main entry point for FlowMonkey.

## Constructor

```typescript
new Engine(store: StateStore, handlers: HandlerRegistry, flows: FlowRegistry)
```

## Methods

### create()

Creates a new execution.

```typescript
async create(
  flowId: string,
  context: Record<string, unknown>,
  options?: CreateOptions
): Promise<{ execution: Execution; created: boolean }>
```

**Options:**

| Option | Type | Description |
|--------|------|-------------|
| `tenantId` | `string` | Multi-tenancy support |
| `idempotencyKey` | `string` | Prevent duplicates |
| `idempotencyTTL` | `number` | Key expiration (ms) |
| `metadata` | `object` | Custom metadata |
| `parentExecutionId` | `string` | For sub-workflows |

### run()

Runs an execution to completion or wait.

```typescript
async run(executionId: string): Promise<RunResult>
```

**Returns:**

```typescript
interface RunResult {
  status: ExecutionStatus;
  stepResults: StepResult[];
  error?: ExecutionError;
  waitMetadata?: WaitMetadata;
}
```

### step()

Executes a single step.

```typescript
async step(executionId: string): Promise<StepResult>
```

### resume()

Resumes a waiting execution.

```typescript
async resume(
  executionId: string,
  data?: Record<string, unknown>
): Promise<void>
```

### cancel()

Cancels an execution.

```typescript
async cancel(
  executionId: string,
  info: CancellationInfo
): Promise<{ cancelled: boolean; error?: string }>
```

**CancellationInfo:**

```typescript
interface CancellationInfo {
  source: 'user' | 'system' | 'timeout' | 'admin';
  reason?: string;
}
```
