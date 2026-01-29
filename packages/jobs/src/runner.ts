import type {
  StepHandler,
  HandlerParams,
  CheckpointManager,
  EventBus,
  ContextHelpers,
} from '@flowmonkey/core';
import type { Job, JobStore } from '@flowmonkey/postgres';

/**
 * Job runner that executes stateful handlers.
 * Runs in a worker process/thread.
 */
export interface JobRunner {
  /** Start the runner (connect to job store, wait for jobs) */
  start(): Promise<void>;

  /** Stop the runner gracefully */
  stop(): Promise<void>;

  /** Register a handler by name */
  registerHandler(name: string, handler: StepHandler): void;

  /** Current number of active jobs */
  activeCount(): number;

  /** Total jobs completed */
  completedCount(): number;

  /** Total jobs failed */
  failedCount(): number;
}

export interface JobRunnerOptions {
  /** Job store for persistence */
  jobStore: JobStore;
  /** Execution store for loading executions */
  execStore: any; // StateStore
  /** Unique runner ID */
  runnerId?: string;
  /** Polling interval in ms */
  pollInterval?: number;
  /** Max concurrent jobs */
  concurrency?: number;
  /** Event bus for emitting events */
  eventBus?: EventBus;
  /** Heartbeat interval in ms */
  heartbeatInterval?: number;
}

/**
 * Create a CheckpointManager that validates instance ownership.
 */
function createCheckpointManager(
  jobStore: JobStore,
  jobId: string,
  instanceId: string,
  eventBus?: EventBus,
  executionId?: string,
  stepId?: string
): CheckpointManager {
  return {
    async save(key: string, data: unknown): Promise<void> {
      // Wrap in checkpoint envelope
      const checkpoint = { [key]: data };
      const success = await jobStore.saveCheckpoint(jobId, instanceId, checkpoint);
      if (!success) {
        throw new Error(`Instance ${instanceId} is no longer active for job ${jobId}`);
      }
      eventBus?.onJobCheckpoint?.({
        jobId,
        executionId: executionId ?? '',
        stepId: stepId ?? '',
        instanceId,
        checkpointKey: key,
      });
    },
    async restore<T = unknown>(key: string): Promise<T | null> {
      const checkpoint = await jobStore.getCheckpoint(jobId);
      if (!checkpoint || typeof checkpoint !== 'object') return null;
      return (checkpoint as Record<string, unknown>)[key] as T ?? null;
    },
    async list(): Promise<string[]> {
      const checkpoint = await jobStore.getCheckpoint(jobId);
      if (!checkpoint || typeof checkpoint !== 'object') return [];
      return Object.keys(checkpoint);
    },
    async delete(key: string): Promise<void> {
      const checkpoint = await jobStore.getCheckpoint(jobId);
      if (!checkpoint || typeof checkpoint !== 'object') return;
      delete (checkpoint as Record<string, unknown>)[key];
      await jobStore.saveCheckpoint(jobId, instanceId, checkpoint);
    },
    async clear(): Promise<void> {
      await jobStore.saveCheckpoint(jobId, instanceId, {});
    },
  };
}

/**
 * Enhanced job runner with checkpoint, progress, and event support.
 */
export class BasicJobRunner implements JobRunner {
  private running = false;
  private handlers = new Map<string, StepHandler>();
  private stats = { active: 0, completed: 0, failed: 0 };
  private abortControllers = new Map<string, AbortController>();
  private heartbeatTimers = new Map<string, ReturnType<typeof setInterval>>();

  private readonly jobStore: JobStore;
  private readonly execStore: any;
  private readonly runnerId: string;
  private readonly pollInterval: number;
  private readonly concurrency: number;
  private readonly eventBus?: EventBus;
  private readonly heartbeatInterval: number;

  constructor(options: JobRunnerOptions) {
    this.jobStore = options.jobStore;
    this.execStore = options.execStore;
    this.runnerId = options.runnerId ?? crypto.randomUUID();
    this.pollInterval = options.pollInterval ?? 1000;
    this.concurrency = options.concurrency ?? 5;
    this.eventBus = options.eventBus;
    this.heartbeatInterval = options.heartbeatInterval ?? 10000;
  }

  registerHandler(name: string, handler: StepHandler): void {
    this.handlers.set(name, handler);
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;

    while (this.running) {
      // Limit concurrency
      if (this.stats.active >= this.concurrency) {
        await new Promise(resolve => setTimeout(resolve, this.pollInterval));
        continue;
      }

      // Find pending jobs
      const jobs = await this.jobStore.listByStatus('pending', this.concurrency - this.stats.active);

      for (const job of jobs) {
        // Generate unique instance ID for this execution attempt
        const instanceId = crypto.randomUUID();

        // Try to claim with instance ID
        const claimed = await this.jobStore.claimWithInstance(job.id, this.runnerId, instanceId);
        if (!claimed) continue;

        this.stats.active++;

        // Emit job claimed event
        this.eventBus?.onJobClaimed?.({
          jobId: job.id,
          executionId: job.executionId,
          stepId: job.stepId,
          instanceId,
          runnerId: this.runnerId,
          handler: job.handler,
        });

        // Execute job (don't await - run concurrently)
        this.executeJob(job, instanceId).finally(() => {
          this.stats.active--;
          this.cleanupJob(job.id);
        });
      }

      // Also check for stalled jobs that need resetting
      const stalled = await this.jobStore.findStalled(Date.now(), 10);
      for (const stalledJob of stalled) {
        if (stalledJob.attempts < stalledJob.maxAttempts) {
          const oldInstanceId = stalledJob.instanceId;
          await this.jobStore.resetStalled(stalledJob.id);

          // Emit superseded event if there was a previous instance
          if (oldInstanceId) {
            this.eventBus?.onJobSuperseded?.({
              jobId: stalledJob.id,
              executionId: stalledJob.executionId,
              stepId: stalledJob.stepId,
              oldInstanceId,
              newInstanceId: '', // Will be set when reclaimed
            });
          }
        }
      }

      await new Promise(resolve => setTimeout(resolve, this.pollInterval));
    }
  }

