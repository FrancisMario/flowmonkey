/**
 * Class-based Batch Process Handler using decorator system.
 *
 * Stateful handler that processes items in batches with checkpoint support.
 */

import {
  Handler,
  Input,
  Min,
  Max,
  StatefulHandler,
} from '@flowmonkey/core';
import type { StepResult } from '@flowmonkey/core';

// ── Checkpoint Type ─────────────────────────────────────────────────

export interface BatchProcessCheckpoint {
  processedCount: number;
  failedCount: number;
  totalCount: number;
  results: BatchItemResult[];
  startedAt: number;
  lastProcessedIndex: number;
}

export interface BatchItemResult {
  index: number;
  input: unknown;
  output?: unknown;
  error?: string;
  processedAt: number;
}

// ── Output Types ────────────────────────────────────────────────────

export interface BatchProcessSuccessOutput {
  processedCount: number;
  failedCount: number;
  totalCount: number;
  results: BatchItemResult[];
  startedAt: number;
  completedAt: number;
  durationMs: number;
}

export interface BatchProcessFailureOutput {
  code: string;
  message: string;
  processedCount: number;
  failedCount: number;
  lastError?: string;
}

// ── Handler Class ───────────────────────────────────────────────────

@Handler({
  type: 'batch-process',
  name: 'Batch Process',
  description: 'Process items in batches with checkpoint support for resilience',
  category: 'data',
  stateful: true,
  visual: {
    icon: '📦',
    color: '#f59e0b',
    tags: ['batch', 'process', 'bulk', 'iterate'],
  },
})
export class BatchProcessHandler extends StatefulHandler<
  unknown[],
  BatchProcessSuccessOutput,
  BatchProcessFailureOutput,
  BatchProcessCheckpoint
> {
  // ── Inputs ─────────────────────────────────────────────────────────

  @Input({ type: 'array', source: 'previous', required: true, description: 'Items to process' })
  items!: unknown[];

  @Input({ type: 'number', source: 'config', description: 'Batch size (default: 10)' })
  @Min(1, 'Batch size must be at least 1')
  @Max(1000, 'Batch size cannot exceed 1000')
  batchSize?: number;

  @Input({ type: 'string', source: 'config', required: true, description: 'JavaScript expression to apply to each item (receives `item` and `index`)' })
  expression!: string;

  @Input({ type: 'boolean', source: 'config', description: 'Continue processing on item failure (default: true)' })
  continueOnError?: boolean;

  @Input({ type: 'number', source: 'config', description: 'Delay between batches in ms' })
  @Min(0, 'Delay must be non-negative')
  delayBetweenBatches?: number;

  // ── Outputs (declared for type inference) ─────────────────────────

  declare result: BatchProcessSuccessOutput;
  declare error: BatchProcessFailureOutput;

  // ── Execute (Stateful) ─────────────────────────────────────────────

  async execute(): Promise<StepResult> {
    let checkpointData = await this.getCheckpoint();

    // Initialize checkpoint if not exists
    if (!checkpointData) {
      checkpointData = {
        processedCount: 0,
        failedCount: 0,
        totalCount: this.items.length,
        results: [],
        startedAt: Date.now(),
        lastProcessedIndex: -1,
      };
      await this.checkpoint(checkpointData);
    }

    // Process the next batch
    return this.processNextBatch(checkpointData);
  }

  private async processNextBatch(checkpointData: BatchProcessCheckpoint): Promise<StepResult> {
    const batchSize = this.batchSize ?? 10;
    const continueOnError = this.continueOnError ?? true;
    const startIndex = checkpointData.lastProcessedIndex + 1;
    const endIndex = Math.min(startIndex + batchSize, this.items.length);

    // Check if we're done
    if (startIndex >= this.items.length) {
      return this.completeProcessing(checkpointData);
    }

    // Create the transform function
    let transformFn: (item: unknown, index: number) => unknown;
    try {
      transformFn = new Function('item', 'index', `return (${this.expression})`) as typeof transformFn;
    } catch (error) {
      return this.failure('INVALID_EXPRESSION', `Invalid expression: ${(error as Error).message}`, {
        code: 'INVALID_EXPRESSION',
        message: `Invalid expression: ${(error as Error).message}`,
        processedCount: checkpointData.processedCount,
        failedCount: checkpointData.failedCount,
      });
    }

    // Process items in this batch
    for (let i = startIndex; i < endIndex; i++) {
      const item = this.items[i];
      const result: BatchItemResult = {
        index: i,
        input: item,
        processedAt: Date.now(),
      };

      try {
        result.output = transformFn(item, i);
        checkpointData.processedCount++;
      } catch (error) {
        result.error = (error as Error).message;
        checkpointData.failedCount++;

        if (!continueOnError) {
          // Save checkpoint and fail
          checkpointData.results.push(result);
          checkpointData.lastProcessedIndex = i;
          await this.checkpoint(checkpointData);

          return this.failure('ITEM_ERROR', `Error processing item ${i}: ${result.error}`, {
            code: 'ITEM_ERROR',
            message: `Error processing item ${i}: ${result.error}`,
            processedCount: checkpointData.processedCount,
            failedCount: checkpointData.failedCount,
            lastError: result.error,
          });
        }
      }

      checkpointData.results.push(result);
      checkpointData.lastProcessedIndex = i;
    }

    // Save checkpoint after batch
    await this.checkpoint(checkpointData);

    // Report progress as percentage
    const percent = ((checkpointData.lastProcessedIndex + 1) / checkpointData.totalCount) * 100;
    await this.reportProgress(
      percent,
      `Processed ${checkpointData.processedCount}/${checkpointData.totalCount} items (${checkpointData.failedCount} failed)`
    );

    // Check if more items to process
    if (checkpointData.lastProcessedIndex < this.items.length - 1) {
      // Add delay between batches if configured
      if (this.delayBetweenBatches && this.delayBetweenBatches > 0) {
        await new Promise(resolve => setTimeout(resolve, this.delayBetweenBatches));
      }

      // Return wait result to allow job runner to continue
      return {
        outcome: 'wait',
        waitReason: 'Processing in progress',
        waitData: {
          processedCount: checkpointData.processedCount,
          failedCount: checkpointData.failedCount,
          totalCount: checkpointData.totalCount,
          progress: `${checkpointData.lastProcessedIndex + 1}/${checkpointData.totalCount}`,
        },
      };
    }

    // All done
    return this.completeProcessing(checkpointData);
  }

  private completeProcessing(checkpointData: BatchProcessCheckpoint): StepResult {
    const completedAt = Date.now();

    return this.success({
      processedCount: checkpointData.processedCount,
      failedCount: checkpointData.failedCount,
      totalCount: checkpointData.totalCount,
      results: checkpointData.results,
      startedAt: checkpointData.startedAt,
      completedAt,
      durationMs: completedAt - checkpointData.startedAt,
    });
  }
}
