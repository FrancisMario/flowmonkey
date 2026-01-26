import type { StepHandler, HandlerParams } from '@flowmonkey/core';

interface BatchProcessConfig {
  items: unknown[];
  processor: string;
  batchSize?: number;
  checkpointEvery?: number;
}

interface BatchCheckpoint {
  lastProcessedIndex: number;
  successCount: number;
  failureCount: number;
  errors: Array<{ index: number; error: string }>;
  startedAt: number;
}

export const batchProcessHandler: StepHandler = {
  type: 'batch.process',

  metadata: {
    type: 'batch.process',
    name: 'Batch Process',
    description: 'Process items in batches with checkpointing',
    category: 'data',
    stateful: true,
    retryable: true,

    visual: {
      icon: '📦',
      color: '#0078d4',
      tags: ['batch', 'processing', 'stateful'],
    },

    configSchema: {
      type: 'object',
      required: ['items', 'processor'],
      properties: {
        items: {
          type: 'array',
          description: 'Items to process',
        },
        processor: {
          type: 'string',
          description: 'Name of processing function',
        },
        batchSize: {
          type: 'number',
          default: 10,
          description: 'Items per batch',
        },
        checkpointEvery: {
          type: 'number',
          default: 100,
          description: 'Checkpoint every N items',
        },
      },
      additionalProperties: false,
    },

    examples: [
      {
        name: 'Process user list',
        config: {
          items: [{ id: 1 }, { id: 2 }, { id: 3 }],
          processor: 'sendEmail',
          batchSize: 10,
        },
      },
    ],
  },

  async execute(params: HandlerParams) {
    if (!params.checkpoints) {
      return {
        outcome: 'failure' as const,
        error: { code: 'NO_CHECKPOINTS', message: 'Checkpoints not available for stateful handler' },
      };
    }

    const config = params.step.config as unknown as BatchProcessConfig;

    // Restore checkpoint if resuming
    const checkpoint = await params.checkpoints.restore<BatchCheckpoint>('progress');

    const startIndex = checkpoint?.lastProcessedIndex ?? -1;
    let successCount = checkpoint?.successCount ?? 0;
    let failureCount = checkpoint?.failureCount ?? 0;
    const errors = checkpoint?.errors ?? [];
    const startedAt = checkpoint?.startedAt ?? Date.now();

    const items = config.items;
    const checkpointEvery = config.checkpointEvery ?? 100;

    // Process items
    for (let i = startIndex + 1; i < items.length; i++) {
      try {
        // Mock processing
        await new Promise(resolve => setTimeout(resolve, 10));
        successCount++;
      } catch (err) {
        failureCount++;
        errors.push({ index: i, error: err instanceof Error ? err.message : 'Unknown error' });
      }

      // Save checkpoint
      if ((i + 1) % checkpointEvery === 0) {
        await params.checkpoints.save('progress', {
          lastProcessedIndex: i,
          successCount,
          failureCount,
          errors,
          startedAt,
        } as BatchCheckpoint);
      }
    }

    // Final cleanup
    await params.checkpoints.delete('progress');

    const duration = Date.now() - startedAt;

    return {
      outcome: 'success' as const,
      output: {
        total: items.length,
        successCount,
        failureCount,
        duration,
        errors,
      },
    };
  },
};
