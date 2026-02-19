/**
 * EventDispatcher Tests
 *
 * Verifies:
 * - Multi-listener support (.on / .off / .removeAll)
 * - Wildcard listener receives all events
 * - Sync mode: events dispatched inline
 * - Async mode: events dispatched on microtask
 * - Listener isolation: throwing listener doesn't affect others
 * - onError callback receives thrown errors
 * - Timestamp attached to every event
 * - listenerCount and unsubscribe function
 * - Flush drains async queue
 * - Integration: works as Engine's EventBus
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventDispatcher, type DispatchedEvent, type EventType } from '../impl/event-dispatcher';
import { Engine } from '../engine/execution-engine';
import { MemoryStore } from '../impl/memory-store';
import { DefaultHandlerRegistry } from '../impl/handler-registry';
import { DefaultFlowRegistry } from '../impl/flow-registry';
import type { StepHandler } from '../interfaces/step-handler';
import type { Flow } from '../types/flow';

// ── Helpers ─────────────────────────────────────────────────────

const echoHandler: StepHandler = {
  type: 'echo',
  async execute(params) {
    return { outcome: 'success', output: params.input };
  },
};

const multiStepFlow: Flow = {
  id: 'multi',
  version: '1.0.0',
  initialStepId: 'step1',
  steps: {
    step1: {
      id: 'step1',
      type: 'echo',
      config: {},
      input: { type: 'static', value: { x: 1 } },
      outputKey: 'first',
      transitions: { onSuccess: 'step2', onFailure: null },
    },
    step2: {
      id: 'step2',
      type: 'echo',
      config: {},
      input: { type: 'static', value: { x: 2 } },
      outputKey: 'second',
      transitions: { onSuccess: null, onFailure: null },
    },
  },
};

// ── Sync Mode Tests ─────────────────────────────────────────────

describe('EventDispatcher (sync)', () => {
  let dispatcher: EventDispatcher;

  beforeEach(() => {
    dispatcher = new EventDispatcher({ mode: 'sync' });
  });

  it('dispatches to a single listener', () => {
    const received: DispatchedEvent[] = [];
    dispatcher.on('execution.created', e => received.push(e));

    dispatcher.onExecutionCreated({ executionId: 'e1', flowId: 'f1', context: {} });

    expect(received).toHaveLength(1);
    expect(received[0].type).toBe('execution.created');
    expect(received[0].executionId).toBe('e1');
  });

  it('dispatches to multiple listeners on same event', () => {
    let a = 0, b = 0;
    dispatcher.on('step.completed', () => { a++; });
    dispatcher.on('step.completed', () => { b++; });

    dispatcher.onStepCompleted({
      executionId: 'e', stepId: 's',
      result: { outcome: 'success', output: {} },
      durationMs: 42,
    });

    expect(a).toBe(1);
    expect(b).toBe(1);
  });

  it('wildcard listener receives all events', () => {
    const all: string[] = [];
    dispatcher.on('*', e => all.push(e.type));

    dispatcher.onExecutionCreated({ executionId: 'e', flowId: 'f', context: {} });
    dispatcher.onStepStarted({ executionId: 'e', stepId: 's', input: {} });
    dispatcher.onRowInserted({ tableId: 't', rowId: 'r', row: {} });

    expect(all).toEqual(['execution.created', 'step.started', 'row.inserted']);
  });

  it('adds timestamp to every event', () => {
    const received: DispatchedEvent[] = [];
    dispatcher.on('execution.created', e => received.push(e));

    const before = Date.now();
    dispatcher.onExecutionCreated({ executionId: 'e', flowId: 'f', context: {} });

    expect(received[0].timestamp).toBeGreaterThanOrEqual(before);
    expect(received[0].timestamp).toBeLessThanOrEqual(Date.now() + 10);
  });

  it('events are frozen (immutable)', () => {
    const received: DispatchedEvent[] = [];
    dispatcher.on('execution.created', e => received.push(e));

    dispatcher.onExecutionCreated({ executionId: 'e', flowId: 'f', context: {} });

    expect(() => { (received[0] as any).executionId = 'tampered'; }).toThrow();
  });

  it('unsubscribe function removes listener', () => {
    let count = 0;
    const unsub = dispatcher.on('execution.created', () => { count++; });

    dispatcher.onExecutionCreated({ executionId: 'e', flowId: 'f', context: {} });
    expect(count).toBe(1);

    unsub();
    dispatcher.onExecutionCreated({ executionId: 'e', flowId: 'f', context: {} });
    expect(count).toBe(1);
  });

  it('off() removes listener', () => {
    let count = 0;
    const listener = () => { count++; };
    dispatcher.on('execution.created', listener);

    dispatcher.onExecutionCreated({ executionId: 'e', flowId: 'f', context: {} });
    expect(count).toBe(1);

    dispatcher.off('execution.created', listener);
    dispatcher.onExecutionCreated({ executionId: 'e', flowId: 'f', context: {} });
    expect(count).toBe(1);
  });

  it('removeAll() clears listeners for a type', () => {
    let a = 0, b = 0;
    dispatcher.on('execution.created', () => { a++; });
    dispatcher.on('step.started', () => { b++; });

    dispatcher.removeAll('execution.created');

    dispatcher.onExecutionCreated({ executionId: 'e', flowId: 'f', context: {} });
    dispatcher.onStepStarted({ executionId: 'e', stepId: 's', input: {} });

    expect(a).toBe(0);
    expect(b).toBe(1);
  });

  it('removeAll() with no args clears everything', () => {
    dispatcher.on('execution.created', () => {});
    dispatcher.on('step.started', () => {});
    dispatcher.on('*', () => {});

    expect(dispatcher.listenerCount()).toBe(3);
    dispatcher.removeAll();
    expect(dispatcher.listenerCount()).toBe(0);
  });

  it('listenerCount() returns correct counts', () => {
    expect(dispatcher.listenerCount()).toBe(0);
    expect(dispatcher.listenerCount('execution.created')).toBe(0);

    dispatcher.on('execution.created', () => {});
    dispatcher.on('execution.created', () => {});
    dispatcher.on('step.started', () => {});

    expect(dispatcher.listenerCount('execution.created')).toBe(2);
    expect(dispatcher.listenerCount('step.started')).toBe(1);
    expect(dispatcher.listenerCount()).toBe(3);
  });

  it('no listeners — fast exit, no errors', () => {
    // Just verify it doesn't throw
    dispatcher.onExecutionCreated({ executionId: 'e', flowId: 'f', context: {} });
    dispatcher.onStepCompleted({
      executionId: 'e', stepId: 's',
      result: { outcome: 'success', output: {} },
      durationMs: 1,
    });
  });
});

// ── Listener Isolation ──────────────────────────────────────────

describe('EventDispatcher isolation', () => {
  it('throwing listener does not affect other listeners', () => {
    const dispatcher = new EventDispatcher({ mode: 'sync' });
    let reached = false;

    dispatcher.on('execution.created', () => { throw new Error('boom'); });
    dispatcher.on('execution.created', () => { reached = true; });

    dispatcher.onExecutionCreated({ executionId: 'e', flowId: 'f', context: {} });

    expect(reached).toBe(true);
  });

  it('onError callback receives thrown errors', () => {
    const errors: unknown[] = [];
    const dispatcher = new EventDispatcher({
      mode: 'sync',
      onError: (err) => errors.push(err),
    });

    dispatcher.on('execution.created', () => { throw new Error('bad listener'); });
    dispatcher.onExecutionCreated({ executionId: 'e', flowId: 'f', context: {} });

    expect(errors).toHaveLength(1);
    expect((errors[0] as Error).message).toBe('bad listener');
  });

  it('onError receives the event that caused the error', () => {
    const captured: DispatchedEvent[] = [];
    const dispatcher = new EventDispatcher({
      mode: 'sync',
      onError: (_err, event) => captured.push(event),
    });

    dispatcher.on('step.timeout', () => { throw new Error('oops'); });
    dispatcher.onStepTimeout({ executionId: 'e1', stepId: 's1', timeoutMs: 5000 });

    expect(captured).toHaveLength(1);
    expect(captured[0].type).toBe('step.timeout');
    expect(captured[0].executionId).toBe('e1');
  });
});

// ── Async Mode Tests ────────────────────────────────────────────

describe('EventDispatcher (async)', () => {
  it('does not fire listeners synchronously', () => {
    const dispatcher = new EventDispatcher({ mode: 'async' });
    let count = 0;
    dispatcher.on('execution.created', () => { count++; });

    dispatcher.onExecutionCreated({ executionId: 'e', flowId: 'f', context: {} });

    // Not yet — still on same microtask
    expect(count).toBe(0);
  });

  it('fires listeners after flush()', async () => {
    const dispatcher = new EventDispatcher({ mode: 'async' });
    let count = 0;
    dispatcher.on('execution.created', () => { count++; });

    dispatcher.onExecutionCreated({ executionId: 'e', flowId: 'f', context: {} });
    await dispatcher.flush();

    expect(count).toBe(1);
  });

  it('multiple events dispatched and flushed', async () => {
    const dispatcher = new EventDispatcher({ mode: 'async' });
    const types: string[] = [];
    dispatcher.on('*', e => types.push(e.type));

    dispatcher.onExecutionCreated({ executionId: 'e', flowId: 'f', context: {} });
    dispatcher.onStepStarted({ executionId: 'e', stepId: 's', input: {} });
    dispatcher.onStepCompleted({
      executionId: 'e', stepId: 's',
      result: { outcome: 'success', output: {} },
      durationMs: 5,
    });

    await dispatcher.flush();

    expect(types).toEqual(['execution.created', 'step.started', 'step.completed']);
  });

  it('listener errors still isolated in async mode', async () => {
    const errors: unknown[] = [];
    const dispatcher = new EventDispatcher({
      mode: 'async',
      onError: (err) => errors.push(err),
    });

    let reached = false;
    dispatcher.on('execution.created', () => { throw new Error('async boom'); });
    dispatcher.on('execution.created', () => { reached = true; });

    dispatcher.onExecutionCreated({ executionId: 'e', flowId: 'f', context: {} });
    await dispatcher.flush();

    expect(reached).toBe(true);
    expect(errors).toHaveLength(1);
  });
});

// ── All 39 EventBus methods wired ───────────────────────────────

describe('EventDispatcher covers all EventBus methods', () => {
  it('all 40 methods fire the correct event type', () => {
    const dispatcher = new EventDispatcher({ mode: 'sync' });
    const received: string[] = [];
    dispatcher.on('*', e => received.push(e.type));

    // Fire every method — payloads don't matter, just need the right shape
    dispatcher.onExecutionCreated({ executionId: '', flowId: '', context: {} });
    dispatcher.onExecutionStarted({ executionId: '', flowId: '', stepId: '' });
    dispatcher.onExecutionCompleted({ executionId: '', context: {}, totalSteps: 0 });
    dispatcher.onExecutionFailed({ executionId: '', stepId: '', error: { code: '', message: '' } });
    dispatcher.onExecutionWaiting({ executionId: '', stepId: '' });
    dispatcher.onExecutionResumed({ executionId: '', flowId: '', stepId: '' });
    dispatcher.onExecutionCancelled({ executionId: '', source: '', childrenCancelled: 0, tokensInvalidated: 0 });
    dispatcher.onStepStarted({ executionId: '', stepId: '', input: {} });
    dispatcher.onStepCompleted({ executionId: '', stepId: '', result: { outcome: 'success', output: {} }, durationMs: 0 });
    dispatcher.onStepTimeout({ executionId: '', stepId: '', timeoutMs: 0 });
    dispatcher.onStepRetry({ executionId: '', stepId: '', attempt: 1, maxAttempts: 3, backoffMs: 0, error: { code: '', message: '' } });
    dispatcher.onTransition({ executionId: '', fromStepId: '', toStepId: '', outcome: '' });
    dispatcher.onIdempotencyHit({ executionId: '', flowId: '', idempotencyKey: '' });
    dispatcher.onJobClaimed({ jobId: '', executionId: '', stepId: '', instanceId: '', runnerId: '', handler: '' });
    dispatcher.onJobProgress({ jobId: '', executionId: '', stepId: '', instanceId: '', progress: { percent: 0 } });
    dispatcher.onJobCheckpoint({ jobId: '', executionId: '', stepId: '', instanceId: '', checkpointKey: '' });
    dispatcher.onJobCompleted({ jobId: '', executionId: '', stepId: '', instanceId: '', durationMs: 0, result: {} });
    dispatcher.onJobFailed({ jobId: '', executionId: '', stepId: '', instanceId: '', error: { code: '', message: '' }, willRetry: false, attempt: 0, maxAttempts: 0 });
    dispatcher.onJobSuperseded({ jobId: '', executionId: '', stepId: '', oldInstanceId: '', newInstanceId: '' });
    dispatcher.onJobHeartbeat({ jobId: '', executionId: '', stepId: '', instanceId: '' });
    dispatcher.onPipeInserted({ executionId: '', stepId: '', pipeId: '', tableId: '', rowId: '' });
    dispatcher.onPipeFailed({ executionId: '', stepId: '', pipeId: '', tableId: '', error: { code: '', message: '' } });
    dispatcher.onPipeDiscarded({ executionId: '', pipeId: '', tableId: '', attempts: 0, error: '' });
    dispatcher.onRowInserted({ tableId: '', rowId: '', row: {} });
    dispatcher.onRowUpdated({ tableId: '', rowId: '', changes: {} });
    dispatcher.onRowDeleted({ tableId: '', rowId: '' });
    dispatcher.onFlowRegistered({ flowId: '', version: '' });
    dispatcher.onHandlerRegistered({ handlerType: '' });
    dispatcher.onHandlerUnregistered({ handlerType: '' });
    dispatcher.onTableCreated({ tableId: '', columnCount: 0 });
    dispatcher.onTableDeleted({ tableId: '' });
    dispatcher.onTableColumnAdded({ tableId: '', columnId: '', columnType: '' });
    dispatcher.onTableColumnRemoved({ tableId: '', columnId: '' });
    dispatcher.onTokenCreated({ token: '', executionId: '', stepId: '' });
    dispatcher.onTokenUsed({ token: '', executionId: '' });
    dispatcher.onTokenRevoked({ token: '', executionId: '' });
    dispatcher.onTokensCleanedUp({ count: 0 });
    dispatcher.onWALAppended({ entryId: '', tableId: '', executionId: '', pipeId: '' });
    dispatcher.onWALReplayed({ entryId: '', tableId: '' });
    dispatcher.onWALCompacted({ removedCount: 0 });

    expect(received).toHaveLength(40);
    expect(received).toEqual([
      'execution.created', 'execution.started', 'execution.completed',
      'execution.failed', 'execution.waiting', 'execution.resumed', 'execution.cancelled',
      'step.started', 'step.completed', 'step.timeout', 'step.retry',
      'transition', 'idempotency.hit',
      'job.claimed', 'job.progress', 'job.checkpoint', 'job.completed',
      'job.failed', 'job.superseded', 'job.heartbeat',
      'pipe.inserted', 'pipe.failed', 'pipe.discarded',
      'row.inserted', 'row.updated', 'row.deleted',
      'flow.registered',
      'handler.registered', 'handler.unregistered',
      'table.created', 'table.deleted', 'table.column.added', 'table.column.removed',
      'token.created', 'token.used', 'token.revoked', 'tokens.cleaned',
      'wal.appended', 'wal.replayed', 'wal.compacted',
    ]);
  });
});

// ── Integration: EventDispatcher as Engine's EventBus ───────────

describe('EventDispatcher + Engine integration', () => {
  it('captures full execution lifecycle via dispatcher', async () => {
    const dispatcher = new EventDispatcher({ mode: 'sync' });
    const events: DispatchedEvent[] = [];
    dispatcher.on('*', e => events.push(e));

    const store = new MemoryStore();
    const handlers = new DefaultHandlerRegistry();
    const flows = new DefaultFlowRegistry();
    handlers.register(echoHandler);
    flows.register(multiStepFlow);

    const engine = new Engine(store, handlers, flows, dispatcher, {
      recordHistory: true,
      maxSteps: 100,
    });

    const { execution } = await engine.create('multi');
    await engine.run(execution.id, { simulateTime: true });

    const types = events.map(e => e.type);

    expect(types).toContain('execution.created');
    expect(types).toContain('execution.started');
    expect(types.filter(t => t === 'step.started')).toHaveLength(2);
    expect(types.filter(t => t === 'step.completed')).toHaveLength(2);
    expect(types.filter(t => t === 'transition')).toHaveLength(1);
    expect(types).toContain('execution.completed');
  });

  it('async mode works with engine (events arrive after flush)', async () => {
    const dispatcher = new EventDispatcher({ mode: 'async' });
    const events: DispatchedEvent[] = [];
    dispatcher.on('*', e => events.push(e));

    const store = new MemoryStore();
    const handlers = new DefaultHandlerRegistry();
    const flows = new DefaultFlowRegistry();
    handlers.register(echoHandler);
    flows.register(multiStepFlow);

    const engine = new Engine(store, handlers, flows, dispatcher, {
      maxSteps: 100,
    });

    const { execution } = await engine.create('multi');
    await engine.run(execution.id, { simulateTime: true });

    // Engine.run() is async internally, so microtasks may drain during awaits.
    // Flush to ensure everything is delivered, then verify events arrived.
    await dispatcher.flush();

    expect(events.length).toBeGreaterThan(0);
    expect(events.some(e => e.type === 'execution.created')).toBe(true);
    expect(events.some(e => e.type === 'execution.completed')).toBe(true);
  });

  it('metrics listener pattern — measure step durations', async () => {
    const dispatcher = new EventDispatcher({ mode: 'sync' });
    const durations: number[] = [];

    dispatcher.on('step.completed', (e) => {
      durations.push(e.durationMs as number);
    });

    const store = new MemoryStore();
    const handlers = new DefaultHandlerRegistry();
    const flows = new DefaultFlowRegistry();
    handlers.register(echoHandler);
    flows.register(multiStepFlow);

    const engine = new Engine(store, handlers, flows, dispatcher, {
      maxSteps: 100,
    });

    const { execution } = await engine.create('multi');
    await engine.run(execution.id, { simulateTime: true });

    expect(durations).toHaveLength(2);
    durations.forEach(d => expect(d).toBeGreaterThanOrEqual(0));
  });

  it('audit log pattern — wildcard captures everything', async () => {
    const dispatcher = new EventDispatcher({ mode: 'sync' });
    const auditLog: Array<{ type: string; ts: number }> = [];

    dispatcher.on('*', (e) => {
      auditLog.push({ type: e.type, ts: e.timestamp });
    });

    const store = new MemoryStore();
    const handlers = new DefaultHandlerRegistry();
    const flows = new DefaultFlowRegistry();
    handlers.register(echoHandler);
    flows.register(multiStepFlow);

    const engine = new Engine(store, handlers, flows, dispatcher, {
      maxSteps: 100,
    });

    const { execution } = await engine.create('multi');
    await engine.run(execution.id, { simulateTime: true });

    // Should have a good number of events
    expect(auditLog.length).toBeGreaterThanOrEqual(7); // created + started + 2×step.started + 2×step.completed + transition + completed
    // All timestamps should be valid
    auditLog.forEach(entry => {
      expect(entry.ts).toBeGreaterThan(0);
    });
  });
});
