import type { StepHandler, HandlerParams } from '@flowmonkey/core';

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

/**
 * Basic implementation using polling.
 * In production, use event-driven approach.
 */
export class BasicJobRunner implements JobRunner {
  private running = false;
  private handlers = new Map<string, StepHandler>();
  private stats = { active: 0, completed: 0, failed: 0 };
  private pollInterval = 1000; // Check for jobs every 1s

  constructor(
    private jobStore: any, // JobStore
    private execStore: any, // StateStore
    private runnerId: string = crypto.randomUUID()
  ) {}

  registerHandler(name: string, handler: StepHandler): void {
    this.handlers.set(name, handler);
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;

    while (this.running) {
      // Find pending jobs
      const jobs = await this.jobStore.listByStatus('pending', 10);

      for (const job of jobs) {
        // Try to claim
        const claimed = await this.jobStore.claim(job.id, this.runnerId);
        if (!claimed) continue;

        this.stats.active++;
        this.executeJob(job).finally(() => {
          this.stats.active--;
        });
      }

      // Also check for stalled jobs that need resetting
      const stalled = await this.jobStore.findStalled(Date.now(), 10);
      for (const job of stalled) {
        if (job.attempts < job.maxAttempts) {
          await this.jobStore.resetStalled(job.id);
        }
      }

      await new Promise(resolve => setTimeout(resolve, this.pollInterval));
    }
  }

  async stop(): Promise<void> {
    this.running = false;
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

  private async executeJob(job: any): Promise<void> {
    try {
      const handler = this.handlers.get(job.handler);
      if (!handler) {
        throw new Error(`No handler for ${job.handler}`);
      }

      const exec = await this.execStore.load(job.executionId);
      if (!exec) {
        throw new Error(`Execution ${job.executionId} not found`);
      }

      // Create mock context helpers (no storage backend for jobs)
      const ctx = {
        get: async (key: string) => exec.context[key],
        set: async (key: string, value: unknown) => { exec.context[key] = value; },
        has: (key: string) => key in exec.context,
        delete: async (key: string) => { delete exec.context[key]; },
        getAll: async <T = Record<string, unknown>>(keys: string[]): Promise<T> => {
          const result: Record<string, unknown> = {};
          for (const key of keys) result[key] = exec.context[key];
          return result as T;
        },
      };

      const params: HandlerParams = {
        input: job.input,
        step: {
          id: job.stepId,
          type: job.handler,
          config: {},
          input: { type: 'full' },
          transitions: { onSuccess: 'next' },
        },
        context: exec.context ?? {},
        ctx,
        execution: exec,
      };

      const result = await handler.execute(params);
      await this.jobStore.complete(job.id, this.runnerId, result);
      this.stats.completed++;
    } catch (error) {
      await this.jobStore.fail(job.id, this.runnerId, {
        code: 'EXECUTION_ERROR',
        message: String(error),
      });
      this.stats.failed++;
    }
  }
}
