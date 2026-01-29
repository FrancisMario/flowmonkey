import type { StepResult } from '../types/result';

/**
 * Job progress information.
 */
export interface JobProgress {
  percent: number;
  message?: string;
}

/**
 * Job error information.
 */
export interface JobError {
  code: string;
  message: string;
  details?: unknown;
}

/**
 * Optional event publishing.
 * Implement for logging, metrics, webhooks, etc.
 */
export interface EventBus {
  // ── Execution Events ─────────────────────────────────────────────
  onExecutionCreated?(e: { executionId: string; flowId: string; context: Record<string, unknown> }): void;
  onExecutionStarted?(e: { executionId: string; flowId: string; stepId: string }): void;
  onStepStarted?(e: { executionId: string; stepId: string; input: unknown }): void;
  onStepCompleted?(e: { executionId: string; stepId: string; result: StepResult; durationMs: number }): void;
  onExecutionCompleted?(e: { executionId: string; context: Record<string, unknown>; totalSteps: number }): void;
  onExecutionFailed?(e: { executionId: string; stepId: string; error: { code: string; message: string } }): void;
  onExecutionWaiting?(e: { executionId: string; stepId: string; wakeAt?: number; reason?: string }): void;

  // ── Job Events (for stateful handlers) ────────────────────────────
  /**
   * Emitted when a job is claimed by a runner.
   */
  onJobClaimed?(e: {
    jobId: string;
    executionId: string;
    stepId: string;
    instanceId: string;
    runnerId: string;
    handler: string;
  }): void;

  /**
   * Emitted when a job reports progress.
   */
  onJobProgress?(e: {
    jobId: string;
    executionId: string;
    stepId: string;
    instanceId: string;
    progress: JobProgress;
  }): void;

  /**
   * Emitted when a job saves a checkpoint.
   */
  onJobCheckpoint?(e: {
    jobId: string;
    executionId: string;
    stepId: string;
    instanceId: string;
    checkpointKey: string;
  }): void;

  /**
   * Emitted when a job completes successfully.
   */
  onJobCompleted?(e: {
    jobId: string;
    executionId: string;
    stepId: string;
    instanceId: string;
    durationMs: number;
    result: unknown;
  }): void;

  /**
   * Emitted when a job fails.
   */
  onJobFailed?(e: {
    jobId: string;
    executionId: string;
    stepId: string;
    instanceId: string;
    error: JobError;
    willRetry: boolean;
    attempt: number;
    maxAttempts: number;
  }): void;

  /**
   * Emitted when a job instance is superseded by a newer instance.
   * This happens when a stalled job is reclaimed.
   */
  onJobSuperseded?(e: {
    jobId: string;
    executionId: string;
    stepId: string;
    oldInstanceId: string;
    newInstanceId: string;
  }): void;

  /**
   * Emitted when a job heartbeat is recorded.
   */
  onJobHeartbeat?(e: {
    jobId: string;
    executionId: string;
    stepId: string;
    instanceId: string;
    progress?: JobProgress;
  }): void;
}
