/**
 * Example 12 — TestHarness
 *
 * Demonstrates:
 * - Using TestHarness for fast, simple testing
 * - Built-in assertion helpers
 * - Event capture and inspection
 * - Testing with tables and pipes
 * - Manual tick control
 *
 * This is how you'd write tests in a real project.
 * (Uses console.log instead of a test runner for portability.)
 */

import {
  TestHarness,
  type RunResult,
} from '@flowmonkey/core/test';
import {
  Result,
  type Flow,
  type StepHandler,
  type TableDef,
} from '@flowmonkey/core';

// ── Handlers ────────────────────────────────────────────────────

const echoHandler: StepHandler = {
  type: 'echo',
  async execute({ input }) {
    return Result.success(input);
  },
};

const doubleHandler: StepHandler = {
  type: 'double',
  async execute({ input }) {
    return Result.success((input as number) * 2);
  },
};

const failHandler: StepHandler = {
  type: 'fail',
  async execute({ step }) {
    return Result.failure(
      (step.config.code as string) ?? 'FAIL',
      (step.config.message as string) ?? 'Failed'
    );
  },
};

// ── Flows ───────────────────────────────────────────────────────

const mathFlow: Flow = {
  id: 'math',
  version: '1.0.0',
  initialStepId: 'double',
  steps: {
    double: {
      id: 'double',
      type: 'double',
      config: {},
      input: { type: 'key', key: 'value' },
      outputKey: 'result',
      transitions: { onSuccess: null },
    },
  },
};

const failFlow: Flow = {
  id: 'fail-flow',
  version: '1.0.0',
  initialStepId: 'fail',
  steps: {
    fail: {
      id: 'fail',
      type: 'fail',
      config: { code: 'BAD_INPUT', message: 'Invalid data' },
      input: { type: 'static', value: null },
      transitions: { onSuccess: null, onFailure: null },
    },
  },
};

// ── Test functions ──────────────────────────────────────────────

function assert(condition: boolean, msg: string) {
  if (!condition) throw new Error(`FAIL: ${msg}`);
  console.log(`  ✅ ${msg}`);
}

async function testBasicExecution() {
  console.log('--- Test: basic execution ---');
  const t = new TestHarness({
    handlers: [echoHandler, doubleHandler],
    flows: [mathFlow],
  });

  const { execution } = await t.run('math', { value: 21 });

  t.assertCompleted(execution);
  t.assertContext(execution, { result: 42 });
  assert(execution.context.result === 42, 'result is 42');
  assert(execution.stepCount === 1, 'one step executed');
}

async function testFailure() {
  console.log('\n--- Test: failure handling ---');
  const t = new TestHarness({
    handlers: [failHandler],
    flows: [failFlow],
  });

  const { execution } = await t.run('fail-flow');

  t.assertFailed(execution, 'BAD_INPUT');
  assert(execution.error?.code === 'BAD_INPUT', 'error code matches');
  assert(execution.error?.message === 'Invalid data', 'error message matches');
}

async function testEvents() {
  console.log('\n--- Test: event capture ---');
  const t = new TestHarness({
    handlers: [doubleHandler],
    flows: [mathFlow],
  });

  const { execution, events } = await t.run('math', { value: 5 });

  t.assertCompleted(execution);

  // Events are captured automatically
  const types = events.map((e: any) => e.type);
  assert(types.includes('execution.created'), 'has created event');
  assert(types.includes('step.started'), 'has step.started event');
  assert(types.includes('step.completed'), 'has step.completed event');
  assert(types.includes('execution.completed'), 'has completed event');

  // Access specific event data
  const completed = events.find((e: any) => e.type === 'step.completed');
  assert(completed.stepId === 'double', 'step.completed has correct stepId');
  assert(typeof completed.durationMs === 'number', 'step.completed has durationMs');
}

async function testHistory() {
  console.log('\n--- Test: step history ---');
  const multiFlow: Flow = {
    id: 'multi',
    version: '1.0.0',
    initialStepId: 'a',
    steps: {
      a: { id: 'a', type: 'echo', config: {}, input: { type: 'static', value: 'A' }, outputKey: 'a', transitions: { onSuccess: 'b' } },
      b: { id: 'b', type: 'echo', config: {}, input: { type: 'static', value: 'B' }, outputKey: 'b', transitions: { onSuccess: null } },
    },
  };

  const t = new TestHarness({
    handlers: [echoHandler],
    flows: [multiFlow],
    recordHistory: true,  // enabled by default in TestHarness
  });

  const { execution } = await t.run('multi');

  assert(execution.history!.length === 2, 'two history entries');
  assert(execution.history![0].stepId === 'a', 'first step is a');
  assert(execution.history![1].stepId === 'b', 'second step is b');
  assert(execution.history!.every(h => h.outcome === 'success'), 'all steps succeeded');
}

async function testWithDispatcher() {
  console.log('\n--- Test: dispatcher subscriptions ---');
  const t = new TestHarness({
    handlers: [doubleHandler],
    flows: [mathFlow],
  });

  // Use the dispatcher for typed subscriptions
  const stepDurations: number[] = [];
  t.dispatcher.on('step.completed', (e) => {
    stepDurations.push(e.durationMs);
  });

  await t.run('math', { value: 10 });

  assert(stepDurations.length === 1, 'captured one step duration');
  assert(typeof stepDurations[0] === 'number', 'duration is a number');
}

async function testIdempotency() {
  console.log('\n--- Test: idempotency ---');
  const t = new TestHarness({
    handlers: [echoHandler],
    flows: [mathFlow],
  });

  const r1 = await t.createWithResult('math', { value: 1 }, { idempotencyKey: 'key-1' });
  const r2 = await t.createWithResult('math', { value: 1 }, { idempotencyKey: 'key-1' });

  assert(r1.created === true, 'first request creates');
  assert(r2.idempotencyHit === true, 'second request is deduplicated');
  assert(r1.execution.id === r2.execution.id, 'same execution returned');
}

// ── Run all tests ───────────────────────────────────────────────

async function main() {
  await testBasicExecution();
  await testFailure();
  await testEvents();
  await testHistory();
  await testWithDispatcher();
  await testIdempotency();
  console.log('\n🎉 All tests passed!');
}

main().catch(console.error);
