/**
 * Source of cancellation for tracking why an execution was stopped.
 */
export type CancellationSource =
  | 'user'           // Manual cancellation via API
  | 'timeout'        // Execution timeout exceeded
  | 'system'         // System shutdown
  | 'parent';        // Parent execution cancelled (sub-flows)

/**
 * Cancellation metadata recorded when execution is cancelled.
 */
export interface CancellationInfo {
  readonly source: CancellationSource;
  readonly reason?: string;
  readonly cancelledAt: number;
}

/**
 * Timeout configuration for an execution.
 */
export interface TimeoutConfig {
  /** Max execution duration in ms (default: 24h) */
  executionTimeoutMs?: number;
  /** Max wait duration in ms (default: 7 days) */
  waitTimeoutMs?: number;
}

/**
 * An Execution is a running instance of a Flow.
 */
export interface Execution {
  /** Unique ID (UUID) */
  readonly id: string;

  /** Which flow this runs */
  readonly flowId: string;

  /** Flow version at creation time */
  readonly flowVersion: string;

  /** Current step */
  currentStepId: string;

  /** Current status */
  status: ExecutionStatus;

  /** Shared data between steps */
  context: Record<string, unknown>;

  /** When to wake (for waiting status) */
  wakeAt?: number;

  /** Why waiting (human readable) */
  waitReason?: string;

  /** Error info (for failed status) */
  error?: ExecutionError;

  /** Steps executed so far */
  stepCount: number;

  /** Step execution history (optional) */
  history?: StepHistory[];

  /** Creation timestamp (ms) */
  readonly createdAt: number;

  /** Last update timestamp (ms) */
  updatedAt: number;

  /** Optional tenant ID for multi-tenancy */
  readonly tenantId?: string;

  /** Optional custom metadata */
  metadata?: Record<string, unknown>;

  // === V1 Gap Fixes ===

  /** Idempotency key for deduplication */
  idempotencyKey?: string;

  /** When idempotency key expires (ms timestamp) */
  idempotencyExpiresAt?: number;

  /** Cancellation info if execution was cancelled */
  cancellation?: CancellationInfo;

  /** Parent execution ID for sub-flows */
  parentExecutionId?: string;

  /** When the execution entered waiting status (for timeout tracking) */
  waitStartedAt?: number;

  /** Timeout configuration for this execution */
  timeoutConfig?: TimeoutConfig;

  /** Tracks retry attempts per step (stepId → attempt count) */
  retryAttempts?: Record<string, number>;
}

export type ExecutionStatus =
  | 'pending'     // Created, not started
  | 'running'     // Executing a step
  | 'waiting'     // Paused, waiting for wake
  | 'cancelling'  // Transitional: cleanup in progress
  | 'cancelled'   // Terminal: cancelled by user/timeout/parent
  | 'completed'   // Terminal: successfully finished
  | 'failed';     // Terminal: terminated with error

/** Statuses from which an execution can be cancelled */
export const CANCELLABLE_STATUSES = ['running', 'waiting', 'paused'] as const;

/** Terminal statuses (execution cannot continue) */
export const TERMINAL_STATUSES = ['cancelled', 'completed', 'failed'] as const;

export interface ExecutionError {
  readonly code: string;
  readonly message: string;
  readonly stepId: string;
  readonly details?: unknown;
  readonly timestamp: number;
}

export interface StepHistory {
  readonly stepId: string;
  readonly handlerType: string;
  readonly outcome: 'success' | 'failure' | 'wait' | 'waiting' | 'waited';
  readonly startedAt: number;
  readonly completedAt: number;
  readonly durationMs: number;
  readonly error?: unknown;
}
