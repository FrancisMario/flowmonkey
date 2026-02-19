/**
 * Example 06 — Waiting & Resume
 *
 * Demonstrates:
 * - Handlers returning a wait result (pausing execution)
 * - Simulating external signals that resume execution
 * - The tick-based execution model
 * - wakeAt and wait reasons
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

const createOrderHandler: StepHandler = {
  type: 'create-order',
  async execute({ input }) {
    const order = { id: 'ORD-001', ...(input as any), status: 'pending' };
    console.log('  📦 Order created:', order.id);
    return Result.success(order);
  },
};

// This handler pauses and waits for a payment webhook
const waitForPaymentHandler: StepHandler = {
  type: 'wait-for-payment',
  async execute() {
    console.log('  ⏳ Waiting for payment confirmation...');
    // Return a wait result — engine pauses until wakeAt
    return {
      outcome: 'wait' as const,
      wakeAt: Date.now() + 60_000,  // wake in 60s (or when externally resumed)
      waitReason: 'Awaiting payment webhook',
      output: { waitingFor: 'payment' },
    };
  },
};

const fulfillHandler: StepHandler = {
  type: 'fulfill',
  async execute({ context }) {
    const order = context.order as any;
    console.log('  ✅ Fulfilling order:', order.id);
    return Result.success({ ...order, status: 'fulfilled' });
  },
};

// ── Flow ────────────────────────────────────────────────────────

const orderFlow: Flow = {
  id: 'order-flow',
  version: '1.0.0',
  initialStepId: 'create-order',
  steps: {
    'create-order': {
      id: 'create-order',
      type: 'create-order',
      config: {},
      input: { type: 'full' },
      outputKey: 'order',
      transitions: { onSuccess: 'wait-payment' },
    },
    'wait-payment': {
      id: 'wait-payment',
      type: 'wait-for-payment',
      config: {},
      input: { type: 'key', key: 'order' },
      outputKey: 'paymentWait',
      transitions: {
        onSuccess: 'fulfill',  // after wait completes → fulfill
      },
    },
    fulfill: {
      id: 'fulfill',
      type: 'fulfill',
      config: {},
      input: { type: 'key', key: 'order' },
      outputKey: 'fulfillment',
      transitions: { onSuccess: null },
    },
  },
};

// ── Run ─────────────────────────────────────────────────────────

async function main() {
  const store = new MemoryStore();
  const handlers = new DefaultHandlerRegistry();
  const flows = new DefaultFlowRegistry();

  [createOrderHandler, waitForPaymentHandler, fulfillHandler].forEach(h => handlers.register(h));
  flows.register(orderFlow);

  const engine = new Engine(store, handlers, flows, undefined, { recordHistory: true });

  // Create and tick manually to see each step
  const { execution } = await engine.create('order-flow', { item: 'Widget', qty: 3 });
  console.log('--- Step 1: Create order ---');

  let result = await engine.tick(execution.id);
  console.log('  Result:', result.status);  // running → next step

  console.log('\n--- Step 2: Wait for payment ---');
  result = await engine.tick(execution.id);
  console.log('  Result:', result.status);   // waiting
  console.log('  Wake at:', new Date(result.wakeAt!).toISOString());

  // Execution is paused. In production, a webhook handler
  // would update the execution or call engine.resume().
  // Here, we simulate by directly modifying the wake time:
  const exec = await engine.get(execution.id);
  console.log('\n  Status:', exec?.status);      // waiting
  console.log('  Reason:', exec?.waitReason);     // 'Awaiting payment webhook'

  // Simulate: "payment received" — update wakeAt to now
  console.log('\n--- External event: Payment received! ---');
  // In real usage: engine.resume(id, token, data)
  // For this demo, we just tick with simulateTime which skips waits:
  const finalResult = await engine.run(execution.id, { simulateTime: true });
  console.log('  Final status:', finalResult.status);  // completed

  const final = await engine.get(execution.id);
  console.log('\n--- Final state ---');
  console.log('  Order:', final?.context.fulfillment);
  console.log('  History:', final?.history?.map(h => `${h.stepId} → ${h.outcome}`));
}

main().catch(console.error);