  async stop(): Promise<void> {
    this.running = false;

    // Abort all running jobs
    for (const [, controller] of this.abortControllers) {
      controller.abort();
    }

    // Clear all heartbeat timers
    for (const [, timer] of this.heartbeatTimers) {
      clearInterval(timer);
    }

    // Wait for active jobs to finish (with timeout)
    const timeout = Date.now() + 30000;
    while (this.stats.active > 0 && Date.now() < timeout) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  activeCount(): number {
    return this.stats.active;
  }

  completedCount(): number {
    return this.stats.completed;
  }

  failedCount(): number {
    return this.stats.failed;
  }

  private cleanupJob(jobId: string): void {
    const timer = this.heartbeatTimers.get(jobId);
    if (timer) {
      clearInterval(timer);
      this.heartbeatTimers.delete(jobId);
    }
    this.abortControllers.delete(jobId);
  }

  private async executeJob(job: Job, instanceId: string): Promise<void> {
    const startTime = Date.now();

    // Set up abort controller
    const abortController = new AbortController();
    this.abortControllers.set(job.id, abortController);

    // Set up heartbeat
    const heartbeatTimer = setInterval(async () => {
      const active = await this.jobStore.isInstanceActive(job.id, instanceId);
      if (!active) {
        abortController.abort();
        return;
      }
      await this.jobStore.heartbeat(job.id, this.runnerId);
      this.eventBus?.onJobHeartbeat?.({
        jobId: job.id,
        executionId: job.executionId,
        stepId: job.stepId,
        instanceId,
      });
    }, this.heartbeatInterval);
    this.heartbeatTimers.set(job.id, heartbeatTimer);

    try {
      const handler = this.handlers.get(job.handler);
      if (!handler) {
        throw new Error(`No handler registered for type: ${job.handler}`);
      }

      const exec = await this.execStore.load(job.executionId);
      if (!exec) {
        throw new Error(`Execution ${job.executionId} not found`);
      }

      // Create checkpoint manager with instance validation
      const checkpoints = createCheckpointManager(
        this.jobStore,
        job.id,
        instanceId,
        this.eventBus,
        job.executionId,
        job.stepId
      );

      // Create context helpers
      const ctx = this.createContextHelpers(exec, job.id, instanceId);

      // Build handler params
      const params: HandlerParams = {
        input: job.input,
        step: {
          id: job.stepId,
          type: job.handler,
          config: {},
          input: { type: 'full' },
          transitions: { onSuccess: null },
        },
        context: exec.context ?? {},
        ctx,
        execution: exec,
        checkpoints,
        signal: abortController.signal,
      };

      // Execute handler
      const result = await handler.execute(params);

      // Complete job
      await this.jobStore.complete(job.id, this.runnerId, result);
      this.stats.completed++;

      // Emit completed event
      this.eventBus?.onJobCompleted?.({
        jobId: job.id,
        executionId: job.executionId,
        stepId: job.stepId,
        instanceId,
        durationMs: Date.now() - startTime,
        result,
      });
    } catch (error) {
      const jobError = {
        code: error instanceof Error && 'code' in error ? String((error as any).code) : 'EXECUTION_ERROR',
        message: String(error instanceof Error ? error.message : error),
        details: error instanceof Error ? error.stack : undefined,
      };

      const willRetry = job.attempts < job.maxAttempts;
      await this.jobStore.fail(job.id, this.runnerId, jobError);
      this.stats.failed++;

      // Emit failed event
      this.eventBus?.onJobFailed?.({
        jobId: job.id,
        executionId: job.executionId,
        stepId: job.stepId,
        instanceId,
        error: jobError,
        willRetry,
        attempt: job.attempts,
        maxAttempts: job.maxAttempts,
      });
    }
  }

  private createContextHelpers(exec: any, jobId: string, instanceId: string): ContextHelpers {
    // Note: In production, this should use PgContextStorage
    // For now, we use in-memory with instance validation
    return {
      get: async <T = unknown>(key: string): Promise<T> => {
        return exec.context[key] as T;
      },
      set: async (key: string, value: unknown): Promise<void> => {
        // Validate instance is still active before writing
        const active = await this.jobStore.isInstanceActive(jobId, instanceId);
        if (!active) {
          throw new Error(`Instance ${instanceId} is no longer active`);
        }
        exec.context[key] = value;
      },
      has: (key: string): boolean => {
        return key in exec.context;
      },
      delete: async (key: string): Promise<void> => {
        const active = await this.jobStore.isInstanceActive(jobId, instanceId);
        if (!active) {
          throw new Error(`Instance ${instanceId} is no longer active`);
        }
        delete exec.context[key];
      },
      getAll: async <T = Record<string, unknown>>(keys: string[]): Promise<T> => {
        const result: Record<string, unknown> = {};
        for (const key of keys) {
          result[key] = exec.context[key];
        }
        return result as T;
      },
    };
  }
}
