/**
 * Example 11 — Idempotency
 *
 * Demonstrates:
 * - Creating executions with idempotency keys
 * - Deduplication — same key returns existing execution
 * - Idempotency window (TTL)
 * - Different keys allow separate executions
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

// ── Handler ─────────────────────────────────────────────────────

const chargeHandler: StepHandler = {
  type: 'charge',
  async execute({ input }) {
    const { amount, currency } = input as any;
    console.log(`  💳 Charging $${amount} ${currency}`);
    return Result.success({
      transactionId: `TXN-${Date.now()}`,
      amount,
      currency,
      charged: true,
    });
  },
};

// ── Flow ────────────────────────────────────────────────────────

const paymentFlow: Flow = {
  id: 'process-payment',
  version: '1.0.0',
  initialStepId: 'charge',
  steps: {
    charge: {
      id: 'charge',
      type: 'charge',
      config: {},
      input: { type: 'full' },
      outputKey: 'payment',
      transitions: { onSuccess: null },
    },
  },
};

// ── Run ─────────────────────────────────────────────────────────

async function main() {
  const store = new MemoryStore();
  const handlers = new DefaultHandlerRegistry();
  const flows = new DefaultFlowRegistry();

  handlers.register(chargeHandler);
  flows.register(paymentFlow);

  const engine = new Engine(store, handlers, flows);

  const context = { amount: 99.99, currency: 'USD' };

  // First call — creates a new execution
  console.log('--- First request ---');
  const r1 = await engine.create('process-payment', context, {
    idempotencyKey: 'payment-abc-123',
    idempotencyWindowMs: 60_000,  // 1 minute window
  });
  console.log('  Created:', r1.created);              // true
  console.log('  Idempotency hit:', r1.idempotencyHit); // false
  console.log('  Execution ID:', r1.execution.id);

  await engine.run(r1.execution.id, { simulateTime: true });

  // Second call — same key → returns existing execution (no double charge!)
  console.log('\n--- Duplicate request (same key) ---');
  const r2 = await engine.create('process-payment', context, {
    idempotencyKey: 'payment-abc-123',
  });
  console.log('  Created:', r2.created);              // false
  console.log('  Idempotency hit:', r2.idempotencyHit); // true
  console.log('  Same execution?', r2.execution.id === r1.execution.id); // true

  // Third call — different key → new execution
  console.log('\n--- Different key ---');
  const r3 = await engine.create('process-payment', context, {
    idempotencyKey: 'payment-xyz-456',
  });
  console.log('  Created:', r3.created);              // true
  console.log('  Idempotency hit:', r3.idempotencyHit); // false
  console.log('  New execution?', r3.execution.id !== r1.execution.id); // true

  // Same key, different flow — not deduplicated
  console.log('\n--- Same key, different flow ---');
  const otherFlow: Flow = { ...paymentFlow, id: 'refund' };
  flows.register(otherFlow);
  const r4 = await engine.create('refund', context, {
    idempotencyKey: 'payment-abc-123',
  });
  console.log('  Created:', r4.created);              // true (different flow)
  console.log('  Idempotency hit:', r4.idempotencyHit); // false
}

main().catch(console.error);
