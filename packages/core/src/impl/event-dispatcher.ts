/**
 * EventDispatcher — event bus with multi-listener support,
 * async dispatch, listener isolation, and automatic timestamping.
 *
 * Implements the EventBus interface so it drops into Engine, decorators,
 * and anywhere else that accepts an EventBus — zero engine code changes.
 *
 * Features:
 * - Multiple listeners per event type via `.on(type, listener)`
 * - Wildcard `'*'` listener receives every event
 * - Async dispatch (queueMicrotask) — listeners never block the engine
 * - Sync mode for testing — events dispatched inline
 * - try/catch per listener — one bad listener can't crash the system
 * - Every dispatched event has `type` and `timestamp` fields
 * - `.on()` returns unsubscribe function for easy cleanup
 *
 * Usage:
 * ```typescript
 * const dispatcher = new EventDispatcher();
 *
 * // Subscribe to specific events
 * const unsub = dispatcher.on('step.completed', (e) => {
 *   metrics.histogram('step_duration_ms', e.durationMs);
 * });
 *
 * // Wildcard — audit log everything
 * dispatcher.on('*', (e) => auditLog.append(e));
 *
 * // Pass to engine as EventBus
 * const engine = new Engine(store, handlers, flows, dispatcher);
 *
 * // Cleanup
 * unsub();
 * ```
 */

import type { EventBus } from '../interfaces/event-bus';
import { now } from '../utils';

// ── Event Types ─────────────────────────────────────────────────

/** All event type strings emitted by the system. */
export type EventType =
  // Execution lifecycle
  | 'execution.created'
  | 'execution.started'
  | 'execution.completed'
  | 'execution.failed'
  | 'execution.waiting'
  | 'execution.resumed'
  | 'execution.cancelled'
  // Step lifecycle
  | 'step.started'
  | 'step.completed'
  | 'step.timeout'
  | 'step.retry'
  // Routing
  | 'transition'
  | 'idempotency.hit'
  // Jobs
  | 'job.claimed'
  | 'job.progress'
  | 'job.checkpoint'
  | 'job.completed'
  | 'job.failed'
  | 'job.superseded'
  | 'job.heartbeat'
  // Pipes
  | 'pipe.inserted'
  | 'pipe.failed'
  | 'pipe.discarded'
  // Rows
  | 'row.inserted'
  | 'row.updated'
  | 'row.deleted'
  // Flow registry
  | 'flow.registered'
  // Handler registry
  | 'handler.registered'
  | 'handler.unregistered'
  // Table registry
  | 'table.created'
  | 'table.deleted'
  | 'table.column.added'
  | 'table.column.removed'
  // Resume tokens
  | 'token.created'
  | 'token.used'
  | 'token.revoked'
  | 'tokens.cleaned'
  // WAL
  | 'wal.appended'
  | 'wal.replayed'
  | 'wal.compacted';

/** Every dispatched event carries its type and a millisecond timestamp. */
export interface DispatchedEvent {
  readonly type: EventType;
  readonly timestamp: number;
  readonly [key: string]: unknown;
}

/** Listener callback signature. */
export type EventListener = (event: DispatchedEvent) => void;

// ── Mapping: EventBus method name → event type string ───────────

