# FlowMonkey Deployment Guide

This guide covers deploying FlowMonkey to production environments.

## Table of Contents

- [Architecture Overview](#architecture-overview)
- [Prerequisites](#prerequisites)
- [Environment Configuration](#environment-configuration)
- [Database Setup](#database-setup)
- [Application Deployment](#application-deployment)
- [Scaling Strategies](#scaling-strategies)
- [Monitoring & Observability](#monitoring--observability)
- [Security Considerations](#security-considerations)
- [Troubleshooting](#troubleshooting)

## Architecture Overview

```
                    ┌─────────────────────────────────────────────────────┐
                    │                   Load Balancer                      │
                    └──────────────────────┬──────────────────────────────┘
                                           │
              ┌────────────────────────────┼────────────────────────────┐
              │                            │                            │
     ┌────────▼────────┐        ┌─────────▼─────────┐        ┌────────▼────────┐
     │   API Server    │        │   API Server      │        │   API Server    │
     │   (Node.js)     │        │   (Node.js)       │        │   (Node.js)     │
     └────────┬────────┘        └─────────┬─────────┘        └────────┬────────┘
              │                           │                           │
              └───────────────────────────┼───────────────────────────┘
                                          │
        ┌─────────────────────────────────┼─────────────────────────────────┐
        │                                 │                                 │
┌───────▼───────┐                 ┌───────▼───────┐                 ┌───────▼───────┐
│  PostgreSQL   │                 │    Redis      │                 │  Job Workers  │
│  (Primary)    │                 │   (Cluster)   │                 │  (N replicas) │
│               │                 │               │                 │               │
│  - Executions │                 │  - Locks      │                 │  - Stateful   │
│  - Flows      │                 │  - Signals    │                 │    handlers   │
│  - Jobs       │                 │  - Cache      │                 │               │
│  - Events     │                 │               │                 │               │
└───────────────┘                 └───────────────┘                 └───────────────┘
```

### Components

| Component | Purpose | Scaling |
|-----------|---------|---------|
| API Servers | Handle HTTP triggers, API requests | Horizontal (stateless) |
| Job Workers | Execute stateful handlers | Horizontal (stateless) |
| Schedule Runner | Fire scheduled triggers | Single instance with failover |
| PostgreSQL | Persistent storage | Vertical + read replicas |
| Redis | Locking, signaling, caching | Cluster mode |

## Prerequisites

### System Requirements

- **Node.js**: 20.x or later
- **PostgreSQL**: 14.x or later
- **Redis**: 6.x or later (optional, for distributed deployments)
- **Memory**: 512MB+ per API server, 256MB+ per worker
- **CPU**: 1+ core per instance

### Dependencies

```bash
# Production dependencies
pnpm add @flowmonkey/core @flowmonkey/postgres @flowmonkey/redis @flowmonkey/handlers @flowmonkey/jobs @flowmonkey/triggers

# Database driver
pnpm add pg

# Redis client
pnpm add ioredis
```

## Environment Configuration

Create a `.env` file or configure environment variables:

```bash
# Application
NODE_ENV=production
PORT=3000
LOG_LEVEL=info

# PostgreSQL
DATABASE_URL=postgres://user:password@host:5432/flowmonkey
PG_POOL_SIZE=20
PG_IDLE_TIMEOUT=30000
PG_CONNECTION_TIMEOUT=5000

# Redis (optional)
REDIS_URL=redis://user:password@host:6379
REDIS_CLUSTER_NODES=redis-1:6379,redis-2:6379,redis-3:6379

# Security
API_KEY_SALT=your-secret-salt
WEBHOOK_SECRET=your-webhook-secret

# Execution limits
MAX_EXECUTION_STEPS=1000
EXECUTION_TIMEOUT_MS=86400000
WAIT_TIMEOUT_MS=604800000
MAX_CONTEXT_SIZE_KB=1024
MAX_CONTEXT_KEYS=100

# Job runner
JOB_POLL_INTERVAL=1000
JOB_BATCH_SIZE=10
JOB_MAX_CONCURRENT=5
JOB_HEARTBEAT_INTERVAL=10000
JOB_STALLED_THRESHOLD=60000

# Schedule runner
SCHEDULE_CHECK_INTERVAL=60000
SCHEDULE_DEFAULT_TIMEZONE=UTC
```

## Database Setup

### 1. Create Database

```bash
# Connect to PostgreSQL
psql -U postgres

# Create database and user
CREATE DATABASE flowmonkey;
CREATE USER flowmonkey_app WITH ENCRYPTED PASSWORD 'secure-password';
GRANT ALL PRIVILEGES ON DATABASE flowmonkey TO flowmonkey_app;

# Connect to new database
\c flowmonkey

# Grant schema permissions
GRANT ALL ON SCHEMA public TO flowmonkey_app;
```

### 2. Apply Schema

```typescript
// scripts/migrate.ts
import { Pool } from 'pg';
import { applySchema } from '@flowmonkey/postgres';

async function migrate() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
  });

  try {
    console.log('Applying FlowMonkey schema...');
    await applySchema(pool);
    console.log('Schema applied successfully');
  } finally {
    await pool.end();
  }
}

migrate().catch(console.error);
```

```bash
# Run migration
npx tsx scripts/migrate.ts
```

### 3. Production Migrations

For production, use a proper migration tool:

```typescript
// migrations/001_flowmonkey_initial.ts
import { schema } from '@flowmonkey/postgres';

export const up = async (db) => {
  await db.query(schema);
};

export const down = async (db) => {
  await db.query(`
    DROP TABLE IF EXISTS fm_resume_tokens CASCADE;
    DROP TABLE IF EXISTS fm_events CASCADE;
    DROP TABLE IF EXISTS fm_jobs CASCADE;
    DROP TABLE IF EXISTS fm_flow_versions CASCADE;
    DROP TABLE IF EXISTS fm_flows CASCADE;
    DROP TABLE IF EXISTS fm_triggers CASCADE;
    DROP TABLE IF EXISTS fm_executions CASCADE;
  `);
};
```

## Application Deployment

### API Server

```typescript
// src/server.ts
import express from 'express';
import { Pool } from 'pg';
import Redis from 'ioredis';
import { Engine, DefaultHandlerRegistry, DefaultFlowRegistry } from '@flowmonkey/core';
import { createPgStores } from '@flowmonkey/postgres';
import { RedisLockManager, RedisWakeSignaler } from '@flowmonkey/redis';
import { TriggerService, HttpHandler } from '@flowmonkey/triggers';
import { httpHandler, delayHandler, webhookHandler } from '@flowmonkey/handlers';

// Database
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: parseInt(process.env.PG_POOL_SIZE || '20'),
  idleTimeoutMillis: parseInt(process.env.PG_IDLE_TIMEOUT || '30000'),
  connectionTimeoutMillis: parseInt(process.env.PG_CONNECTION_TIMEOUT || '5000'),
});

// Redis
const redis = new Redis(process.env.REDIS_URL);
const lockManager = new RedisLockManager(redis);
const signaler = new RedisWakeSignaler(redis);

// Stores
const { executionStore, flowStore, jobStore, eventStore } = createPgStores(pool);

// Registries
const handlers = new DefaultHandlerRegistry();
handlers.register(httpHandler);
handlers.register(delayHandler);
handlers.register(webhookHandler);

const flows = new DefaultFlowRegistry();
// Load flows from database on startup
await flowStore.loadAll();
for (const flow of flowStore.list()) {
  flows.register(flow);
}

// Engine
const engine = new Engine(executionStore, handlers, flows);

// Triggers - pass app instance for auto-registration
const triggers = new TriggerService(triggerStore, engine, {
  http: {
    app,
    framework: 'express',
    basePath: '/webhooks',
    middleware: [authenticate], // Optional auth
  },
  schedule: {
    enabled: true,
    timezone: process.env.SCHEDULE_DEFAULT_TIMEZONE || 'UTC',
    checkInterval: parseInt(process.env.SCHEDULE_CHECK_INTERVAL || '60000'),
  },
});

// Express app
const app = express();
app.use(express.json({ limit: '1mb' }));

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'healthy', timestamp: Date.now() });
});

// Readiness check
app.get('/ready', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    await redis.ping();
    const triggersHealthy = await triggers.isHealthy();
    res.json({ status: 'ready', triggers: triggersHealthy });
  } catch (error) {
    res.status(503).json({ status: 'not ready', error: error.message });
  }
});

// API routes
app.post('/api/executions', async (req, res) => {
  const { flowId, context, options } = req.body;
  
  const { execution, created } = await engine.create(flowId, context, options);
  
  if (!created) {
    return res.status(200).json({ execution, created: false });
  }
  
  // Run in background
  engine.run(execution.id).catch(console.error);
  
  res.status(201).json({ execution, created: true });
});

app.get('/api/executions/:id', async (req, res) => {
  const execution = await executionStore.get(req.params.id);
  if (!execution) {
    return res.status(404).json({ error: 'Not found' });
  }
  res.json(execution);
});

app.post('/api/executions/:id/resume', async (req, res) => {
  await engine.resume(req.params.id, req.body);
  await signaler.signal(req.params.id);
  res.json({ success: true });
});

app.post('/api/executions/:id/cancel', async (req, res) => {
  const result = await engine.cancel(req.params.id, req.body);
  res.json(result);
});

// Webhook triggers are auto-registered at /webhooks/:triggerId
// No need for manual: app.post('/webhooks/:triggerId', HttpHandler(triggers));

// Start server
const port = parseInt(process.env.PORT || '3000');
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});

// Wake signal handler
signaler.subscribe(async (executionId) => {
  await lockManager.withLock(executionId, async () => {
    await engine.run(executionId);
  });
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('Shutting down...');
  await triggers.shutdown();  // Stops scheduler, cleans up
  await signaler.unsubscribe();
  await redis.quit();
  await pool.end();
  process.exit(0);
});
```

### Job Worker

```typescript
// src/worker.ts
import { Pool } from 'pg';
import { BasicJobRunner, JobReaper } from '@flowmonkey/jobs';
import { PgJobStore, PgExecutionStore } from '@flowmonkey/postgres';
import { emailHandler, reportHandler } from './handlers';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
});

const jobStore = new PgJobStore(pool);
const execStore = new PgExecutionStore(pool);

const workerId = `worker-${process.env.HOSTNAME || crypto.randomUUID()}`;

const runner = new BasicJobRunner(jobStore, execStore, workerId, {
  pollInterval: parseInt(process.env.JOB_POLL_INTERVAL || '1000'),
  batchSize: parseInt(process.env.JOB_BATCH_SIZE || '10'),
  maxConcurrent: parseInt(process.env.JOB_MAX_CONCURRENT || '5'),
});

const reaper = new JobReaper(jobStore, {
  stalledThreshold: parseInt(process.env.JOB_STALLED_THRESHOLD || '60000'),
  checkInterval: 30000,
});

// Register handlers
runner.registerHandler('email-send', emailHandler);
runner.registerHandler('report-generate', reportHandler);

// Start
await runner.start();
await reaper.start();

console.log(`Worker ${workerId} started`);

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('Shutting down worker...');
  await runner.stop();
  await reaper.stop();
  await pool.end();
  process.exit(0);
});
```

### Schedule Runner

The schedule runner is now built into `TriggerService`. When you pass `schedule: { enabled: true }`, 
the scheduler automatically starts and manages cron triggers.

```typescript
// Schedule is enabled in TriggerService config
const triggers = new TriggerService(triggerStore, engine, {
  http: { app, framework: 'express', basePath: '/webhooks' },
  schedule: {
    enabled: true,
    checkInterval: 60000,
    timezone: 'UTC',
  },
});

// Distributed lock ensures only one scheduler runs (if using Redis)
// No need for separate scheduler process in most deployments
```

For high-availability deployments, the scheduler uses distributed locking 
(via Redis if configured) to ensure only one instance processes schedules.
```

## Docker Deployment

### Dockerfile

```dockerfile
FROM node:20-alpine AS builder

WORKDIR /app

# Install pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

# Copy package files
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/*/package.json ./packages/

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source
COPY . .

# Build
RUN pnpm build

# Production image
FROM node:20-alpine

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@latest --activate

COPY --from=builder /app/package.json /app/pnpm-lock.yaml /app/pnpm-workspace.yaml ./
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/node_modules ./node_modules

ENV NODE_ENV=production

EXPOSE 3000

CMD ["node", "packages/app/dist/server.js"]
```

### docker-compose.yml

```yaml
version: '3.8'

services:
  api:
    build: .
    ports:
      - "3000:3000"
    environment:
      - DATABASE_URL=postgres://flowmonkey:password@postgres:5432/flowmonkey
      - REDIS_URL=redis://redis:6379
      - NODE_ENV=production
    depends_on:
      - postgres
      - redis
    deploy:
      replicas: 3
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/health"]
      interval: 30s
      timeout: 10s
      retries: 3

  worker:
    build: .
    command: ["node", "packages/app/dist/worker.js"]
    environment:
      - DATABASE_URL=postgres://flowmonkey:password@postgres:5432/flowmonkey
      - REDIS_URL=redis://redis:6379
      - NODE_ENV=production
    depends_on:
      - postgres
      - redis
    deploy:
      replicas: 2

  # Note: Scheduler is built into api service via TriggerService
  # No separate scheduler container needed (uses distributed locking)

  postgres:
    image: postgres:14-alpine
    environment:
      - POSTGRES_USER=flowmonkey
      - POSTGRES_PASSWORD=password
      - POSTGRES_DB=flowmonkey
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U flowmonkey"]
      interval: 10s
      timeout: 5s
      retries: 5

  redis:
    image: redis:7-alpine
    command: redis-server --appendonly yes
    volumes:
      - redis_data:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5

volumes:
  postgres_data:
  redis_data:
```

## Kubernetes Deployment

### Deployment

```yaml
# k8s/api-deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: flowmonkey-api
spec:
  replicas: 3
  selector:
    matchLabels:
      app: flowmonkey-api
  template:
    metadata:
      labels:
        app: flowmonkey-api
    spec:
      containers:
      - name: api
        image: your-registry/flowmonkey:latest
        ports:
        - containerPort: 3000
        env:
        - name: DATABASE_URL
          valueFrom:
            secretKeyRef:
              name: flowmonkey-secrets
              key: database-url
        - name: REDIS_URL
          valueFrom:
            secretKeyRef:
              name: flowmonkey-secrets
              key: redis-url
        resources:
          requests:
            memory: "512Mi"
            cpu: "250m"
          limits:
            memory: "1Gi"
            cpu: "1000m"
        livenessProbe:
          httpGet:
            path: /health
            port: 3000
          initialDelaySeconds: 10
          periodSeconds: 30
        readinessProbe:
          httpGet:
            path: /ready
            port: 3000
          initialDelaySeconds: 5
          periodSeconds: 10
---
apiVersion: v1
kind: Service
metadata:
  name: flowmonkey-api
spec:
  selector:
    app: flowmonkey-api
  ports:
  - port: 80
    targetPort: 3000
  type: ClusterIP
---
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: flowmonkey-ingress
  annotations:
    nginx.ingress.kubernetes.io/ssl-redirect: "true"
spec:
  tls:
  - hosts:
    - flowmonkey.example.com
    secretName: flowmonkey-tls
  rules:
  - host: flowmonkey.example.com
    http:
      paths:
      - path: /
        pathType: Prefix
        backend:
          service:
            name: flowmonkey-api
            port:
              number: 80
```

### Worker Deployment

```yaml
# k8s/worker-deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: flowmonkey-worker
spec:
  replicas: 2
  selector:
    matchLabels:
      app: flowmonkey-worker
  template:
    metadata:
      labels:
        app: flowmonkey-worker
    spec:
      containers:
      - name: worker
        image: your-registry/flowmonkey:latest
        command: ["node", "packages/app/dist/worker.js"]
        env:
        - name: DATABASE_URL
          valueFrom:
            secretKeyRef:
              name: flowmonkey-secrets
              key: database-url
        - name: REDIS_URL
          valueFrom:
            secretKeyRef:
              name: flowmonkey-secrets
              key: redis-url
        resources:
          requests:
            memory: "256Mi"
            cpu: "100m"
          limits:
            memory: "512Mi"
            cpu: "500m"
```

## Scaling Strategies

### Horizontal Scaling

| Component | Scaling Trigger | Notes |
|-----------|-----------------|-------|
| API Servers | CPU > 70% or requests/sec | Stateless, scale freely |
| Job Workers | Queue depth > 100 | Scale based on job backlog |
| Schedule Runner | N/A | Single instance with failover |

### Vertical Scaling

| Component | Memory | CPU | Notes |
|-----------|--------|-----|-------|
| PostgreSQL | 4GB+ | 2+ cores | Memory for caching |
| Redis | 1GB+ | 1+ core | Memory for keys |

### Database Scaling

1. **Read Replicas**: Route read queries to replicas
2. **Connection Pooling**: Use PgBouncer for connection pooling
3. **Partitioning**: Partition large tables by date

```sql
-- Partition executions by month
CREATE TABLE fm_executions (
  ...
) PARTITION BY RANGE (created_at);

CREATE TABLE fm_executions_2024_01 PARTITION OF fm_executions
  FOR VALUES FROM (1704067200000) TO (1706745600000);
```

## Monitoring & Observability

### Metrics (Prometheus)

```typescript
import { Counter, Histogram, Gauge } from 'prom-client';

// Execution metrics
const executionCreated = new Counter({
  name: 'flowmonkey_execution_created_total',
  help: 'Total executions created',
  labelNames: ['flow_id'],
});

const executionCompleted = new Counter({
  name: 'flowmonkey_execution_completed_total',
  help: 'Total executions completed',
  labelNames: ['flow_id', 'status'],
});

const executionDuration = new Histogram({
  name: 'flowmonkey_execution_duration_seconds',
  help: 'Execution duration',
  labelNames: ['flow_id'],
  buckets: [0.1, 0.5, 1, 5, 10, 30, 60, 300],
});

// Job metrics
const jobsPending = new Gauge({
  name: 'flowmonkey_jobs_pending',
  help: 'Pending jobs',
});

const jobsActive = new Gauge({
  name: 'flowmonkey_jobs_active',
  help: 'Active jobs',
  labelNames: ['worker_id'],
});

// Database metrics
const dbPoolSize = new Gauge({
  name: 'flowmonkey_db_pool_size',
  help: 'Database pool size',
});

const dbPoolWaiting = new Gauge({
  name: 'flowmonkey_db_pool_waiting',
  help: 'Waiting for database connection',
});
```

### Logging (Structured)

```typescript
import pino from 'pino';

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  formatters: {
    level: (label) => ({ level: label }),
  },
});

// Log execution events
engine.on('execution.created', (execution) => {
  logger.info({ 
    event: 'execution.created',
    executionId: execution.id,
    flowId: execution.flowId,
  });
});

engine.on('execution.completed', (execution) => {
  logger.info({
    event: 'execution.completed',
    executionId: execution.id,
    flowId: execution.flowId,
    duration: execution.updatedAt - execution.createdAt,
    stepCount: execution.stepCount,
  });
});

engine.on('execution.failed', (execution) => {
  logger.error({
    event: 'execution.failed',
    executionId: execution.id,
    flowId: execution.flowId,
    error: execution.error,
  });
});
```

### Tracing (OpenTelemetry)

```typescript
import { trace } from '@opentelemetry/api';

const tracer = trace.getTracer('flowmonkey');

// Wrap engine.run with tracing
async function runWithTracing(executionId: string) {
  return tracer.startActiveSpan('execution.run', async (span) => {
    span.setAttribute('execution.id', executionId);
    
    try {
      const result = await engine.run(executionId);
      span.setAttribute('execution.status', result.status);
      span.setAttribute('execution.steps', result.stepCount);
      return result;
    } catch (error) {
      span.recordException(error);
      throw error;
    } finally {
      span.end();
    }
  });
}
```

## Security Considerations

### 1. Authentication & Authorization

```typescript
// API key authentication
app.use('/api', (req, res, next) => {
  const apiKey = req.headers['x-api-key'];
  if (!apiKey || !validateApiKey(apiKey)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
});

// Tenant isolation
app.use('/api', (req, res, next) => {
  const tenantId = extractTenantId(req);
  req.tenantId = tenantId;
  next();
});

// Always pass tenantId to engine
const { execution } = await engine.create(flowId, context, { tenantId: req.tenantId });
```

### 2. Input Validation

```typescript
import Ajv from 'ajv';

const ajv = new Ajv({ allErrors: true });

// Validate all API inputs
app.post('/api/executions', async (req, res) => {
  const validate = ajv.compile(executionCreateSchema);
  
  if (!validate(req.body)) {
    return res.status(400).json({
      error: 'Validation failed',
      details: validate.errors,
    });
  }
  
  // Proceed with validated data
});
```

### 3. Secrets Management

```typescript
// Use environment variables for secrets
const config = {
  database: process.env.DATABASE_URL,
  redis: process.env.REDIS_URL,
  webhookSecret: process.env.WEBHOOK_SECRET,
};

// Never log secrets
logger.info({
  database: config.database.replace(/:[^:@]+@/, ':***@'),
});
```

### 4. Network Security

- Use TLS for all connections
- Restrict database access to application IPs
- Use private subnets for internal services
- Enable Redis AUTH

## Troubleshooting

### Common Issues

#### 1. Executions Stuck in "running"

**Cause**: Worker crashed without completing step

**Solution**:
```sql
-- Find stuck executions
SELECT id, current_step, updated_at
FROM fm_executions
WHERE status = 'running'
  AND updated_at < extract(epoch from now() - interval '1 hour') * 1000;

-- Reset to previous state
UPDATE fm_executions
SET status = 'pending'
WHERE id = 'stuck-execution-id';
```

#### 2. Job Queue Growing

**Cause**: Not enough workers, or handlers failing

**Solution**:
```sql
-- Check job status distribution
SELECT status, handler, COUNT(*)
FROM fm_jobs
GROUP BY status, handler;

-- Check failed jobs
SELECT * FROM fm_jobs
WHERE status = 'failed'
ORDER BY updated_at DESC
LIMIT 10;
```

#### 3. Database Connection Exhausted

**Cause**: Too many connections, connection leaks

**Solution**:
```sql
-- Check active connections
SELECT count(*) FROM pg_stat_activity 
WHERE datname = 'flowmonkey';

-- Kill idle connections
SELECT pg_terminate_backend(pid)
FROM pg_stat_activity
WHERE datname = 'flowmonkey'
  AND state = 'idle'
  AND state_change < now() - interval '10 minutes';
```

#### 4. Redis Memory Full

**Cause**: Too many cached executions

**Solution**:
```bash
# Check memory usage
redis-cli INFO memory

# Flush cache (safe - data is in Postgres)
redis-cli FLUSHDB
```

### Health Check Endpoints

```typescript
// Detailed health check
app.get('/health/detailed', async (req, res) => {
  const checks = {
    database: await checkDatabase(),
    redis: await checkRedis(),
    jobs: await checkJobQueue(),
  };
  
  const healthy = Object.values(checks).every(c => c.healthy);
  
  res.status(healthy ? 200 : 503).json({
    status: healthy ? 'healthy' : 'unhealthy',
    checks,
    timestamp: Date.now(),
  });
});

async function checkDatabase() {
  try {
    const start = Date.now();
    await pool.query('SELECT 1');
    return { healthy: true, latencyMs: Date.now() - start };
  } catch (error) {
    return { healthy: false, error: error.message };
  }
}

async function checkRedis() {
  try {
    const start = Date.now();
    await redis.ping();
    return { healthy: true, latencyMs: Date.now() - start };
  } catch (error) {
    return { healthy: false, error: error.message };
  }
}

async function checkJobQueue() {
  const pending = await jobStore.listByStatus('pending', 1000);
  const stalled = await jobStore.findStalled(Date.now(), 100);
  
  return {
    healthy: stalled.length < 10,
    pendingJobs: pending.length,
    stalledJobs: stalled.length,
  };
}
```

## License

MIT © FlowMonkey Contributors
