import type { Flow, Step } from '../types/flow';
import type { PipeDef, Row } from '../types/table';
import type { Execution, CancellationSource, TimeoutConfig } from '../types/execution';
import type { StepResult } from '../types/result';
import type { StateStore } from '../interfaces/state-store';
import type { HandlerRegistry } from '../interfaces/handler-registry';
import type { FlowRegistry } from '../interfaces/flow-registry';
import type { EventBus } from '../interfaces/event-bus';
import type { ResumeTokenManager } from '../interfaces/resume-token-manager';
import type { TableStore } from '../interfaces/table-store';
import type { TableRegistry } from '../interfaces/table-store';
import type { WriteAheadLog } from '../interfaces/write-ahead-log';
import { ExecutionError } from '../types/errors';
import { resolveInput, getPath } from './input-resolver';
import { generateId, now, setPath } from '../utils';
import { ContextHelpersImpl, type ContextLimits } from './context-helpers';

// === Constants ===

const DEFAULT_IDEMPOTENCY_WINDOW_MS = 24 * 60 * 60 * 1000; // 24 hours
const MAX_IDEMPOTENCY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export interface EngineOptions {
  /** Record step history (default: false) */
  recordHistory?: boolean;
  /** Max steps per execution (default: 1000) */
  maxSteps?: number;
  /** Handler timeout in ms (default: 30000) */
  timeoutMs?: number;
  /** Context size limits */
  contextLimits?: Partial<ContextLimits>;
  /** Resume token manager for waiting handlers */
  tokenManager?: ResumeTokenManager;
  /** Table store for pipe writes (optional — pipes skipped if absent) */
  tableStore?: TableStore;
  /** Table registry for pipe validation (optional) */
  tableRegistry?: TableRegistry;
  /** Write-ahead log for failed pipe writes (optional — failures silent if absent) */
  pipeWAL?: WriteAheadLog;
}

export interface CreateOptions {
  /** Custom execution ID */
  executionId?: string;
  /** Tenant ID for multi-tenancy */
  tenantId?: string;
  /** Parent execution ID for sub-flows */
  parentExecutionId?: string;
  /** Idempotency key for deduplication */
  idempotencyKey?: string;
  /** Deduplication window in ms (default: 24h, max: 7d) */
  idempotencyWindowMs?: number;
  /** Timeout configuration */
  timeoutConfig?: TimeoutConfig;
  /** Custom metadata */
  metadata?: Record<string, unknown>;
}

export interface CreateResult {
  /** The execution (new or existing) */
  execution: Execution;
  /** Whether a new execution was created */
  created: boolean;
  /** Whether this was an idempotency cache hit */
  idempotencyHit: boolean;
}

export interface CancelOptions {
  /** Source of cancellation */
  source?: CancellationSource;
  /** Human-readable reason */
  reason?: string;
}

export interface CancelResult {
  /** Execution ID */
  executionId: string;
  /** Status before cancellation */
  previousStatus: Execution['status'];
  /** Whether cancellation was performed */
  cancelled: boolean;
  /** Number of resume tokens invalidated */
  tokensInvalidated: number;
  /** Number of child executions cancelled */
  childrenCancelled: number;
  /** When cancellation completed */
  cancelledAt: number;
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

/** Statuses that can be cancelled */
const CANCELLABLE_STATUSES = ['pending', 'running', 'waiting'] as const;

/**
 * Core execution engine.
 * Stateless — all state lives in Execution objects via StateStore.
 */
export class Engine {
  private readonly _store: StateStore;
  private readonly _handlers: HandlerRegistry;
  private readonly _flows: FlowRegistry;
  private readonly events?: EventBus;
  private readonly tokenManager?: ResumeTokenManager;
  private readonly tableStore?: TableStore;
  private readonly _tableRegistry?: TableRegistry;
  private readonly pipeWAL?: WriteAheadLog;
  private readonly opts: Required<Omit<EngineOptions, 'contextLimits' | 'tokenManager' | 'tableStore' | 'tableRegistry' | 'pipeWAL'>> & {
    contextLimits?: Partial<ContextLimits>;
  };

