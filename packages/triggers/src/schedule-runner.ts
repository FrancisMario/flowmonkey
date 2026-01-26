import type { FlowRegistry, Engine } from '@flowmonkey/core';
import type { TriggerStore, ScheduleTrigger, WakeSignaler } from './types';
import { parseExpression } from 'cron-parser';

/**
 * Compute next cron run time.
 */
function computeNextRun(schedule: string, timezone: string): number {
  const interval = parseExpression(schedule, { tz: timezone });
  return interval.next().getTime();
}

export interface ScheduleRunnerOptions {
  /** Poll interval in milliseconds (default: 60000) */
  intervalMs?: number;
}

export interface ScheduleRunnerDeps {
  triggerStore: TriggerStore;
  flowRegistry: FlowRegistry;
  engine: Engine;
  signals?: WakeSignaler;
}

/**
 * Runs scheduled triggers on their cron schedules.
 * Polls the database for due triggers and fires them.
 */
export class ScheduleRunner {
  private running = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly intervalMs: number;

  constructor(
    private readonly deps: ScheduleRunnerDeps,
    options?: ScheduleRunnerOptions
  ) {
    this.intervalMs = options?.intervalMs ?? 60000;
  }

  /**
   * Start the schedule runner.
   * Idempotent - calling multiple times has no effect.
   */
  start(): void {
    if (this.running) return;
    this.running = true;
    this.tick();
  }

  /**
   * Stop the schedule runner gracefully.
   */
  stop(): void {
    this.running = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  /**
   * Check if runner is currently running.
   */
  isRunning(): boolean {
    return this.running;
  }

  /**
   * Manually fire a single tick (useful for testing).
   */
  async tickOnce(): Promise<void> {
    await this.processDueTriggers();
  }

  private async tick(): Promise<void> {
    if (!this.running) return;

    try {
      await this.processDueTriggers();
    } catch (err) {
      console.error('[ScheduleRunner] Error processing triggers:', err);
    }

    if (this.running) {
      this.timer = setTimeout(() => this.tick(), this.intervalMs);
    }
  }

  private async processDueTriggers(): Promise<void> {
    const now = Date.now();
    const dueTriggers = await this.deps.triggerStore.listDueSchedules(now);

    for (const trigger of dueTriggers) {
      await this.fireTrigger(trigger, now);
    }
  }

  private async fireTrigger(trigger: ScheduleTrigger, now: number): Promise<void> {
    const startTime = Date.now();

    // Check flow exists
    const flow = this.deps.flowRegistry.get(trigger.flowId);
    if (!flow) {
      await this.deps.triggerStore.logInvocation({
        triggerId: trigger.id,
        status: 'flow_not_found',
        errorCode: 'FLOW_NOT_FOUND',
        errorMessage: `Flow '${trigger.flowId}' not found`,
        durationMs: Date.now() - startTime,
        timestamp: now,
      });

      // Still advance schedule to prevent infinite retries
      const nextRunAt = computeNextRun(trigger.schedule, trigger.timezone);
      await this.deps.triggerStore.updateScheduleRun(trigger.id, now, nextRunAt);
      return;
    }

    try {
      // Create execution with static context
      const result = await this.deps.engine.create(trigger.flowId, trigger.staticContext);
      const executionId = result.execution.id;

      // Signal worker if available
      if (this.deps.signals) {
        await this.deps.signals.signal(executionId);
      }

      await this.deps.triggerStore.logInvocation({
        triggerId: trigger.id,
        executionId,
        status: 'success',
        durationMs: Date.now() - startTime,
        timestamp: now,
      });

      // Advance schedule
      const nextRunAt = computeNextRun(trigger.schedule, trigger.timezone);
      await this.deps.triggerStore.updateScheduleRun(trigger.id, now, nextRunAt);
    } catch (err) {
      await this.deps.triggerStore.logInvocation({
        triggerId: trigger.id,
        status: 'error',
        errorCode: 'EXECUTION_ERROR',
        errorMessage: err instanceof Error ? err.message : 'Unknown error',
        durationMs: Date.now() - startTime,
        timestamp: now,
      });

      // Still advance schedule to prevent infinite retries
      const nextRunAt = computeNextRun(trigger.schedule, trigger.timezone);
      await this.deps.triggerStore.updateScheduleRun(trigger.id, now, nextRunAt);
    }
  }
}
