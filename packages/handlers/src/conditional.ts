/**
 * Conditional & Switch Handlers
 *
 * Expression-based branching beyond simple success/failure transitions.
 * Both handlers use `nextStepOverride` to direct the engine to any step.
 *
 * ## conditionalHandler
 * Evaluates a list of conditions against the input.
 * First matching condition wins — its `target` becomes the next step.
 *
 * ```typescript
 * step: {
 *   type: 'conditional',
 *   config: {
 *     conditions: [
 *       { path: 'order.total', op: 'gte', value: 1000, target: 'large-order' },
 *       { path: 'order.total', op: 'gt', value: 0, target: 'small-order' },
 *     ],
 *     default: 'manual-review',
 *   },
 *   input: { type: 'full' },
 *   transitions: { onSuccess: null }, // unused — conditional picks it
 * }
 * ```
 *
 * ## switchHandler
 * Simple value matching — looks up a context value and picks a target.
 *
 * ```typescript
 * step: {
 *   type: 'switch',
 *   config: {
 *     path: 'status',
 *     cases: { approved: 'process', rejected: 'notify', pending: 'wait' },
 *     default: 'manual-review',
 *   },
 *   input: { type: 'full' },
 *   transitions: { onSuccess: null },
 * }
 * ```
 */

import type { StepHandler, HandlerParams } from '@flowmonkey/core';

// ── Types ───────────────────────────────────────────────────────

export type ConditionOp =
  | 'eq' | 'neq'
  | 'gt' | 'gte' | 'lt' | 'lte'
  | 'in' | 'nin'
  | 'contains' | 'startsWith' | 'endsWith'
  | 'exists' | 'notExists'
  | 'matches';

export interface Condition {
  /** Dot-notation path into the input */
  path: string;
  /** Comparison operator */
  op: ConditionOp;
  /** Value to compare against (ignored for exists/notExists) */
  value?: unknown;
  /** Step ID to jump to when this condition matches */
  target: string;
}

export interface ConditionalConfig {
  conditions: Condition[];
  /** Fallback step ID if no condition matches */
  default?: string | null;
}

export interface SwitchConfig {
  /** Dot-notation path into the input */
  path: string;
  /** Value → step ID mapping */
  cases: Record<string, string>;
  /** Fallback step ID if no case matches */
  default?: string | null;
}

// ── Helpers ─────────────────────────────────────────────────────

function getPath(obj: unknown, path: string): unknown {
  if (obj == null || typeof obj !== 'object') return undefined;
  const parts = path.split('.');
  let current: unknown = obj;
  for (const part of parts) {
    if (current == null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function evaluate(actual: unknown, op: ConditionOp, expected: unknown): boolean {
  switch (op) {
    case 'eq': return actual === expected;
    case 'neq': return actual !== expected;
    case 'gt': return (actual as number) > (expected as number);
    case 'gte': return (actual as number) >= (expected as number);
    case 'lt': return (actual as number) < (expected as number);
    case 'lte': return (actual as number) <= (expected as number);
    case 'in': return Array.isArray(expected) && expected.includes(actual);
    case 'nin': return Array.isArray(expected) && !expected.includes(actual);
    case 'contains':
      return typeof actual === 'string' && typeof expected === 'string' && actual.includes(expected);
    case 'startsWith':
      return typeof actual === 'string' && typeof expected === 'string' && actual.startsWith(expected);
    case 'endsWith':
      return typeof actual === 'string' && typeof expected === 'string' && actual.endsWith(expected);
    case 'exists': return actual !== undefined && actual !== null;
    case 'notExists': return actual === undefined || actual === null;
    case 'matches':
      return typeof actual === 'string' && typeof expected === 'string' && new RegExp(expected).test(actual);
    default: return false;
  }
}

// ── Conditional Handler ─────────────────────────────────────────

export const conditionalHandler: StepHandler = {
  type: 'conditional',
  metadata: {
    type: 'conditional',
    name: 'Conditional',
    description: 'Evaluate conditions against input and branch to the first matching step',
    category: 'control',
    stateful: false,
    configSchema: {
      type: 'object',
      properties: {
        conditions: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              path: { type: 'string' },
              op: { type: 'string' },
              value: {},
              target: { type: 'string' },
            },
            required: ['path', 'op', 'target'],
          },
        },
        default: { type: 'string' },
      },
      required: ['conditions'],
    },
  },
  async execute(params: HandlerParams) {
    const config = params.step.config as unknown as ConditionalConfig;
    const input = params.input;

    if (!config.conditions?.length) {
      return {
        outcome: 'failure' as const,
        error: { code: 'MISSING_CONDITIONS', message: 'No conditions defined' },
      };
    }

    for (const condition of config.conditions) {
      const actual = getPath(input, condition.path);
      if (evaluate(actual, condition.op, condition.value)) {
        return {
          outcome: 'success' as const,
          output: { matched: condition.path, op: condition.op, target: condition.target },
          nextStepOverride: condition.target,
        };
      }
    }

    // No match — use default or fail
    if (config.default !== undefined) {
      return {
        outcome: 'success' as const,
        output: { matched: null, target: config.default },
        nextStepOverride: config.default,
      };
    }

    return {
      outcome: 'failure' as const,
      error: { code: 'NO_MATCH', message: 'No condition matched and no default defined' },
    };
  },
};

// ── Switch Handler ──────────────────────────────────────────────

export const switchHandler: StepHandler = {
  type: 'switch',
  metadata: {
    type: 'switch',
    name: 'Switch',
    description: 'Match a value against cases and branch to the matching step',
    category: 'control',
    stateful: false,
    configSchema: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        cases: { type: 'object' },
        default: { type: 'string' },
      },
      required: ['path', 'cases'],
    },
  },
  async execute(params: HandlerParams) {
    const config = params.step.config as unknown as SwitchConfig;
    const input = params.input;

    if (!config.path) {
      return {
        outcome: 'failure' as const,
        error: { code: 'MISSING_PATH', message: 'No path defined in switch config' },
      };
    }

    const value = getPath(input, config.path);
    const key = String(value);
    const target = config.cases?.[key];

    if (target) {
      return {
        outcome: 'success' as const,
        output: { path: config.path, value, target },
        nextStepOverride: target,
      };
    }

    if (config.default !== undefined) {
      return {
        outcome: 'success' as const,
        output: { path: config.path, value, target: config.default },
        nextStepOverride: config.default,
      };
    }

    return {
      outcome: 'failure' as const,
      error: { code: 'NO_MATCH', message: `No case matched value "${key}" and no default defined` },
    };
  },
};