  constructor(
    store: StateStore,
    handlers: HandlerRegistry,
    flows: FlowRegistry,
    events?: EventBus,
    options?: EngineOptions
  ) {
    this._store = store;
    this._handlers = handlers;
    this._flows = flows;
    this.events = events;
    this.tokenManager = options?.tokenManager;
    this.tableStore = options?.tableStore;
    this._tableRegistry = options?.tableRegistry;
    this.pipeWAL = options?.pipeWAL;
    this.opts = {
      recordHistory: options?.recordHistory ?? false,
      maxSteps: options?.maxSteps ?? 1000,
      timeoutMs: options?.timeoutMs ?? 30000,
      contextLimits: options?.contextLimits,
    };
  }

  /** Access to the flow registry. */
  get flows(): FlowRegistry {
    return this._flows;
  }

  /** Access to the handler registry. */
  get handlers(): HandlerRegistry {
    return this._handlers;
  }

  /** Access to the state store. */
  get store(): StateStore {
    return this._store;
  }

  /** Access to the table registry (if configured). */
  get tables(): TableRegistry | undefined {
    return this._tableRegistry;
  }

  /**
   * Create a new execution.
   * If idempotencyKey is provided, returns existing execution if found within window.
   */
  async create(
    flowId: string,
    context: Record<string, unknown> = {},
    options?: CreateOptions
  ): Promise<CreateResult> {
    // Check for idempotency hit
    if (options?.idempotencyKey && this._store.findByIdempotencyKey) {
      const windowMs = Math.min(
        options.idempotencyWindowMs ?? DEFAULT_IDEMPOTENCY_WINDOW_MS,
        MAX_IDEMPOTENCY_WINDOW_MS
      );
      const existing = await this._store.findByIdempotencyKey(flowId, options.idempotencyKey, windowMs);
      if (existing) {
        this.events?.onIdempotencyHit?.({
          executionId: existing.id,
          flowId,
          idempotencyKey: options.idempotencyKey,
        });
        return {
          execution: existing,
          created: false,
          idempotencyHit: true,
        };
      }
    }

    const flow = this._flows.get(flowId);
    if (!flow) {
      throw new ExecutionError('FLOW_NOT_FOUND', '', `Flow "${flowId}" not found`);
    }

    const idempotencyWindowMs = options?.idempotencyKey
      ? Math.min(options.idempotencyWindowMs ?? DEFAULT_IDEMPOTENCY_WINDOW_MS, MAX_IDEMPOTENCY_WINDOW_MS)
      : undefined;

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
      parentExecutionId: options?.parentExecutionId,
      idempotencyKey: options?.idempotencyKey,
      idempotencyExpiresAt: options?.idempotencyKey ? now() + idempotencyWindowMs! : undefined,
      timeoutConfig: options?.timeoutConfig,
      metadata: options?.metadata,
    };

    await this._store.save(execution);
    this.events?.onExecutionCreated?.({ executionId: execution.id, flowId, context });

    return {
      execution,
      created: true,
      idempotencyHit: false,
    };
  }

  /**
   * Execute one step. Call repeatedly until done.
   */
  async tick(executionId: string): Promise<TickResult> {
    const execution = await this._store.load(executionId);
    if (!execution) {
      return { done: true, status: 'failed', error: { code: 'NOT_FOUND', message: 'Execution not found' } };
    }

    // Already terminal
    if (execution.status === 'completed' || execution.status === 'failed' || execution.status === 'cancelled') {
      return { done: true, status: execution.status };
    }

    // Being cancelled - don't proceed
    if (execution.status === 'cancelling') {
      return { done: false, status: 'cancelling' };
    }

    // Waiting and not ready
    if (execution.status === 'waiting' && execution.wakeAt && execution.wakeAt > now()) {
      return { done: false, status: 'waiting', wakeAt: execution.wakeAt };
    }

    // Resuming from waiting
    if (execution.status === 'waiting') {
      this.events?.onExecutionResumed?.({
        executionId: execution.id,
        flowId: execution.flowId,
        stepId: execution.currentStepId,
      });
    }

    // Step limit
    if (execution.stepCount >= this.opts.maxSteps) {
      return this.fail(execution, 'MAX_STEPS', `Exceeded ${this.opts.maxSteps} steps`);
    }

    // Load flow
    const flow = this._flows.get(execution.flowId, execution.flowVersion);
    if (!flow) {
      return this.fail(execution, 'FLOW_NOT_FOUND', `Flow "${execution.flowId}" not found`);
    }

    // Get step
    const step = flow.steps[execution.currentStepId];
    if (!step) {
      return this.fail(execution, 'STEP_NOT_FOUND', `Step "${execution.currentStepId}" not found`);
    }

    // Get handler
    const handler = this._handlers.get(step.type);
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
      let timedOut = false;
      const timeout = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, this.opts.timeoutMs);

