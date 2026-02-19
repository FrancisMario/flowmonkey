/**
 * Example 07 — Sub-flows (Parent/Child Executions)
 *
 * Demonstrates:
 * - Creating child executions from a handler
 * - Wait-for-completion mode (inline call, get result)
 * - Fire-and-forget mode (spawn and continue)
 * - parentExecutionId linking
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

// ── Sub-flow handler factory ────────────────────────────────────
//
// Handlers don't have access to the engine directly,
// so we use a factory that captures it in a closure.

function createSubFlowHandler(engine: Engine): StepHandler {
  return {
    type: 'sub-flow',
    async execute({ input, step, execution }) {
      const config = step.config as { flowId: string; waitForCompletion?: boolean };
      const childContext = (input ?? {}) as Record<string, unknown>;

      // Create child execution linked to parent
      const { execution: child } = await engine.create(config.flowId, childContext, {
        parentExecutionId: execution.id,
      });

      if (config.waitForCompletion !== false) {
        // Run child to completion and return its result
        const result = await engine.run(child.id, { simulateTime: true });
        const final = await engine.get(child.id);
        if (result.status === 'completed') {
          return Result.success({
            childId: child.id,
            status: 'completed',
            context: final?.context ?? {},
          });
        }
        return Result.failure('CHILD_FAILED', `Child ${child.id} failed: ${result.error?.message}`);
      }

      // Fire-and-forget
      return Result.success({
        childId: child.id,
        status: 'spawned',
        mode: 'fire-and-forget',
      });
    },
  };
}

// ── Simple handler for child flow ───────────────────────────────

const processItemHandler: StepHandler = {
  type: 'process-item',
  async execute({ input }) {
    const item = input as Record<string, unknown>;
    return Result.success({
      ...item,
      processed: true,
      processedAt: new Date().toISOString(),
    });
  },
};

const echoHandler: StepHandler = {
  type: 'echo',
  async execute({ input }) { return Result.success(input); },
};

// ── Flows ───────────────────────────────────────────────────────

const childFlow: Flow = {
  id: 'process-item',
  version: '1.0.0',
  initialStepId: 'process',
  steps: {
    process: {
      id: 'process',
      type: 'process-item',
      config: {},
      input: { type: 'full' },
      outputKey: 'result',
      transitions: { onSuccess: null },
    },
  },
};

const parentFlow: Flow = {
  id: 'batch-processor',
  version: '1.0.0',
  initialStepId: 'process-first',
  steps: {
    'process-first': {
      id: 'process-first',
      type: 'sub-flow',
      config: { flowId: 'process-item', waitForCompletion: true },
      input: { type: 'key', key: 'item1' },
      outputKey: 'firstResult',
      transitions: { onSuccess: 'spawn-second' },
    },
    'spawn-second': {
      id: 'spawn-second',
      type: 'sub-flow',
      config: { flowId: 'process-item', waitForCompletion: false },  // fire-and-forget
      input: { type: 'key', key: 'item2' },
      outputKey: 'secondRef',
      transitions: { onSuccess: 'done' },
    },
    done: {
      id: 'done',
      type: 'echo',
      config: {},
      input: { type: 'static', value: 'all spawned' },
      outputKey: 'status',
      transitions: { onSuccess: null },
    },
  },
};

// ── Run ─────────────────────────────────────────────────────────

async function main() {
  const store = new MemoryStore();
  const handlers = new DefaultHandlerRegistry();
  const flows = new DefaultFlowRegistry();

  flows.register(childFlow);
  flows.register(parentFlow);

  handlers.register(processItemHandler);
  handlers.register(echoHandler);

  const engine = new Engine(store, handlers, flows, undefined, { recordHistory: true });

  // Register sub-flow handler (needs engine reference)
  handlers.register(createSubFlowHandler(engine));

  const { execution: parent } = await engine.create('batch-processor', {
    item1: { name: 'Widget A', qty: 10 },
    item2: { name: 'Widget B', qty: 5 },
  });

  await engine.run(parent.id, { simulateTime: true });

  const final = await engine.get(parent.id);
  console.log('Parent status:', final?.status);

  // Wait-for-completion result
  const first = final?.context.firstResult as any;
  console.log('\nFirst child (wait-for-completion):');
  console.log('  Child ID:', first?.childId);
  console.log('  Status:', first?.status);
  console.log('  Result:', first?.context?.result);

  // Fire-and-forget result
  const second = final?.context.secondRef as any;
  console.log('\nSecond child (fire-and-forget):');
  console.log('  Child ID:', second?.childId);
  console.log('  Mode:', second?.mode);

  // Verify parent-child link
  const child = await engine.get(first?.childId);
  console.log('\nChild →', child?.parentExecutionId === parent.id ? 'linked to parent ✅' : 'NOT linked ❌');
}

main().catch(console.error);