const EVENT_MAP: ReadonlyArray<[keyof EventBus, EventType]> = [
  // Execution
  ['onExecutionCreated', 'execution.created'],
  ['onExecutionStarted', 'execution.started'],
  ['onExecutionCompleted', 'execution.completed'],
  ['onExecutionFailed', 'execution.failed'],
  ['onExecutionWaiting', 'execution.waiting'],
  ['onExecutionResumed', 'execution.resumed'],
  ['onExecutionCancelled', 'execution.cancelled'],
  // Step
  ['onStepStarted', 'step.started'],
  ['onStepCompleted', 'step.completed'],
  ['onStepTimeout', 'step.timeout'],
  ['onStepRetry', 'step.retry'],
  // Routing
  ['onTransition', 'transition'],
  ['onIdempotencyHit', 'idempotency.hit'],
  // Jobs
  ['onJobClaimed', 'job.claimed'],
  ['onJobProgress', 'job.progress'],
  ['onJobCheckpoint', 'job.checkpoint'],
  ['onJobCompleted', 'job.completed'],
  ['onJobFailed', 'job.failed'],
  ['onJobSuperseded', 'job.superseded'],
  ['onJobHeartbeat', 'job.heartbeat'],
  // Pipes
  ['onPipeInserted', 'pipe.inserted'],
  ['onPipeFailed', 'pipe.failed'],
  ['onPipeDiscarded', 'pipe.discarded'],
  // Rows
  ['onRowInserted', 'row.inserted'],
  ['onRowUpdated', 'row.updated'],
  ['onRowDeleted', 'row.deleted'],
  // Flow registry
  ['onFlowRegistered', 'flow.registered'],
  // Handler registry
  ['onHandlerRegistered', 'handler.registered'],
  ['onHandlerUnregistered', 'handler.unregistered'],
  // Table registry
  ['onTableCreated', 'table.created'],
  ['onTableDeleted', 'table.deleted'],
  ['onTableColumnAdded', 'table.column.added'],
  ['onTableColumnRemoved', 'table.column.removed'],
  // Tokens
  ['onTokenCreated', 'token.created'],
  ['onTokenUsed', 'token.used'],
  ['onTokenRevoked', 'token.revoked'],
  ['onTokensCleanedUp', 'tokens.cleaned'],
  // WAL
  ['onWALAppended', 'wal.appended'],
  ['onWALReplayed', 'wal.replayed'],
  ['onWALCompacted', 'wal.compacted'],
];

// ── Options ─────────────────────────────────────────────────────

export interface EventDispatcherOptions {
  /**
   * Dispatch mode.
   * - `'async'` (default) — listeners fire on next microtask via queueMicrotask.
   *   Engine and store calls return immediately; listeners execute after.
   * - `'sync'` — listeners fire inline. Use for testing or when you need
   *   to assert events immediately after an operation.
   */
  mode?: 'sync' | 'async';

  /**
   * Called when a listener throws. Without this, errors are silently swallowed
   * (listeners must never crash the host). Set this to log or report.
   */
  onError?: (error: unknown, event: DispatchedEvent) => void;
}

// ── EventDispatcher ─────────────────────────────────────────────

export class EventDispatcher implements EventBus {
  private readonly _listeners = new Map<string, Set<EventListener>>();
  private readonly _mode: 'sync' | 'async';
  private readonly _onError?: (error: unknown, event: DispatchedEvent) => void;

  // EventBus method implementations — assigned in constructor
  declare onExecutionCreated: NonNullable<EventBus['onExecutionCreated']>;
  declare onExecutionStarted: NonNullable<EventBus['onExecutionStarted']>;
  declare onExecutionCompleted: NonNullable<EventBus['onExecutionCompleted']>;
  declare onExecutionFailed: NonNullable<EventBus['onExecutionFailed']>;
  declare onExecutionWaiting: NonNullable<EventBus['onExecutionWaiting']>;
  declare onExecutionResumed: NonNullable<EventBus['onExecutionResumed']>;
  declare onExecutionCancelled: NonNullable<EventBus['onExecutionCancelled']>;
  declare onStepStarted: NonNullable<EventBus['onStepStarted']>;
  declare onStepCompleted: NonNullable<EventBus['onStepCompleted']>;
  declare onStepTimeout: NonNullable<EventBus['onStepTimeout']>;
  declare onStepRetry: NonNullable<EventBus['onStepRetry']>;
  declare onTransition: NonNullable<EventBus['onTransition']>;
  declare onIdempotencyHit: NonNullable<EventBus['onIdempotencyHit']>;
  declare onJobClaimed: NonNullable<EventBus['onJobClaimed']>;
  declare onJobProgress: NonNullable<EventBus['onJobProgress']>;
  declare onJobCheckpoint: NonNullable<EventBus['onJobCheckpoint']>;
  declare onJobCompleted: NonNullable<EventBus['onJobCompleted']>;
  declare onJobFailed: NonNullable<EventBus['onJobFailed']>;
  declare onJobSuperseded: NonNullable<EventBus['onJobSuperseded']>;
  declare onJobHeartbeat: NonNullable<EventBus['onJobHeartbeat']>;
  declare onPipeInserted: NonNullable<EventBus['onPipeInserted']>;
  declare onPipeFailed: NonNullable<EventBus['onPipeFailed']>;
  declare onPipeDiscarded: NonNullable<EventBus['onPipeDiscarded']>;
  declare onRowInserted: NonNullable<EventBus['onRowInserted']>;
  declare onRowUpdated: NonNullable<EventBus['onRowUpdated']>;
  declare onRowDeleted: NonNullable<EventBus['onRowDeleted']>;
  declare onFlowRegistered: NonNullable<EventBus['onFlowRegistered']>;
  declare onHandlerRegistered: NonNullable<EventBus['onHandlerRegistered']>;
  declare onHandlerUnregistered: NonNullable<EventBus['onHandlerUnregistered']>;
  declare onTableCreated: NonNullable<EventBus['onTableCreated']>;
  declare onTableDeleted: NonNullable<EventBus['onTableDeleted']>;
  declare onTableColumnAdded: NonNullable<EventBus['onTableColumnAdded']>;
  declare onTableColumnRemoved: NonNullable<EventBus['onTableColumnRemoved']>;
  declare onTokenCreated: NonNullable<EventBus['onTokenCreated']>;
  declare onTokenUsed: NonNullable<EventBus['onTokenUsed']>;
  declare onTokenRevoked: NonNullable<EventBus['onTokenRevoked']>;
  declare onTokensCleanedUp: NonNullable<EventBus['onTokensCleanedUp']>;
  declare onWALAppended: NonNullable<EventBus['onWALAppended']>;
  declare onWALReplayed: NonNullable<EventBus['onWALReplayed']>;
  declare onWALCompacted: NonNullable<EventBus['onWALCompacted']>;

