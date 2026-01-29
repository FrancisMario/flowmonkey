/**
 * StatelessHandler - Base class for single-shot handlers.
 *
 * Use for handlers that complete in a single execution without
 * checkpoints or progress tracking. Examples: HTTP requests,
 * data transformations, simple computations.
 */

import { BaseHandler } from './base';
import type { StepResult } from '../types/result';
import { Result } from '../types/result';

/**
 * Abstract base class for stateless handlers.
 *
 * Stateless handlers:
 * - Execute in a single shot
 * - No checkpoint support
 * - No progress reporting
 * - Run directly in the engine (not via job queue)
 *
 * @typeParam TInput - Type of resolved inputs
 * @typeParam TSuccessOutput - Type of success output
 * @typeParam TFailureOutput - Type of failure output (default: StepError shape)
 *
 * @example
 * ```typescript
 * @Handler({ type: 'http', name: 'HTTP Request', category: 'external' })
 * class HttpHandler extends StatelessHandler<HttpInput, HttpResponse> {
 *   @Input({ type: 'string', source: 'config', required: true })
 *   @Url()
 *   url!: string;
 *
 *   @Input({ type: 'string', source: 'config', defaultValue: 'GET' })
 *   method!: string;
 *
 *   async execute(): Promise<StepResult> {
 *     const response = await fetch(this.url, { method: this.method });
 *     const body = await response.json();
 *     return this.success({ status: response.status, body });
 *   }
 * }
 * ```
 */
export abstract class StatelessHandler<
  TInput = unknown,
  TSuccessOutput = unknown,
  TFailureOutput = unknown,
> extends BaseHandler<TInput, TSuccessOutput, TFailureOutput> {
  /**
   * Create a success result with output.
   */
  protected success(output?: TSuccessOutput): StepResult {
    return Result.success(output);
  }

  /**
   * Create a failure result.
   */
  protected failure(
    code: string,
    message: string,
    details?: TFailureOutput
  ): StepResult {
    return Result.failure(code, message, details);
  }

  /**
   * Create a wait result (for timed delays).
   */
  protected wait(durationMs: number, reason?: string): StepResult {
    return Result.wait(durationMs, reason);
  }

  /**
   * Create a wait result until a specific timestamp.
   */
  protected waitUntil(timestamp: number, reason?: string): StepResult {
    return Result.waitUntil(timestamp, reason);
  }

  /**
   * Create a wait result for an external signal (resume token).
   */
  protected async waitForSignal(
    reason: string,
    options?: {
      expiresInMs?: number;
      metadata?: Record<string, unknown>;
    }
  ): Promise<StepResult> {
    if (!this.tokenManager) {
      throw new Error('Token manager not available - cannot create resume token');
    }

    const token = await this.tokenManager.generate(
      this.execution.id,
      this.step.id,
      {
        expiresInMs: options?.expiresInMs,
        metadata: options?.metadata,
      }
    );

    return {
      outcome: 'wait',
      waitReason: reason,
      resumeToken: token.token,
      wakeAt: options?.expiresInMs ? Date.now() + options.expiresInMs : undefined,
      waitData: options?.metadata,
    };
  }

  /**
   * Execute the handler. Must be implemented by subclasses.
   */
  abstract execute(): Promise<StepResult>;
}
