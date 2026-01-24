import type { Step } from '../types/flow';
import type { StepResult } from '../types/result';

/**
 * Executes a step type.
 * Implement this for http calls, LLM invocations, delays, etc.
 */
export interface StepHandler {
  /** Unique type identifier (e.g., "http", "delay") */
  readonly type: string;

  /**
   * Whether this handler is stateful (runs as a job).
   * Default: false (stateless, runs inline)
   */
  readonly stateful?: boolean;

  /** Execute the step */
  execute(params: HandlerParams): Promise<StepResult>;
}

export interface HandlerParams {
  /** Resolved input from context */
  readonly input: unknown;

  /** Step definition */
  readonly step: Step;

  /** Read-only context */
  readonly context: Readonly<Record<string, unknown>>;

  /** Execution info for logging */
  readonly execution: {
    readonly id: string;
    readonly flowId: string;
    readonly stepCount: number;
  };

  /** Cancellation signal */
  readonly signal?: AbortSignal;
}
