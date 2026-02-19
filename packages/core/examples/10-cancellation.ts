/**
 * Example 10 — Cancellation
 *
 * Demonstrates:
 * - Cancelling a waiting execution
 * - Cancellation with source and reason
 * - Cascading cancellation to child executions
 * - Inspecting cancellation metadata
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

// ── Handlers ────────────────────────────────────────────────────

const startHandler: StepHandler = {
  type: 'start',
  async execute() {
    return Result.success({ started: true });
  },
};

const longWaitHandler: StepHandler = {
  type: 'long-wait',
  async execute() {
    // Wait for an hour (simulating a long-running external process)
    return {
      outcome: 'wait' as const,
      wakeAt: Date.now() + 3_600_000,
      waitReason: 'Awaiting external approval',
    };
  },
};

// ── Flow ────────────────────────────────────────────────────────

const approvalFlow: Flow = {
  id: 'approval',
  version: '1.0.0',
  initialStepId: 'start',
  steps: {
    start: {
      id: 'start',
      type: 'start',
      config: {},
      input: { type: 'static', value: null },
      outputKey: 'init',
      transitions: { onSuccess: 'wait-approval' },
    },
    'wait-approval': {
      id: 'wait-approval',
      type: 'long-wait',
      config: {},
      input: { type: 'static', value: null },
      transitions: { onSuccess: null },
    },
  },
};

// ── Run ─────────────────────────────────────────────────────────

async function main() {
  const store = new MemoryStore();
  const handlers = new DefaultHandlerRegistry();
  const flows = new DefaultFlowRegistry();

  handlers.register(startHandler);
  handlers.register(longWaitHandler);
  flows.register(approvalFlow);

  const dispatcher = new EventDispatcher({ mode: 'sync' });
  dispatcher.on('execution.cancelled', (e) => {
    console.log(`  🛑 Cancelled: ${e.executionId} (source: ${e.source}, reason: ${e.reason})`);
  });

  const engine = new Engine(store, handlers, flows, dispatcher);

  // Create and run until it reaches the wait step
  const { execution } = await engine.create('approval', {});
  await engine.tick(execution.id);  // start → running
  await engine.tick(execution.id);  // wait-approval → waiting

  const waiting = await engine.get(execution.id);
  console.log('--- Before cancellation ---');
  console.log('  Status:', waiting?.status);       // waiting
  console.log('  Wait reason:', waiting?.waitReason); // 'Awaiting external approval'

  // Cancel with metadata
  console.log('\n--- Cancelling ---');
  const result = await engine.cancel(execution.id, {
    source: 'user',
    reason: 'Manager rejected the request',
  });

  console.log('  Cancelled:', result.cancelled);
  console.log('  Previous status:', result.previousStatus);
  console.log('  Tokens invalidated:', result.tokensInvalidated);

  // Inspect final state
  const cancelled = await engine.get(execution.id);
  console.log('\n--- After cancellation ---');
  console.log('  Status:', cancelled?.status);                           // cancelled
  console.log('  Source:', cancelled?.cancellation?.source);             // user
  console.log('  Reason:', cancelled?.cancellation?.reason);             // Manager rejected the request
  console.log('  Cancelled at:', new Date(cancelled?.cancellation?.cancelledAt!).toISOString());

  // Trying to tick a cancelled execution is a no-op
  const afterTick = await engine.tick(execution.id);
  console.log('\n  Tick after cancel:', afterTick.done, afterTick.status); // true, cancelled
}

main().catch(console.error);
