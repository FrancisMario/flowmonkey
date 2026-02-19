/**
 * Retry, Conditional, Switch and Sub-flow Tests
 *
 * Covers:
 * - Step retry with backoff (engine feature)
 * - Conditional handler — multi-condition branching
 * - Switch handler — value-based routing
 * - Sub-flow handler — child execution spawning
 */

import { describe, it, expect } from 'vitest';
import { TestHarness } from './harness';
import type { Flow } from '../types/flow';
import type { StepHandler } from '../interfaces/step-handler';

// ── Helper Handlers ─────────────────────────────────────────────

const echoHandler: StepHandler = {
  type: 'echo',
  async execute(params) {
    return { outcome: 'success', output: params.input };
  },
};

/** Creates a handler that fails N times, then succeeds */
function createFlaky(failTimes: number): StepHandler {
  let failCount = 0;
  return {
    type: 'flaky',
    async execute() {
      failCount++;
      if (failCount <= failTimes) {
        return { outcome: 'failure', error: { code: 'FLAKY', message: `Fail #${failCount}` } };
      }
      return { outcome: 'success', output: { attempts: failCount } };
    },
  };
}

/** Always fails with a specific code */
const alwaysFailHandler: StepHandler = {
  type: 'always-fail',
  async execute() {
    return { outcome: 'failure', error: { code: 'PERMANENT', message: 'Always fails' } };
  },
};

const doneHandler: StepHandler = {
  type: 'done',
  async execute() {
    return { outcome: 'success', output: 'done' };
  },
};

// ── Inline Conditional/Switch Handlers ──────────────────────────

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

const conditionalHandler: StepHandler = {
  type: 'conditional',
  async execute(params) {
    const config = params.step.config as any;
    const input = params.input;
    for (const cond of (config.conditions ?? [])) {
      const actual = getPath(input, cond.path);
      let match = false;
      switch (cond.op) {
        case 'eq': match = actual === cond.value; break;
        case 'neq': match = actual !== cond.value; break;
        case 'gt': match = (actual as number) > cond.value; break;
        case 'gte': match = (actual as number) >= cond.value; break;
        case 'lt': match = (actual as number) < cond.value; break;
        case 'lte': match = (actual as number) <= cond.value; break;
        case 'exists': match = actual !== undefined && actual !== null; break;
        case 'in': match = Array.isArray(cond.value) && cond.value.includes(actual); break;
      }
      if (match) {
        return { outcome: 'success', output: { matched: cond.path, target: cond.target }, nextStepOverride: cond.target };
      }
    }
    if (config.default !== undefined) {
      return { outcome: 'success', output: { matched: null, target: config.default }, nextStepOverride: config.default };
    }
    return { outcome: 'failure', error: { code: 'NO_MATCH', message: 'No condition matched' } };
  },
};

const switchHandlerImpl: StepHandler = {
  type: 'switch',
  async execute(params) {
    const config = params.step.config as any;
    const input = params.input;
    const value = getPath(input, config.path);
    const key = String(value);
    const target = config.cases?.[key];
    if (target) {
      return { outcome: 'success', output: { value, target }, nextStepOverride: target };
    }
    if (config.default !== undefined) {
      return { outcome: 'success', output: { value, target: config.default }, nextStepOverride: config.default };
    }
    return { outcome: 'failure', error: { code: 'NO_MATCH', message: `No case for "${key}"` } };
  },
};

// ── Inline Sub-flow Handler (avoids cross-package import) ───────

