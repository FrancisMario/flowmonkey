import type { StepHandler, HandlerParams, CheckpointManager, ContextHelpers, Step, Execution } from '@flowmonkey/core';

/**
 * Create mock context helpers for testing
 */
function createMockContextHelpers(context: Record<string, unknown>): ContextHelpers {
  return {
    get: async <T = unknown>(key: string): Promise<T> => context[key] as T,
    set: async (key: string, value: unknown) => {
      context[key] = value;
    },
    has: (key: string) => key in context,
    delete: async (key: string) => {
      delete context[key];
    },
    getAll: async <T = Record<string, unknown>>(keys: string[]): Promise<T> => {
      const result: Record<string, unknown> = {};
      for (const key of keys) {
        result[key] = context[key];
      }
      return result as T;
    },
  };
}

/**
 * Create mock checkpoint manager for testing
 */
function createMockCheckpointManager(): CheckpointManager {
  const checkpoints = new Map<string, unknown>();
  return {
    save: async (key: string, data: unknown) => {
      checkpoints.set(key, data);
    },
    restore: async <T = unknown>(key: string): Promise<T | null> => {
      return (checkpoints.get(key) as T) || null;
    },
    list: async () => Array.from(checkpoints.keys()),
    delete: async (key: string) => {
      checkpoints.delete(key);
    },
    clear: async () => {
      checkpoints.clear();
    },
  };
}

/**
 * Create mock handler params for testing
 */
export function createMockParams(overrides?: Partial<HandlerParams>): HandlerParams {
  const executionId = 'exec_test_123';
  const context: Record<string, unknown> = {};

  return {
    step: {
      id: 'test-step',
      type: 'test',
      config: {},
      input: { type: 'full' },
      outputKey: 'result',
      transitions: { onSuccess: null },
    } as Step,
    input: null,
    context,
    ctx: createMockContextHelpers(context),
    execution: {
      id: executionId,
      flowId: 'test-flow',
      flowVersion: '1.0',
      currentStepId: 'test-step',
      status: 'running',
      context,
      stepCount: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    } as Execution,
    checkpoints: createMockCheckpointManager(),
    signal: new AbortController().signal,
    ...overrides,
  };
}

/**
 * Test a handler with given config and input
 */
export async function testHandler(handler: StepHandler, config: Record<string, unknown>, input?: unknown) {
  const params = createMockParams({
    step: {
      id: 'test',
      type: handler.type,
      config,
      input: { type: 'static', value: input },
      outputKey: 'result',
      transitions: { onSuccess: null },
    } as Step,
    input,
  });

  return await handler.execute(params);
}

/**
 * Assert handler result is success
 */
export function assertSuccess(result: any): asserts result is { outcome: 'success'; output: unknown } {
  if (result.outcome !== 'success') {
    throw new Error(`Expected success, got ${result.outcome}`);
  }
}

/**
 * Assert handler result is failure
 */
export function assertFailure(result: any): asserts result is { outcome: 'failure'; error: { code: string; message: string } } {
  if (result.outcome !== 'failure') {
    throw new Error(`Expected failure, got ${result.outcome}`);
  }
}

/**
 * Assert handler result is waiting
 */
export function assertWaiting(result: any): asserts result is { outcome: 'waiting'; resumeToken?: string } {
  if (result.outcome !== 'wait' && result.outcome !== 'waiting' && result.outcome !== 'waited') {
    throw new Error(`Expected waiting, got ${result.outcome}`);
  }
}
