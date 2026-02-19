/**
 * Example 02 — Input Selectors
 *
 * Demonstrates all 6 ways to pull input from the execution context:
 * - key — single context key
 * - keys — pick multiple keys
 * - path — dot-notation into nested objects
 * - template — string interpolation with ${path}
 * - full — entire context object
 * - static — hardcoded value (ignores context)
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

// Handler that just echoes whatever it receives
const echoHandler: StepHandler = {
  type: 'echo',
  async execute({ input }) {
    return Result.success(input);
  },
};

// ── Flow with one step per selector type ────────────────────────

const flow: Flow = {
  id: 'input-demo',
  version: '1.0.0',
  initialStepId: 'step-key',
  steps: {
    // 1) key — reads context["user"]
    'step-key': {
      id: 'step-key',
      type: 'echo',
      config: {},
      input: { type: 'key', key: 'user' },
      outputKey: 'from_key',
      transitions: { onSuccess: 'step-keys' },
    },

    // 2) keys — picks { user, score } from context
    'step-keys': {
      id: 'step-keys',
      type: 'echo',
      config: {},
      input: { type: 'keys', keys: ['user', 'score'] },
      outputKey: 'from_keys',
      transitions: { onSuccess: 'step-path' },
    },

    // 3) path — dot notation "user.email"
    'step-path': {
      id: 'step-path',
      type: 'echo',
      config: {},
      input: { type: 'path', path: 'user.email' },
      outputKey: 'from_path',
      transitions: { onSuccess: 'step-template' },
    },

    // 4) template — interpolates "${user.name} scored ${score}"
    'step-template': {
      id: 'step-template',
      type: 'echo',
      config: {},
      input: { type: 'template', template: '${user.name} scored ${score}' },
      outputKey: 'from_template',
      transitions: { onSuccess: 'step-full' },
    },

    // 5) full — entire context as input
    'step-full': {
      id: 'step-full',
      type: 'echo',
      config: {},
      input: { type: 'full' },
      outputKey: 'from_full',
      transitions: { onSuccess: 'step-static' },
    },

    // 6) static — hardcoded value, context is ignored
    'step-static': {
      id: 'step-static',
      type: 'echo',
      config: {},
      input: { type: 'static', value: { msg: 'I am a static value' } },
      outputKey: 'from_static',
      transitions: { onSuccess: null },
    },
  },
};

// ── Run ─────────────────────────────────────────────────────────

async function main() {
  const store = new MemoryStore();
  const handlers = new DefaultHandlerRegistry();
  const flows = new DefaultFlowRegistry();

  handlers.register(echoHandler);
  flows.register(flow);

  const engine = new Engine(store, handlers, flows);

  const { execution } = await engine.create('input-demo', {
    user: { name: 'Alice', email: 'alice@example.com' },
    score: 95,
  });

  await engine.run(execution.id, { simulateTime: true });

  const final = await engine.get(execution.id);
  const ctx = final!.context;

  console.log('key  →', ctx.from_key);        // { name: 'Alice', email: 'alice@example.com' }
  console.log('keys →', ctx.from_keys);       // { user: {...}, score: 95 }
  console.log('path →', ctx.from_path);       // 'alice@example.com'
  console.log('tmpl →', ctx.from_template);   // 'Alice scored 95'
  console.log('full →', Object.keys(ctx.from_full as any)); // all context keys
  console.log('stat →', ctx.from_static);     // { msg: 'I am a static value' }
}

main().catch(console.error);
