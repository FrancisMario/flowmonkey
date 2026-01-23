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
}

export type ExecutionStatus =
  | 'pending'    // Created, not started
  | 'running'    // Executing a step
  | 'waiting'    // Paused, waiting for wake
  | 'completed'  // Successfully finished
  | 'failed';    // Terminated with error

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
  readonly outcome: 'success' | 'failure' | 'wait';
  readonly startedAt: number;
  readonly completedAt: number;
  readonly durationMs: number;
  readonly error?: unknown;
}
