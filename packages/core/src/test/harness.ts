import { Engine, type TickResult } from '../engine/execution-engine';
import { MemoryStore } from '../impl/memory-store';
import { DefaultHandlerRegistry } from '../impl/handler-registry';
import { DefaultFlowRegistry } from '../impl/flow-registry';
import type { Flow } from '../types/flow';
import type { Execution } from '../types/execution';
import type { StepHandler } from '../interfaces/step-handler';
import type { EventBus } from '../interfaces/event-bus';

export interface TestHarnessOptions {
  handlers?: StepHandler[];
  flows?: Flow[];
  recordHistory?: boolean;
  maxSteps?: number;
}

export interface RunResult {
  execution: Execution;
  result: TickResult;
  events: any[];
}

/**
 * Test harness for easy testing.
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
    const execution = await this.engine.create(flowId, context);
    const result = await this.engine.run(execution.id, { simulateTime: true });
    const final = await this.engine.get(execution.id);
    return { execution: final!, result, events: this.events.filter(e => e.executionId === execution.id) };
  }

  /** Create without running */
  create(flowId: string, context: Record<string, unknown> = {}) {
    return this.engine.create(flowId, context);
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
    if (e.status !== 'failed') throw new Error(`Expected failed, got ${e.status}`);
    if (code && e.error?.code !== code) throw new Error(`Expected code ${code}, got ${e.error?.code}`);
  }

  assertContext(e: Execution, expected: Record<string, unknown>) {
    for (const [k, v] of Object.entries(expected)) {
      if (JSON.stringify(e.context[k]) !== JSON.stringify(v)) {
        throw new Error(`Context[${k}]: expected ${JSON.stringify(v)}, got ${JSON.stringify(e.context[k])}`);
      }
    }
  }
}
