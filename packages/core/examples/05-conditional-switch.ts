/**
 * Example 05 — Conditional & Switch Routing
 *
 * Demonstrates:
 * - Conditional handler — evaluate conditions with operators
 * - Switch handler — simple value-based routing
 * - nextStepOverride for dynamic step transitions
 */

import {
  Engine,
  MemoryStore,
  DefaultHandlerRegistry,
  DefaultFlowRegistry,
  Result,
  type Flow,
  type StepHandler,
} from '@flowmonkey/core';

// ── Conditional handler (evaluates conditions) ──────────────────

function getPath(obj: unknown, path: string): unknown {
  let current: any = obj;
  for (const part of path.split('.')) {
    if (current == null) return undefined;
    current = current[part];
  }
  return current;
}

const conditionalHandler: StepHandler = {
  type: 'conditional',
  async execute({ input, step }) {
    const config = step.config as any;
    for (const cond of config.conditions ?? []) {
      const actual = getPath(input, cond.path);
      let match = false;
      switch (cond.op) {
        case 'eq':  match = actual === cond.value; break;
        case 'gt':  match = (actual as number) > cond.value; break;
        case 'gte': match = (actual as number) >= cond.value; break;
        case 'lt':  match = (actual as number) < cond.value; break;
        case 'in':  match = Array.isArray(cond.value) && cond.value.includes(actual); break;
      }
      if (match) {
        return { outcome: 'success' as const, output: { matched: cond.path }, nextStepOverride: cond.target };
      }
    }
    if (config.default) {
      return { outcome: 'success' as const, output: { matched: null }, nextStepOverride: config.default };
    }
    return Result.failure('NO_MATCH', 'No condition matched');
  },
};

// ── Switch handler (value lookup) ───────────────────────────────

const switchHandler: StepHandler = {
  type: 'switch',
  async execute({ input, step }) {
    const config = step.config as any;
    const value = getPath(input, config.path);
    const target = config.cases?.[String(value)];
    if (target) {
      return { outcome: 'success' as const, output: { value, target }, nextStepOverride: target };
    }
    if (config.default) {
      return { outcome: 'success' as const, output: { value }, nextStepOverride: config.default };
    }
    return Result.failure('NO_MATCH', `No case for "${value}"`);
  },
};

// ── Simple result handler ───────────────────────────────────────

const setHandler: StepHandler = {
  type: 'set',
  async execute({ step }) { return Result.success(step.config.value); },
};

// ── Conditional flow: route by age ──────────────────────────────

const ageCheckFlow: Flow = {
  id: 'age-check',
  version: '1.0.0',
  initialStepId: 'check',
  steps: {
    check: {
      id: 'check',
      type: 'conditional',
      config: {
        conditions: [
          { path: 'age', op: 'lt', value: 13, target: 'child' },
          { path: 'age', op: 'lt', value: 18, target: 'teen' },
        ],
        default: 'adult',
      },
      input: { type: 'full' },
      transitions: { onSuccess: null, onFailure: null },
    },
    child:  { id: 'child',  type: 'set', config: { value: 'child' },  input: { type: 'static', value: null }, outputKey: 'category', transitions: { onSuccess: null } },
    teen:   { id: 'teen',   type: 'set', config: { value: 'teen' },   input: { type: 'static', value: null }, outputKey: 'category', transitions: { onSuccess: null } },
    adult:  { id: 'adult',  type: 'set', config: { value: 'adult' },  input: { type: 'static', value: null }, outputKey: 'category', transitions: { onSuccess: null } },
  },
};

// ── Switch flow: route by HTTP method ───────────────────────────

const routerFlow: Flow = {
  id: 'router',
  version: '1.0.0',
  initialStepId: 'route',
  steps: {
    route: {
      id: 'route',
      type: 'switch',
      config: {
        path: 'method',
        cases: { GET: 'handle-get', POST: 'handle-post', DELETE: 'handle-delete' },
        default: 'handle-other',
      },
      input: { type: 'full' },
      transitions: { onSuccess: null, onFailure: null },
    },
    'handle-get':    { id: 'handle-get',    type: 'set', config: { value: '200 OK' },          input: { type: 'static', value: null }, outputKey: 'response', transitions: { onSuccess: null } },
    'handle-post':   { id: 'handle-post',   type: 'set', config: { value: '201 Created' },     input: { type: 'static', value: null }, outputKey: 'response', transitions: { onSuccess: null } },
    'handle-delete': { id: 'handle-delete', type: 'set', config: { value: '204 No Content' },  input: { type: 'static', value: null }, outputKey: 'response', transitions: { onSuccess: null } },
    'handle-other':  { id: 'handle-other',  type: 'set', config: { value: '405 Not Allowed' }, input: { type: 'static', value: null }, outputKey: 'response', transitions: { onSuccess: null } },
  },
};

// ── Run ─────────────────────────────────────────────────────────

async function main() {
  const store = new MemoryStore();
  const handlers = new DefaultHandlerRegistry();
  const flows = new DefaultFlowRegistry();

  [conditionalHandler, switchHandler, setHandler].forEach(h => handlers.register(h));
  [ageCheckFlow, routerFlow].forEach(f => flows.register(f));

  const engine = new Engine(store, handlers, flows);

  // Conditional: test different ages
  console.log('--- Conditional Routing ---');
  for (const age of [8, 15, 25]) {
    const { execution } = await engine.create('age-check', { age });
    await engine.run(execution.id, { simulateTime: true });
    const final = await engine.get(execution.id);
    console.log(`  age=${age} → ${final?.context.category}`);
  }

  // Switch: test different methods
  console.log('\n--- Switch Routing ---');
  for (const method of ['GET', 'POST', 'PATCH']) {
    const { execution } = await engine.create('router', { method });
    await engine.run(execution.id, { simulateTime: true });
    const final = await engine.get(execution.id);
    console.log(`  ${method} → ${final?.context.response}`);
  }
}

main().catch(console.error);
