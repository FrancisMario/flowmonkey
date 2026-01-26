/**
 * Result returned by a StepHandler.
 * This is the ONLY way handlers communicate with the engine.
 */
export interface StepResult {
  /** What happened */
  readonly outcome: 'success' | 'failure' | 'wait' | 'waiting' | 'waited';

  /** Output to store in context */
  readonly output?: unknown;

  /** Error info (for failure) */
  readonly error?: StepError;

  /** When to wake (for wait) */
  readonly wakeAt?: number;

  /** Why waiting (for wait) */
  readonly waitReason?: string;

  /** Resume token (for waiting) */
  readonly resumeToken?: string;

  /** Additional wait data */
  readonly waitData?: Record<string, unknown>;

  /** Override default transition */
  readonly nextStepOverride?: string | null;
}

export interface StepError {
  readonly code: string;
  readonly message: string;
  readonly retryable?: boolean;
  readonly details?: unknown;
}

/**
 * Helper functions for creating results.
 */
export const Result = {
  success(output?: unknown): StepResult {
    return { outcome: 'success', output };
  },

  failure(code: string, message: string, details?: unknown): StepResult {
    return { outcome: 'failure', error: { code, message, details } };
  },

  wait(durationMs: number, reason?: string): StepResult {
    return {
      outcome: 'wait',
      wakeAt: Date.now() + durationMs,
      waitReason: reason,
    };
  },

  waitUntil(timestamp: number, reason?: string): StepResult {
    return { outcome: 'wait', wakeAt: timestamp, waitReason: reason };
  },

  waitForSignal(reason: string): StepResult {
    return { outcome: 'wait', waitReason: reason };
  },
} as const;
