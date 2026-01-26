# @flowmonkey/jobs

Background job runner for FlowMonkey stateful handlers.

## Installation

```bash
pnpm add @flowmonkey/jobs
```

## Overview

This package provides a job runner for executing long-running, stateful handlers in the background:

- **BasicJobRunner** — Polling-based job processor
- **JobScheduler** — Delayed and scheduled job creation
- **JobReaper** — Cleanup of stalled/abandoned jobs

## Quick Start

```typescript
import { BasicJobRunner } from '@flowmonkey/jobs';
import { PgJobStore, PgExecutionStore } from '@flowmonkey/postgres';
import { emailHandler, reportHandler } from './handlers';

// Create stores
const jobStore = new PgJobStore(pool);
const execStore = new PgExecutionStore(pool);

// Create runner
const runner = new BasicJobRunner(jobStore, execStore, 'worker-1');

// Register handlers
runner.registerHandler('email-send', emailHandler);
runner.registerHandler('report-generate', reportHandler);

// Start processing
await runner.start();

// Graceful shutdown
process.on('SIGTERM', async () => {
  await runner.stop();
});
```

## Stateful Handlers

Stateful handlers create jobs for background processing:

```typescript
import type { StepHandler } from '@flowmonkey/core';
import { Result } from '@flowmonkey/core';

export const emailHandler: StepHandler = {
  type: 'email-send',
  metadata: {
    type: 'email-send',
    name: 'Send Email',
    description: 'Send email via provider',
    category: 'external',
    stateful: true,  // Mark as stateful
    configSchema: {},
  },
  async execute({ input, execution, step }) {
    // Handler creates a job and returns wait
    // Job runner will call this again with job context
    
    const { to, subject, body } = input as EmailInput;
    
    // Actually send the email
    await sendEmail({ to, subject, body });
    
    return Result.success({
      sent: true,
      timestamp: Date.now(),
    });
  },
};
```

## BasicJobRunner

### Configuration

```typescript
const runner = new BasicJobRunner(jobStore, execStore, runnerId, {
  pollInterval: 1000,    // Check for jobs every 1s
  batchSize: 10,         // Process up to 10 jobs at once
  maxConcurrent: 5,      // Max concurrent job executions
  heartbeatInterval: 10000, // Heartbeat every 10s
});
```

### API

```typescript
interface JobRunner {
  // Start processing jobs
  start(): Promise<void>;
  
  // Stop gracefully (waits for active jobs)
  stop(): Promise<void>;
  
  // Register a handler
  registerHandler(name: string, handler: StepHandler): void;
  
  // Stats
  activeCount(): number;
  completedCount(): number;
  failedCount(): number;
}
```

### Lifecycle

```
┌──────────┐     ┌──────────┐     ┌───────────┐     ┌───────────┐
│ PENDING  │────▶│ RUNNING  │────▶│ COMPLETED │     │  FAILED   │
└──────────┘     └──────────┘     └───────────┘     └───────────┘
     │                │                                   ▲
     │                │ (error/timeout)                   │
     │                └───────────────────────────────────┘
     │                         │
     │                         ▼ (retry if attempts < max)
     └─────────────────────────┘
```

## JobScheduler

Schedule jobs for future execution:

```typescript
import { JobScheduler } from '@flowmonkey/jobs';

const scheduler = new JobScheduler(jobStore);

// Schedule a job for later
await scheduler.schedule({
  executionId: 'exec-123',
  stepId: 'send-reminder',
  handler: 'email-send',
  input: { to: 'user@example.com', subject: 'Reminder' },
  runAt: Date.now() + 24 * 60 * 60 * 1000, // 24 hours from now
  maxAttempts: 3,
});

// Schedule recurring (cron-like)
await scheduler.scheduleRecurring({
  name: 'daily-digest',
  cron: '0 9 * * *',
  handler: 'digest-send',
  input: { type: 'daily' },
});
```

## JobReaper

Clean up stalled jobs:

