/**
 * Job reaper cleans up stalled/dead jobs.
 * Runs periodically to detect and reset or fail jobs.
 */
export interface JobReaper {
  start(): Promise<void>;
  stop(): Promise<void>;
}

/**
 * Basic implementation.
 */
export class BasicJobReaper implements JobReaper {
  private running = false;
  private checkInterval = 30000; // Every 30s

  constructor(
    private jobStore: any, // JobStore
    private maxHeartbeatAge = 120000 // 2 minutes
  ) {}

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;

    while (this.running) {
      await this.reap();
      await new Promise(resolve => setTimeout(resolve, this.checkInterval));
    }
  }

  async stop(): Promise<void> {
    this.running = false;
  }

  private async reap(): Promise<void> {
    const now = Date.now();
    const stalled = await this.jobStore.findStalled(now, 100);

    for (const job of stalled) {
      const age = now - (job.heartbeatAt ?? job.createdAt);

      if (age > this.maxHeartbeatAge) {
        // Too old, fail it
        if (job.attempts < job.maxAttempts) {
          const reset = await this.jobStore.resetStalled(job.id);
          if (reset) {
            console.log(`[Reaper] Reset stalled job ${job.id}`);
          }
        } else {
          // Already max attempts, leave as failed
          console.log(`[Reaper] Job ${job.id} gave up after ${job.attempts} attempts`);
        }
      }
    }
  }
}
