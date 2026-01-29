# @flowmonkey/redis

Redis caching, locking, and signaling for FlowMonkey workflows.

This package provides Redis-based utilities for distributed FlowMonkey deployments, enabling coordination between multiple engine instances.

## Table of Contents

- [Installation](#installation)
- [Overview](#overview)
- [RedisLockManager](#redislockmanager)
  - [Basic Locking](#basic-locking)
  - [Lock with Callback](#lock-with-callback)
  - [Lock Extension](#lock-extension)
- [RedisWakeSignaler](#rediswakesignaler)
  - [Publishing Wake Signals](#publishing-wake-signals)
  - [Subscribing to Wake Signals](#subscribing-to-wake-signals)
- [RedisExecutionCache](#redisexecutioncache)
  - [Caching Executions](#caching-executions)
  - [Cache Invalidation](#cache-invalidation)
- [Configuration](#configuration)
- [Use Cases](#use-cases)
- [API Reference](#api-reference)

## Installation

```bash
pnpm add @flowmonkey/redis ioredis
```

## Overview

In distributed deployments where multiple engine instances process workflows, coordination is essential. This package provides three utilities:

- **RedisLockManager** - Prevents concurrent execution of the same workflow
- **RedisWakeSignaler** - Notifies instances when executions should wake
- **RedisExecutionCache** - Caches execution data to reduce database load

These utilities work together to enable safe, efficient horizontal scaling.

```typescript
import Redis from 'ioredis';
import {
  RedisLockManager,
  RedisWakeSignaler,
  RedisExecutionCache,
} from '@flowmonkey/redis';

const redis = new Redis(process.env.REDIS_URL);

const lockManager = new RedisLockManager(redis);
const signaler = new RedisWakeSignaler(redis);
const cache = new RedisExecutionCache(redis);
```

## RedisLockManager

Distributed locking prevents race conditions when multiple workers might process the same execution simultaneously.

### Basic Locking

```typescript
import { RedisLockManager } from '@flowmonkey/redis';

const lockManager = new RedisLockManager(redis, {
  keyPrefix: 'fm:lock:',  // Key prefix in Redis
  defaultTTL: 30000,      // Lock expires after 30 seconds
  retryDelay: 100,        // Wait 100ms between retry attempts
  maxRetries: 50,         // Try up to 50 times to acquire lock
});

// Acquire a lock
const token = await lockManager.acquire(executionId);

if (!token) {
  // Another worker holds the lock
  console.log('Execution is being processed by another worker');
  return;
}

try {
  // Safe to process - we have exclusive access
  await engine.run(executionId);
} finally {
  // Always release the lock
  await lockManager.release(executionId, token);
}
```

The lock token is required for release to prevent accidentally releasing another worker's lock.

### Lock with Callback

The `withLock` method handles acquisition and release automatically:

```typescript
await lockManager.withLock(executionId, async () => {
  // This code runs with the lock held
  await engine.run(executionId);
});

// Lock is automatically released after callback completes (or throws)
```

With custom TTL:

```typescript
await lockManager.withLock(
  executionId,
  async () => {
    // Long-running operation
    await processLargeWorkflow(executionId);
  },
  120000 // 2 minute TTL
);
```

### Lock Extension

For long-running operations, extend the lock before it expires:

```typescript
const token = await lockManager.acquire(executionId);

// Set up periodic extension
const extendInterval = setInterval(async () => {
  const extended = await lockManager.extend(executionId, token, 30000);
  if (!extended) {
    // Lock was lost - stop processing
    clearInterval(extendInterval);
  }
}, 10000); // Extend every 10 seconds

try {
  await longRunningOperation();
} finally {
  clearInterval(extendInterval);
  await lockManager.release(executionId, token);
}
```

### Checking Lock Status

```typescript
// Check if an execution is currently locked
const isLocked = await lockManager.isLocked(executionId);

if (isLocked) {
  console.log('Execution is being processed');
}
```

## RedisWakeSignaler

The wake signaler enables cross-instance notification when an execution should be woken up.

### Publishing Wake Signals

When an execution is ready to wake (timer expired, external event received):

```typescript
import { RedisWakeSignaler } from '@flowmonkey/redis';

const signaler = new RedisWakeSignaler(redis, {
  channel: 'fm:wake',  // Pub/sub channel name
});

// Signal that an execution should wake
await signaler.publish(executionId);

// Signal with metadata
await signaler.publish(executionId, {
  reason: 'approval-received',
  data: { approved: true },
});
```

### Subscribing to Wake Signals

Each worker instance subscribes to receive wake signals:

```typescript
// Subscribe to wake signals
await signaler.subscribe(async (executionId, metadata) => {
  console.log(`Wake signal for ${executionId}:`, metadata);
  
  // Try to acquire lock and process
  const token = await lockManager.acquire(executionId);
  if (token) {
    try {
      await engine.run(executionId);
    } finally {
      await lockManager.release(executionId, token);
    }
  }
});

// Later: unsubscribe when shutting down
await signaler.unsubscribe();
```

### Integration Example

Combining the wake signaler with a polling loop:

```typescript
class WakeProcessor {
  private running = false;
  
  constructor(
    private engine: Engine,
    private store: StateStore,
    private lockManager: RedisLockManager,
    private signaler: RedisWakeSignaler,
  ) {}

  async start() {
    this.running = true;
    
    // Subscribe to immediate wake signals
    await this.signaler.subscribe(async (execId) => {
      await this.processExecution(execId);
    });
    
    // Poll for scheduled wakes
    this.pollForWakes();
  }

  async stop() {
    this.running = false;
    await this.signaler.unsubscribe();
  }

  private async pollForWakes() {
    while (this.running) {
      const toWake = await this.store.findWaiting(100);
      
      for (const exec of toWake) {
        if (exec.wakeAt && exec.wakeAt <= Date.now()) {
          await this.processExecution(exec.id);
        }
      }
      
      await sleep(1000);
    }
  }

  private async processExecution(executionId: string) {
    await this.lockManager.withLock(executionId, async () => {
      await this.engine.run(executionId);
    });
  }
}
```

## RedisExecutionCache

Caches execution data to reduce database load for frequently accessed executions.

### Caching Executions

```typescript
import { RedisExecutionCache } from '@flowmonkey/redis';

const cache = new RedisExecutionCache(redis, {
  keyPrefix: 'fm:exec:',  // Key prefix
  ttl: 60000,             // Cache for 1 minute
});

// Get from cache or database
async function getExecution(id: string): Promise<Execution> {
  // Try cache first
  const cached = await cache.get(id);
  if (cached) {
    return cached;
  }
  
  // Load from database
  const execution = await store.get(id);
  
  // Cache for next time
  if (execution) {
    await cache.set(execution);
  }
  
  return execution;
}
```

### Cache Invalidation

Invalidate cache when executions are modified:

```typescript
// After updating an execution
await store.update(execution);
await cache.invalidate(execution.id);

// Or update the cache with new value
await store.update(execution);
await cache.set(execution);
```

Bulk invalidation:

```typescript
// Invalidate multiple executions
await cache.invalidateMany([id1, id2, id3]);

// Clear all cached executions
await cache.clear();
```

### Cache-Aside Pattern

Wrap the store with caching:

```typescript
class CachedExecutionStore implements StateStore {
  constructor(
    private store: StateStore,
    private cache: RedisExecutionCache,
  ) {}

  async get(id: string): Promise<Execution | undefined> {
    const cached = await this.cache.get(id);
    if (cached) return cached;
    
    const execution = await this.store.get(id);
    if (execution) {
      await this.cache.set(execution);
    }
    return execution;
  }

  async update(execution: Execution): Promise<void> {
    await this.store.update(execution);
    await this.cache.set(execution); // Update cache
  }

  async delete(id: string): Promise<void> {
    await this.store.delete(id);
    await this.cache.invalidate(id);
  }

  // ... other methods
}
```

## Configuration

### Redis Connection

```typescript
import Redis from 'ioredis';

// Single instance
const redis = new Redis({
  host: 'localhost',
  port: 6379,
  password: process.env.REDIS_PASSWORD,
  db: 0,
  
  // Reconnection
  retryStrategy: (times) => {
    return Math.min(times * 50, 2000);
  },
  
  // Timeouts
  connectTimeout: 10000,
  commandTimeout: 5000,
});

// Cluster
const cluster = new Redis.Cluster([
  { host: 'node1', port: 6379 },
  { host: 'node2', port: 6379 },
  { host: 'node3', port: 6379 },
]);
```

### Component Configuration

```typescript
const lockManager = new RedisLockManager(redis, {
  keyPrefix: 'myapp:fm:lock:',
  defaultTTL: 30000,
  retryDelay: 100,
  maxRetries: 50,
});

const signaler = new RedisWakeSignaler(redis, {
  channel: 'myapp:fm:wake',
});

const cache = new RedisExecutionCache(redis, {
  keyPrefix: 'myapp:fm:exec:',
  ttl: 60000,
});
```

## Use Cases

### Single Worker Processing

For a simple deployment with one worker per execution:

```typescript
async function processExecution(executionId: string) {
  await lockManager.withLock(executionId, async () => {
    const execution = await store.get(executionId);
    if (execution.status === 'waiting') {
      await engine.run(executionId);
    }
  });
}
```

### Competing Workers

Multiple workers competing for the same executions:

```typescript
async function workerLoop() {
  while (running) {
    const waiting = await store.findWaiting(10);
    
    for (const exec of waiting) {
      // Try to claim the execution
      const token = await lockManager.acquire(exec.id);
      
      if (token) {
        try {
          await engine.run(exec.id);
        } finally {
          await lockManager.release(exec.id, token);
        }
      }
      // If no token, another worker got it - move on
    }
    
    await sleep(100);
  }
}
```

### Event-Driven Wake

Wake executions immediately when events occur:

```typescript
// API endpoint receives webhook
app.post('/webhook/:executionId', async (req, res) => {
  const { executionId } = req.params;
  
  // Store the data
  await engine.resume(executionId, req.body);
  
  // Signal workers to process immediately
  await signaler.publish(executionId, { reason: 'webhook' });
  
  res.json({ status: 'received' });
});
```

### High-Availability Setup

```typescript
const redis = new Redis.Cluster([...]);

const lockManager = new RedisLockManager(redis, {
  keyPrefix: 'fm:lock:',
  defaultTTL: 30000,
});

const signaler = new RedisWakeSignaler(redis, {
  channel: 'fm:wake',
});

// Multiple instances can safely share the same Redis cluster
```

## API Reference

### RedisLockManager

```typescript
class RedisLockManager {
  constructor(redis: Redis, options?: LockManagerOptions);
  
  // Acquire a lock, returns token or null
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

interface LockManagerOptions {
  keyPrefix?: string;   // Default: 'fm:lock:'
  defaultTTL?: number;  // Default: 30000
  retryDelay?: number;  // Default: 100
  maxRetries?: number;  // Default: 50
}
```

### RedisWakeSignaler

```typescript
class RedisWakeSignaler {
  constructor(redis: Redis, options?: WakeSignalerOptions);
  
  // Publish wake signal
  publish(executionId: string, metadata?: object): Promise<void>;
  
  // Subscribe to wake signals
  subscribe(handler: WakeHandler): Promise<void>;
  
  // Unsubscribe
  unsubscribe(): Promise<void>;
}

type WakeHandler = (executionId: string, metadata?: object) => Promise<void>;

interface WakeSignalerOptions {
  channel?: string;  // Default: 'fm:wake'
}
```

### RedisExecutionCache

```typescript
class RedisExecutionCache {
  constructor(redis: Redis, options?: CacheOptions);
  
  // Get cached execution
  get(id: string): Promise<Execution | null>;
  
  // Cache an execution
  set(execution: Execution): Promise<void>;
  
  // Invalidate cached execution
  invalidate(id: string): Promise<void>;
  
  // Invalidate multiple
  invalidateMany(ids: string[]): Promise<void>;
  
  // Clear all cached executions
  clear(): Promise<void>;
}

interface CacheOptions {
  keyPrefix?: string;  // Default: 'fm:exec:'
  ttl?: number;        // Default: 60000
}
```

## License

MIT
