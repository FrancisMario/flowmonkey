/**
 * Job scheduler coordinates job execution.
 * Triggers runners, handles retries, manages timeouts.
 */
export interface JobScheduler {
  start(): Promise<void>;
  stop(): Promise<void>;
  enqueueJob(executionId: string, stepId: string, handler: string, input: unknown): Promise<void>;
}

/**
 * Basic scheduler.
 */
export class BasicJobScheduler implements JobScheduler {
  private running = false;

  constructor(
    private jobStore: any, // JobStore
    private execStore: any, // StateStore
    private pollInterval = 5000
  ) {}

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;

    while (this.running) {
      // Trigger job execution based on execution state
      const waitingExecs = await this.execStore.listByStatus('waiting', 100);

      for (const exec of waitingExecs) {
        // Check if job is complete
        const jobs = await this.jobStore.listForExecution(exec.id);
        const lastJob = jobs[jobs.length - 1];

        if (lastJob?.status === 'completed') {
          // Move to next step or complete
          // This would be integrated with the engine
          exec.status = 'running';
          await this.execStore.save(exec);
        } else if (lastJob?.status === 'failed' && lastJob.attempts >= lastJob.maxAttempts) {
          // Mark execution as failed
          exec.status = 'failed';
          exec.error = { code: 'JOB_FAILED', message: 'Job failed after max retries' };
          await this.execStore.save(exec);
        }
      }

      await new Promise(resolve => setTimeout(resolve, this.pollInterval));
    }
  }

  async stop(): Promise<void> {
    this.running = false;
  }

  async enqueueJob(
    executionId: string,
    stepId: string,
    handler: string,
    input: unknown
  ): Promise<void> {
    await this.jobStore.getOrCreate({
      executionId,
      stepId,
      handler,
      input,
    });
  }
}
