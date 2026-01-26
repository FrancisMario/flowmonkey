# @flowmonkey/redis

Redis caching, locking, and signaling for FlowMonkey workflows.

## Installation

```bash
pnpm add @flowmonkey/redis ioredis
```

## Overview

This package provides Redis-based utilities for distributed FlowMonkey deployments:

- **RedisLockManager** — Distributed locking for execution safety
- **RedisWakeSignaler** — Cross-instance wake signaling
- **RedisExecutionCache** — Execution caching layer

## Quick Start

```typescript
import Redis from 'ioredis';
import { RedisLockManager, RedisWakeSignaler, RedisExecutionCache } from '@flowmonkey/redis';

const redis = new Redis(process.env.REDIS_URL);

// Distributed locking
const lockManager = new RedisLockManager(redis, {
  keyPrefix: 'fm:lock:',
  defaultTTL: 30000,  // 30 seconds
});

// Wake signaling across instances
const signaler = new RedisWakeSignaler(redis, {
  channel: 'fm:wake',
});

// Execution caching
const cache = new RedisExecutionCache(redis, {
  keyPrefix: 'fm:exec:',
  ttl: 60000,  // 1 minute
});
```

## RedisLockManager

Prevent concurrent execution of the same workflow:

```typescript
import { RedisLockManager } from '@flowmonkey/redis';

const lockManager = new RedisLockManager(redis, {
  keyPrefix: 'fm:lock:',
  defaultTTL: 30000,
  retryDelay: 100,
  maxRetries: 50,
});

// Acquire lock before running
const lock = await lockManager.acquire(executionId);

if (!lock) {
  console.log('Execution is locked by another worker');
  return;
}

try {
  // Safe to run - we have the lock
  await engine.run(executionId);
} finally {
  // Always release the lock
  await lockManager.release(executionId, lock);
}

// Or use the helper
await lockManager.withLock(executionId, async () => {
  await engine.run(executionId);
});
```

### Lock API

```typescript
interface LockManager {
  // Acquire a lock, returns lock token or null
  acquire(key: string, ttl?: number): Promise<string | null>;
  
  // Release a lock
  release(key: string, token: string): Promise<boolean>;
  
  // Extend lock TTL
  extend(key: string, token: string, ttl?: number): Promise<boolean>;
  
  // Execute callback with lock
  withLock<T>(key: string, fn: () => Promise<T>, ttl?: number): Promise<T>;
  
  // Check if locked
  isLocked(key: string): Promise<boolean>;
}
```

## RedisWakeSignaler

Signal waiting executions across multiple instances:

```typescript
import { RedisWakeSignaler } from '@flowmonkey/redis';

const signaler = new RedisWakeSignaler(redis, {
  channel: 'fm:wake',
});

// Subscribe to wake signals
await signaler.subscribe(async (executionId) => {
  console.log(`Wake signal for ${executionId}`);
  await engine.run(executionId);
});

// Signal a wake (called after resume)
await signaler.signal(executionId);

// Signal multiple
await signaler.signalMany([exec1, exec2, exec3]);

// Cleanup on shutdown
await signaler.unsubscribe();
```

### Wake Pattern

```typescript
// Worker 1: Polls for waiting executions
async function pollWaiting() {
  const waiting = await store.findWaiting(100);
  const now = Date.now();
  
  for (const exec of waiting) {
    if (exec.wakeAt && exec.wakeAt <= now) {
      await signaler.signal(exec.id);
    }
  }
}

// Worker 2: Handles API resume requests
app.post('/executions/:id/resume', async (req, res) => {
  await engine.resume(req.params.id, req.body);
  await signaler.signal(req.params.id);  // Wake immediately
  res.json({ success: true });
});

// All workers: Listen for wake signals
await signaler.subscribe(async (executionId) => {
  await lockManager.withLock(executionId, async () => {
    await engine.run(executionId);
  });
});
```

## RedisExecutionCache

Cache execution data to reduce database load:

```typescript
import { RedisExecutionCache } from '@flowmonkey/redis';

const cache = new RedisExecutionCache(redis, {
  keyPrefix: 'fm:exec:',
  ttl: 60000,  // Cache for 1 minute
});

// Wrap your store
class CachedStore implements StateStore {
  constructor(
    private store: StateStore,
    private cache: RedisExecutionCache
  ) {}
  
  async get(id: string) {
    // Try cache first
    const cached = await this.cache.get(id);
    if (cached) return cached;
    
    // Load from database
    const exec = await this.store.get(id);
    if (exec) {
      await this.cache.set(exec);
    }
    return exec;
  }
  
  async update(execution: Execution) {
    await this.store.update(execution);
    await this.cache.set(execution);  // Update cache
  }
  
  async delete(id: string) {
    await this.store.delete(id);
    await this.cache.invalidate(id);  // Clear cache
  }
}
```

### Cache API

```typescript
interface ExecutionCache {
  // Get cached execution
  get(id: string): Promise<Execution | null>;
  
  // Cache an execution
  set(execution: Execution, ttl?: number): Promise<void>;
  
  // Invalidate cache entry
  invalidate(id: string): Promise<void>;
  
  // Invalidate multiple
  invalidateMany(ids: string[]): Promise<void>;
  
  // Get multiple (batch)
  getMany(ids: string[]): Promise<Map<string, Execution>>;
}
```

## Configuration

### Connection Options

```typescript
import Redis from 'ioredis';

// Single instance
const redis = new Redis({
  host: 'localhost',
  port: 6379,
  password: process.env.REDIS_PASSWORD,
  db: 0,
  retryStrategy: (times) => Math.min(times * 50, 2000),
});

// Cluster
const cluster = new Redis.Cluster([
  { host: 'redis-1', port: 6379 },
  { host: 'redis-2', port: 6379 },
  { host: 'redis-3', port: 6379 },
], {
  redisOptions: {
    password: process.env.REDIS_PASSWORD,
  },
});

// Sentinel
const sentinel = new Redis({
  sentinels: [
    { host: 'sentinel-1', port: 26379 },
    { host: 'sentinel-2', port: 26379 },
  ],
  name: 'mymaster',
  password: process.env.REDIS_PASSWORD,
});
```

### Key Prefixes

Use prefixes to namespace FlowMonkey data:

```typescript
const lockManager = new RedisLockManager(redis, {
  keyPrefix: 'myapp:fm:lock:',
});

const signaler = new RedisWakeSignaler(redis, {
  channel: 'myapp:fm:wake',
});

const cache = new RedisExecutionCache(redis, {
  keyPrefix: 'myapp:fm:exec:',
});
```

## Best Practices

### 1. Handle Connection Errors

```typescript
redis.on('error', (err) => {
  console.error('Redis error:', err);
});

redis.on('connect', () => {
  console.log('Redis connected');
});

redis.on('reconnecting', () => {
  console.log('Redis reconnecting...');
});
```

### 2. Graceful Shutdown

```typescript
process.on('SIGTERM', async () => {
  await signaler.unsubscribe();
  await redis.quit();
});
```

### 3. Monitor Memory

```typescript
// Check Redis memory usage
const info = await redis.info('memory');
console.log(info);

// Set eviction policy in redis.conf
// maxmemory-policy allkeys-lru
```

### 4. Use Pipelining for Batch Operations

```typescript
const pipeline = redis.pipeline();
for (const id of executionIds) {
  pipeline.get(`fm:exec:${id}`);
}
const results = await pipeline.exec();
```

## License

MIT
