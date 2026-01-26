/**
 * Test Harness
 *
 * Provides a preconfigured test environment for integration testing.
 * Automatically sets up Engine, MemoryStore, and registries with
 * event capture for assertions.
 *
 * Usage:
 * ```typescript
 * const t = new TestHarness({
 *   handlers: [myHandler],
 *   flows: [myFlow],
 * });
 *
 * const { execution } = await t.run('my-flow', { input: 'data' });
 * t.assertCompleted(execution);
 * t.assertContext(execution, { expectedKey: 'expectedValue' });
 * ```
 *
 * @see README.md for full documentation
 */
import { Engine, type TickResult, type CreateResult, type CreateOptions } from '../engine/execution-engine';
import { MemoryStore } from '../impl/memory-store';
import { DefaultHandlerRegistry } from '../impl/handler-registry';
import { DefaultFlowRegistry } from '../impl/flow-registry';
import type { Flow } from '../types/flow';
import type { Execution } from '../types/execution';
import type { StepHandler } from '../interfaces/step-handler';
import type { EventBus } from '../interfaces/event-bus';

/** Options for creating a TestHarness instance. */
export interface TestHarnessOptions {
  /** Handlers to register with the engine */
  handlers?: StepHandler[];
  /** Flows to register with the engine */
  flows?: Flow[];
  /** Whether to record step history (default: true) */
  recordHistory?: boolean;
  /** Maximum steps before failing (default: 100) */
  maxSteps?: number;
}

/** Result of running a flow to completion. */
export interface RunResult {
  /** Final execution state */
  execution: Execution;
  /** Last tick result */
  result: TickResult;
  /** All events emitted during execution */
  events: any[];
}

/**
 * Test harness for easy engine testing.
 * Provides a complete test environment with assertions.
 */
export class TestHarness {
  readonly store: MemoryStore;
  readonly handlers: DefaultHandlerRegistry;
  readonly flows: DefaultFlowRegistry;
  readonly engine: Engine;
  readonly events: any[] = [];

  constructor(options: TestHarnessOptions = {}) {
    this.store = new MemoryStore();
    this.handlers = new DefaultHandlerRegistry();
    this.flows = new DefaultFlowRegistry();

    const eventBus: EventBus = {
      onExecutionCreated: e => this.events.push({ type: 'created', ...e }),
      onExecutionStarted: e => this.events.push({ type: 'started', ...e }),
      onStepStarted: e => this.events.push({ type: 'step.started', ...e }),
      onStepCompleted: e => this.events.push({ type: 'step.completed', ...e }),
      onExecutionCompleted: e => this.events.push({ type: 'completed', ...e }),
      onExecutionFailed: e => this.events.push({ type: 'failed', ...e }),
      onExecutionWaiting: e => this.events.push({ type: 'waiting', ...e }),
    };

    this.engine = new Engine(this.store, this.handlers, this.flows, eventBus, {
      recordHistory: options.recordHistory ?? true,
      maxSteps: options.maxSteps ?? 100,
    });

    options.handlers?.forEach(h => this.handlers.register(h));
    options.flows?.forEach(f => this.flows.register(f));
  }

  /** Run a flow to completion */
  async run(flowId: string, context: Record<string, unknown> = {}): Promise<RunResult> {
    const createResult = await this.engine.create(flowId, context);
    const result = await this.engine.run(createResult.execution.id, { simulateTime: true });
    const final = await this.engine.get(createResult.execution.id);
    return { execution: final!, result, events: this.events.filter(e => e.executionId === createResult.execution.id) };
  }

  /** Create without running */
  async create(flowId: string, context: Record<string, unknown> = {}, options?: CreateOptions): Promise<Execution> {
    const result = await this.engine.create(flowId, context, options);
    return result.execution;
  }

  /** Create and return full result (for idempotency testing) */
  createWithResult(flowId: string, context: Record<string, unknown> = {}, options?: CreateOptions): Promise<CreateResult> {
    return this.engine.create(flowId, context, options);
  }

  /** Single tick */
  tick(executionId: string) {
    return this.engine.tick(executionId);
  }

  /** Reset all state */
  reset() {
    this.store.clear();
    this.events.length = 0;
  }

  // Assertions
  assertCompleted(e: Execution) {
    if (e.status !== 'completed') throw new Error(`Expected completed, got ${e.status}: ${e.error?.message}`);
  }

  assertFailed(e: Execution, code?: string) {
    if (e.status !== 'failed' && e.status !== 'cancelled') throw new Error(`Expected failed/cancelled, got ${e.status}`);
    if (code && e.status === 'failed' && e.error?.code !== code) throw new Error(`Expected code ${code}, got ${e.error?.code}`);
    if (code && e.status === 'cancelled' && code !== 'CANCELLED') throw new Error(`Expected code ${code}, but execution was cancelled`);
  }

  assertCancelled(e: Execution) {
    if (e.status !== 'cancelled') throw new Error(`Expected cancelled, got ${e.status}`);
    if (!e.cancellation) throw new Error(`Expected cancellation info, but none found`);
  }

  assertContext(e: Execution, expected: Record<string, unknown>) {
    for (const [k, v] of Object.entries(expected)) {
      if (JSON.stringify(e.context[k]) !== JSON.stringify(v)) {
        throw new Error(`Context[${k}]: expected ${JSON.stringify(v)}, got ${JSON.stringify(e.context[k])}`);
      }
    }
  }
}