function createSubFlowHandler(engine: any): StepHandler {
  return {
    type: 'sub-flow',
    async execute(params) {
      const config = params.step.config as any;
      if (!config.flowId) {
        return { outcome: 'failure' as const, error: { code: 'MISSING_FLOW_ID', message: 'flowId required' } };
      }
      const childContext = (params.input ?? {}) as Record<string, unknown>;
      const waitForCompletion = config.waitForCompletion !== false;

      const { execution: child } = await engine.create(config.flowId, childContext, {
        parentExecutionId: params.execution.id,
        tenantId: config.tenantId ?? params.execution.tenantId,
        metadata: config.metadata,
      });

      if (!waitForCompletion) {
        return {
          outcome: 'success' as const,
          output: { childExecutionId: child.id, flowId: config.flowId, mode: 'fire-and-forget' },
        };
      }

      const result = await engine.run(child.id, { simulateTime: true });

      if (result.status === 'completed') {
        const final = await engine.get(child.id);
        return {
          outcome: 'success' as const,
          output: { childExecutionId: child.id, flowId: config.flowId, status: 'completed', context: final?.context ?? {} },
        };
      }

      return {
        outcome: 'failure' as const,
        error: { code: 'CHILD_FAILED', message: `Child ${child.id} status: ${result.status}` },
      };
    },
  };
}

// ── Retry Tests ─────────────────────────────────────────────────

describe('Step retry/backoff', () => {
  it('retries on failure and eventually succeeds', async () => {
    const flaky = createFlaky(2); // fail 2 times, then succeed

    const flow: Flow = {
      id: 'retry-test',
      version: '1.0.0',
      initialStepId: 'step1',
      steps: {
        step1: {
          id: 'step1',
          type: 'flaky',
          config: {},
          input: { type: 'static', value: {} },
          outputKey: 'result',
          transitions: { onSuccess: null, onFailure: null },
          retry: { maxAttempts: 3 },
        },
      },
    };

    const t = new TestHarness({ handlers: [flaky], flows: [flow] });
    const { execution } = await t.run('retry-test');

    t.assertCompleted(execution);
    expect(execution.context.result).toEqual({ attempts: 3 });

    // Should have emitted retry events
    const retries = t.events.filter(e => e.type === 'step.retry');
    expect(retries).toHaveLength(2);
    expect(retries[0].attempt).toBe(1);
    expect(retries[1].attempt).toBe(2);
  });

  it('exhausts retries then follows onFailure', async () => {
    const flow: Flow = {
      id: 'retry-exhaust',
      version: '1.0.0',
      initialStepId: 'step1',
      steps: {
        step1: {
          id: 'step1',
          type: 'always-fail',
          config: {},
          input: { type: 'static', value: {} },
          transitions: { onSuccess: null, onFailure: 'fallback' },
          retry: { maxAttempts: 2 },
        },
        fallback: {
          id: 'fallback',
          type: 'done',
          config: {},
          input: { type: 'static', value: {} },
          outputKey: 'fallback',
          transitions: { onSuccess: null, onFailure: null },
        },
      },
    };

    const t = new TestHarness({ handlers: [alwaysFailHandler, doneHandler], flows: [flow] });
    const { execution } = await t.run('retry-exhaust');

    t.assertCompleted(execution);
    expect(execution.context.fallback).toBe('done');

    const retries = t.events.filter(e => e.type === 'step.retry');
    expect(retries).toHaveLength(2);
  });

  it('exhausts retries and fails when no onFailure', async () => {
    const flow: Flow = {
      id: 'retry-fail',
      version: '1.0.0',
      initialStepId: 'step1',
      steps: {
        step1: {
          id: 'step1',
          type: 'always-fail',
          config: {},
          input: { type: 'static', value: {} },
          transitions: { onSuccess: null, onFailure: null },
          retry: { maxAttempts: 1 },
        },
      },
    };

    const t = new TestHarness({ handlers: [alwaysFailHandler], flows: [flow] });
    const { execution } = await t.run('retry-fail');

    t.assertFailed(execution);
    const retries = t.events.filter(e => e.type === 'step.retry');
    expect(retries).toHaveLength(1);
  });

  it('applies backoff delay between retries', async () => {
    const flaky = createFlaky(1);

    const flow: Flow = {
      id: 'retry-backoff',
      version: '1.0.0',
      initialStepId: 'step1',
      steps: {
        step1: {
          id: 'step1',
          type: 'flaky',
          config: {},
          input: { type: 'static', value: {} },
          outputKey: 'result',
          transitions: { onSuccess: null, onFailure: null },
          retry: { maxAttempts: 3, backoffMs: 100 },
        },
      },
    };

    const t = new TestHarness({ handlers: [flaky], flows: [flow] });
    const { execution } = await t.run('retry-backoff');

    t.assertCompleted(execution);

    const retries = t.events.filter(e => e.type === 'step.retry');
    expect(retries).toHaveLength(1);
    expect(retries[0].backoffMs).toBe(100); // 100 * 2^0 = 100
  });

  it('respects retryOn filter', async () => {
    const flow: Flow = {
      id: 'retry-filter',
      version: '1.0.0',
      initialStepId: 'step1',
      steps: {
        step1: {
          id: 'step1',
          type: 'always-fail',
          config: {},
          input: { type: 'static', value: {} },
          transitions: { onSuccess: null, onFailure: null },
          retry: { maxAttempts: 3, retryOn: ['TRANSIENT'] }, // PERMANENT not in list
        },
      },
    };

    const t = new TestHarness({ handlers: [alwaysFailHandler], flows: [flow] });
    const { execution } = await t.run('retry-filter');

    // Should fail immediately — error code PERMANENT is not in retryOn
    t.assertFailed(execution);
    const retries = t.events.filter(e => e.type === 'step.retry');
    expect(retries).toHaveLength(0);
  });

  it('clears retry counter on success', async () => {
    const flaky = createFlaky(1);

    const flow: Flow = {
      id: 'retry-clear',
      version: '1.0.0',
      initialStepId: 'step1',
      steps: {
        step1: {
          id: 'step1',
          type: 'flaky',
          config: {},
          input: { type: 'static', value: {} },
          outputKey: 'result',
          transitions: { onSuccess: null, onFailure: null },
          retry: { maxAttempts: 5 },
        },
      },
    };

    const t = new TestHarness({ handlers: [flaky], flows: [flow] });
    const { execution } = await t.run('retry-clear');

    t.assertCompleted(execution);
    // After success, retryAttempts should be cleared
    expect(execution.retryAttempts?.['step1']).toBeUndefined();
  });
});

