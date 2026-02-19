/**
 * Example 03 — Error Handling
 *
 * Demonstrates:
 * - Handler returning failure results
 * - onFailure transitions (fallback steps)
 * - Execution failing with error details
 * - Inspecting error state after failure
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

// ── Handlers ────────────────────────────────────────────────────

const validateHandler: StepHandler = {
  type: 'validate',
  async execute({ input }) {
    const data = input as Record<string, unknown>;
    if (!data?.email || typeof data.email !== 'string') {
      return Result.failure('VALIDATION_ERROR', 'Email is required');
    }
    if (!data.email.includes('@')) {
      return Result.failure('INVALID_EMAIL', 'Email must contain @');
    }
    return Result.success({ valid: true, email: data.email });
  },
};

const sendEmailHandler: StepHandler = {
  type: 'send-email',
  async execute({ input }) {
    console.log('  📧 Sending email to:', (input as any)?.email);
    return Result.success({ sent: true });
  },
};

const logErrorHandler: StepHandler = {
  type: 'log-error',
  async execute({ context }) {
    console.log('  ⚠️  Logging validation error. Full context:', Object.keys(context));
    return Result.success({ logged: true });
  },
};

// ── Flow with error handling ────────────────────────────────────

const emailFlow: Flow = {
  id: 'send-email',
  version: '1.0.0',
  initialStepId: 'validate',
  steps: {
    validate: {
      id: 'validate',
      type: 'validate',
      config: {},
      input: { type: 'full' },
      outputKey: 'validated',
      transitions: {
        onSuccess: 'send',       // if valid → send
        onFailure: 'log-error',  // if invalid → log and end gracefully
      },
    },
    send: {
      id: 'send',
      type: 'send-email',
      config: {},
      input: { type: 'key', key: 'validated' },
      outputKey: 'sendResult',
      transitions: { onSuccess: null },
    },
    'log-error': {
      id: 'log-error',
      type: 'log-error',
      config: {},
      input: { type: 'full' },
      outputKey: 'errorLog',
      transitions: { onSuccess: null },  // completes successfully (graceful fallback)
    },
  },
};

// ── Run both cases ──────────────────────────────────────────────

async function main() {
  const store = new MemoryStore();
  const handlers = new DefaultHandlerRegistry();
  const flows = new DefaultFlowRegistry();

  [validateHandler, sendEmailHandler, logErrorHandler].forEach(h => handlers.register(h));
  flows.register(emailFlow);

  const engine = new Engine(store, handlers, flows, undefined, { recordHistory: true });

  // Case 1: Valid input → sends email
  console.log('--- Case 1: Valid email ---');
  const { execution: e1 } = await engine.create('send-email', { email: 'alice@example.com' });
  await engine.run(e1.id, { simulateTime: true });
  const r1 = await engine.get(e1.id);
  console.log('  Status:', r1?.status);         // completed
  console.log('  Result:', r1?.context.sendResult); // { sent: true }

  // Case 2: Invalid input → catches error, logs it, completes
  console.log('\n--- Case 2: Invalid email ---');
  const { execution: e2 } = await engine.create('send-email', { email: 'not-an-email' });
  await engine.run(e2.id, { simulateTime: true });
  const r2 = await engine.get(e2.id);
  console.log('  Status:', r2?.status);          // completed (fallback succeeded)
  console.log('  Error log:', r2?.context.errorLog); // { logged: true }

  // Case 3: Missing email, no onFailure → execution fails
  console.log('\n--- Case 3: Unhandled failure ---');
  const failFlow: Flow = {
    ...emailFlow,
    id: 'send-email-strict',
    steps: {
      ...emailFlow.steps,
      validate: {
        ...emailFlow.steps.validate,
        transitions: { onSuccess: 'send', onFailure: null }, // null = fail execution
      },
    },
  };
  flows.register(failFlow);
  const { execution: e3 } = await engine.create('send-email-strict', {});
  await engine.run(e3.id, { simulateTime: true });
  const r3 = await engine.get(e3.id);
  console.log('  Status:', r3?.status);   // failed
  console.log('  Error:', r3?.error);     // { code: 'VALIDATION_ERROR', message: 'Email is required', ... }
}

main().catch(console.error);
