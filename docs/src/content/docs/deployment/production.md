---
title: Production Setup
description: Deploying FlowMonkey to production.
---

# Production Setup

Guide for deploying FlowMonkey in production environments.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      Load Balancer                          │
└─────────────────────────┬───────────────────────────────────┘
                          │
          ┌───────────────┼───────────────┐
          │               │               │
          ▼               ▼               ▼
    ┌──────────┐    ┌──────────┐    ┌──────────┐
    │ Engine 1 │    │ Engine 2 │    │ Engine 3 │
    └────┬─────┘    └────┬─────┘    └────┬─────┘
         │               │               │
         └───────────────┼───────────────┘
                         │
         ┌───────────────┼───────────────┐
         │               │               │
         ▼               ▼               ▼
    ┌──────────┐    ┌──────────┐    ┌──────────┐
    │PostgreSQL│    │  Redis   │    │Job Runner│
    └──────────┘    └──────────┘    └──────────┘
```

## Environment Variables

```bash
# Database
DATABASE_URL=postgres://user:pass@host:5432/flowmonkey
DATABASE_POOL_SIZE=20

# Redis
REDIS_URL=redis://host:6379

# Server
PORT=3000
NODE_ENV=production

# Observability
LOG_LEVEL=info
ENABLE_METRICS=true
```

## Basic Setup

```typescript
import { Pool } from 'pg';
import { Redis } from 'ioredis';
import { Engine, DefaultHandlerRegistry, DefaultFlowRegistry } from '@flowmonkey/core';
import { PgExecutionStore, applySchema } from '@flowmonkey/postgres';
import { RedisLockManager } from '@flowmonkey/redis';

// Database
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: parseInt(process.env.DATABASE_POOL_SIZE || '20')
});

await applySchema(pool);

// Redis
const redis = new Redis(process.env.REDIS_URL);

// Components
const store = new PgExecutionStore(pool);
const lockManager = new RedisLockManager(redis);
const handlers = new DefaultHandlerRegistry();
const flows = new DefaultFlowRegistry();

// Register handlers and flows
// ...

const engine = new Engine(store, handlers, flows);
```

## Health Checks

```typescript
import express from 'express';

const app = express();

app.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    await redis.ping();
    res.json({ status: 'healthy' });
  } catch (error) {
    res.status(503).json({ status: 'unhealthy', error: error.message });
  }
});

app.get('/ready', async (req, res) => {
  // Check if service is ready to accept traffic
  res.json({ status: 'ready' });
});
```

## Graceful Shutdown

```typescript
const shutdown = async () => {
  console.log('Shutting down...');
  
  // Stop accepting new requests
  server.close();
  
  // Stop scheduled tasks
  await scheduler.stop();
  
  // Wait for in-flight requests
  await new Promise(resolve => setTimeout(resolve, 5000));
  
  // Close connections
  await pool.end();
  await redis.quit();
  
  process.exit(0);
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
```

## Monitoring

### Metrics

```typescript
import { collectDefaultMetrics, Counter, Histogram } from 'prom-client';

collectDefaultMetrics();

const executionCounter = new Counter({
  name: 'flowmonkey_executions_total',
  help: 'Total executions',
  labelNames: ['flow_id', 'status']
});

const stepDuration = new Histogram({
  name: 'flowmonkey_step_duration_seconds',
  help: 'Step execution duration',
  labelNames: ['step_type']
});

// Track metrics
engine.on('execution:completed', (execution) => {
  executionCounter.inc({ flow_id: execution.flowId, status: 'completed' });
});

engine.on('step:completed', (event) => {
  stepDuration.observe({ step_type: event.type }, event.duration / 1000);
});
```

### Logging

```typescript
import pino from 'pino';

const logger = pino({
  level: process.env.LOG_LEVEL || 'info'
});

engine.on('execution:started', (execution) => {
  logger.info({ executionId: execution.id, flowId: execution.flowId }, 'Execution started');
});

engine.on('execution:failed', (execution) => {
  logger.error({ executionId: execution.id, error: execution.error }, 'Execution failed');
});
```

## Scaling

### Horizontal Scaling

FlowMonkey engines are stateless—scale by adding more instances:

```yaml
# kubernetes deployment
spec:
  replicas: 3
```

### Database Connection Limits

```typescript
// Total connections = instances × pool size
// PostgreSQL default: 100 connections
// 3 instances × 20 pool = 60 connections
```

## Next Steps

- [Docker Deployment](/deployment/docker/) - Container deployment
- [Error Handling](/advanced/error-handling/) - Production error strategies