// ── Conditional Handler Tests ───────────────────────────────────

describe('Conditional handler', () => {
  const makeFlow = (conditions: any[], defaultTarget?: string | null): Flow => ({
    id: 'cond-test',
    version: '1.0.0',
    initialStepId: 'route',
    steps: {
      route: {
        id: 'route',
        type: 'conditional',
        config: { conditions, default: defaultTarget },
        input: { type: 'full' },
        outputKey: 'routeResult',
        transitions: { onSuccess: null, onFailure: null },
      },
      approved: {
        id: 'approved',
        type: 'echo',
        config: {},
        input: { type: 'static', value: 'approved' },
        outputKey: 'status',
        transitions: { onSuccess: null, onFailure: null },
      },
      rejected: {
        id: 'rejected',
        type: 'echo',
        config: {},
        input: { type: 'static', value: 'rejected' },
        outputKey: 'status',
        transitions: { onSuccess: null, onFailure: null },
      },
      fallback: {
        id: 'fallback',
        type: 'echo',
        config: {},
        input: { type: 'static', value: 'fallback' },
        outputKey: 'status',
        transitions: { onSuccess: null, onFailure: null },
      },
    },
  });

  it('routes to first matching condition', async () => {
    const flow = makeFlow([
      { path: 'score', op: 'gte', value: 80, target: 'approved' },
      { path: 'score', op: 'lt', value: 80, target: 'rejected' },
    ]);

    const t = new TestHarness({ handlers: [conditionalHandler, echoHandler], flows: [flow] });
    const { execution } = await t.run('cond-test', { score: 90 });

    t.assertCompleted(execution);
    expect(execution.context.status).toBe('approved');
  });

  it('routes to second condition when first doesnt match', async () => {
    const flow = makeFlow([
      { path: 'score', op: 'gte', value: 80, target: 'approved' },
      { path: 'score', op: 'lt', value: 80, target: 'rejected' },
    ]);

    const t = new TestHarness({ handlers: [conditionalHandler, echoHandler], flows: [flow] });
    const { execution } = await t.run('cond-test', { score: 50 });

    t.assertCompleted(execution);
    expect(execution.context.status).toBe('rejected');
  });

  it('uses default when no condition matches', async () => {
    const flow = makeFlow([
      { path: 'score', op: 'gt', value: 100, target: 'approved' },
    ], 'fallback');

    const t = new TestHarness({ handlers: [conditionalHandler, echoHandler], flows: [flow] });
    const { execution } = await t.run('cond-test', { score: 50 });

    t.assertCompleted(execution);
    expect(execution.context.status).toBe('fallback');
  });

  it('fails when no match and no default', async () => {
    const flow = makeFlow([
      { path: 'score', op: 'gt', value: 100, target: 'approved' },
    ]);

    const t = new TestHarness({ handlers: [conditionalHandler, echoHandler], flows: [flow] });
    const { execution } = await t.run('cond-test', { score: 50 });

    t.assertFailed(execution);
  });

  it('supports nested path evaluation', async () => {
    const flow = makeFlow([
      { path: 'user.role', op: 'eq', value: 'admin', target: 'approved' },
    ], 'rejected');

    const t = new TestHarness({ handlers: [conditionalHandler, echoHandler], flows: [flow] });
    const { execution } = await t.run('cond-test', { user: { role: 'admin' } });

    t.assertCompleted(execution);
    expect(execution.context.status).toBe('approved');
  });

  it('supports exists operator', async () => {
    const flow = makeFlow([
      { path: 'token', op: 'exists', target: 'approved' },
    ], 'rejected');

    const t = new TestHarness({ handlers: [conditionalHandler, echoHandler], flows: [flow] });
    const { execution } = await t.run('cond-test', { token: 'abc123' });

    t.assertCompleted(execution);
    expect(execution.context.status).toBe('approved');
  });

  it('supports in operator', async () => {
    const flow = makeFlow([
      { path: 'status', op: 'in', value: ['active', 'pending'], target: 'approved' },
    ], 'rejected');

    const t = new TestHarness({ handlers: [conditionalHandler, echoHandler], flows: [flow] });
    const { execution } = await t.run('cond-test', { status: 'active' });

    t.assertCompleted(execution);
    expect(execution.context.status).toBe('approved');
  });
});

