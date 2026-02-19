# Distributed Handler Architecture (Production Vision)

**Date:** February 3, 2026  
**Status:** Future Architecture Design  
**Current State:** In-process execution (trusted handlers only)

---

## Executive Summary

This document outlines a **distributed, worker-based architecture** for handler execution in FlowMonkey, designed for:
- **Marketplace handlers** (untrusted community code)
- **Multi-region deployment** (handlers run where data lives)
- **Horizontal scaling** (dedicated worker pools)
- **Resource isolation** (containers per handler type)

**Key Concept:** The engine becomes a **pure orchestrator**, delegating all handler execution to remote workers via message queues. Workers are containerized, stateless, and can be deployed globally.

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Worker Model](#worker-model)
3. [Communication Protocol](#communication-protocol)
4. [Plumbing Requirements](#plumbing-requirements)
5. [Stateless vs Stateful Handlers](#stateless-vs-stateful-handlers)
6. [Multi-Region Deployment](#multi-region-deployment)
7. [Implementation Phases](#implementation-phases)
8. [Technical Challenges](#technical-challenges)

---

## Architecture Overview

### Current State (In-Process)
```
┌─────────────────────────────────────────────────────────┐
│ Engine Process                                          │
│  ├─ Flow orchestration                                  │
│  ├─ Handler execution ← ALL IN ONE PROCESS             │
│  ├─ State management                                    │
│  └─ Event emission                                      │
└─────────────────────────────────────────────────────────┘
```

### Target State (Distributed Workers)
```
┌─────────────────────────────────────────────────────────┐
│ Engine (Orchestrator)                                   │
│  ├─ Flow execution logic                                │
│  ├─ State management (Postgres)                         │
│  ├─ Task dispatch (Redis/SQS)                           │
│  └─ Result collection                                   │
└─────────────────────────────────────────────────────────┘
         │                    │                    │
         ↓ dispatch task      ↓                    ↓
┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
│ Worker Pool A   │  │ Worker Pool B   │  │ Worker Pool C   │
│ (us-east-1)     │  │ (eu-west-1)     │  │ (ap-south-1)    │
├─────────────────┤  ├─────────────────┤  ├─────────────────┤
│ Handler: HTTP   │  │ Handler: AI     │  │ Handler: Data   │
│ Concurrency: 10 │  │ Concurrency: 2  │  │ Concurrency: 50 │
│ Timeout: 30s    │  │ Timeout: 300s   │  │ Timeout: 10s    │
└─────────────────┘  └─────────────────┘  └─────────────────┘
         ↓ result             ↓                    ↓
┌─────────────────────────────────────────────────────────┐
│ Result Queue (Redis/SQS)                                │
└─────────────────────────────────────────────────────────┘
```

**Key Benefits:**
- ✅ **Complete isolation** - Handler crashes can't affect engine
- ✅ **Independent scaling** - Scale workers by handler type
- ✅ **Multi-region** - Run handlers near data sources
- ✅ **Language agnostic** - Workers can be in any language
- ✅ **Resource control** - Per-worker CPU/memory limits
- ✅ **Cost optimization** - Spot instances for burst workloads

---

## Worker Model

### Worker Architecture

```
┌─────────────────────────────────────────────────────────┐
│ Worker Container (Docker)                               │
├─────────────────────────────────────────────────────────┤
│ Worker Runtime                                          │
│  ├─ Task polling (Redis/SQS)                            │
│  ├─ Context deserialization                             │
│  ├─ Handler loader                                      │
│  ├─ Execution environment                               │
│  ├─ Result serialization                                │
│  └─ Heartbeat/health checks                             │
├─────────────────────────────────────────────────────────┤
│ Handler Code                                            │
│  ├─ Handler implementation                              │
│  ├─ Dependencies                                        │
│  └─ Configuration                                       │
├─────────────────────────────────────────────────────────┤
│ Plumbing Interfaces                                     │
│  ├─ Context API (read/write execution context)         │
│  ├─ Vault API (secrets management)                      │
│  ├─ Checkpoint API (stateful handlers)                  │
│  ├─ Progress API (long-running tasks)                   │
│  └─ Event API (emit custom events)                      │
└─────────────────────────────────────────────────────────┘
```

### Worker Types

#### 1. **Stateless Workers** (Most Handlers)
```typescript
// Stateless worker configuration
{
  type: 'stateless',
  handlerType: 'http-request',
  image: 'flowmonkey/handler-http:v1.0.0',
  concurrency: 10,              // Run 10 tasks concurrently
  timeout: 30000,               // 30s per task
  resources: {
    cpu: '500m',                // 0.5 CPU cores
    memory: '512Mi'             // 512 MB RAM
  },
  autoScale: {
    min: 2,                     // Always 2 workers running
    max: 20,                    // Scale up to 20
    targetQueueDepth: 5         // Scale when queue > 5
  }
}
```

**Characteristics:**
- Pulls tasks from shared queue
- Executes handler with provided context
- Returns result and exits
- No persistent state between tasks
- Can be killed/restarted anytime
- Perfect for: HTTP calls, transformations, validations

#### 2. **Stateful Workers** (Long-Running Jobs)
```typescript
// Stateful worker configuration
{
  type: 'stateful',
  handlerType: 'video-processing',
  image: 'flowmonkey/handler-video:v1.0.0',
  concurrency: 1,               // One task per worker (exclusive)
  timeout: 3600000,             // 1 hour per task
  resources: {
    cpu: '2000m',               // 2 CPU cores
    memory: '4Gi',              // 4 GB RAM
    gpu: 'nvidia-t4'            // Optional GPU
  },
  checkpoint: {
    enabled: true,
    intervalMs: 10000           // Save progress every 10s
  },
  ownership: 'exclusive'        // Worker owns task until completion
}
```

**Characteristics:**
- Claims a single task exclusively
- Maintains state throughout execution
- Periodically saves checkpoints
- Can resume after crash
- Sends progress updates
- Perfect for: Video encoding, data processing, AI inference

---

## Communication Protocol

### Task Dispatch (Engine → Worker)

**Task Message Format:**
```json
{
  "taskId": "task-abc123",
  "executionId": "exec-xyz789",
  "flowId": "payment-flow",
  "flowVersion": "1.0.0",
  "stepId": "step-http-call",
  
  "handler": {
    "type": "http-request",
    "version": "1.0.0"
  },
  
  "input": {
    "url": "https://api.stripe.com/v1/charges",
    "method": "POST",
    "headers": { "Authorization": "Bearer {{vault.stripe.key}}" },
    "body": { "amount": 1000, "currency": "usd" }
  },
  
  "context": {
    "userId": "user-123",
    "orderId": "order-456",
    "timestamp": "2026-02-03T12:00:00Z"
  },
  
  "config": {
    "timeout": 30000,
    "retries": 3,
    "backoff": "exponential"
  },
  
  "vault": {
    "keys": ["stripe.key", "stripe.secret"]  // Request specific secrets
  },
  
  "metadata": {
    "region": "us-east-1",
    "tenantId": "tenant-abc",
    "priority": "high",
    "dispatchedAt": "2026-02-03T12:00:00.123Z"
  }
}
```

**Queue Strategy:**
```typescript
// Different queue per handler type for independent scaling
const queues = {
  'http-request': 'flowmonkey:tasks:http',
  'ai-inference': 'flowmonkey:tasks:ai',
  'data-transform': 'flowmonkey:tasks:data',
  // ... one queue per handler type
};

// Priority queues for urgent tasks
const priorityQueues = {
  high: 'flowmonkey:tasks:http:high',
  normal: 'flowmonkey:tasks:http:normal',
  low: 'flowmonkey:tasks:http:low'
};

// Region-specific queues for data locality
const regionQueues = {
  'us-east-1': 'flowmonkey:tasks:http:us-east-1',
  'eu-west-1': 'flowmonkey:tasks:http:eu-west-1',
  'ap-south-1': 'flowmonkey:tasks:http:ap-south-1'
};
```

### Result Collection (Worker → Engine)

**Result Message Format:**
```json
{
  "taskId": "task-abc123",
  "executionId": "exec-xyz789",
  "stepId": "step-http-call",
  
  "outcome": "success",  // or "failure", "wait"
  
  "output": {
    "status": 200,
    "body": { "id": "ch_xyz", "status": "succeeded" },
    "headers": { "content-type": "application/json" }
  },
  
  "metrics": {
    "startedAt": "2026-02-03T12:00:00.123Z",
    "completedAt": "2026-02-03T12:00:01.456Z",
    "duration": 1333,
    "attempts": 1,
    "workerId": "worker-us-east-1-abc",
    "region": "us-east-1"
  },
  
  "logs": [
    { "level": "info", "message": "Starting HTTP request", "timestamp": "..." },
    { "level": "debug", "message": "Request sent", "timestamp": "..." },
    { "level": "info", "message": "Response received", "timestamp": "..." }
  ]
}
```

**Failure Result:**
```json
{
  "taskId": "task-abc123",
  "executionId": "exec-xyz789",
  "stepId": "step-http-call",
  
  "outcome": "failure",
  
  "error": {
    "code": "TIMEOUT",
    "message": "Request timed out after 30s",
    "retryable": true,
    "details": {
      "url": "https://api.stripe.com/v1/charges",
      "elapsed": 30001
    }
  },
  
  "metrics": { /* ... */ }
}
```

**Wait Result (Async Continuation):**
```json
{
  "taskId": "task-abc123",
  "executionId": "exec-xyz789",
  "stepId": "step-webhook-wait",
  
  "outcome": "wait",
  
  "resumeToken": "webhook-stripe-ch_xyz",
  "waitUntil": "2026-02-03T12:10:00Z",  // Optional timeout
  
  "metadata": {
    "webhookUrl": "https://api.myapp.com/webhooks/stripe",
    "expectedEvent": "charge.succeeded"
  }
}
```

### Heartbeat Protocol (Long-Running Tasks)

```json
{
  "taskId": "task-abc123",
  "workerId": "worker-us-east-1-abc",
  "status": "running",
  "progress": {
    "percent": 45,
    "message": "Processing frame 450/1000",
    "estimatedCompletion": "2026-02-03T12:15:00Z"
  },
  "checkpoint": {
    "id": "checkpoint-xyz",
    "savedAt": "2026-02-03T12:05:00Z",
    "size": 1024000  // bytes
  },
  "heartbeatAt": "2026-02-03T12:05:30Z"
}
```

**Heartbeat Rules:**
- Workers must send heartbeat every 30s for long tasks
- Engine marks task as stale if no heartbeat for 60s
- Stale tasks are re-queued for retry
- Checkpoints prevent work loss on retry

---

## Plumbing Requirements

### 1. Context API (Worker ↔ Engine)

**Purpose:** Workers need read/write access to execution context

**Interface:**
```typescript
interface ContextAPI {
  // Read operations (passed in task message)
  get(path: string): any;
  getSafe(path: string, defaultValue?: any): any;
  
  // Write operations (returned in result)
  set(path: string, value: any): void;
  merge(data: object): void;
  delete(path: string): void;
}
```

**Implementation Options:**

#### Option A: Full Context in Task (Simple)
```typescript
// Engine sends entire context with task
const task = {
  taskId: 'task-123',
  context: execution.context,  // Full context object (could be large)
  input: resolvedInput
};

// Worker modifies context locally
const result = await handler.execute(task);

// Worker returns updated context
const resultMessage = {
  taskId: 'task-123',
  output: result.output,
  contextUpdates: {              // Only changes returned
    'step1.result': { ... },
    'payment.status': 'completed'
  }
};

// Engine merges updates back
Object.assign(execution.context, result.contextUpdates);
```

**Pros:** Simple, no API calls  
**Cons:** Large context = large messages, serialization overhead

#### Option B: Context Service (Scalable)
```typescript
// Engine sends only task metadata
const task = {
  taskId: 'task-123',
  executionId: 'exec-xyz',
  contextUrl: 'https://context-api.flowmonkey.dev/v1/contexts/exec-xyz',
  contextToken: 'eyJhbGc...'  // JWT token for this execution
};

// Worker fetches context on-demand
const context = await fetch(task.contextUrl, {
  headers: { 'Authorization': `Bearer ${task.contextToken}` }
}).then(r => r.json());

// Worker patches context as needed
await fetch(`${task.contextUrl}/patch`, {
  method: 'PATCH',
  headers: { 'Authorization': `Bearer ${task.contextToken}` },
  body: JSON.stringify({
    'step1.result': { ... }
  })
});
```

**Pros:** Small messages, streaming updates, multi-region replication  
**Cons:** More complex, network overhead, API latency

**Recommendation:** **Option A for now** (simple), migrate to **Option B** when contexts exceed 1MB or need streaming updates.

---

### 2. Vault API (Secrets Management)

**Purpose:** Workers need secure access to secrets without storing them

**Interface:**
```typescript
interface VaultAPI {
  get(key: string): Promise<string>;
  getMultiple(keys: string[]): Promise<Record<string, string>>;
}
```

**Implementation:**

```typescript
// Engine requests secrets for task
const secrets = await vaultService.getSecrets(
  ['stripe.key', 'aws.accessKey'],
  { executionId: 'exec-xyz', tenantId: 'tenant-abc' }
);

// Engine includes encrypted secrets in task
const task = {
  taskId: 'task-123',
  vault: {
    'stripe.key': encryptForWorker(secrets['stripe.key'], workerPublicKey),
    'aws.accessKey': encryptForWorker(secrets['aws.accessKey'], workerPublicKey)
  }
};

// Worker decrypts secrets using its private key
const stripeKey = decryptSecret(task.vault['stripe.key'], workerPrivateKey);
```

**Security Model:**
- Workers receive **only** secrets they need (per handler config)
- Secrets encrypted in-transit using worker's public key
- Secrets never logged or persisted by worker
- Secrets cleared from memory after task completion
- Audit log tracks all secret access

**Alternative:** Workers call vault service directly (more secure, adds latency)

---

### 3. Checkpoint API (Stateful Handlers)

**Purpose:** Long-running handlers save progress to survive crashes

**Interface:**
```typescript
interface CheckpointAPI {
  save(data: any): Promise<void>;
  load(): Promise<any | null>;
  clear(): Promise<void>;
}
```

**Implementation:**

```typescript
// Worker saves checkpoint periodically
await checkpointAPI.save({
  processedFrames: 450,
  currentFrame: 'frame-0450.mp4',
  tempFiles: ['/tmp/output-0001.mp4', '/tmp/output-0002.mp4'],
  metadata: { ... }
});

// Engine stores checkpoint in Postgres
INSERT INTO fm_checkpoints (
  execution_id,
  task_id,
  worker_id,
  data,
  saved_at
) VALUES ($1, $2, $3, $4, NOW());

// On retry, new worker loads checkpoint
const checkpoint = await checkpointAPI.load();
if (checkpoint) {
  // Resume from checkpoint
  startFrame = checkpoint.processedFrames + 1;
} else {
  // Start from beginning
  startFrame = 0;
}
```

**Checkpoint Storage:**
- Small checkpoints (<1MB): Postgres JSONB column
- Large checkpoints (>1MB): S3/GCS with reference in Postgres
- TTL: Checkpoints expire 7 days after task completion
- Compression: gzip for large checkpoints

---

### 4. Progress API (Observability)

**Purpose:** Workers report progress for long-running tasks

**Interface:**
```typescript
interface ProgressAPI {
  update(percent: number, message?: string): Promise<void>;
  setEstimatedCompletion(timestamp: Date): Promise<void>;
}
```

**Implementation:**

```typescript
// Worker updates progress
await progressAPI.update(45, 'Processing frame 450/1000');

// Engine broadcasts progress via WebSocket
websocketServer.broadcast({
  type: 'execution.progress',
  executionId: 'exec-xyz',
  stepId: 'step-video',
  progress: {
    percent: 45,
    message: 'Processing frame 450/1000',
    updatedAt: '2026-02-03T12:05:30Z'
  }
});

// UI shows progress bar
<ProgressBar value={45} label="Processing frame 450/1000" />
```

**Progress Storage:**
- Real-time: Redis PubSub for live updates
- Historical: Postgres for audit trail
- Retention: 30 days

---

### 5. Event API (Custom Events)

**Purpose:** Handlers emit custom events for observability/triggers

**Interface:**
```typescript
interface EventAPI {
  emit(event: string, data: any): Promise<void>;
}
```

**Implementation:**

```typescript
// Handler emits custom event
await eventAPI.emit('payment.processed', {
  orderId: 'order-456',
  amount: 1000,
  currency: 'usd',
  transactionId: 'txn-xyz'
});

// Engine publishes event to EventBus
eventBus.publish({
  type: 'handler.custom',
  executionId: 'exec-xyz',
  stepId: 'step-payment',
  event: 'payment.processed',
  data: { ... },
  timestamp: '2026-02-03T12:00:01Z'
});

// Other systems subscribe to events
eventBus.subscribe('payment.processed', async (event) => {
  await notificationService.send({
    userId: event.data.userId,
    message: `Payment of $${event.data.amount} processed`
  });
});
```

---

## Stateless vs Stateful Handlers

### Stateless Handler Lifecycle

```
1. Engine dispatches task to queue
   ↓
2. Worker pulls task from queue
   ↓
3. Worker loads handler code
   ↓
4. Worker deserializes context
   ↓
5. Worker executes handler (30s timeout)
   ↓
6. Worker serializes result
   ↓
7. Worker publishes result to result queue
   ↓
8. Worker acknowledges task completion
   ↓
9. Engine processes result
   ↓
10. Engine continues to next step
```

**Timing:**
- Queue latency: ~10ms
- Deserialization: ~5ms
- Handler execution: 50ms - 30s
- Serialization: ~5ms
- Total overhead: ~30ms + handler time

**Scaling:**
- Horizontal: Add more workers
- Auto-scaling: Based on queue depth
- Cost: Pay per task (serverless) or per worker-hour (containers)

---

### Stateful Handler Lifecycle

```
1. Engine creates job in fm_jobs table
   ↓
2. Engine dispatches task to exclusive queue
   ↓
3. Worker claims task with unique worker ID
   ↓
4. Worker loads checkpoint (if exists)
   ↓
5. Worker starts execution (1-60 min timeout)
   ↓
6. Worker saves checkpoints every 10s
   ↓
7. Worker sends heartbeats every 30s
   ↓
8. [If crash] New worker claims task, loads checkpoint
   ↓
9. Worker completes task, publishes result
   ↓
10. Engine marks job complete
```

**Key Differences:**
- **Exclusive claim**: Only one worker processes the task
- **Checkpointing**: Progress saved every 10s
- **Heartbeats**: Prove worker is still alive
- **Resume logic**: New worker can continue from checkpoint
- **Timeout**: Much longer (minutes/hours)

**Job Table Schema:**
```sql
CREATE TABLE fm_jobs (
  id UUID PRIMARY KEY,
  execution_id UUID NOT NULL,
  step_id TEXT NOT NULL,
  handler_type TEXT NOT NULL,
  status TEXT NOT NULL,  -- 'pending', 'claimed', 'running', 'completed', 'failed'
  
  -- Task ownership
  worker_id TEXT,
  claimed_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  
  -- Progress tracking
  progress_percent INT DEFAULT 0,
  progress_message TEXT,
  last_heartbeat_at TIMESTAMPTZ,
  
  -- Checkpoint reference
  checkpoint_id UUID,
  
  -- Configuration
  timeout_ms INT NOT NULL,
  max_retries INT DEFAULT 3,
  retry_count INT DEFAULT 0,
  
  -- Result
  result JSONB,
  error JSONB,
  
  FOREIGN KEY (execution_id) REFERENCES fm_executions(id)
);

CREATE INDEX idx_fm_jobs_status_handler ON fm_jobs(status, handler_type);
CREATE INDEX idx_fm_jobs_heartbeat ON fm_jobs(last_heartbeat_at) 
  WHERE status IN ('claimed', 'running');
```

---

## Multi-Region Deployment

### Architecture

```
┌─────────────────────────────────────────────────────────────┐
│ Global Control Plane (us-east-1)                            │
│  ├─ Primary Postgres (executions, flows)                    │
│  ├─ Primary Redis (task queues, result queues)              │
│  ├─ Engine cluster (orchestrators)                          │
│  └─ API servers                                             │
└─────────────────────────────────────────────────────────────┘
              │ replication             │ replication
              ↓                         ↓
┌─────────────────────────┐   ┌─────────────────────────┐
│ Region: eu-west-1       │   │ Region: ap-south-1      │
│  ├─ Read replica (PG)   │   │  ├─ Read replica (PG)   │
│  ├─ Redis cache         │   │  ├─ Redis cache         │
│  ├─ Worker pools        │   │  ├─ Worker pools        │
│  └─ Local APIs          │   │  └─ Local APIs          │
└─────────────────────────┘   └─────────────────────────┘
```

### Task Routing Strategies

#### 1. **Affinity-Based Routing** (Data Locality)
```typescript
// Route tasks to region where data lives
const task = {
  taskId: 'task-123',
  handler: { type: 'http-request' },
  routing: {
    region: 'eu-west-1',  // Force EU region
    reason: 'data-residency'
  }
};

// Engine publishes to region-specific queue
await queueService.publish(
  `flowmonkey:tasks:http:${task.routing.region}`,
  task
);
```

**Use Cases:**
- GDPR compliance (EU data stays in EU)
- Low-latency access to regional APIs
- Cost optimization (avoid cross-region data transfer)

#### 2. **Least-Latency Routing**
```typescript
// Route to region with lowest queue depth
const queueDepths = await Promise.all([
  redis.llen('flowmonkey:tasks:http:us-east-1'),
  redis.llen('flowmonkey:tasks:http:eu-west-1'),
  redis.llen('flowmonkey:tasks:http:ap-south-1')
]);

const bestRegion = regions[queueDepths.indexOf(Math.min(...queueDepths))];

await queueService.publish(
  `flowmonkey:tasks:http:${bestRegion}`,
  task
);
```

#### 3. **Failover Routing**
```typescript
// Try primary region, fallback to others
try {
  await queueService.publish(
    `flowmonkey:tasks:http:${primaryRegion}`,
    task,
    { timeout: 5000 }
  );
} catch (error) {
  // Primary region unavailable, try fallback
  await queueService.publish(
    `flowmonkey:tasks:http:${fallbackRegion}`,
    task
  );
}
```

### Data Consistency Challenges

**Challenge 1: Result Publishing Across Regions**
```typescript
// Worker in eu-west-1 completes task
const result = { taskId: 'task-123', output: { ... } };

// Option A: Publish to global result queue (higher latency)
await redis.global.publish('flowmonkey:results', result);

// Option B: Write directly to Postgres (cross-region write)
await postgres.primary.query(
  'UPDATE fm_executions SET ... WHERE id = $1',
  [result.executionId]
);

// Option C: Hybrid (fast ack + eventual consistency)
await redis.regional.publish('flowmonkey:results:eu-west-1', result);
// Background job syncs to primary region
```

**Recommendation:** **Option C** with eventual consistency window of <1s

**Challenge 2: Context Updates Across Regions**
```typescript
// Execution started in us-east-1, handler runs in eu-west-1
// Context updates must be visible to next step

// Solution: Context Service with regional caches
class ContextService {
  async patch(executionId: string, updates: object) {
    // Write to primary
    await this.primary.patch(executionId, updates);
    
    // Invalidate regional caches
    await this.invalidateCache(executionId);
    
    // Publish update event
    await this.eventBus.publish({
      type: 'context.updated',
      executionId,
      updates
    });
  }
  
  async get(executionId: string): Promise<Context> {
    // Try regional cache first
    const cached = await this.regional.get(executionId);
    if (cached) return cached;
    
    // Fallback to primary
    const context = await this.primary.get(executionId);
    
    // Cache in regional store
    await this.regional.set(executionId, context, { ttl: 60 });
    
    return context;
  }
}
```

---

## Implementation Phases

### Phase 0: Foundation (Current State)
**Status:** ✅ Complete  
**Timeline:** Done

- [x] In-process handler execution
- [x] Trusted handlers only
- [x] Single-region deployment
- [x] Postgres state store
- [x] Basic job system

---

### Phase 1: Task Queue System (Months 1-2)
**Goal:** Decouple handler execution from engine via queues

**Deliverables:**
1. **Task Queue Interface**
   ```typescript
   interface TaskQueue {
     publish(queue: string, task: Task): Promise<void>;
     subscribe(queue: string, handler: TaskHandler): Promise<void>;
     ack(taskId: string): Promise<void>;
     nack(taskId: string, requeue: boolean): Promise<void>;
   }
   ```

2. **Redis Queue Implementation**
   - Using Redis Lists (LPUSH/BRPOP) for simplicity
   - One queue per handler type
   - Reliable queue pattern (backup list for requeue)

3. **Engine Task Dispatcher**
   ```typescript
   class TaskDispatcher {
     async dispatch(execution: Execution, step: Step): Promise<void> {
       const task = this.buildTask(execution, step);
       const queue = this.getQueueForHandler(step.type);
       await this.taskQueue.publish(queue, task);
       
       // Update execution status
       execution.status = 'waiting_for_worker';
       await this.store.save(execution);
     }
   }
   ```

4. **Basic Worker Runtime**
   ```typescript
   class WorkerRuntime {
     async start() {
       const queue = `flowmonkey:tasks:${this.handlerType}`;
       
       await this.taskQueue.subscribe(queue, async (task) => {
         try {
           const result = await this.executeTask(task);
           await this.resultQueue.publish('flowmonkey:results', result);
           await this.taskQueue.ack(task.taskId);
         } catch (error) {
           await this.taskQueue.nack(task.taskId, true);
         }
       });
     }
   }
   ```

5. **Result Collector**
   ```typescript
   class ResultCollector {
     async start() {
       await this.resultQueue.subscribe('flowmonkey:results', async (result) => {
         const execution = await this.store.get(result.executionId);
         
         // Update execution with result
         execution.context[result.outputKey] = result.output;
         execution.status = 'running';
         await this.store.save(execution);
         
         // Continue execution
         await this.engine.tick(execution.id);
       });
     }
   }
   ```

**Testing:**
- Local workers (same machine, different process)
- Fault injection (kill workers mid-task)
- Load testing (1000 concurrent tasks)

**Migration Strategy:**
- Keep in-process execution as fallback
- Opt-in per handler type
- Gradual rollout (10% → 50% → 100%)

---

### Phase 2: Docker Workers (Months 3-4)
**Goal:** Containerize workers for isolation and portability

**Deliverables:**
1. **Base Worker Image**
   ```dockerfile
   # flowmonkey/worker-base:1.0.0
   FROM node:20-alpine
   
   # Install runtime dependencies
   RUN apk add --no-cache tini
   
   # Create app directory
   WORKDIR /app
   
   # Copy worker runtime
   COPY packages/worker-runtime ./runtime
   RUN npm install --production
   
   # Plumbing libraries
   COPY packages/plumbing ./plumbing
   
   # Health check
   HEALTHCHECK --interval=30s --timeout=3s \
     CMD node /app/runtime/health-check.js
   
   # Use tini for proper signal handling
   ENTRYPOINT ["/sbin/tini", "--"]
   CMD ["node", "/app/runtime/worker.js"]
   ```

2. **Handler-Specific Images**
   ```dockerfile
   # flowmonkey/handler-http:1.0.0
   FROM flowmonkey/worker-base:1.0.0
   
   # Copy handler code
   COPY handlers/http ./handlers/http
   RUN cd ./handlers/http && npm install --production
   
   # Configure handler
   ENV HANDLER_TYPE=http-request
   ENV HANDLER_PATH=./handlers/http/index.js
   ```

3. **Container Orchestration**
   - Docker Compose for local development
   - Kubernetes manifests for production
   - Helm charts for configuration management

4. **Resource Limits**
   ```yaml
   # k8s/worker-http.yaml
   apiVersion: apps/v1
   kind: Deployment
   metadata:
     name: flowmonkey-worker-http
   spec:
     replicas: 5
     template:
       spec:
         containers:
         - name: worker
           image: flowmonkey/handler-http:1.0.0
           resources:
             requests:
               cpu: 250m
               memory: 256Mi
             limits:
               cpu: 500m
               memory: 512Mi
           env:
           - name: REDIS_URL
             valueFrom:
               secretKeyRef:
                 name: flowmonkey-redis
                 key: url
   ```

**Testing:**
- Local Docker Compose setup
- Kind cluster for K8s testing
- Resource limit validation
- Crash recovery testing

---

### Phase 3: Plumbing APIs (Months 5-6)
**Goal:** Implement Context, Vault, Checkpoint, Progress APIs

**Deliverables:**
1. **Context Service**
   ```typescript
   @Injectable()
   class ContextService {
     async get(executionId: string): Promise<Context>;
     async patch(executionId: string, updates: object): Promise<void>;
     async set(executionId: string, path: string, value: any): Promise<void>;
   }
   ```

2. **Vault Service**
   ```typescript
   @Injectable()
   class VaultService {
     async getSecrets(
       keys: string[],
       scope: { executionId: string; tenantId: string }
     ): Promise<Record<string, string>>;
     
     async encrypt(
       secrets: Record<string, string>,
       workerPublicKey: string
     ): Promise<Record<string, string>>;
   }
   ```

3. **Checkpoint Service**
   ```typescript
   @Injectable()
   class CheckpointService {
     async save(
       executionId: string,
       taskId: string,
       workerId: string,
       data: any
     ): Promise<string>;  // Returns checkpoint ID
     
     async load(taskId: string): Promise<any | null>;
     async clear(taskId: string): Promise<void>;
   }
   ```

4. **Progress Service**
   ```typescript
   @Injectable()
   class ProgressService {
     async update(
       executionId: string,
       stepId: string,
       progress: { percent: number; message?: string }
     ): Promise<void>;
     
     async subscribe(executionId: string): AsyncIterator<ProgressUpdate>;
   }
   ```

5. **Worker Plumbing SDK**
   ```typescript
   // Injected into worker runtime
   const plumbing = {
     context: new ContextClient(task.contextUrl, task.contextToken),
     vault: new VaultClient(task.vaultSecrets),
     checkpoint: new CheckpointClient(task.checkpointUrl, task.taskId),
     progress: new ProgressClient(task.progressUrl, task.executionId),
     events: new EventClient(task.eventUrl, task.executionId)
   };
   
   // Handlers use plumbing transparently
   await handler.execute({ ...params, plumbing });
   ```

**Testing:**
- API endpoint tests
- Worker integration tests
- Large context handling (>1MB)
- Secret encryption/decryption
- Checkpoint save/load/resume

---

### Phase 4: Multi-Region (Months 7-9)
**Goal:** Deploy workers in multiple regions

**Deliverables:**
1. **Region-Specific Queues**
   ```typescript
   const queues = {
     'us-east-1': 'flowmonkey:tasks:http:us-east-1',
     'eu-west-1': 'flowmonkey:tasks:http:eu-west-1',
     'ap-south-1': 'flowmonkey:tasks:http:ap-south-1'
   };
   ```

2. **Task Router**
   ```typescript
   class TaskRouter {
     route(task: Task, strategy: RoutingStrategy): string {
       switch (strategy) {
         case 'affinity':
           return task.metadata.region || this.defaultRegion;
         case 'least-latency':
           return this.findLeastBusyRegion(task.handler.type);
         case 'failover':
           return this.findHealthyRegion(task.handler.type);
       }
     }
   }
   ```

3. **Regional Deployments**
   - Workers deployed in 3 regions
   - Redis in each region
   - Postgres read replicas
   - Cross-region replication monitoring

4. **Data Locality Rules**
   ```typescript
   const dataResidencyRules = {
     'gdpr': ['eu-west-1'],  // EU data must stay in EU
     'india': ['ap-south-1'], // India data must stay in India
     'default': ['us-east-1', 'eu-west-1', 'ap-south-1']
   };
   ```

**Testing:**
- Cross-region latency benchmarks
- Failover scenarios (region outage)
- Data residency compliance
- Cost analysis (cross-region data transfer)

---

### Phase 5: Auto-Scaling & Optimization (Months 10-12)
**Goal:** Production-ready scaling and cost optimization

**Deliverables:**
1. **Auto-Scaling Based on Queue Depth**
   ```yaml
   apiVersion: autoscaling/v2
   kind: HorizontalPodAutoscaler
   metadata:
     name: flowmonkey-worker-http
   spec:
     scaleTargetRef:
       apiVersion: apps/v1
       kind: Deployment
       name: flowmonkey-worker-http
     minReplicas: 2
     maxReplicas: 50
     metrics:
     - type: External
       external:
         metric:
           name: redis_queue_depth
           selector:
             matchLabels:
               queue: flowmonkey:tasks:http
         target:
           type: AverageValue
           averageValue: "5"  # Target 5 tasks per worker
   ```

2. **Spot Instance Support** (for burst workloads)
   ```yaml
   nodeSelector:
     workload: spot-instance
   tolerations:
   - key: "spot"
     operator: "Equal"
     value: "true"
     effect: "NoSchedule"
   ```

3. **Worker Warm Pools** (reduce cold start)
   ```typescript
   class WorkerPool {
     private warmWorkers: Worker[] = [];
     
     async ensureWarmWorkers(handlerType: string, count: number) {
       // Keep N workers pre-started
       while (this.warmWorkers.length < count) {
         const worker = await this.startWorker(handlerType);
         this.warmWorkers.push(worker);
       }
     }
   }
   ```

4. **Cost Optimization**
   - Rightsizing: Analyze actual CPU/memory usage
   - Reserved instances for baseline load
   - Spot instances for burst traffic
   - Regional cost comparison
   - Idle worker shutdown (scale to zero)

5. **Observability**
   - Prometheus metrics (queue depth, worker utilization, task duration)
   - Grafana dashboards
   - Alert rules (queue backup, worker crashes, timeout spikes)
   - Distributed tracing (OpenTelemetry)

**Testing:**
- Load testing (10K concurrent tasks)
- Chaos engineering (kill random workers)
- Cost simulation (estimate monthly costs)
- Autoscaler validation

---

## Technical Challenges

### Challenge 1: Large Context Serialization
**Problem:** Context can exceed 10MB, making task messages huge

**Solutions:**
1. **Context Compression** (quick win)
   ```typescript
   const compressed = gzip(JSON.stringify(context));
   // ~70% size reduction
   ```

2. **Context Streaming** (Phase 3)
   ```typescript
   // Engine uploads context to S3
   const contextUrl = await s3.upload(context);
   
   // Worker downloads context
   const context = await fetch(contextUrl).then(r => r.json());
   ```

3. **Lazy Context Loading** (advanced)
   ```typescript
   // Worker only loads context keys it needs
   const context = new LazyContext(contextUrl);
   const userId = await context.get('user.id');  // Fetches only 'user' subtree
   ```

**Recommendation:** Start with compression, add streaming if contexts exceed 5MB

---

### Challenge 2: Task Ordering & Dependencies
**Problem:** Some flows require sequential execution (step B needs step A result)

**Solution:** Engine already handles this
```typescript
// Engine dispatches tasks sequentially
await engine.tick(executionId);  // Executes one step
// Wait for result
// Then dispatch next step
await engine.tick(executionId);  // Executes next step
```

**No changes needed** - workers are stateless, engine maintains order

---

### Challenge 3: Worker Health & Stale Tasks
**Problem:** Workers crash mid-task, tasks stuck in queue

**Solutions:**
1. **Reliable Queue Pattern**
   ```typescript
   // Worker moves task to processing queue
   await redis.rpoplpush('flowmonkey:tasks:http', 'flowmonkey:processing:http');
   
   // On success, remove from processing
   await redis.lrem('flowmonkey:processing:http', 1, task);
   
   // Reaper reclaims stale tasks (no heartbeat for 60s)
   setInterval(async () => {
     const staleTasks = await redis.lrange('flowmonkey:processing:http', 0, -1);
     for (const task of staleTasks) {
       if (isStale(task)) {
         await redis.lpush('flowmonkey:tasks:http', task);  // Re-queue
       }
     }
   }, 30000);
   ```

2. **Heartbeat System** (stateful handlers)
   ```typescript
   // Worker sends heartbeat every 30s
   setInterval(async () => {
     await redis.setex(`heartbeat:${taskId}`, 60, Date.now());
   }, 30000);
   
   // Reaper checks heartbeats
   const lastHeartbeat = await redis.get(`heartbeat:${taskId}`);
   if (!lastHeartbeat || Date.now() - lastHeartbeat > 60000) {
     // Task is stale, re-queue
   }
   ```

---

### Challenge 4: Secret Management Across Regions
**Problem:** Vault secrets need to be available in all regions

**Solutions:**
1. **Centralized Vault** (simple)
   - All workers call central vault API
   - Pros: Simple, consistent
   - Cons: Latency, single point of failure

2. **Regional Vault Replicas** (scalable)
   - Vault replicated to each region
   - Pros: Low latency, fault tolerant
   - Cons: Replication complexity

3. **Secrets in Task** (recommended for Phase 1)
   - Engine fetches secrets, includes in task (encrypted)
   - Pros: No API calls from worker, fast
   - Cons: Secrets in message (mitigated by encryption)

**Recommendation:** **Option 3** for Phase 1, migrate to **Option 2** for multi-region

---

### Challenge 5: Debugging Distributed Workers
**Problem:** Hard to debug tasks running in remote containers

**Solutions:**
1. **Structured Logging**
   ```typescript
   logger.info('Handler started', {
     executionId: task.executionId,
     stepId: task.stepId,
     workerId: process.env.WORKER_ID,
     region: process.env.REGION
   });
   ```

2. **Distributed Tracing** (OpenTelemetry)
   ```typescript
   const span = tracer.startSpan('execute-handler', {
     attributes: {
       'execution.id': task.executionId,
       'handler.type': task.handler.type
     }
   });
   
   await handler.execute(task);
   span.end();
   ```

3. **Remote Debugging** (dev only)
   ```bash
   # Forward worker debug port
   kubectl port-forward pod/flowmonkey-worker-http-abc123 9229:9229
   
   # Attach debugger
   node --inspect-brk=9229
   ```

4. **Replay System** (production debugging)
   ```typescript
   // Save task payload on failure
   await s3.upload(`debug/failed-tasks/${taskId}.json`, task);
   
   // Replay locally
   const task = await s3.download(`debug/failed-tasks/${taskId}.json`);
   await worker.executeTask(task);  // Step through with debugger
   ```

---

## Cost Analysis

### Current State (In-Process)
```
Infrastructure:
- 3x c5.2xlarge (8 vCPU, 16 GB) = $306/month each
- Total: $918/month

Handles ~10,000 executions/day
Cost per execution: $0.003
```

### Target State (Distributed Workers)
```
Control Plane:
- 2x c5.xlarge (4 vCPU, 8 GB) = $153/month each
- Postgres RDS db.r5.large = $216/month
- Redis ElastiCache cache.r5.large = $180/month
- Subtotal: $702/month

Worker Pools (per handler type):
- 5x t3.medium (2 vCPU, 4 GB) = $30/month each
- 3 handler types = 15 workers = $450/month
- Auto-scaling headroom (+50%) = $675/month

Total: $1,377/month

Handles ~50,000 executions/day (5x scale)
Cost per execution: $0.0009

SAVINGS: 70% cost per execution
        5x throughput capacity
```

**Cost Drivers:**
- More workers = higher baseline cost
- Better utilization = lower per-execution cost
- Auto-scaling = pay for what you use
- Spot instances = 60-70% savings on burst workers

---

## Migration Checklist

### Pre-Migration
- [ ] Review current handler implementations
- [ ] Identify handlers that need secrets
- [ ] Identify stateful handlers (long-running)
- [ ] Measure current throughput and latency
- [ ] Document SLAs and performance requirements

### Phase 1 (Task Queue)
- [ ] Implement TaskQueue interface
- [ ] Create Redis queue implementation
- [ ] Build TaskDispatcher in engine
- [ ] Build ResultCollector in engine
- [ ] Create basic worker runtime
- [ ] Test with one handler type
- [ ] Monitor queue metrics
- [ ] Load test (1000 concurrent tasks)

### Phase 2 (Docker Workers)
- [ ] Create base worker Docker image
- [ ] Build handler-specific images
- [ ] Set up Docker Compose for local dev
- [ ] Deploy to Kubernetes cluster
- [ ] Configure resource limits
- [ ] Test worker crash recovery
- [ ] Validate health checks

### Phase 3 (Plumbing APIs)
- [ ] Implement Context Service
- [ ] Implement Vault Service
- [ ] Implement Checkpoint Service
- [ ] Implement Progress Service
- [ ] Create worker plumbing SDK
- [ ] Test large context handling
- [ ] Test secret encryption
- [ ] Test checkpoint save/resume

### Phase 4 (Multi-Region)
- [ ] Deploy workers in 3 regions
- [ ] Set up regional Redis
- [ ] Configure Postgres replication
- [ ] Implement task routing
- [ ] Test cross-region latency
- [ ] Validate data residency
- [ ] Test region failover

### Phase 5 (Production)
- [ ] Configure auto-scaling
- [ ] Set up monitoring and alerts
- [ ] Implement cost tracking
- [ ] Run chaos tests
- [ ] Document operations playbook
- [ ] Train team on debugging
- [ ] Go live! 🚀

---

## Conclusion

This distributed worker architecture transforms FlowMonkey from a **monolithic execution engine** into a **scalable, secure, multi-region platform** ready for:

- ✅ **Marketplace handlers** (untrusted community code)
- ✅ **Global deployment** (run handlers where data lives)
- ✅ **Horizontal scaling** (independent worker pools)
- ✅ **Cost optimization** (pay per use, spot instances)
- ✅ **Enterprise security** (complete isolation)

**Timeline:** 12 months from foundation to production  
**Team Size:** 2-3 engineers  
**Risk Level:** Medium (proven patterns, incremental migration)

**Next Steps:**
1. Review and approve architecture
2. Prioritize phases (can skip Phase 4 if single-region is sufficient)
3. Assign engineering resources
4. Start Phase 1 implementation (task queue system)

---

**Document Status:** Architecture Proposal  
**Last Updated:** February 3, 2026  
**Author:** FlowMonkey Architecture Team
