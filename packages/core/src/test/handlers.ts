/**
 * Test Handlers
 *
 * Reusable step handlers for testing the execution engine.
 * Each handler demonstrates a different execution pattern.
 *
 * @see README.md for usage examples
 */
import type { StepHandler } from '../interfaces/step-handler';
import { Result } from '../types/result';

/**
 * Echo handler — returns input unchanged.
 * Useful for testing input resolution and basic flow execution.
 */
export const echoHandler: StepHandler = {
  type: 'echo',
  metadata: { type: 'echo', name: 'Echo', configSchema: { type: 'object' } },
  async execute({ input }) {
    return Result.success(input);
  },
};

/**
 * Transform handler — applies string transformations.
 * Supports: upper, lower, reverse
 */
export const transformHandler: StepHandler = {
  type: 'transform',
  metadata: { type: 'transform', name: 'Transform', configSchema: { type: 'object' } },
  async execute({ input, step }) {
    const s = String(input);
    switch (step.config.transform) {
      case 'upper': return Result.success(s.toUpperCase());
      case 'lower': return Result.success(s.toLowerCase());
      case 'reverse': return Result.success(s.split('').reverse().join(''));
      default: return Result.failure('BAD_TRANSFORM', `Unknown: ${step.config.transform}`);
    }
  },
};

/**
 * Delay handler — returns waiting status.
 * For testing, uses immediate wake (simulateTime handles timing).
 */
export const delayHandler: StepHandler = {
  type: 'delay',
  metadata: { type: 'delay', name: 'Delay', configSchema: { type: 'object' } },
  async execute() {
    // For testing with simulateTime, use immediate wake
    return Result.waitUntil(Date.now(), 'Delaying');
  },
};

/**
 * Fail handler — intentionally fails with configurable error.
 * Useful for testing onFailure transitions and error handling.
 */
export const failHandler: StepHandler = {
  type: 'fail',
  metadata: { type: 'fail', name: 'Fail', configSchema: { type: 'object' } },
  async execute({ step }) {
    return Result.failure(
      (step.config.code as string) ?? 'FAIL',
      (step.config.message as string) ?? 'Failed'
    );
  },
};

/**
 * Branch handler — conditional routing based on context values.
 * Config: { conditions: [{ path, eq, goto }], default }
 */
export const branchHandler: StepHandler = {
  type: 'branch',
  metadata: { type: 'branch', name: 'Branch', configSchema: { type: 'object' } },
  async execute({ context, step }) {
    const conditions = step.config.conditions as { path: string; eq: unknown; goto: string }[];
    for (const c of conditions) {
      if (getPath(context, c.path) === c.eq) {
        return { outcome: 'success', nextStepOverride: c.goto };
      }
    }
    const def = step.config.default as string | undefined;
    if (def) return { outcome: 'success', nextStepOverride: def };
    return Result.failure('NO_MATCH', 'No condition matched');
  },
};

/**
 * Set handler — outputs a static configured value.
 * Useful for testing outputKey and context storage.
 */
export const setHandler: StepHandler = {
  type: 'set',
  metadata: { type: 'set', name: 'Set', configSchema: { type: 'object' } },
  async execute({ step }) {
    return Result.success(step.config.value);
  },
};

/**
 * Handler that respects abort signal for testing timeout.
 */
export const slowHandler: StepHandler = {
  type: 'slow',
  metadata: { type: 'slow', name: 'Slow', configSchema: { type: 'object' } },
  async execute({ step, signal }) {
    const ms = (step.config.ms as number) ?? 5000;
    
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        resolve(Result.success('completed'));
      }, ms);

      signal?.addEventListener('abort', () => {
        clearTimeout(timeout);
        resolve(Result.failure('ABORTED', 'Handler was aborted'));
      });
    });
  },
};

/**
 * Handler that stores to context via ctx helper.
 */
export const contextSetHandler: StepHandler = {
  type: 'context-set',
  metadata: { type: 'context-set', name: 'Context Set', configSchema: { type: 'object' } },
  async execute({ step, ctx }) {
    const key = step.config.key as string;
    const value = step.config.value;
    await ctx.set(key, value);
    return Result.success(value);
  },
};

function getPath(obj: unknown, path: string): unknown {
  let c: any = obj;
  for (const p of path.split('.')) {
    if (c == null) return undefined;
    c = c[p];
  }
  return c;
}
