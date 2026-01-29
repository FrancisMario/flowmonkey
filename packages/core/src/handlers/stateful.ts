/**
 * StatefulHandler - Base class for long-running handlers with checkpoints.
 *
 * Use for handlers that may take a long time, need to survive restarts,
 * or require progress tracking. Runs via job queue, not directly in engine.
 */

import { BaseHandler, type HandlerContext } from './base';
import type { StepResult } from '../types/result';
import { Result } from '../types/result';
import type { CheckpointManager } from '../interfaces/step-handler';
import { FlowMonkeyError } from '../types/errors';

/**
 * Error thrown when a handler instance has been superseded by a newer instance.
 */
export class InstanceSupersededError extends FlowMonkeyError {
  constructor(
    public readonly jobId: string,
    public readonly instanceId: string
  ) {
    super(
      'INSTANCE_SUPERSEDED',
      `Handler instance ${instanceId} for job ${jobId} has been superseded`
    );
    this.name = 'InstanceSupersededError';
  }
}

/**
 * Checkpoint data wrapper with type safety.
 */
export interface CheckpointData<T> {
  data: T;
  savedAt: number;
  instanceId: string;
}

/**
 * Extended handler context for stateful handlers.
 */
export interface StatefulHandlerContext extends HandlerContext {
  /** Checkpoint manager for persistence */
  checkpoints: CheckpointManager;
  /** Unique instance ID for this execution attempt */
  instanceId: string;
  /** Job ID in the job store */
  jobId: string;
  /** Callback to check if this instance is still active */
  isActive: () => Promise<boolean>;
  /** Callback to update progress */
  updateProgress: (percent: number, message?: string) => Promise<void>;
}

/**
 * Abstract base class for stateful handlers.
 *
 * Stateful handlers:
 * - Run via job queue (not directly in engine)
 * - Support checkpointing for crash recovery
 * - Support progress reporting
 * - Have instance tracking to prevent duplicate execution
 *
 * @typeParam TInput - Type of resolved inputs
 * @typeParam TSuccessOutput - Type of success output
 * @typeParam TFailureOutput - Type of failure output
 * @typeParam TCheckpoint - Type of checkpoint data
 *
 * @example
 * ```typescript
 * interface BatchCheckpoint {
 *   processedItems: string[];
 *   currentIndex: number;
 * }
 *
 * @Handler({ type: 'batch-process', name: 'Batch Processor', stateful: true })
 * class BatchHandler extends StatefulHandler<BatchInput, BatchOutput, BatchError, BatchCheckpoint> {
 *   @Input({ type: 'array', source: 'previous', required: true })
 *   items!: string[];
 *
 *   async execute(): Promise<StepResult> {
 *     // Restore checkpoint or start fresh
 *     let checkpoint = await this.getCheckpoint();
 *     let processed = checkpoint?.processedItems ?? [];
 *     let index = checkpoint?.currentIndex ?? 0;
 *
 *     for (; index < this.items.length; index++) {
 *       // Check if we've been superseded
 *       await this.assertActive();
 *
 *       // Process item
 *       processed.push(await this.processItem(this.items[index]));
 *
 *       // Checkpoint progress
 *       await this.checkpoint({ processedItems: processed, currentIndex: index + 1 });
 *       await this.reportProgress(((index + 1) / this.items.length) * 100);
 *     }
 *
 *     return this.success({ processed });
 *   }
 * }
 * ```
 */
export abstract class StatefulHandler<
  TInput = unknown,
  TSuccessOutput = unknown,
  TFailureOutput = unknown,
  TCheckpoint = unknown,
> extends BaseHandler<TInput, TSuccessOutput, TFailureOutput> {
  /**
   * Stateful context (narrowed type).
   * @internal
   */
  protected declare _context: StatefulHandlerContext;

  /**
   * Get the unique instance ID for this execution attempt.
   */
  protected get instanceId(): string {
    return this._context.instanceId;
  }

  /**
   * Get the job ID.
   */
  protected get jobId(): string {
    return this._context.jobId;
  }

  /**
   * Get the checkpoint manager.
   */
  protected get checkpoints(): CheckpointManager {
    return this._context.checkpoints;
  }

  /**
   * Save a checkpoint. Automatically validates that this instance is still active.
   *
   * @param data - Checkpoint data to save
   * @throws InstanceSupersededError if this instance has been superseded
   */
  protected async checkpoint(data: TCheckpoint): Promise<void> {
    await this.assertActive();

    const wrapped: CheckpointData<TCheckpoint> = {
      data,
      savedAt: Date.now(),
      instanceId: this.instanceId,
    };

    await this.checkpoints.save('checkpoint', wrapped);
  }

  /**
   * Restore the last checkpoint, if any.
   *
   * @returns The checkpoint data, or null if no checkpoint exists
   */
  protected async getCheckpoint(): Promise<TCheckpoint | null> {
    const wrapped = await this.checkpoints.restore<CheckpointData<TCheckpoint>>('checkpoint');
    return wrapped?.data ?? null;
  }

  /**
   * Report progress. Automatically validates that this instance is still active.
   *
   * @param percent - Progress percentage (0-100)
   * @param message - Optional status message
   * @throws InstanceSupersededError if this instance has been superseded
   */
  protected async reportProgress(percent: number, message?: string): Promise<void> {
    await this.assertActive();
    await this._context.updateProgress(Math.min(100, Math.max(0, percent)), message);
  }

  /**
   * Assert that this instance is still the active owner of the job.
   * Call this before any operation that modifies external state.
   *
   * @throws InstanceSupersededError if this instance has been superseded
   */
  protected async assertActive(): Promise<void> {
    const active = await this._context.isActive();
    if (!active) {
      throw new InstanceSupersededError(this.jobId, this.instanceId);
    }
  }

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
