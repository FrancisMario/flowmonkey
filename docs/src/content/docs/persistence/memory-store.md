---
title: Memory Store
description: In-memory execution storage for development and testing.
---

# Memory Store

`MemoryStore` is an in-memory implementation of `StateStore` for development and testing.

## Usage

```typescript
import { MemoryStore } from '@flowmonkey/core';

const store = new MemoryStore();

const engine = new Engine(store, handlers, flows);
```

## Characteristics

- **Non-persistent**: Data is lost on process restart
- **Fast**: No I/O overhead
- **Single-process**: Not suitable for distributed deployments

## When to Use

✅ Unit tests  
✅ Integration tests  
✅ Local development  
✅ Prototyping  

❌ Production deployments  
❌ Multi-instance deployments  
❌ Long-running workflows  

## Testing Example

```typescript
import { describe, it, beforeEach } from 'vitest';
import { Engine, MemoryStore, DefaultHandlerRegistry, DefaultFlowRegistry } from '@flowmonkey/core';

describe('my workflow', () => {
  let engine: Engine;
  let store: MemoryStore;
  
  beforeEach(() => {
    store = new MemoryStore();
    engine = new Engine(store, handlers, flows);
  });
  
  it('completes successfully', async () => {
    const { execution } = await engine.create('my-flow', { input: 'data' });
    await engine.run(execution.id);
    
    const result = await store.load(execution.id);
    expect(result?.status).toBe('completed');
  });
});
```

## For Production

Use [PostgreSQL Store](/persistence/postgres/) for production deployments.