      try {
        const ctx = new ContextHelpersImpl(
          execution.id,
          execution.context,
          undefined, // storage
          undefined, // config
          this.opts.contextLimits
        );
        result = await handler.execute({
          input,
          step,
          context: execution.context,
          ctx,
          execution: execution,
          tokenManager: this.tokenManager,
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeout);
      }

      if (timedOut) {
        this.events?.onStepTimeout?.({
          executionId: execution.id,
          stepId: step.id,
          timeoutMs: this.opts.timeoutMs,
        });
      }
    } catch (err) {
      // Detect timeout-induced abort
      if (err instanceof Error && err.name === 'AbortError') {
        this.events?.onStepTimeout?.({
          executionId: execution.id,
          stepId: step.id,
          timeoutMs: this.opts.timeoutMs,
        });
      }
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
        if (options?.simulateTime) {
          // Advance past the wake time so the next tick resumes immediately
          const exec = await this._store.load(executionId);
          if (exec && exec.wakeAt) {
            exec.wakeAt = 0; // epoch — always in the past
            await this._store.save(exec);
          }
        } else {
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
   * Cancel an execution with full cleanup.
   */
  async cancel(executionId: string, options?: CancelOptions | string): Promise<CancelResult> {
    // Support legacy signature: cancel(id, reason?: string)
    const opts: CancelOptions = typeof options === 'string'
      ? { source: 'user', reason: options }
      : options ?? { source: 'user' };

    const execution = await this._store.load(executionId);

    if (!execution) {
      return {
        executionId,
        previousStatus: 'failed',
        cancelled: false,
        tokensInvalidated: 0,
        childrenCancelled: 0,
        cancelledAt: now(),
      };
    }

    const previousStatus = execution.status;

    // Already terminal - no-op
    if (!CANCELLABLE_STATUSES.includes(previousStatus as typeof CANCELLABLE_STATUSES[number])) {
      return {
        executionId,
        previousStatus,
        cancelled: false,
        tokensInvalidated: 0,
        childrenCancelled: 0,
        cancelledAt: now(),
      };
    }

    // 1. Set to cancelling (transitional)
    execution.status = 'cancelling';
    execution.updatedAt = now();
    await this._store.save(execution);

    // 2. Invalidate resume tokens
    let tokensInvalidated = 0;
    if (this.tokenManager) {
      const tokens = await this.tokenManager.listByExecution(executionId);
      for (const token of tokens) {
        if (token.status === 'active') {
          await this.tokenManager.revoke(token.token);
          tokensInvalidated++;
        }
      }
    }

    // 3. Cancel children (sub-flows)
    let childrenCancelled = 0;
    if (this._store.findChildren) {
      const children = await this._store.findChildren(executionId);
      for (const child of children) {
        const result = await this.cancel(child.id, { source: 'parent', reason: 'Parent cancelled' });
        if (result.cancelled) childrenCancelled++;
      }
    }

    // 4. Set final status
    const cancelledAt = now();
    execution.status = 'cancelled';
    execution.cancellation = {
      source: opts.source ?? 'user',
      reason: opts.reason,
      cancelledAt,
    };
    execution.updatedAt = cancelledAt;
    await this._store.save(execution);

    // 5. Emit events
    this.events?.onExecutionCancelled?.({
      executionId,
      source: opts.source ?? 'user',
      reason: opts.reason,
      childrenCancelled,
      tokensInvalidated,
    });
    // Also emit failed for backward compat
    this.events?.onExecutionFailed?.({
      executionId,
      stepId: execution.currentStepId,
      error: { code: 'CANCELLED', message: opts.reason ?? 'Execution cancelled' },
    });

    return {
      executionId,
      previousStatus,
      cancelled: true,
      tokensInvalidated,
      childrenCancelled,
      cancelledAt,
    };
  }

  /**
   * Get execution by ID.
   */
  async get(executionId: string): Promise<Execution | null> {
    return this._store.load(executionId);
  }

  // --- Private ---

  /**
   * Execute matching pipes for a step result.
   * Fire-and-forget: pipe failures never affect execution flow.
   */
  private async executePipes(execution: Execution, flow: Flow, step: Step, result: StepResult): Promise<void> {
    if (!this.tableStore || !flow.pipes?.length) return;

    const outcome = result.outcome === 'success' ? 'success' : 'failure';
    const matchingPipes = flow.pipes.filter(p =>
      p.enabled !== false &&
      p.stepId === step.id &&
      (p.on === 'any' || (p.on ?? 'success') === outcome)
    );

    for (const pipe of matchingPipes) {
      let row: Row | undefined;
      try {
        row = this.buildPipeRow(pipe, result.output);
        const rowId = await this.tableStore.insert(pipe.tableId, row, execution.tenantId);
        this.events?.onPipeInserted?.({
          executionId: execution.id,
          stepId: step.id,
          pipeId: pipe.id,
          tableId: pipe.tableId,
          rowId,
        });
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Unknown pipe error';
        this.events?.onPipeFailed?.({
          executionId: execution.id,
          stepId: step.id,
          pipeId: pipe.id,
          tableId: pipe.tableId,
          error: { code: 'PIPE_ERROR', message: errorMessage },
        });

        // Queue for retry via WAL (if WAL is configured)
        if (this.pipeWAL && row) {
          try {
            await this.pipeWAL.append({
              id: generateId(),
              tableId: pipe.tableId,
              tenantId: execution.tenantId,
              data: row,
              pipeId: pipe.id,
              executionId: execution.id,
              flowId: execution.flowId,
              stepId: step.id,
              error: errorMessage,
              attempts: 0,
              createdAt: now(),
            });
          } catch {
            // WAL append itself failed — truly lost, but execution continues
          }
        }
      }
    }
  }

  /**
   * Build a row from pipe mappings and step output.
   */
  private buildPipeRow(pipe: PipeDef, output: unknown): Row {
    const row: Row = {};

    // Map step output fields to column IDs
    for (const mapping of pipe.mappings) {
      row[mapping.columnId] = getPath(output, mapping.sourcePath);
    }

    // Add static values
    if (pipe.staticValues) {
      Object.assign(row, pipe.staticValues);
    }

    return row;
  }

  private async fail(execution: Execution, code: string, message: string): Promise<TickResult> {
    execution.status = 'failed';
    execution.error = { code, message, stepId: execution.currentStepId, timestamp: now() };
    execution.updatedAt = now();
    await this._store.save(execution);
    this.events?.onExecutionFailed?.({ executionId: execution.id, stepId: execution.currentStepId, error: execution.error });
    return { done: true, status: 'failed', error: { code, message } };
  }

  private async applyResult(execution: Execution, flow: Flow, step: Step, result: StepResult): Promise<TickResult> {
    // Store output
    if ((result.outcome === 'success' || result.outcome === 'waiting') && step.outputKey && result.output !== undefined) {
      setPath(execution.context, step.outputKey, result.output);
    }

    // Execute matching pipes (fire-and-forget — never affects execution)
    await this.executePipes(execution, flow, step, result);

    if (result.outcome === 'success') {
      // Clear retry attempts on success
      if (execution.retryAttempts?.[step.id]) {
        delete execution.retryAttempts[step.id];
      }

      const next = result.nextStepOverride !== undefined ? result.nextStepOverride : step.transitions.onSuccess;

      if (next === null || next === undefined) {
        // Complete
        execution.status = 'completed';
        execution.updatedAt = now();
        await this._store.save(execution);
        this.events?.onExecutionCompleted?.({ executionId: execution.id, context: execution.context, totalSteps: execution.stepCount });
        return { done: true, status: 'completed', stepId: step.id, outcome: 'success' };
      }

      if (!flow.steps[next]) {
        return this.fail(execution, 'INVALID_TRANSITION', `Step "${step.id}" → "${next}" not found`);
      }

      execution.currentStepId = next;
      execution.updatedAt = now();
      await this._store.save(execution);
      this.events?.onTransition?.({ executionId: execution.id, fromStepId: step.id, toStepId: next, outcome: 'success' });
      return { done: false, status: 'running', stepId: step.id, outcome: 'success' };
    }

    if (result.outcome === 'failure') {
      // ── Retry Logic ──────────────────────────────────────────────
      if (step.retry && step.retry.maxAttempts > 0) {
        const attempts = execution.retryAttempts?.[step.id] ?? 0;
        const errorCode = result.error?.code ?? 'STEP_FAILED';

        // Check if this error is retryable
        const retryable = !step.retry.retryOn || step.retry.retryOn.includes(errorCode);

        if (retryable && attempts < step.retry.maxAttempts) {
          // Increment attempt counter
          if (!execution.retryAttempts) execution.retryAttempts = {};
          execution.retryAttempts[step.id] = attempts + 1;

          // Calculate backoff
          const baseBackoff = step.retry.backoffMs ?? 0;
          const multiplier = step.retry.backoffMultiplier ?? 2;
          const maxBackoff = step.retry.maxBackoffMs ?? 60000;
          const backoffMs = Math.min(baseBackoff * Math.pow(multiplier, attempts), maxBackoff);

          this.events?.onStepRetry?.({
            executionId: execution.id,
            stepId: step.id,
            attempt: attempts + 1,
            maxAttempts: step.retry.maxAttempts,
            backoffMs,
            error: { code: errorCode, message: result.error?.message ?? 'Step failed' },
          });

          if (backoffMs > 0) {
            // Wait before retrying (engine will re-tick when wakeAt is reached)
            execution.status = 'waiting';
            execution.wakeAt = now() + backoffMs;
            execution.waitReason = `Retry ${attempts + 1}/${step.retry.maxAttempts} after ${backoffMs}ms`;
            execution.waitStartedAt = now();
            // Keep currentStepId the same — it re-runs on next tick
            execution.updatedAt = now();
            await this._store.save(execution);
            return { done: false, status: 'waiting', stepId: step.id, outcome: 'failure', wakeAt: execution.wakeAt };
          } else {
            // Immediate retry — stay running, same step
            execution.updatedAt = now();
            await this._store.save(execution);
            return { done: false, status: 'running', stepId: step.id, outcome: 'failure' };
          }
        }
      }
      // Clear retry attempts on final failure
      if (execution.retryAttempts?.[step.id]) {
        delete execution.retryAttempts[step.id];
      }

      // ── Normal failure path ──────────────────────────────────────
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
        await this._store.save(execution);
        this.events?.onExecutionFailed?.({ executionId: execution.id, stepId: step.id, error: execution.error });
        return { done: true, status: 'failed', stepId: step.id, outcome: 'failure', error: { code: execution.error.code, message: execution.error.message } };
      }

      if (!flow.steps[next]) {
        return this.fail(execution, 'INVALID_TRANSITION', `Step "${step.id}" onFailure → "${next}" not found`);
      }

      execution.currentStepId = next;
      execution.updatedAt = now();
      await this._store.save(execution);
      this.events?.onTransition?.({ executionId: execution.id, fromStepId: step.id, toStepId: next, outcome: 'failure' });
      return { done: false, status: 'running', stepId: step.id, outcome: 'failure' };
    }

    // Wait (outcome is 'wait', 'waiting', or 'waited')
    execution.status = 'waiting';
    execution.wakeAt = result.wakeAt;
    execution.waitReason = result.waitReason;
    execution.waitStartedAt = now(); // Track when waiting started for timeout
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
    await this._store.save(execution);
    this.events?.onExecutionWaiting?.({ executionId: execution.id, stepId: step.id, wakeAt: result.wakeAt, reason: result.waitReason });
    return { done: false, status: 'waiting', stepId: step.id, outcome: 'wait', wakeAt: result.wakeAt };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}
