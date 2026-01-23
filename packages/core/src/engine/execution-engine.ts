import type { Flow, Step } from '../types/flow';
import type { Execution } from '../types/execution';
import type { StepResult } from '../types/result';
import type { StateStore } from '../interfaces/state-store';
import type { HandlerRegistry } from '../interfaces/handler-registry';
import type { FlowRegistry } from '../interfaces/flow-registry';
import type { EventBus } from '../interfaces/event-bus';
import { ExecutionError } from '../types/errors';
import { resolveInput } from './input-resolver';
import { generateId, now, setPath } from '../utils';

export interface EngineOptions {
  /** Record step history (default: false) */
  recordHistory?: boolean;
  /** Max steps per execution (default: 1000) */
  maxSteps?: number;
  /** Handler timeout in ms (default: 30000) */
  timeoutMs?: number;
}

export interface TickResult {
  /** No more ticks needed */
  done: boolean;
  /** Current status */
  status: Execution['status'];
  /** Step that was executed */
  stepId?: string;
  /** Step outcome */
  outcome?: StepResult['outcome'];
  /** When to tick again (for waiting) */
  wakeAt?: number;
  /** Error info */
  error?: { code: string; message: string };
}

/**
 * Core execution engine.
 * Stateless — all state lives in Execution objects via StateStore.
 */
export class Engine {
  private readonly store: StateStore;
  private readonly handlers: HandlerRegistry;
  private readonly flows: FlowRegistry;
  private readonly events?: EventBus;
  private readonly opts: Required<EngineOptions>;

  constructor(
    store: StateStore,
    handlers: HandlerRegistry,
    flows: FlowRegistry,
    events?: EventBus,
    options?: EngineOptions
  ) {
    this.store = store;
    this.handlers = handlers;
    this.flows = flows;
    this.events = events;
    this.opts = {
      recordHistory: options?.recordHistory ?? false,
      maxSteps: options?.maxSteps ?? 1000,
      timeoutMs: options?.timeoutMs ?? 30000,
    };
  }

  /**
   * Create a new execution.
   */
  async create(
    flowId: string,
    context: Record<string, unknown> = {},
    options?: { executionId?: string; tenantId?: string }
  ): Promise<Execution> {
    const flow = this.flows.get(flowId);
    if (!flow) {
      throw new ExecutionError('FLOW_NOT_FOUND', '', `Flow "${flowId}" not found`);
    }

    const execution: Execution = {
      id: options?.executionId ?? generateId(),
      flowId: flow.id,
      flowVersion: flow.version,
      currentStepId: flow.initialStepId,
      status: 'pending',
      context: { ...context },
      stepCount: 0,
      history: this.opts.recordHistory ? [] : undefined,
      createdAt: now(),
      updatedAt: now(),
      tenantId: options?.tenantId,
    };

    await this.store.save(execution);
    this.events?.onExecutionCreated?.({ executionId: execution.id, flowId, context });

    return execution;
  }

  /**
   * Execute one step. Call repeatedly until done.
   */
  async tick(executionId: string): Promise<TickResult> {
    const execution = await this.store.load(executionId);
    if (!execution) {
      return { done: true, status: 'failed', error: { code: 'NOT_FOUND', message: 'Execution not found' } };
    }

    // Already terminal
    if (execution.status === 'completed' || execution.status === 'failed') {
      return { done: true, status: execution.status };
    }

    // Waiting and not ready
    if (execution.status === 'waiting' && execution.wakeAt && execution.wakeAt > now()) {
      return { done: false, status: 'waiting', wakeAt: execution.wakeAt };
    }

    // Step limit
    if (execution.stepCount >= this.opts.maxSteps) {
      return this.fail(execution, 'MAX_STEPS', `Exceeded ${this.opts.maxSteps} steps`);
    }

    // Load flow
    const flow = this.flows.get(execution.flowId, execution.flowVersion);
    if (!flow) {
      return this.fail(execution, 'FLOW_NOT_FOUND', `Flow "${execution.flowId}" not found`);
    }

    // Get step
    const step = flow.steps[execution.currentStepId];
    if (!step) {
      return this.fail(execution, 'STEP_NOT_FOUND', `Step "${execution.currentStepId}" not found`);
    }

    // Get handler
    const handler = this.handlers.get(step.type);
    if (!handler) {
      return this.fail(execution, 'HANDLER_NOT_FOUND', `No handler for "${step.type}"`);
    }

    // Resolve input
    let input: unknown;
    try {
      input = resolveInput(step.input, execution.context);
    } catch (err) {
      return this.fail(execution, 'INPUT_ERROR', err instanceof Error ? err.message : 'Input resolution failed');
    }

    // Update to running
    const wasFirst = execution.status === 'pending';
    execution.status = 'running';
    execution.updatedAt = now();

    if (wasFirst) {
      this.events?.onExecutionStarted?.({ executionId: execution.id, flowId: flow.id, stepId: step.id });
    }
    this.events?.onStepStarted?.({ executionId: execution.id, stepId: step.id, input });

    // Execute handler
    const startTime = now();
    let result: StepResult;

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.opts.timeoutMs);

      try {
        result = await handler.execute({
          input,
          step,
          context: execution.context,
          execution: { id: execution.id, flowId: flow.id, stepCount: execution.stepCount },
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeout);
      }
    } catch (err) {
      result = {
        outcome: 'failure',
        error: { code: 'HANDLER_ERROR', message: err instanceof Error ? err.message : 'Handler threw' },
      };
    }