// ── Switch Handler Tests ────────────────────────────────────────

describe('Switch handler', () => {
  const switchFlow: Flow = {
    id: 'switch-test',
    version: '1.0.0',
    initialStepId: 'route',
    steps: {
      route: {
        id: 'route',
        type: 'switch',
        config: {
          path: 'action',
          cases: { create: 'handle-create', update: 'handle-update', delete: 'handle-delete' },
          default: 'handle-unknown',
        },
        input: { type: 'full' },
        transitions: { onSuccess: null, onFailure: null },
      },
      'handle-create': {
        id: 'handle-create',
        type: 'echo',
        config: {},
        input: { type: 'static', value: 'created' },
        outputKey: 'result',
        transitions: { onSuccess: null, onFailure: null },
      },
      'handle-update': {
        id: 'handle-update',
        type: 'echo',
        config: {},
        input: { type: 'static', value: 'updated' },
        outputKey: 'result',
        transitions: { onSuccess: null, onFailure: null },
      },
      'handle-delete': {
        id: 'handle-delete',
        type: 'echo',
        config: {},
        input: { type: 'static', value: 'deleted' },
        outputKey: 'result',
        transitions: { onSuccess: null, onFailure: null },
      },
      'handle-unknown': {
        id: 'handle-unknown',
        type: 'echo',
        config: {},
        input: { type: 'static', value: 'unknown' },
        outputKey: 'result',
        transitions: { onSuccess: null, onFailure: null },
      },
    },
  };

  it('routes to matching case', async () => {
    const t = new TestHarness({ handlers: [switchHandlerImpl, echoHandler], flows: [switchFlow] });
    const { execution } = await t.run('switch-test', { action: 'create' });

    t.assertCompleted(execution);
    expect(execution.context.result).toBe('created');
  });

  it('routes to different case', async () => {
    const t = new TestHarness({ handlers: [switchHandlerImpl, echoHandler], flows: [switchFlow] });
    const { execution } = await t.run('switch-test', { action: 'delete' });

    t.assertCompleted(execution);
    expect(execution.context.result).toBe('deleted');
  });

  it('uses default when no case matches', async () => {
    const t = new TestHarness({ handlers: [switchHandlerImpl, echoHandler], flows: [switchFlow] });
    const { execution } = await t.run('switch-test', { action: 'archive' });

    t.assertCompleted(execution);
    expect(execution.context.result).toBe('unknown');
  });

  it('works with numeric values', async () => {
    const numFlow: Flow = {
      id: 'num-switch',
      version: '1.0.0',
      initialStepId: 'route',
      steps: {
        route: {
          id: 'route',
          type: 'switch',
          config: {
            path: 'code',
            cases: { '200': 'ok', '404': 'not-found', '500': 'error' },
            default: 'other',
          },
          input: { type: 'full' },
          transitions: { onSuccess: null, onFailure: null },
        },
        ok: {
          id: 'ok', type: 'echo', config: {},
          input: { type: 'static', value: 'ok' }, outputKey: 'result',
          transitions: { onSuccess: null, onFailure: null },
        },
        'not-found': {
          id: 'not-found', type: 'echo', config: {},
          input: { type: 'static', value: '404' }, outputKey: 'result',
          transitions: { onSuccess: null, onFailure: null },
        },
        error: {
          id: 'error', type: 'echo', config: {},
          input: { type: 'static', value: '500' }, outputKey: 'result',
          transitions: { onSuccess: null, onFailure: null },
        },
        other: {
          id: 'other', type: 'echo', config: {},
          input: { type: 'static', value: 'other' }, outputKey: 'result',
          transitions: { onSuccess: null, onFailure: null },
        },
      },
    };

    const t = new TestHarness({ handlers: [switchHandlerImpl, echoHandler], flows: [numFlow] });
    const { execution } = await t.run('num-switch', { code: 404 });

    t.assertCompleted(execution);
    expect(execution.context.result).toBe('404');
  });
});

