---
title: Interfaces
description: Core interfaces in FlowMonkey.
---

# Interfaces

Core interfaces for extending FlowMonkey.

## StateStore

Storage interface for executions.

```typescript
interface StateStore {
  save(execution: Execution): Promise<void>;
  load(id: string): Promise<Execution | null>;
  delete(id: string): Promise<void>;
  findByIdempotencyKey(key: string): Promise<Execution | null>;
}
```

## HandlerRegistry

Registry for step handlers.

```typescript
interface HandlerRegistry {
  register(handler: StepHandler): void;
  get(type: string): StepHandler | undefined;
  has(type: string): boolean;
  list(): StepHandler[];
}
```

## FlowRegistry

Registry for flow definitions.

```typescript
interface FlowRegistry {
  register(flow: Flow): void;
  get(id: string, version?: string): Flow | undefined;
  has(id: string): boolean;
  list(): Flow[];
}
```

## EventBus

Event system for observability.

```typescript
interface EventBus {
  on<T>(event: string, handler: (data: T) => void): void;
  off<T>(event: string, handler: (data: T) => void): void;
  emit<T>(event: string, data: T): void;
}
```

### Events

| Event | Data | Description |
|-------|------|-------------|
| `execution:created` | `Execution` | New execution created |
| `execution:started` | `Execution` | Execution started |
| `execution:completed` | `Execution` | Execution completed |
| `execution:failed` | `Execution` | Execution failed |
| `execution:waiting` | `Execution` | Execution waiting |
| `execution:resumed` | `Execution` | Execution resumed |
| `execution:cancelled` | `Execution` | Execution cancelled |
| `step:started` | `StepEvent` | Step started |
| `step:completed` | `StepEvent` | Step completed |
| `step:failed` | `StepEvent` | Step failed |

## ResumeTokenManager

For secure resume tokens.

```typescript
interface ResumeTokenManager {
  create(executionId: string, ttl?: number): Promise<string>;
  validate(token: string): Promise<string | null>;
  revoke(token: string): Promise<void>;
}
```