    const durationMs = now() - startTime;
    this.events?.onStepCompleted?.({ executionId: execution.id, stepId: step.id, result, durationMs });

    // Record history
    if (execution.history) {
      execution.history.push({
        stepId: step.id,
        handlerType: step.type,
        outcome: result.outcome,
        startedAt: startTime,
        completedAt: now(),
        durationMs,
        error: result.error,
      });
    }

    execution.stepCount++;

    // Apply result
    return this.applyResult(execution, flow, step, result);
  }

  /**
   * Run to completion. Use tick() for production.
   */
  async run(executionId: string, options?: { simulateTime?: boolean }): Promise<TickResult> {
    let result: TickResult;
    let iterations = 0;
    const maxIterations = 10000;

    do {
      result = await this.tick(executionId);

      if (result.status === 'waiting' && result.wakeAt) {
        if (!options?.simulateTime) {
          const delay = result.wakeAt - now();
          if (delay > 0) await sleep(delay);
        }
      }

      if (++iterations >= maxIterations) {
        throw new ExecutionError('MAX_ITERATIONS', executionId, 'Run exceeded max iterations');
      }
    } while (!result.done);

    return result;
  }

  /**
   * Cancel an execution.
   */
  async cancel(executionId: string, reason?: string): Promise<boolean> {
    const execution = await this.store.load(executionId);
    if (!execution) return false;
    if (execution.status === 'completed' || execution.status === 'failed') return false;

    execution.status = 'failed';
    execution.error = { code: 'CANCELLED', message: reason ?? 'Cancelled', stepId: execution.currentStepId, timestamp: now() };
    execution.updatedAt = now();

    await this.store.save(execution);
    this.events?.onExecutionFailed?.({ executionId, stepId: execution.currentStepId, error: execution.error });

    return true;
  }

  /**
   * Get execution by ID.
   */
  async get(executionId: string): Promise<Execution | null> {
    return this.store.load(executionId);
  }

  // --- Private ---

  private async fail(execution: Execution, code: string, message: string): Promise<TickResult> {
    execution.status = 'failed';
    execution.error = { code, message, stepId: execution.currentStepId, timestamp: now() };
    execution.updatedAt = now();
    await this.store.save(execution);
    this.events?.onExecutionFailed?.({ executionId: execution.id, stepId: execution.currentStepId, error: execution.error });
    return { done: true, status: 'failed', error: { code, message } };
  }

  private async applyResult(execution: Execution, flow: Flow, step: Step, result: StepResult): Promise<TickResult> {
    // Store output
    if (result.outcome === 'success' && step.outputKey && result.output !== undefined) {
      setPath(execution.context, step.outputKey, result.output);
    }

    if (result.outcome === 'success') {
      const next = result.nextStepOverride !== undefined ? result.nextStepOverride : step.transitions.onSuccess;

      if (next === null || next === undefined) {
        // Complete
        execution.status = 'completed';
        execution.updatedAt = now();
        await this.store.save(execution);
        this.events?.onExecutionCompleted?.({ executionId: execution.id, context: execution.context, totalSteps: execution.stepCount });
        return { done: true, status: 'completed', stepId: step.id, outcome: 'success' };
      }

      if (!flow.steps[next]) {
        return this.fail(execution, 'INVALID_TRANSITION', `Step "${step.id}" → "${next}" not found`);
      }

      execution.currentStepId = next;
      execution.updatedAt = now();
      await this.store.save(execution);
      return { done: false, status: 'running', stepId: step.id, outcome: 'success' };
    }

    if (result.outcome === 'failure') {
      const next = result.nextStepOverride !== undefined ? result.nextStepOverride : step.transitions.onFailure;

      if (next === null || next === undefined) {
        execution.status = 'failed';
        execution.error = {
          code: result.error?.code ?? 'STEP_FAILED',
          message: result.error?.message ?? 'Step failed',
          stepId: step.id,
          details: result.error?.details,
          timestamp: now(),
        };
        execution.updatedAt = now();
        await this.store.save(execution);
        this.events?.onExecutionFailed?.({ executionId: execution.id, stepId: step.id, error: execution.error });
        return { done: true, status: 'failed', stepId: step.id, outcome: 'failure', error: { code: execution.error.code, message: execution.error.message } };
      }

      if (!flow.steps[next]) {
        return this.fail(execution, 'INVALID_TRANSITION', `Step "${step.id}" onFailure → "${next}" not found`);
      }

      execution.currentStepId = next;
      execution.updatedAt = now();
      await this.store.save(execution);
      return { done: false, status: 'running', stepId: step.id, outcome: 'failure' };
    }

    // Wait
    execution.status = 'waiting';
    execution.wakeAt = result.wakeAt;
    execution.waitReason = result.waitReason;
    if (step.transitions.onResume) {
      execution.currentStepId = step.transitions.onResume;
    } else {
      // If no onResume, proceed to onSuccess when waking
      const next = step.transitions.onSuccess;
      if (next) {
        execution.currentStepId = next;
      }
    }
    execution.updatedAt = now();
    await this.store.save(execution);
    this.events?.onExecutionWaiting?.({ executionId: execution.id, stepId: step.id, wakeAt: result.wakeAt, reason: result.waitReason });
    return { done: false, status: 'waiting', stepId: step.id, outcome: 'wait', wakeAt: result.wakeAt };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}