// ── Sub-flow Handler Tests ──────────────────────────────────────

describe('Sub-flow handler', () => {
  it('runs child flow to completion and returns context', async () => {
    const parentFlow: Flow = {
      id: 'parent',
      version: '1.0.0',
      initialStepId: 'spawn',
      steps: {
        spawn: {
          id: 'spawn',
          type: 'sub-flow',
          config: { flowId: 'child', waitForCompletion: true },
          input: { type: 'static', value: { x: 42 } },
          outputKey: 'childResult',
          transitions: { onSuccess: null, onFailure: null },
        },
      },
    };

    const childFlow: Flow = {
      id: 'child',
      version: '1.0.0',
      initialStepId: 'double',
      steps: {
        double: {
          id: 'double',
          type: 'echo',
          config: {},
          input: { type: 'full' },
          outputKey: 'output',
          transitions: { onSuccess: null, onFailure: null },
        },
      },
    };

    const t = new TestHarness({
      handlers: [echoHandler],
      flows: [parentFlow, childFlow],
    });

    // Register sub-flow handler that uses the engine
    const subFlow = createSubFlowHandler(t.engine);
    t.handlers.register(subFlow);

    const { execution } = await t.run('parent');

    t.assertCompleted(execution);
    const result = execution.context.childResult as any;
    expect(result.status).toBe('completed');
    expect(result.context.x).toBe(42);
  });

  it('fire-and-forget mode returns child ID immediately', async () => {
    const parentFlow: Flow = {
      id: 'parent-ff',
      version: '1.0.0',
      initialStepId: 'spawn',
      steps: {
        spawn: {
          id: 'spawn',
          type: 'sub-flow',
          config: { flowId: 'child', waitForCompletion: false },
          input: { type: 'static', value: { x: 1 } },
          outputKey: 'childRef',
          transitions: { onSuccess: null, onFailure: null },
        },
      },
    };

    const childFlow: Flow = {
      id: 'child',
      version: '1.0.0',
      initialStepId: 'step1',
      steps: {
        step1: {
          id: 'step1',
          type: 'echo',
          config: {},
          input: { type: 'full' },
          outputKey: 'out',
          transitions: { onSuccess: null, onFailure: null },
        },
      },
    };

    const t = new TestHarness({
      handlers: [echoHandler],
      flows: [parentFlow, childFlow],
    });

    const subFlow = createSubFlowHandler(t.engine);
    t.handlers.register(subFlow);

    const { execution } = await t.run('parent-ff');

    t.assertCompleted(execution);
    const ref = execution.context.childRef as any;
    expect(ref.mode).toBe('fire-and-forget');
    expect(ref.childExecutionId).toBeDefined();
  });

  it('returns failure when child flow fails', async () => {
    const parentFlow: Flow = {
      id: 'parent-fail',
      version: '1.0.0',
      initialStepId: 'spawn',
      steps: {
        spawn: {
          id: 'spawn',
          type: 'sub-flow',
          config: { flowId: 'fail-child', waitForCompletion: true },
          input: { type: 'static', value: {} },
          transitions: { onSuccess: null, onFailure: null },
        },
      },
    };

    const failChild: Flow = {
      id: 'fail-child',
      version: '1.0.0',
      initialStepId: 'fail',
      steps: {
        fail: {
          id: 'fail',
          type: 'always-fail',
          config: {},
          input: { type: 'static', value: {} },
          transitions: { onSuccess: null, onFailure: null },
        },
      },
    };

    const t = new TestHarness({
      handlers: [alwaysFailHandler],
      flows: [parentFlow, failChild],
    });

    const subFlow = createSubFlowHandler(t.engine);
    t.handlers.register(subFlow);

    const { execution } = await t.run('parent-fail');

    t.assertFailed(execution);
  });

  it('links child to parent via parentExecutionId', async () => {
    const parentFlow: Flow = {
      id: 'parent-link',
      version: '1.0.0',
      initialStepId: 'spawn',
      steps: {
        spawn: {
          id: 'spawn',
          type: 'sub-flow',
          config: { flowId: 'child', waitForCompletion: true },
          input: { type: 'static', value: { data: 'test' } },
          outputKey: 'childResult',
          transitions: { onSuccess: null, onFailure: null },
        },
      },
    };

    const childFlow: Flow = {
      id: 'child',
      version: '1.0.0',
      initialStepId: 's1',
      steps: {
        s1: {
          id: 's1',
          type: 'echo',
          config: {},
          input: { type: 'full' },
          transitions: { onSuccess: null, onFailure: null },
        },
      },
    };

    const t = new TestHarness({
      handlers: [echoHandler],
      flows: [parentFlow, childFlow],
    });

    const subFlow = createSubFlowHandler(t.engine);
    t.handlers.register(subFlow);

    const { execution: parent } = await t.run('parent-link');

    // Find child execution in the store
    const result = parent.context.childResult as any;
    const child = await t.engine.get(result.childExecutionId);
    expect(child).not.toBeNull();
    expect(child!.parentExecutionId).toBe(parent.id);
  });
});
