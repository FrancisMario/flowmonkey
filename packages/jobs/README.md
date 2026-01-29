# @flowmonkey/jobs

Background job runner for FlowMonkey stateful handlers.

This package provides a job processing system for executing long-running, stateful handlers in the background with checkpointing, retries, and failure handling.

## Table of Contents

- [Installation](#installation)
- [Overview](#overview)
- [BasicJobRunner](#basicjobrunner)
  - [Configuration](#configuration)
  - [Registering Handlers](#registering-handlers)
  - [Starting and Stopping](#starting-and-stopping)
- [Job Lifecycle](#job-lifecycle)
- [JobScheduler](#jobscheduler)
- [JobReaper](#jobreaper)
- [Stateful Handlers Integration](#stateful-handlers-integration)
- [Monitoring](#monitoring)
- [API Reference](#api-reference)

## Installation

```bash
pnpm add @flowmonkey/jobs
```

## Overview

When a stateful handler returns a `wait` result, the engine creates a job record. The job runner picks up these jobs, executes the handler, and manages the job lifecycle (retries, heartbeats, completion).

The job system consists of three components:

- **BasicJobRunner** - Polls for and processes jobs
- **JobScheduler** - Creates delayed and scheduled jobs
- **JobReaper** - Cleans up stalled and abandoned jobs

```
+------------------+     +----------------+     +------------------+
|  Stateful        |     |    JobStore    |     |   BasicJobRunner |
|  Handler         | --> |  (PostgreSQL)  | <-- |   (Worker)       |
+------------------+     +----------------+     +------------------+
        |                        |                       |
        | creates job            | persists              | claims & processes
        | record                 | job state             | jobs
        v                        v                       v
   wait result            pending -> running        complete/fail
```

## BasicJobRunner

The job runner polls for pending jobs and processes them.

### Configuration

```typescript
import { BasicJobRunner } from '@flowmonkey/jobs';
import { PgJobStore, PgExecutionStore } from '@flowmonkey/postgres';

const jobStore = new PgJobStore(pool);
const executionStore = new PgExecutionStore(pool);

const runner = new BasicJobRunner(jobStore, executionStore, 'worker-1', {
  pollInterval: 1000,      // Check for jobs every 1 second
  batchSize: 10,           // Claim up to 10 jobs at once
  maxConcurrent: 5,        // Process up to 5 jobs concurrently
  heartbeatInterval: 10000, // Send heartbeat every 10 seconds
});
```

Configuration options:

| Option | Default | Description |
|--------|---------|-------------|
| `pollInterval` | `1000` | Milliseconds between polling for new jobs |
| `batchSize` | `10` | Maximum jobs to claim per poll |
| `maxConcurrent` | `5` | Maximum concurrent job executions |
| `heartbeatInterval` | `10000` | Milliseconds between heartbeat updates |

### Registering Handlers

Register handlers that process specific job types:

```typescript
import { emailHandler, reportHandler } from './handlers';

// Register handlers by type
runner.registerHandler('email-send', emailHandler);
runner.registerHandler('report-generate', reportHandler);

// Or register multiple at once
runner.registerHandlers({
  'email-send': emailHandler,
  'report-generate': reportHandler,
  'data-export': exportHandler,
});
```

The handler type must match the `handler` field in the job record, which typically corresponds to the step type that created the job.

### Starting and Stopping

```typescript
// Start processing jobs
await runner.start();
console.log('Job runner started');

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('Shutting down...');
  await runner.stop();
  console.log('Job runner stopped');
  process.exit(0);
});
```

The `stop()` method:
1. Stops accepting new jobs
2. Waits for current jobs to complete (with timeout)
3. Releases any uncompleted jobs back to pending

## Job Lifecycle

Jobs progress through these states:

```
pending -> running -> completed
                  \-> failed
```

### Pending

When a stateful handler returns `wait`, the engine creates a pending job:

```typescript
// Handler returns wait, engine creates job
return Result.wait({
  wakeAt: Date.now() + 3600000,
  reason: 'Waiting for external process',
});

// Job is created:
{
  id: 'job-123',
  executionId: 'exec-456',
  stepId: 'process-data',
  handler: 'data-processor',
  status: 'pending',
  input: { ... },
  attempts: 0,
  maxAttempts: 3,
}
```

### Running

When a worker claims a job:

1. Job status changes to `running`
2. `runner_id` is set to the worker ID
3. `heartbeat_at` is updated periodically
4. `attempts` is incremented

### Completed

When the handler succeeds:

```typescript
{
  status: 'completed',
  result: { ... },  // Handler output
}
```

### Failed

When the handler fails after all retry attempts:

```typescript
{
  status: 'failed',
  error: {
    code: 'PROCESS_ERROR',
    message: 'Failed after 3 attempts',
  },
}
```

## JobScheduler

Create jobs for future execution:

```typescript
import { JobScheduler } from '@flowmonkey/jobs';

const scheduler = new JobScheduler(jobStore);

// Schedule a job for later
await scheduler.schedule({
  executionId: 'exec-123',
  stepId: 'send-reminder',
  handler: 'email-send',
  input: { to: 'user@example.com', template: 'reminder' },
  runAt: Date.now() + 24 * 60 * 60 * 1000, // 24 hours from now
});

// Schedule a recurring job
await scheduler.scheduleRecurring({
  executionId: 'exec-123',
  stepId: 'daily-check',
  handler: 'status-check',
  input: { checkType: 'daily' },
  cron: '0 9 * * *', // Daily at 9am
  timezone: 'America/New_York',
});
```

## JobReaper

Clean up jobs that are stuck or abandoned:

```typescript
import { JobReaper } from '@flowmonkey/jobs';

const reaper = new JobReaper(jobStore, {
  stalledThreshold: 60000,    // Jobs without heartbeat for 60s
  maxReapBatch: 100,          // Process up to 100 stalled jobs at once
  reapInterval: 30000,        // Check every 30 seconds
});

// Start the reaper
await reaper.start();

// Stop gracefully
await reaper.stop();
```

The reaper:
1. Finds jobs in `running` status with old heartbeats
2. Increments their attempt count
3. If attempts < maxAttempts, sets status back to `pending` for retry
4. If attempts >= maxAttempts, marks as `failed`

## Stateful Handlers Integration

Stateful handlers work with the job system for long-running operations. They have access to all the same decorators (`@Handler`, `@Input`, validation decorators) as stateless handlers, plus checkpoint methods. The key difference is the lifecycle - stateful handlers can pause with `wait()` and resume later.

### Creating a Stateful Handler

```typescript
import { Handler, Input, StatefulHandler } from '@flowmonkey/core';
import type { StepResult } from '@flowmonkey/core';

interface ProcessingCheckpoint {
  currentIndex: number;
  processedCount: number;
  errors: string[];
}

@Handler({
  type: 'batch-processor',
  name: 'Batch Processor',
  description: 'Process items with checkpointing',
  category: 'data',
  stateful: true, // Marks handler as stateful
})
export class BatchProcessor extends StatefulHandler<
  BatchInput,
  ProcessingCheckpoint,
  BatchOutput
> {
  @Input({ type: 'array', source: 'config', required: true })
  items!: unknown[];

  @Input({ type: 'number', source: 'config', defaultValue: 10 })
  batchSize!: number;

  async execute(): Promise<StepResult> {
    // Load or initialize checkpoint
    const checkpoint = await this.loadCheckpoint() ?? {
      currentIndex: 0,
      processedCount: 0,
      errors: [],
    };

    // Process a batch
    const endIndex = Math.min(
      checkpoint.currentIndex + this.batchSize,
      this.items.length
    );

    for (let i = checkpoint.currentIndex; i < endIndex; i++) {
      try {
        await this.processItem(this.items[i]);
        checkpoint.processedCount++;
      } catch (error) {
        checkpoint.errors.push(`Item ${i}: ${error.message}`);
      }
      checkpoint.currentIndex = i + 1;
    }

    // More items to process?
    if (checkpoint.currentIndex < this.items.length) {
      await this.saveCheckpoint(checkpoint);
      
      return this.wait({
        wakeAt: Date.now() + 100, // Continue immediately
        reason: `Processed ${checkpoint.processedCount}/${this.items.length}`,
      });
    }

    // All done
    return this.success({
      totalProcessed: checkpoint.processedCount,
      errors: checkpoint.errors,
    });
  }

  private async processItem(item: unknown): Promise<void> {
    // Processing logic
  }
}
```

### Handler Lifecycle with Jobs

1. **First Call**: Handler starts processing, saves checkpoint, returns `wait`
2. **Job Created**: Engine creates job record with handler input
3. **Job Claimed**: Runner picks up job, initializes handler
4. **Handler Resumes**: Handler loads checkpoint, continues processing
5. **Loop**: Steps 2-4 repeat until handler returns `success` or `failure`
6. **Completion**: Job marked complete, execution continues

### Checkpoint Storage

Checkpoints are stored in the execution context:

```typescript
// Save checkpoint
await this.saveCheckpoint({ progress: 50 });
// Stored at: execution.context.__checkpoints[stepId]

// Load checkpoint
const checkpoint = await this.loadCheckpoint();
// Retrieved from: execution.context.__checkpoints[stepId]
```

## Monitoring

### Job Metrics

```typescript
import { JobMetrics } from '@flowmonkey/jobs';

const metrics = new JobMetrics(jobStore);

// Get current metrics
const stats = await metrics.getStats();
console.log(stats);
// {
//   pending: 15,
//   running: 3,
//   completed: 1250,
//   failed: 12,
//   avgProcessingTime: 2500,
// }

// Get metrics by handler type
const handlerStats = await metrics.getStatsByHandler();
// {
//   'email-send': { pending: 10, completed: 800 },
//   'data-export': { pending: 5, completed: 450 },
// }
```

### Runner Events

```typescript
runner.on('jobStarted', (job) => {
  console.log(`Started job ${job.id} for handler ${job.handler}`);
});

runner.on('jobCompleted', (job, result) => {
  console.log(`Completed job ${job.id}:`, result);
});

runner.on('jobFailed', (job, error) => {
  console.error(`Failed job ${job.id}:`, error);
  alerting.notify(`Job failed: ${job.handler}`, error);
});

runner.on('jobRetry', (job, attempt) => {
  console.log(`Retrying job ${job.id}, attempt ${attempt}`);
});
```

### Health Check

```typescript
async function checkJobRunnerHealth(): Promise<HealthStatus> {
  const stats = await metrics.getStats();
  
  const healthy = 
    stats.pending < 1000 && // Not too many pending
    (stats.running / runner.maxConcurrent) < 0.9; // Not at capacity
  
  return {
    healthy,
    stats,
    runner: {
      id: runner.id,
      running: runner.isRunning,
      activeJobs: runner.activeJobCount,
    },
  };
}
```

## API Reference

### BasicJobRunner

```typescript
class BasicJobRunner {
  constructor(
    jobStore: JobStore,
    executionStore: StateStore,
    runnerId: string,
    options?: JobRunnerOptions
  );

  // Register a handler
  registerHandler(type: string, handler: StepHandler): void;
  
  // Register multiple handlers
  registerHandlers(handlers: Record<string, StepHandler>): void;

  // Start processing
  start(): Promise<void>;
  
  // Stop processing (graceful)
  stop(): Promise<void>;

  // Check if running
  readonly isRunning: boolean;
  
  // Number of active jobs
  readonly activeJobCount: number;
  
  // Runner ID
  readonly id: string;

  // Event emitter methods
  on(event: 'jobStarted' | 'jobCompleted' | 'jobFailed' | 'jobRetry', handler: Function): void;
}

interface JobRunnerOptions {
  pollInterval?: number;      // Default: 1000
  batchSize?: number;         // Default: 10
  maxConcurrent?: number;     // Default: 5
  heartbeatInterval?: number; // Default: 10000
}
```

### JobScheduler

```typescript
class JobScheduler {
  constructor(jobStore: JobStore);

  // Schedule a job for later execution
  schedule(job: ScheduledJob): Promise<string>;

  // Schedule a recurring job
  scheduleRecurring(job: RecurringJob): Promise<string>;

  // Cancel a scheduled job
  cancel(jobId: string): Promise<boolean>;
}

interface ScheduledJob {
  executionId: string;
  stepId: string;
  handler: string;
  input: unknown;
  runAt: number;
  maxAttempts?: number;
}

interface RecurringJob {
  executionId: string;
  stepId: string;
  handler: string;
  input: unknown;
  cron: string;
  timezone?: string;
  maxAttempts?: number;
}
```

### JobReaper

```typescript
class JobReaper {
  constructor(jobStore: JobStore, options?: ReaperOptions);

  // Start the reaper
  start(): Promise<void>;
  
  // Stop the reaper
  stop(): Promise<void>;

  // Manually trigger a reap cycle
  reap(): Promise<number>;
}

interface ReaperOptions {
  stalledThreshold?: number;  // Default: 60000
  maxReapBatch?: number;      // Default: 100
  reapInterval?: number;      // Default: 30000
}
```

### JobMetrics

```typescript
class JobMetrics {
  constructor(jobStore: JobStore);

  // Get overall statistics
  getStats(): Promise<JobStats>;

  // Get statistics by handler type
  getStatsByHandler(): Promise<Record<string, JobStats>>;
}

interface JobStats {
  pending: number;
  running: number;
  completed: number;
  failed: number;
  avgProcessingTime?: number;
}
```

## License

MIT
