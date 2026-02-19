/**
 * Example 04 — Retry & Backoff
 *
 * Demonstrates:
 * - Automatic step retry on failure
 * - Exponential backoff with configurable base & multiplier
 * - retryOn filter — only retry specific error codes
 * - Retry events for observability
 */

import {
  Engine,
  MemoryStore,
  DefaultHandlerRegistry,
  DefaultFlowRegistry,
  EventDispatcher,
  Result,
  type Flow,
  type StepHandler,
} from '@flowmonkey/core';

// ── Flaky handler that fails N times, then succeeds ─────────────

function createFlakyHandler(failTimes: number): StepHandler {
  let attempts = 0;
  return {
    type: 'flaky-api',
    async execute() {
      attempts++;
      if (attempts <= failTimes) {
        console.log(`  ❌ Attempt ${attempts} failed (TRANSIENT)`);
        return Result.failure('TRANSIENT', `Temporary failure #${attempts}`);
      }
      console.log(`  ✅ Attempt ${attempts} succeeded!`);
      return Result.success({ data: 'API response', attemptsTaken: attempts });
    },
  };
}

// ── Flow with retry config ──────────────────────────────────────

const apiFlow: Flow = {
  id: 'call-api',
  version: '1.0.0',
  initialStepId: 'call',
  steps: {
    call: {
      id: 'call',
      type: 'flaky-api',
      config: {},
      input: { type: 'static', value: {} },
      outputKey: 'response',
      transitions: { onSuccess: null, onFailure: null },
      retry: {
        maxAttempts: 5,           // retry up to 5 times
        backoffMs: 100,           // start at 100ms
        backoffMultiplier: 2,     // double each time: 100, 200, 400, 800...
        maxBackoffMs: 2000,       // cap at 2 seconds
        retryOn: ['TRANSIENT'],   // only retry TRANSIENT errors (not PERMANENT)
      },
    },
  },
};

// ── Run ─────────────────────────────────────────────────────────

async function main() {
  const store = new MemoryStore();
  const handlers = new DefaultHandlerRegistry();
  const flows = new DefaultFlowRegistry();

  // Fails 3 times, then succeeds on attempt 4
  handlers.register(createFlakyHandler(3));
  flows.register(apiFlow);

  // Set up event dispatcher to observe retries
  const dispatcher = new EventDispatcher({ mode: 'sync' });
  dispatcher.on('step.retry', (e) => {
    console.log(`  🔄 Retry event: attempt ${e.attempt}/${e.maxAttempts}, backoff ${e.backoffMs}ms`);
  });

  const engine = new Engine(store, handlers, flows, dispatcher, { recordHistory: true });

  console.log('--- Retrying a flaky API call ---');
  const { execution } = await engine.create('call-api');
  await engine.run(execution.id, { simulateTime: true });

  const final = await engine.get(execution.id);
  console.log('\nFinal status:', final?.status);           // completed
  console.log('Response:', final?.context.response);       // { data: 'API response', attemptsTaken: 4 }
  console.log('Steps executed:', final?.stepCount);        // 4 (1 initial + 3 retries)

  // Show the history to see each attempt
  console.log('\nHistory:');
  final?.history?.forEach((h, i) => {
    console.log(`  ${i + 1}. ${h.stepId} → ${h.outcome} (${h.durationMs}ms)`);
  });
}

main().catch(console.error);
