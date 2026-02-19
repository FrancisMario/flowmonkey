/**
 * Example 08 — Events & Observability
 *
 * Demonstrates:
 * - EventDispatcher for multi-listener support
 * - Subscribing to specific event types
 * - Wildcard listener for audit logging
 * - Collecting metrics from step events
 * - Unsubscribe pattern
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

// ── Simple handlers ─────────────────────────────────────────────

const fetchHandler: StepHandler = {
  type: 'fetch',
  async execute({ input }) {
    // Simulate API call
    await new Promise(r => setTimeout(r, 10));
    return Result.success({ data: input, fetchedAt: Date.now() });
  },
};

const transformHandler: StepHandler = {
  type: 'transform',
  async execute({ input }) {
    return Result.success({ transformed: true, original: input });
  },
};

// ── Flow ────────────────────────────────────────────────────────

const flow: Flow = {
  id: 'data-pipeline',
  version: '1.0.0',
  initialStepId: 'fetch',
  steps: {
    fetch: {
      id: 'fetch',
      type: 'fetch',
      config: {},
      input: { type: 'key', key: 'url' },
      outputKey: 'fetched',
      transitions: { onSuccess: 'transform' },
    },
    transform: {
      id: 'transform',
      type: 'transform',
      config: {},
      input: { type: 'key', key: 'fetched' },
      outputKey: 'result',
      transitions: { onSuccess: null },
    },
  },
};

// ── Set up observability ────────────────────────────────────────

async function main() {
  const store = new MemoryStore();
  const handlers = new DefaultHandlerRegistry();
  const flows = new DefaultFlowRegistry();

  handlers.register(fetchHandler);
  handlers.register(transformHandler);
  flows.register(flow);

  // Create a dispatcher (async mode = production, sync mode = testing)
  const dispatcher = new EventDispatcher({ mode: 'sync' });

  // 1. Audit log — wildcard captures every event
  const auditLog: any[] = [];
  dispatcher.on('*', (event) => {
    auditLog.push(event);
  });

  // 2. Metrics — track step durations
  const stepDurations: Record<string, number[]> = {};
  dispatcher.on('step.completed', (event) => {
    const { stepId, durationMs } = event;
    if (!stepDurations[stepId]) stepDurations[stepId] = [];
    stepDurations[stepId].push(durationMs);
  });

  // 3. Alerting — log failures
  dispatcher.on('execution.failed', (event) => {
    console.log(`🚨 ALERT: Execution ${event.executionId} failed at step ${event.stepId}`);
    console.log(`   Error: ${event.error?.code} — ${event.error?.message}`);
  });

  // 4. Progress tracking
  dispatcher.on('execution.created', (e) => console.log(`  📝 Created: ${e.executionId}`));
  dispatcher.on('execution.started', (e) => console.log(`  ▶️  Started: step ${e.stepId}`));
  const unsubTransition = dispatcher.on('transition', (e) => {
    console.log(`  ➡️  Transition: ${e.fromStepId} → ${e.toStepId}`);
  });
  dispatcher.on('execution.completed', (e) => console.log(`  ✅ Completed! (${e.totalSteps} steps)`));

  // Pass dispatcher to engine as the EventBus
  const engine = new Engine(store, handlers, flows, dispatcher, { recordHistory: true });

  console.log('--- Running pipeline ---');
  const { execution } = await engine.create('data-pipeline', { url: 'https://api.example.com/data' });
  await engine.run(execution.id, { simulateTime: true });

  // Show collected metrics
  console.log('\n--- Metrics ---');
  for (const [step, durations] of Object.entries(stepDurations)) {
    const avg = durations.reduce((a, b) => a + b, 0) / durations.length;
    console.log(`  ${step}: avg ${avg.toFixed(1)}ms (${durations.length} executions)`);
  }

  // Show audit log summary
  console.log(`\n--- Audit Log: ${auditLog.length} events ---`);
  auditLog.forEach((e) => {
    console.log(`  [${e.type}] ${e.executionId?.slice(0, 8) ?? ''}...`);
  });

  // Unsubscribe from transitions (no more transition logs)
  unsubTransition();
  console.log('\n--- Listener counts ---');
  console.log(`  transition listeners: ${dispatcher.listenerCount('transition')}`);
  console.log(`  wildcard listeners: ${dispatcher.listenerCount('*')}`);
}

main().catch(console.error);
