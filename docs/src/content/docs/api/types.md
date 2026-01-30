---
title: Types
description: Core type definitions in FlowMonkey.
---

# Types

Core TypeScript types exported from `@flowmonkey/core`.

## Flow Types

### Flow

```typescript
interface Flow {
  id: string;
  version: string;
  name?: string;
  description?: string;
  initialStepId: string;
  steps: Record<string, Step>;
  metadata?: Record<string, unknown>;
}
```

### Step

```typescript
interface Step {
  id: string;
  type: string;
  config: Record<string, unknown>;
  input: InputSelector;
  outputKey?: string;
  transitions: Transitions;
  timeout?: number;
  retries?: RetryConfig;
}
```

### Transitions

```typescript
interface Transitions {
  onSuccess: string | null;
  onFailure?: string | null;
  onResume?: string | null;
}
```

## Input Selectors

```typescript
type InputSelector =
  | { type: 'key'; key: string }
  | { type: 'keys'; keys: string[] }
  | { type: 'path'; path: string }
  | { type: 'template'; template: unknown }
  | { type: 'full' }
  | { type: 'static'; value: unknown };
```

## Execution Types

### Execution

```typescript
interface Execution {
  id: string;
  flowId: string;
  flowVersion: string;
  tenantId?: string;
  status: ExecutionStatus;
  currentStepId: string | null;
  context: Record<string, unknown>;
  history: StepHistoryEntry[];
  error?: ExecutionError;
  waitMetadata?: WaitMetadata;
  cancellation?: CancellationInfo;
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
  failedAt?: number;
  cancelledAt?: number;
  idempotencyKey?: string;
  idempotencyExpiresAt?: number;
  parentExecutionId?: string;
  metadata?: Record<string, unknown>;
}
```

### ExecutionStatus

```typescript
type ExecutionStatus =
  | 'pending'
  | 'running'
  | 'waiting'
  | 'completed'
  | 'failed'
  | 'cancelled';
```

### ExecutionError

```typescript
interface ExecutionError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}
```

## Handler Types

### StepHandler

```typescript
interface StepHandler {
  type: string;
  stateful?: boolean;
  execute(params: HandlerParams): Promise<HandlerResult>;
}
```

### HandlerParams

```typescript
interface HandlerParams {
  input: unknown;
  config: Record<string, unknown>;
  context: Record<string, unknown>;
  step: Step;
  execution: Execution;
}
```

### HandlerResult

```typescript
type HandlerResult =
  | { type: 'success'; output: unknown }
  | { type: 'failure'; error: ExecutionError }
  | { type: 'wait'; wakeAt?: number; reason?: string };
```