  constructor(options: EventDispatcherOptions = {}) {
    this._mode = options.mode ?? 'async';
    this._onError = options.onError;

    // Wire every EventBus method to dispatch through the listener system
    for (const [method, eventType] of EVENT_MAP) {
      (this as any)[method] = (payload: Record<string, unknown>) => {
        this._dispatch(eventType, payload);
      };
    }
  }

  // ── Public API ──────────────────────────────────────────────────

  /**
   * Subscribe to an event type. Use `'*'` to receive all events.
   * Returns an unsubscribe function.
   *
   * ```typescript
   * const unsub = dispatcher.on('step.completed', (e) => {
   *   console.log(e.stepId, e.durationMs);
   * });
   * unsub(); // cleanup
   * ```
   */
  on(type: EventType | '*', listener: EventListener): () => void {
    let set = this._listeners.get(type);
    if (!set) {
      set = new Set();
      this._listeners.set(type, set);
    }
    set.add(listener);
    return () => { set!.delete(listener); };
  }

  /**
   * Remove a specific listener.
   */
  off(type: EventType | '*', listener: EventListener): void {
    this._listeners.get(type)?.delete(listener);
  }

  /**
   * Remove all listeners for a type, or all listeners if no type specified.
   */
  removeAll(type?: EventType | '*'): void {
    if (type) {
      this._listeners.delete(type);
    } else {
      this._listeners.clear();
    }
  }

  /**
   * Count listeners for a type, or total listeners if no type specified.
   */
  listenerCount(type?: EventType | '*'): number {
    if (type) {
      return this._listeners.get(type)?.size ?? 0;
    }
    let total = 0;
    for (const set of this._listeners.values()) {
      total += set.size;
    }
    return total;
  }

  /**
   * Wait for all pending async dispatches to complete.
   * Only meaningful in async mode. In sync mode, resolves immediately.
   * Useful in tests: `await dispatcher.flush()` after engine operations.
   */
  async flush(): Promise<void> {
    // queueMicrotask runs before the next tick,
    // so awaiting a resolved promise is sufficient to drain the queue.
    await Promise.resolve();
    await Promise.resolve(); // double-flush for safety
  }

  // ── Internal ────────────────────────────────────────────────────

  private _dispatch(type: EventType, payload: Record<string, unknown>): void {
    const specific = this._listeners.get(type);
    const wildcard = this._listeners.get('*');

    // Fast exit: no one is listening
    if (!specific?.size && !wildcard?.size) return;

    const event: DispatchedEvent = Object.freeze({ ...payload, type, timestamp: now() });

    if (this._mode === 'sync') {
      this._callListeners(specific, event);
      this._callListeners(wildcard, event);
    } else {
      queueMicrotask(() => {
        this._callListeners(specific, event);
        this._callListeners(wildcard, event);
      });
    }
  }

  private _callListeners(listeners: Set<EventListener> | undefined, event: DispatchedEvent): void {
    if (!listeners) return;
    for (const listener of listeners) {
      try {
        listener(event);
      } catch (err) {
        // Never let a listener crash the engine
        this._onError?.(err, event);
      }
    }
  }
}
