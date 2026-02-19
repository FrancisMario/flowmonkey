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
 * Every mutation and lifecycle transition in the system emits an event.
 * All methods are optional — subscribe only to what you need.
 *
 * Categories:
 * - Execution lifecycle: create, start, resume, complete, fail, wait, cancel
 * - Step lifecycle: start, complete, timeout, transition
 * - Idempotency: duplicate detection
 * - Job lifecycle: claim, progress, checkpoint, complete, fail, supersede, heartbeat
 * - Pipe lifecycle: insert, fail, discard
 * - Row lifecycle: insert, update, delete
 * - Flow registry: register
 * - Handler registry: register, unregister
 * - Table registry: create, delete, column add/remove
 * - Resume tokens: create, use, revoke, cleanup
 * - WAL: append, replay, compact
 */
export interface EventBus {
  // ── Execution Lifecycle ───────────────────────────────────────────
  onExecutionCreated?(e: { executionId: string; flowId: string; context: Record<string, unknown> }): void;
  onExecutionStarted?(e: { executionId: string; flowId: string; stepId: string }): void;
  onExecutionCompleted?(e: { executionId: string; context: Record<string, unknown>; totalSteps: number }): void;
  onExecutionFailed?(e: { executionId: string; stepId: string; error: { code: string; message: string } }): void;
  onExecutionWaiting?(e: { executionId: string; stepId: string; wakeAt?: number; reason?: string }): void;

  /**
   * Emitted when a waiting execution resumes (wake time reached or external resume).
   */
  onExecutionResumed?(e: { executionId: string; flowId: string; stepId: string }): void;

  /**
   * Emitted when an execution is cancelled (dedicated event, separate from failure).
   */
  onExecutionCancelled?(e: {
    executionId: string;
    source: string;
    reason?: string;
    childrenCancelled: number;
    tokensInvalidated: number;
  }): void;

  // ── Step Lifecycle ────────────────────────────────────────────────
  onStepStarted?(e: { executionId: string; stepId: string; input: unknown }): void;
  onStepCompleted?(e: { executionId: string; stepId: string; result: StepResult; durationMs: number }): void;

  /**
   * Emitted when a handler is aborted due to timeout.
   */
  onStepTimeout?(e: { executionId: string; stepId: string; timeoutMs: number }): void;

  /**
   * Emitted when a step is retried after a failure.
   */
  onStepRetry?(e: {
    executionId: string;
    stepId: string;
    attempt: number;
    maxAttempts: number;
    backoffMs: number;
    error: { code: string; message: string };
  }): void;

  /**
   * Emitted on every step-to-step transition.
   */
  onTransition?(e: { executionId: string; fromStepId: string; toStepId: string; outcome: string }): void;

  // ── Idempotency ──────────────────────────────────────────────────

  /**
   * Emitted when a duplicate execution is detected via idempotency key.
   */
  onIdempotencyHit?(e: { executionId: string; flowId: string; idempotencyKey: string }): void;

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

  // ── Pipe Events (DataStore) ───────────────────────────────────

  /**
   * Emitted when a pipe successfully inserts a row into a table.
   */
  onPipeInserted?(e: {
    executionId: string;
    stepId: string;
    pipeId: string;
    tableId: string;
    rowId: string;
  }): void;

  /**
   * Emitted when a pipe fails to insert a row (queued in WAL).
   */
  onPipeFailed?(e: {
    executionId: string;
    stepId: string;
    pipeId: string;
    tableId: string;
    error: { code: string; message: string };
  }): void;

  /**
   * Emitted when a WAL entry permanently fails after max retry attempts.
   */
  onPipeDiscarded?(e: {
    executionId: string;
    pipeId: string;
    tableId: string;
    attempts: number;
    error: string;
  }): void;

  // ── Row Events (DataStore) ────────────────────────────────────

  /**
   * Emitted when a row is inserted into a table (any source: pipe, API, handler).
   */
  onRowInserted?(e: {
    tableId: string;
    rowId: string;
    row: Record<string, unknown>;
    tenantId?: string;
  }): void;

  /**
   * Emitted when a row is updated in a table.
   */
  onRowUpdated?(e: {
    tableId: string;
    rowId: string;
    changes: Record<string, unknown>;
    tenantId?: string;
  }): void;

  /**
   * Emitted when a row is deleted from a table.
   */
  onRowDeleted?(e: {
    tableId: string;
    rowId: string;
    tenantId?: string;
  }): void;

  // ── Flow Registry ─────────────────────────────────────────────

  /**
   * Emitted when a flow definition is registered.
   */
  onFlowRegistered?(e: { flowId: string; version: string }): void;

  // ── Handler Registry ──────────────────────────────────────────

  /**
   * Emitted when a handler is registered.
   */
  onHandlerRegistered?(e: { handlerType: string; name?: string; category?: string }): void;

  /**
   * Emitted when a handler is unregistered.
   */
  onHandlerUnregistered?(e: { handlerType: string }): void;

  // ── Table Registry ────────────────────────────────────────────

  /**
   * Emitted when a table definition is created.
   */
  onTableCreated?(e: { tableId: string; columnCount: number; tenantId?: string }): void;

  /**
   * Emitted when a table definition is deleted.
   */
  onTableDeleted?(e: { tableId: string }): void;

  /**
   * Emitted when a column is added to a table.
   */
  onTableColumnAdded?(e: { tableId: string; columnId: string; columnType: string }): void;

  /**
   * Emitted when a column is removed from a table.
   */
  onTableColumnRemoved?(e: { tableId: string; columnId: string }): void;

  // ── Resume Tokens ─────────────────────────────────────────────

  /**
   * Emitted when a resume token is created.
   */
  onTokenCreated?(e: { token: string; executionId: string; stepId: string; expiresAt?: number }): void;

  /**
   * Emitted when a resume token is consumed.
   */
  onTokenUsed?(e: { token: string; executionId: string }): void;

  /**
   * Emitted when a resume token is revoked.
   */
  onTokenRevoked?(e: { token: string; executionId: string }): void;

  /**
   * Emitted when expired tokens are cleaned up.
   */
  onTokensCleanedUp?(e: { count: number }): void;

  // ── WAL (Write-Ahead Log) ─────────────────────────────────────

  /**
   * Emitted when a failed pipe write is queued in the WAL.
   */
  onWALAppended?(e: { entryId: string; tableId: string; executionId: string; pipeId: string }): void;

  /**
   * Emitted when a WAL entry is successfully replayed.
   */
  onWALReplayed?(e: { entryId: string; tableId: string }): void;

  /**
   * Emitted when the WAL is compacted (acked entries removed).
   */
  onWALCompacted?(e: { removedCount: number }): void;
}
