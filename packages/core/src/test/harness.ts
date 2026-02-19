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
import { MemoryTableRegistry } from '../impl/memory-table-registry';
import { MemoryTableStore } from '../impl/memory-table-store';
import { EventEmittingTableStore } from '../impl/event-emitting-table-store';
import { EventEmittingTableRegistry } from '../impl/event-emitting-table-registry';
import { EventEmittingFlowRegistry } from '../impl/event-emitting-flow-registry';
import { EventEmittingHandlerRegistry } from '../impl/event-emitting-handler-registry';
import { EventEmittingWAL } from '../impl/event-emitting-wal';
import { MemoryWAL } from '../impl/memory-wal';
import { EventDispatcher } from '../impl/event-dispatcher';
import type { Flow } from '../types/flow';
import type { TableDef } from '../types/table';
import type { Execution } from '../types/execution';
import type { StepHandler } from '../interfaces/step-handler';

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
  /** Tables to pre-register for pipe testing */
  tables?: TableDef[];
  /** Enable table/pipe support (auto-enabled if tables provided) */
  enableTables?: boolean;
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
  readonly tableRegistry: MemoryTableRegistry;
  readonly tableStore: MemoryTableStore;
  readonly wal: MemoryWAL;
  /** EventDispatcher — use .on() for typed subscriptions in tests */
  readonly dispatcher: EventDispatcher;
  private readonly _eventEmittingTableStore: EventEmittingTableStore;
  private readonly _eventEmittingTableRegistry: EventEmittingTableRegistry;
  private readonly _eventEmittingWAL: EventEmittingWAL;

  constructor(options: TestHarnessOptions = {}) {
    this.store = new MemoryStore();
    this.handlers = new DefaultHandlerRegistry();
    this.flows = new DefaultFlowRegistry();
    this.tableRegistry = new MemoryTableRegistry();
    this.tableStore = new MemoryTableStore();
    this.wal = new MemoryWAL();

    // EventDispatcher in sync mode — events fire inline for deterministic testing.
    // Wildcard listener populates this.events[] for backward compatibility.
    this.dispatcher = new EventDispatcher({ mode: 'sync' });
    this.dispatcher.on('*', (e) => {
      this.events.push({ ...e });
    });

    // Wrap stores/registries so all mutations emit events
    this._eventEmittingTableStore = new EventEmittingTableStore(this.tableStore, this.dispatcher);
    this._eventEmittingTableRegistry = new EventEmittingTableRegistry(this.tableRegistry, this.dispatcher);
    this._eventEmittingWAL = new EventEmittingWAL(this.wal, this.dispatcher);
    const eventEmittingFlows = new EventEmittingFlowRegistry(this.flows, this.dispatcher);
    const eventEmittingHandlers = new EventEmittingHandlerRegistry(this.handlers, this.dispatcher);

    const enableTables = options.enableTables || (options.tables && options.tables.length > 0);

    this.engine = new Engine(this.store, eventEmittingHandlers, eventEmittingFlows, this.dispatcher, {
      recordHistory: options.recordHistory ?? true,
      maxSteps: options.maxSteps ?? 100,
      ...(enableTables ? {
        tableStore: this._eventEmittingTableStore,
        tableRegistry: this._eventEmittingTableRegistry,
        pipeWAL: this._eventEmittingWAL,
      } : {}),
    });

    options.handlers?.forEach(h => eventEmittingHandlers.register(h));
    options.flows?.forEach(f => eventEmittingFlows.register(f));

    // Pre-register tables
    if (options.tables) {
      for (const table of options.tables) {
        // Synchronous-safe: MemoryTableRegistry.create is async but instant
        this.tableRegistry.create(table);
      }
    }
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
    this.tableRegistry.clear();
    this.tableStore.clear();
    this.wal.clear();
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
