/**
 * Event Coverage Tests
 *
 * Verifies that every lifecycle event fires correctly:
 * - Engine: transition, resumed, cancelled, idempotency hit, step timeout
 * - Flow registry: registered
 * - Handler registry: registered, unregistered
 * - Table registry: created, deleted, column added, column removed
 * - WAL: appended, replayed, compacted
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { TestHarness } from './harness';
import { EventEmittingFlowRegistry } from '../impl/event-emitting-flow-registry';
import { EventEmittingHandlerRegistry } from '../impl/event-emitting-handler-registry';
import { EventEmittingTableRegistry } from '../impl/event-emitting-table-registry';
import { EventEmittingWAL } from '../impl/event-emitting-wal';
import { MemoryTableRegistry } from '../impl/memory-table-registry';
import { MemoryWAL } from '../impl/memory-wal';
import { DefaultFlowRegistry } from '../impl/flow-registry';
import { DefaultHandlerRegistry } from '../impl/handler-registry';
import { generateId, now } from '../utils';
import type { TableDef, ColumnDef } from '../types/table';
import type { Flow } from '../types/flow';
import type { StepHandler } from '../interfaces/step-handler';
import type { EventBus } from '../interfaces/event-bus';

// ── Test Helpers ──────────────────────────────────────────────────

function col(name: string, type: ColumnDef['type'], required = false): ColumnDef {
  return { id: generateId(), name, type, required };
}

function makeTable(columns: ColumnDef[]): TableDef {
  return { id: generateId(), columns, createdAt: now(), updatedAt: now() };
}

const echoHandler: StepHandler = {
  type: 'echo',
  async execute(params) {
    return { outcome: 'success', output: params.input };
  },
};

const failHandler: StepHandler = {
  type: 'fail-always',
  async execute() {
    return { outcome: 'failure', error: { code: 'FAILED', message: 'always fails' } };
  },
};

const waitHandler: StepHandler = {
  type: 'wait-step',
  async execute() {
    return { outcome: 'wait', wakeAt: 1 }; // immediate wake for simulateTime
  },
};

const slowHandler: StepHandler = {
  type: 'slow',
  async execute({ signal }) {
    // Waits forever unless aborted
    return new Promise((resolve, reject) => {
      const onAbort = () => {
        const err = new Error('Aborted');
        err.name = 'AbortError';
        reject(err);
      };
      if (signal?.aborted) return onAbort();
      signal?.addEventListener('abort', onAbort);
    });
  },
};

const doneHandler: StepHandler = {
  type: 'done',
  async execute() {
    return { outcome: 'success', output: { done: true } };
  },
};

// ── Flows ────────────────────────────────────────────────────────

const multiStepFlow: Flow = {
  id: 'multi-step',
  version: '1.0.0',
  initialStepId: 'step1',
  steps: {
    step1: {
      id: 'step1',
      type: 'echo',
      config: {},
      input: { type: 'static', value: { data: 1 } },
      outputKey: 'first',
      transitions: { onSuccess: 'step2', onFailure: null },
    },
    step2: {
      id: 'step2',
      type: 'echo',
      config: {},
      input: { type: 'static', value: { data: 2 } },
      outputKey: 'second',
      transitions: { onSuccess: null, onFailure: null },
    },
  },
};

const branchFlow: Flow = {
  id: 'branch',
  version: '1.0.0',
  initialStepId: 'step1',
  steps: {
    step1: {
      id: 'step1',
      type: 'fail-always',
      config: {},
      input: { type: 'full' },
      transitions: { onSuccess: null, onFailure: 'recover' },
    },
    recover: {
      id: 'recover',
      type: 'echo',
      config: {},
      input: { type: 'static', value: 'recovered' },
      outputKey: 'result',
      transitions: { onSuccess: null, onFailure: null },
    },
  },
};

const waitFlow: Flow = {
  id: 'wait-flow',
  version: '1.0.0',
  initialStepId: 'step1',
  steps: {
    step1: {
      id: 'step1',
      type: 'wait-step',
      config: {},
      input: { type: 'full' },
      transitions: { onSuccess: 'step2', onFailure: null },
    },
    step2: {
      id: 'step2',
      type: 'done',
      config: {},
      input: { type: 'full' },
      outputKey: 'result',
      transitions: { onSuccess: null, onFailure: null },
    },
  },
};

const timeoutFlow: Flow = {
  id: 'timeout-flow',
  version: '1.0.0',
  initialStepId: 'step1',
  steps: {
    step1: {
      id: 'step1',
      type: 'slow',
      config: {},
      input: { type: 'full' },
      transitions: { onSuccess: null, onFailure: null },
    },
  },
};

const singleFlow: Flow = {
  id: 'simple',
  version: '1.0.0',
  initialStepId: 'step1',
  steps: {
    step1: {
      id: 'step1',
      type: 'echo',
      config: {},
      input: { type: 'full' },
      outputKey: 'result',
      transitions: { onSuccess: null, onFailure: null },
    },
  },
};

// ── Engine Events ───────────────────────────────────────────────

describe('Engine Events', () => {
  describe('onTransition', () => {
    it('emits transition on success path', async () => {
      const t = new TestHarness({
        handlers: [echoHandler],
        flows: [multiStepFlow],
      });

      const { events } = await t.run('multi-step');
      const transitions = events.filter((e: any) => e.type === 'transition');
      expect(transitions).toHaveLength(1);
      expect(transitions[0].fromStepId).toBe('step1');
      expect(transitions[0].toStepId).toBe('step2');
      expect(transitions[0].outcome).toBe('success');
    });

    it('emits transition on failure path', async () => {
      const t = new TestHarness({
        handlers: [echoHandler, failHandler],
        flows: [branchFlow],
      });

      const { events } = await t.run('branch');
      const transitions = events.filter((e: any) => e.type === 'transition');
      expect(transitions).toHaveLength(1);
      expect(transitions[0].fromStepId).toBe('step1');
      expect(transitions[0].toStepId).toBe('recover');
      expect(transitions[0].outcome).toBe('failure');
    });
  });

  describe('onExecutionResumed', () => {
    it('emits resumed when waiting execution ticks', async () => {
      const t = new TestHarness({
        handlers: [echoHandler, waitHandler, doneHandler],
        flows: [waitFlow],
      });

      const { events } = await t.run('wait-flow');
      const resumed = events.filter((e: any) => e.type === 'execution.resumed');
      expect(resumed).toHaveLength(1);
      expect(resumed[0].flowId).toBe('wait-flow');
    });
  });

  describe('onExecutionCancelled', () => {
    it('emits dedicated cancelled event', async () => {
      const t = new TestHarness({
        handlers: [echoHandler, waitHandler, doneHandler],
        flows: [waitFlow],
      });

      const e = await t.create('wait-flow');
      await t.tick(e.id); // → waiting
      await t.engine.cancel(e.id, { source: 'user', reason: 'testing' });

      const cancelled = t.events.filter((ev: any) => ev.type === 'execution.cancelled');
      expect(cancelled).toHaveLength(1);
      expect(cancelled[0].executionId).toBe(e.id);
      expect(cancelled[0].source).toBe('user');
      expect(cancelled[0].reason).toBe('testing');
    });

    it('also emits failed for backward compat', async () => {
      const t = new TestHarness({
        handlers: [echoHandler, waitHandler, doneHandler],
        flows: [waitFlow],
      });

      const e = await t.create('wait-flow');
      await t.tick(e.id);
      await t.engine.cancel(e.id, { source: 'system', reason: 'timeout' });

      const failed = t.events.filter((ev: any) => ev.type === 'execution.failed' && ev.error?.code === 'CANCELLED');
      expect(failed).toHaveLength(1);
    });
  });

  describe('onIdempotencyHit', () => {
    it('emits idempotency hit on duplicate key', async () => {
      const t = new TestHarness({
        handlers: [echoHandler],
        flows: [singleFlow],
      });

      await t.createWithResult('simple', {}, { idempotencyKey: 'dup-key' });
      await t.createWithResult('simple', {}, { idempotencyKey: 'dup-key' });

      const hits = t.events.filter((e: any) => e.type === 'idempotency.hit');
      expect(hits).toHaveLength(1);
      expect(hits[0].flowId).toBe('simple');
      expect(hits[0].idempotencyKey).toBe('dup-key');
    });
  });

  describe('onStepTimeout', () => {
    it('emits timeout when handler exceeds timeoutMs', async () => {
      const t = new TestHarness({
        handlers: [slowHandler],
        flows: [timeoutFlow],
        maxSteps: 10,
      });

      // Override engine timeout to something very short
      // We need a custom engine with low timeout — create one directly
      const { Engine } = await import('../engine/execution-engine');
      const { MemoryStore } = await import('../impl/memory-store');
      const { DefaultHandlerRegistry } = await import('../impl/handler-registry');
      const { DefaultFlowRegistry } = await import('../impl/flow-registry');

      const events: any[] = [];
      const eventBus: EventBus = {
        onStepTimeout: e => events.push({ type: 'step.timeout', ...e }),
        onStepCompleted: e => events.push({ type: 'step.completed', ...e }),
        onExecutionCreated: e => events.push({ type: 'created', ...e }),
        onExecutionFailed: e => events.push({ type: 'failed', ...e }),
      };

      const store = new MemoryStore();
      const handlers = new DefaultHandlerRegistry();
      const flows = new DefaultFlowRegistry();
      handlers.register(slowHandler);
      flows.register(timeoutFlow);

      const engine = new Engine(store, handlers, flows, eventBus, {
        timeoutMs: 50, // 50ms timeout
        maxSteps: 10,
      });

      const { execution } = await engine.create('timeout-flow');
      await engine.tick(execution.id);

      const timeouts = events.filter(e => e.type === 'step.timeout');
      expect(timeouts).toHaveLength(1);
      expect(timeouts[0].stepId).toBe('step1');
      expect(timeouts[0].timeoutMs).toBe(50);
    });
  });
});

// ── Flow Registry Events ────────────────────────────────────────

describe('EventEmittingFlowRegistry', () => {
  it('emits onFlowRegistered', () => {
    const events: any[] = [];
    const bus: EventBus = {
      onFlowRegistered: e => events.push(e),
    };

    const inner = new DefaultFlowRegistry();
    const registry = new EventEmittingFlowRegistry(inner, bus);
    registry.register(singleFlow);

    expect(events).toHaveLength(1);
    expect(events[0].flowId).toBe('simple');
    expect(events[0].version).toBe('1.0.0');
  });

  it('delegates all reads to inner', () => {
    const bus: EventBus = {};
    const inner = new DefaultFlowRegistry();
    const registry = new EventEmittingFlowRegistry(inner, bus);
    registry.register(singleFlow);

    expect(registry.get('simple')).toBeDefined();
    expect(registry.has('simple')).toBe(true);
    expect(registry.flowIds()).toEqual(['simple']);
    expect(registry.versions('simple')).toEqual(['1.0.0']);
    expect(registry.validate(singleFlow).length).toBe(0);
  });

  it('emits flow.registered through TestHarness', async () => {
    const t = new TestHarness({
      handlers: [echoHandler],
      flows: [singleFlow],
    });

    const flowEvents = t.events.filter((e: any) => e.type === 'flow.registered');
    expect(flowEvents.length).toBeGreaterThanOrEqual(1);
    expect(flowEvents.some((e: any) => e.flowId === 'simple')).toBe(true);
  });
});

// ── Handler Registry Events ─────────────────────────────────────

describe('EventEmittingHandlerRegistry', () => {
  it('emits onHandlerRegistered', () => {
    const events: any[] = [];
    const bus: EventBus = {
      onHandlerRegistered: e => events.push(e),
    };

    const inner = new DefaultHandlerRegistry();
    const registry = new EventEmittingHandlerRegistry(inner, bus);
    registry.register(echoHandler);

    expect(events).toHaveLength(1);
    expect(events[0].handlerType).toBe('echo');
  });

  it('emits onHandlerUnregistered', () => {
    const events: any[] = [];
    const bus: EventBus = {
      onHandlerRegistered: () => {},
      onHandlerUnregistered: e => events.push(e),
    };

    const inner = new DefaultHandlerRegistry();
    const registry = new EventEmittingHandlerRegistry(inner, bus);
    registry.register(echoHandler);
    registry.unregister('echo');

    expect(events).toHaveLength(1);
    expect(events[0].handlerType).toBe('echo');
  });

  it('does not emit unregister when type not found', () => {
    const events: any[] = [];
    const bus: EventBus = {
      onHandlerUnregistered: e => events.push(e),
    };

    const inner = new DefaultHandlerRegistry();
    const registry = new EventEmittingHandlerRegistry(inner, bus);
    registry.unregister('nonexistent');

    expect(events).toHaveLength(0);
  });

  it('delegates all reads to inner', () => {
    const bus: EventBus = {};
    const inner = new DefaultHandlerRegistry();
    const registry = new EventEmittingHandlerRegistry(inner, bus);
    registry.register(echoHandler);

    expect(registry.get('echo')).toBeDefined();
    expect(registry.has('echo')).toBe(true);
    expect(registry.types()).toEqual(['echo']);
    expect(registry.isClassBased('echo')).toBe(false);
    expect(registry.getAllMetadata()).toHaveLength(1);
  });

  it('emits handler.registered through TestHarness', async () => {
    const t = new TestHarness({
      handlers: [echoHandler],
      flows: [singleFlow],
    });

    const handlerEvents = t.events.filter((e: any) => e.type === 'handler.registered');
    expect(handlerEvents.length).toBeGreaterThanOrEqual(1);
    expect(handlerEvents.some((e: any) => e.handlerType === 'echo')).toBe(true);
  });
});

// ── Table Registry Events ───────────────────────────────────────

describe('EventEmittingTableRegistry', () => {
  let events: any[];
  let registry: EventEmittingTableRegistry;

  beforeEach(() => {
    events = [];
    const bus: EventBus = {
      onTableCreated: e => events.push({ type: 'table.created', ...e }),
      onTableDeleted: e => events.push({ type: 'table.deleted', ...e }),
      onTableColumnAdded: e => events.push({ type: 'table.column.added', ...e }),
      onTableColumnRemoved: e => events.push({ type: 'table.column.removed', ...e }),
    };
    registry = new EventEmittingTableRegistry(new MemoryTableRegistry(), bus);
  });

  it('emits onTableCreated', async () => {
    const nameCol = col('name', 'string', true);
    const table = makeTable([nameCol]);
    await registry.create(table);

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('table.created');
    expect(events[0].tableId).toBe(table.id);
    expect(events[0].columnCount).toBe(1);
  });

  it('emits onTableDeleted', async () => {
    const table = makeTable([col('x', 'string')]);
    await registry.create(table);
    events.length = 0;

    await registry.delete(table.id);
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('table.deleted');
    expect(events[0].tableId).toBe(table.id);
  });

  it('does not emit delete when table not found', async () => {
    await registry.delete('nonexistent');
    expect(events.filter(e => e.type === 'table.deleted')).toHaveLength(0);
  });

  it('emits onTableColumnAdded', async () => {
    const table = makeTable([col('x', 'string')]);
    await registry.create(table);
    events.length = 0;

    const newCol = col('score', 'number');
    await registry.addColumn(table.id, newCol);

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('table.column.added');
    expect(events[0].columnId).toBe(newCol.id);
    expect(events[0].columnType).toBe('number');
  });

  it('emits onTableColumnRemoved', async () => {
    const c = col('x', 'string');
    const table = makeTable([c]);
    await registry.create(table);
    events.length = 0;

    await registry.removeColumn(table.id, c.id);

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('table.column.removed');
    expect(events[0].columnId).toBe(c.id);
  });
});

// ── WAL Events ──────────────────────────────────────────────────

describe('EventEmittingWAL', () => {
  let events: any[];
  let wal: EventEmittingWAL;

  beforeEach(() => {
    events = [];
    const bus: EventBus = {
      onWALAppended: e => events.push({ type: 'wal.appended', ...e }),
      onWALReplayed: e => events.push({ type: 'wal.replayed', ...e }),
      onWALCompacted: e => events.push({ type: 'wal.compacted', ...e }),
    };
    wal = new EventEmittingWAL(new MemoryWAL(), bus);
  });

  it('emits onWALAppended', async () => {
    await wal.append({
      id: 'wal-1',
      tableId: 'tbl-1',
      data: { x: 1 },
      pipeId: 'pipe-1',
      executionId: 'exec-1',
      flowId: 'flow-1',
      stepId: 'step-1',
      error: 'test error',
      attempts: 0,
      createdAt: now(),
    });

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('wal.appended');
    expect(events[0].entryId).toBe('wal-1');
    expect(events[0].pipeId).toBe('pipe-1');
  });

  it('emits onWALReplayed on ack', async () => {
    await wal.append({
      id: 'wal-2',
      tableId: 'tbl-2',
      data: {},
      pipeId: 'p',
      executionId: 'e',
      flowId: 'f',
      stepId: 's',
      error: '',
      attempts: 0,
      createdAt: now(),
    });
    events.length = 0;

    await wal.ack('wal-2');

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('wal.replayed');
    expect(events[0].entryId).toBe('wal-2');
    expect(events[0].tableId).toBe('tbl-2');
  });

  it('emits onWALCompacted when entries removed', async () => {
    await wal.append({
      id: 'wal-3',
      tableId: 'tbl-3',
      data: {},
      pipeId: 'p',
      executionId: 'e',
      flowId: 'f',
      stepId: 's',
      error: '',
      attempts: 0,
      createdAt: now(),
    });
    await wal.ack('wal-3');
    events.length = 0;

    await wal.compact();

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('wal.compacted');
    expect(events[0].removedCount).toBe(1);
  });

  it('does not emit compact when nothing removed', async () => {
    await wal.compact();
    expect(events.filter(e => e.type === 'wal.compacted')).toHaveLength(0);
  });
});

// ── Integration: All events through TestHarness ─────────────────

describe('Full event coverage via TestHarness', () => {
  it('multi-step flow emits complete lifecycle', async () => {
    const t = new TestHarness({
      handlers: [echoHandler],
      flows: [multiStepFlow],
    });

    const { events } = await t.run('multi-step');

    // Should have: created, started, step.started×2, step.completed×2, transition×1, completed
    expect(events.some((e: any) => e.type === 'execution.created')).toBe(true);
    expect(events.some((e: any) => e.type === 'execution.started')).toBe(true);
    expect(events.filter((e: any) => e.type === 'step.started')).toHaveLength(2);
    expect(events.filter((e: any) => e.type === 'step.completed')).toHaveLength(2);
    expect(events.filter((e: any) => e.type === 'transition')).toHaveLength(1);
    expect(events.some((e: any) => e.type === 'execution.completed')).toBe(true);
  });

  it('wait/resume flow emits resumed event', async () => {
    const t = new TestHarness({
      handlers: [waitHandler, doneHandler],
      flows: [waitFlow],
    });

    const { events } = await t.run('wait-flow');

    expect(events.some((e: any) => e.type === 'execution.waiting')).toBe(true);
    expect(events.some((e: any) => e.type === 'execution.resumed')).toBe(true);
    expect(events.some((e: any) => e.type === 'execution.completed')).toBe(true);
  });

  it('failure branch emits transition with failure outcome', async () => {
    const t = new TestHarness({
      handlers: [echoHandler, failHandler],
      flows: [branchFlow],
    });

    const { events } = await t.run('branch');
    const transitions = events.filter((e: any) => e.type === 'transition');
    expect(transitions).toHaveLength(1);
    expect(transitions[0].outcome).toBe('failure');
    expect(transitions[0].fromStepId).toBe('step1');
    expect(transitions[0].toStepId).toBe('recover');
  });
});
