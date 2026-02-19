/**
 * Example 01 — Basic Flow Execution
 *
 * Demonstrates:
 * - Defining a simple flow with two steps
 * - Creating a custom handler
 * - Setting up the engine (store, registries)
 * - Running to completion and reading results
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

// ── 1. Define a handler ─────────────────────────────────────────
//
// A handler is a function that does one thing. It receives input
// from the execution context and returns a result.

const greetHandler: StepHandler = {
  type: 'greet',
  async execute({ input }) {
    const name = (input as any)?.name ?? 'World';
    return Result.success({ greeting: `Hello, ${name}!` });
  },
};

const shoutHandler: StepHandler = {
  type: 'shout',
  async execute({ input }) {
    const text = String(input ?? '');
    return Result.success(text.toUpperCase());
  },
};

// ── 2. Define a flow ────────────────────────────────────────────
//
// A flow is a graph of steps. Each step names its handler type,
// how to pull input from context, where to store output, and
// which step to go to next.

const helloFlow: Flow = {
  id: 'hello',
  version: '1.0.0',
  initialStepId: 'greet',
  steps: {
    greet: {
      id: 'greet',
      type: 'greet',                           // matches handler.type
      config: {},
      input: { type: 'full' },                 // pass entire context as input
      outputKey: 'greetResult',                 // store output at context.greetResult
      transitions: { onSuccess: 'shout' },      // next step on success
    },
    shout: {
      id: 'shout',
      type: 'shout',
      config: {},
      input: { type: 'path', path: 'greetResult.greeting' },  // read nested value
      outputKey: 'result',
      transitions: { onSuccess: null },         // null = flow is done
    },
  },
};

// ── 3. Wire it up ───────────────────────────────────────────────

const store = new MemoryStore();
const handlers = new DefaultHandlerRegistry();
const flows = new DefaultFlowRegistry();

handlers.register(greetHandler);
handlers.register(shoutHandler);
flows.register(helloFlow);

const engine = new Engine(store, handlers, flows, undefined, {
  recordHistory: true,   // keep step-by-step execution log
});

// ── 4. Run it ───────────────────────────────────────────────────

async function main() {
  // Create an execution with initial context
  const { execution } = await engine.create('hello', { name: 'FlowMonkey' });
  console.log('Created:', execution.id, '| status:', execution.status);

  // Run to completion (simulateTime = true skips any wait delays)
  const result = await engine.run(execution.id, { simulateTime: true });
  console.log('Done:', result.status);

  // Read final state
  const final = await engine.get(execution.id);
  console.log('Context:', final?.context);
  // → { name: 'FlowMonkey', greetResult: { greeting: 'Hello, FlowMonkey!' }, result: 'HELLO, FLOWMONKEY!' }

  console.log('History:', final?.history?.map(h => `${h.stepId} (${h.outcome})`));
  // → ['greet (success)', 'shout (success)']
}

main().catch(console.error);
