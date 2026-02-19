/**
 * table-insert handler — critical write to a DataStore table.
 *
 * Unlike pipes (fire-and-forget), this handler is a regular step
 * that follows `onFailure` transitions on write errors.
 *
 * Config:
 *   tableId: string — target table UUID
 *   mappings: Array<{ sourcePath: string; column: string }> — field mappings
 *
 * Input: step output to extract fields from (via input selector)
 * Output: { rowId: string; success: true }
 * Failure: { code: 'TABLE_INSERT_FAILED'; message: string }
 */

import type { StepHandler, HandlerParams } from '@flowmonkey/core';

/** Config shape for the table-insert handler */
export interface TableInsertConfig {
  tableId: string;
  mappings: Array<{ sourcePath: string; column: string }>;
}

/**
 * Resolve a dot-notation path from an object.
 */
function resolvePath(obj: unknown, path: string): unknown {
  let current: any = obj;
  for (const part of path.split('.')) {
    if (current == null) return undefined;
    current = current[part];
  }
  return current;
}

export const tableInsertHandler: StepHandler = {
  type: 'table-insert',
  metadata: {
    type: 'table-insert',
    name: 'Table Insert',
    description: 'Insert a row into a DataStore table (critical write, failable)',
    category: 'data',
    stateful: false,
    configSchema: {
      type: 'object',
      properties: {
        tableId: { type: 'string' },
        mappings: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              sourcePath: { type: 'string' },
              column: { type: 'string' },
            },
            required: ['sourcePath', 'column'],
          },
        },
      },
      required: ['tableId', 'mappings'],
    },
  },
  async execute(params: HandlerParams) {
    const config = params.step.config as unknown as TableInsertConfig;
    const input = params.input;

    if (!config.tableId) {
      return {
        outcome: 'failure' as const,
        error: { code: 'TABLE_INSERT_FAILED', message: 'Missing tableId in step config' },
      };
    }

    if (!config.mappings?.length) {
      return {
        outcome: 'failure' as const,
        error: { code: 'TABLE_INSERT_FAILED', message: 'Missing mappings in step config' },
      };
    }

    // Build the row from mappings
    const row: Record<string, unknown> = {};
    for (const mapping of config.mappings) {
      row[mapping.column] = resolvePath(input, mapping.sourcePath);
    }

    // The tableStore is passed via context by the engine or caller
    // We look for it on the HandlerParams execution context
    const tableStore = (params as any).tableStore;
    if (!tableStore) {
      return {
        outcome: 'failure' as const,
        error: {
          code: 'TABLE_INSERT_FAILED',
          message: 'No TableStore available — ensure tableStore is configured in EngineOptions',
        },
      };
    }

    try {
      const rowId = await tableStore.insert(config.tableId, row, params.execution?.tenantId);
      return {
        outcome: 'success' as const,
        output: { rowId, success: true },
      };
    } catch (err) {
      return {
        outcome: 'failure' as const,
        error: {
          code: 'TABLE_INSERT_FAILED',
          message: err instanceof Error ? err.message : 'Insert failed',
        },
      };
    }
  },
};
