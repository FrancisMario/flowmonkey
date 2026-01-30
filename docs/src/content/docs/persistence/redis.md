---
title: Redis Coordination
description: Redis caching, locking, and signaling for FlowMonkey.
---

# Redis Coordination

`@flowmonkey/redis` provides distributed coordination for multi-instance deployments.

## Installation

```bash
pnpm add @flowmonkey/redis ioredis
```

## Features

- **Distributed Locking** - Prevent concurrent execution conflicts
- **Caching** - Cache frequently accessed data
- **Signaling** - Real-time coordination between instances

## Distributed Locking

```typescript
import { Redis } from 'ioredis';
import { RedisLockManager } from '@flowmonkey/redis';

const redis = new Redis();
const lockManager = new RedisLockManager(redis);

// Acquire lock before running
const lock = await lockManager.acquire(`execution:${executionId}`, {
  ttl: 30000,  // Lock timeout
});

try {
  await engine.run(executionId);
} finally {
  await lock.release();
}
```

## Caching

```typescript
import { RedisCache } from '@flowmonkey/redis';

const cache = new RedisCache(redis);

// Cache execution data
await cache.set(`execution:${id}`, execution, { ttl: 3600 });

// Retrieve
const cached = await cache.get(`execution:${id}`);
```

## Signaling

For real-time coordination between instances:

```typescript
import { RedisSignals } from '@flowmonkey/redis';

const signals = new RedisSignals(redis);

// Subscribe to resume events
signals.subscribe('resume', async (executionId) => {
  await engine.run(executionId);
});

// Signal resume from another instance
await signals.publish('resume', executionId);
```

## When to Use

- Multiple engine instances
- High availability requirements
- Real-time coordination needs
- Caching for performance