```typescript
import { JobReaper } from '@flowmonkey/jobs';

const reaper = new JobReaper(jobStore, {
  stalledThreshold: 60000,  // Jobs with no heartbeat for 60s
  checkInterval: 30000,     // Check every 30s
  maxRetries: 3,
});

await reaper.start();

// On shutdown
await reaper.stop();
```

### Stalled Job Handling

Jobs are considered stalled when:
1. Status is `running`
2. Last heartbeat exceeds `stalledThreshold`

Stalled jobs are either:
- Reset to `pending` if `attempts < maxAttempts`
- Marked as `failed` if max attempts reached

## Job Store Interface

```typescript
interface JobStore {
  // Create a new job
  create(params: CreateJobParams): Promise<Job>;
  
  // Get job by ID
  get(id: string): Promise<Job | undefined>;
  
  // Claim a job for processing (atomic)
  claim(id: string, runnerId: string): Promise<boolean>;
  
  // Update heartbeat
  heartbeat(id: string): Promise<void>;
  
  // Complete job with result
  complete(id: string, result: unknown): Promise<void>;
  
  // Fail job with error
  fail(id: string, error: JobError): Promise<void>;
  
  // Query jobs
  listByStatus(status: JobStatus, limit: number): Promise<Job[]>;
  findStalled(since: number, limit: number): Promise<Job[]>;
  getByExecution(executionId: string): Promise<Job[]>;
  
  // Reset stalled job
  resetStalled(id: string): Promise<void>;
}

interface Job {
  id: string;
  executionId: string;
  stepId: string;
  handler: string;
  status: JobStatus;
  input: unknown;
  result?: unknown;
  error?: JobError;
  runnerId?: string;
  heartbeatAt?: number;
  heartbeatMs: number;
  attempts: number;
  maxAttempts: number;
  createdAt: number;
  updatedAt: number;
}

type JobStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
```

## Scaling Workers

Run multiple job runners for horizontal scaling:

```typescript
// worker-1.ts
const runner1 = new BasicJobRunner(jobStore, execStore, 'worker-1');
await runner1.start();

// worker-2.ts
const runner2 = new BasicJobRunner(jobStore, execStore, 'worker-2');
await runner2.start();
```

Jobs are claimed atomically, so multiple workers can safely poll the same queue.

## Best Practices

### 1. Idempotent Handlers

Make handlers idempotent for safe retries:

```typescript
async execute({ input, context }) {
  const idempotencyKey = `email-${input.to}-${input.messageId}`;
  
  // Check if already sent
  const sent = await checkSent(idempotencyKey);
  if (sent) {
    return Result.success({ alreadySent: true });
  }
  
  // Send and record
  await sendEmail(input);
  await recordSent(idempotencyKey);
  
  return Result.success({ sent: true });
}
```

### 2. Heartbeat for Long Jobs

For jobs that take > 30 seconds:

```typescript
async execute({ input }) {
  const items = input.items;
  
  for (const item of items) {
    await processItem(item);
    
    // Heartbeat to prevent stall detection
    await this.heartbeat?.();
  }
  
  return Result.success({ processed: items.length });
}
```

### 3. Graceful Shutdown

```typescript
let shuttingDown = false;

process.on('SIGTERM', async () => {
  shuttingDown = true;
  
  // Wait for current jobs to complete
  await runner.stop();
  
  await pool.end();
  process.exit(0);
});
```

### 4. Monitor Job Metrics

```typescript
setInterval(async () => {
  const pending = await jobStore.listByStatus('pending', 1000);
  const running = await jobStore.listByStatus('running', 1000);
  const failed = await jobStore.listByStatus('failed', 1000);
  
  metrics.gauge('jobs.pending', pending.length);
  metrics.gauge('jobs.running', running.length);
  metrics.gauge('jobs.failed', failed.length);
  metrics.gauge('jobs.completed', runner.completedCount());
}, 10000);
```

## License

MIT
