---
title: State Store Interface
description: Understanding the FlowMonkey state store interface.
---

# State Store Interface

The `StateStore` interface defines how executions are persisted. FlowMonkey is agnostic to the storage backend.

## Interface

```typescript
interface StateStore {
  save(execution: Execution): Promise<void>;
  load(id: string): Promise<Execution | null>;
  delete(id: string): Promise<void>;
  findByIdempotencyKey(key: string): Promise<Execution | null>;
}
```

## Methods

### save()

Persists an execution. Called after every state change.

```typescript
await store.save(execution);
```

### load()

Retrieves an execution by ID.

```typescript
const execution = await store.load('exec_123');
if (execution) {
  console.log(execution.status);
}
```

### delete()

Removes an execution from storage.

```typescript
await store.delete('exec_123');
```

### findByIdempotencyKey()

Finds an execution by its idempotency key.

```typescript
const existing = await store.findByIdempotencyKey('order-123');
if (existing) {
  // Return existing instead of creating new
}
```

## Implementations

FlowMonkey provides:

- [Memory Store](/persistence/memory-store/) - For development/testing
- [PostgreSQL Store](/persistence/postgres/) - For production

## Custom Implementations

Implement the interface for custom storage:

```typescript
class MongoStore implements StateStore {
  async save(execution: Execution): Promise<void> {
    await this.collection.updateOne(
      { _id: execution.id },
      { $set: execution },
      { upsert: true }
    );
  }
  
  async load(id: string): Promise<Execution | null> {
    return this.collection.findOne({ _id: id });
  }
  
  // ... other methods
}
```
