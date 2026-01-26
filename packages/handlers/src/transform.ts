import type { StepHandler, HandlerParams } from '@flowmonkey/core';

interface TransformConfig {
  operation: 'map' | 'filter' | 'reduce' | 'pick' | 'omit' | 'merge';
  mapping?: Record<string, string>;
  condition?: {
    path: string;
    op: 'eq' | 'ne' | 'gt' | 'lt' | 'contains' | 'exists';
    value?: unknown;
  };
  accumulator?: string;
  keys?: string[];
  sources?: string[];
}

export const transformHandler: StepHandler = {
  type: 'transform',

  metadata: {
    type: 'transform',
    name: 'Transform Data',
    description: 'Transform, filter, or reshape data',
    category: 'data',
    stateful: false,
    retryable: true,

    visual: {
      icon: '🔄',
      color: '#9966cc',
      tags: ['data', 'mapping', 'filter'],
    },

    configSchema: {
      type: 'object',
      required: ['operation'],
      properties: {
        operation: { type: 'string', enum: ['map', 'filter', 'reduce', 'pick', 'omit', 'merge'] },
        mapping: { type: 'object' },
        condition: { type: 'object' },
        accumulator: { type: 'string' },
        keys: { type: 'array', items: { type: 'string' } },
        sources: { type: 'array', items: { type: 'string' } },
      },
      additionalProperties: false,
    },

    examples: [
      {
        name: 'Map fields',
        config: { operation: 'map', mapping: { id: '$.user.id', name: '$.user.name' } },
        input: { user: { id: 1, name: 'John' } },
        expectedOutput: { id: 1, name: 'John' },
      },
      {
        name: 'Pick keys',
        config: { operation: 'pick', keys: ['id', 'name'] },
        input: { id: 1, name: 'John', email: 'john@example.com' },
        expectedOutput: { id: 1, name: 'John' },
      },
    ],
  },

  async execute(params: HandlerParams) {
    const config = params.step.config as unknown as TransformConfig;
    const input = params.input;

    try {
      let output: unknown;

      switch (config.operation) {
        case 'pick':
          output = typeof input === 'object' && input !== null ? pick(input as Record<string, unknown>, config.keys) : input;
          break;
        case 'omit':
          output = typeof input === 'object' && input !== null ? omit(input as Record<string, unknown>, config.keys) : input;
          break;
        case 'map':
          output = typeof input === 'object' && input !== null ? applyMapping(input as Record<string, unknown>, config.mapping) : input;
          break;
        default:
          output = input;
      }

      return {
        outcome: 'success' as const,
        output,
      };
    } catch (error) {
      return {
        outcome: 'failure' as const,
        error: {
          code: 'TRANSFORM_ERROR',
          message: error instanceof Error ? error.message : 'Transform failed',
        },
      };
    }
  },
};

function applyMapping(input: Record<string, unknown>, mapping: Record<string, string> = {}): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const [key, template] of Object.entries(mapping)) {
    const value = getValueByPath(input, template.replace(/\{\{|\}\}/g, ''));
    result[key] = value;
  }

  return result;
}

function pick(input: Record<string, unknown>, keys: string[] = []): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const key of keys) {
    if (key in input) result[key] = input[key];
  }
  return result;
}

function omit(input: Record<string, unknown>, keys: string[] = []): Record<string, unknown> {
  const result = { ...input };
  for (const key of keys) delete result[key];
  return result;
}

function getValueByPath(obj: unknown, path: string): unknown {
  if (typeof obj !== 'object' || obj === null) return undefined;
  const parts = path.split('.');
  let current: any = obj;
  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    current = current[part];
  }
  return current;
}
