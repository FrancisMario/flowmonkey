/**
 * DataStore Tests — Tables, Pipes, WAL, Row Validation
 *
 * Tests the full datastore feature:
 * - MemoryTableRegistry CRUD
 * - MemoryTableStore CRUD & query
 * - Pipe execution via engine (fire-and-forget)
 * - Pipe failure → WAL capture
 * - Hookup validation
 * - validateRow utility
 * - MemoryWAL operations
 * - EventEmittingTableStore row events
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { TestHarness } from './harness';
import { MemoryTableRegistry } from '../impl/memory-table-registry';
import { MemoryTableStore } from '../impl/memory-table-store';
import { EventEmittingTableStore } from '../impl/event-emitting-table-store';
import { MemoryWAL } from '../impl/memory-wal';
import { validateRow } from '../utils/validate-row';
import { generateId, now } from '../utils';
import type { TableDef, ColumnDef, PipeDef } from '../types/table';
import type { Flow } from '../types/flow';
import type { StepHandler } from '../interfaces/step-handler';

// ── Test Helpers ──────────────────────────────────────────────────

function makeTable(columns: ColumnDef[]): TableDef {
  return {
    id: generateId(),
    columns,
    createdAt: now(),
    updatedAt: now(),
  };
}

function col(name: string, type: ColumnDef['type'], required = false): ColumnDef {
  return { id: generateId(), name, type, required };
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

// ── MemoryTableRegistry ─────────────────────────────────────────

describe('MemoryTableRegistry', () => {
  let registry: MemoryTableRegistry;

  beforeEach(() => {
    registry = new MemoryTableRegistry();
  });

  it('creates and retrieves a table', async () => {
    const table = makeTable([col('Email', 'string', true)]);
    await registry.create(table);
    const got = await registry.get(table.id);
    expect(got).toBeDefined();
    expect(got!.id).toBe(table.id);
    expect(got!.columns).toHaveLength(1);
  });

  it('lists all tables', async () => {
    const t1 = makeTable([col('A', 'string')]);
    const t2 = makeTable([col('B', 'number')]);
    await registry.create(t1);
    await registry.create(t2);
    const list = await registry.list();
    expect(list).toHaveLength(2);
  });

  it('deletes a table', async () => {
    const table = makeTable([col('X', 'string')]);
    await registry.create(table);
    const deleted = await registry.delete(table.id);
    expect(deleted).toBe(true);
    expect(await registry.get(table.id)).toBeUndefined();
  });

  it('adds a column', async () => {
    const table = makeTable([col('A', 'string')]);
    await registry.create(table);
    const newCol = col('B', 'number');
    await registry.addColumn(table.id, newCol);
    const got = await registry.get(table.id);
    expect(got!.columns).toHaveLength(2);
    expect(got!.columns[1].id).toBe(newCol.id);
  });

  it('removes a column', async () => {
    const colA = col('A', 'string');
    const colB = col('B', 'number');
    const table = makeTable([colA, colB]);
    await registry.create(table);
    await registry.removeColumn(table.id, colA.id);
    const got = await registry.get(table.id);
    expect(got!.columns).toHaveLength(1);
    expect(got!.columns[0].id).toBe(colB.id);
  });

  it('throws when adding column to non-existent table', async () => {
    await expect(registry.addColumn('nope', col('X', 'string'))).rejects.toThrow('not found');
  });
});

// ── MemoryTableStore ────────────────────────────────────────────

describe('MemoryTableStore', () => {
  let store: MemoryTableStore;

  beforeEach(() => {
    store = new MemoryTableStore();
  });

  it('inserts and retrieves a row', async () => {
    const rowId = await store.insert('tbl1', { name: 'Alice', age: 30 });
    const row = await store.get('tbl1', rowId);
    expect(row).toBeDefined();
    expect(row!.name).toBe('Alice');
    expect(row!.age).toBe(30);
    expect(row!._id).toBe(rowId);
  });

  it('inserts batch and retrieves', async () => {
    const ids = await store.insertBatch('tbl1', [
      { x: 1 }, { x: 2 }, { x: 3 },
    ]);
    expect(ids).toHaveLength(3);
    const result = await store.query({ tableId: 'tbl1' });
    expect(result.rows).toHaveLength(3);
    expect(result.total).toBe(3);
  });

  it('filters rows with eq', async () => {
    await store.insert('tbl1', { status: 'active' });
    await store.insert('tbl1', { status: 'inactive' });
    await store.insert('tbl1', { status: 'active' });
    const result = await store.query({
      tableId: 'tbl1',
      filters: [{ column: 'status', op: 'eq', value: 'active' }],
    });
    expect(result.rows).toHaveLength(2);
    expect(result.total).toBe(2);
  });

  it('sorts rows', async () => {
    await store.insert('tbl1', { n: 3 });
    await store.insert('tbl1', { n: 1 });
    await store.insert('tbl1', { n: 2 });
    const result = await store.query({
      tableId: 'tbl1',
      orderBy: { column: 'n', direction: 'asc' },
    });
    expect(result.rows.map(r => r.n)).toEqual([1, 2, 3]);
  });

  it('paginates rows', async () => {
    await store.insertBatch('tbl1', [{ i: 0 }, { i: 1 }, { i: 2 }, { i: 3 }, { i: 4 }]);
    const result = await store.query({
      tableId: 'tbl1',
      limit: 2,
      offset: 1,
    });
    expect(result.rows).toHaveLength(2);
    expect(result.total).toBe(5);
  });

  it('updates a row', async () => {
    const id = await store.insert('tbl1', { val: 'old' });
    const ok = await store.update('tbl1', id, { val: 'new' });
    expect(ok).toBe(true);
    const row = await store.get('tbl1', id);
    expect(row!.val).toBe('new');
  });

  it('deletes a row', async () => {
    const id = await store.insert('tbl1', { val: 'x' });
    const ok = await store.delete('tbl1', id);
    expect(ok).toBe(true);
    expect(await store.get('tbl1', id)).toBeNull();
  });

  it('counts rows', async () => {
    await store.insertBatch('tbl1', [{ a: 1 }, { a: 2 }, { a: 3 }]);
    const count = await store.count({ tableId: 'tbl1' });
    expect(count).toBe(3);
  });

  it('tenant isolation', async () => {
    await store.insert('tbl1', { x: 1 }, 'tenant-a');
    await store.insert('tbl1', { x: 2 }, 'tenant-b');
    const result = await store.query({ tableId: 'tbl1', tenantId: 'tenant-a' });
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].x).toBe(1);
  });
});

// ── MemoryWAL ───────────────────────────────────────────────────

describe('MemoryWAL', () => {
  let wal: MemoryWAL;

  beforeEach(() => {
    wal = new MemoryWAL();
  });

  it('appends and reads entries', async () => {
    await wal.append({
      id: 'w1', tableId: 'tbl1', data: { x: 1 },
      pipeId: 'p1', executionId: 'e1', flowId: 'f1',
      stepId: 's1', error: 'db down', attempts: 0, createdAt: now(),
    });
    const pending = await wal.readPending();
    expect(pending).toHaveLength(1);
    expect(pending[0].id).toBe('w1');
  });

  it('acks and compacts', async () => {
    await wal.append({
      id: 'w1', tableId: 'tbl1', data: {},
      pipeId: 'p1', executionId: 'e1', flowId: 'f1',
      stepId: 's1', error: 'err', attempts: 0, createdAt: now(),
    });
    await wal.append({
      id: 'w2', tableId: 'tbl1', data: {},
      pipeId: 'p2', executionId: 'e1', flowId: 'f1',
      stepId: 's1', error: 'err', attempts: 0, createdAt: now(),
    });
    await wal.ack('w1');
    await wal.compact();
    const pending = await wal.readPending();
    expect(pending).toHaveLength(1);
    expect(pending[0].id).toBe('w2');
  });

  it('reports pending count', async () => {
    await wal.append({
      id: 'w1', tableId: 'tbl1', data: {},
      pipeId: 'p1', executionId: 'e1', flowId: 'f1',
      stepId: 's1', error: 'err', attempts: 0, createdAt: now(),
    });
    expect(wal.pendingCount()).toBe(1);
    await wal.ack('w1');
    expect(wal.pendingCount()).toBe(0);
  });
});

// ── validateRow ─────────────────────────────────────────────────

describe('validateRow', () => {
  it('passes valid row', () => {
    const emailCol = col('Email', 'string', true);
    const ageCol = col('Age', 'number', false);
    const table = makeTable([emailCol, ageCol]);
    expect(() => validateRow(table, { [emailCol.id]: 'a@b.com', [ageCol.id]: 25 })).not.toThrow();
  });

  it('fails on missing required column', () => {
    const emailCol = col('Email', 'string', true);
    const table = makeTable([emailCol]);
    expect(() => validateRow(table, {})).toThrow('required');
  });

  it('fails on type mismatch (string expected, number given)', () => {
    const emailCol = col('Email', 'string', true);
    const table = makeTable([emailCol]);
    expect(() => validateRow(table, { [emailCol.id]: 42 })).toThrow('expected string');
  });

  it('fails on type mismatch (number expected, string given)', () => {
    const ageCol = col('Age', 'number', true);
    const table = makeTable([ageCol]);
    expect(() => validateRow(table, { [ageCol.id]: 'twenty' })).toThrow('expected number');
  });

  it('allows json type for any value', () => {
    const dataCol = col('Data', 'json', true);
    const table = makeTable([dataCol]);
    expect(() => validateRow(table, { [dataCol.id]: { nested: [1, 2, 3] } })).not.toThrow();
  });

  it('allows optional columns to be absent', () => {
    const nameCol = col('Name', 'string', false);
    const table = makeTable([nameCol]);
    expect(() => validateRow(table, {})).not.toThrow();
  });
});

// ── Hookup Validation ───────────────────────────────────────────

describe('Hookup Validation', () => {
  let registry: MemoryTableRegistry;

  beforeEach(() => {
    registry = new MemoryTableRegistry();
  });

  it('validates valid pipe mappings', async () => {
    const emailCol = col('Email', 'string', true);
    const table = makeTable([emailCol]);
    await registry.create(table);

    const flow: Flow = {
      id: 'test-flow',
      version: '1.0.0',
      initialStepId: 'step1',
      steps: {
        step1: {
          id: 'step1', type: 'echo', config: {},
          input: { type: 'full' },
          transitions: { onSuccess: null },
        },
      },
      pipes: [{
        id: generateId(),
        stepId: 'step1',
        tableId: table.id,
        mappings: [{ sourcePath: 'email', columnId: emailCol.id }],
      }],
    };

    const result = await registry.validatePipes(flow);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('detects TABLE_NOT_FOUND', async () => {
    const flow: Flow = {
      id: 'test-flow',
      version: '1.0.0',
      initialStepId: 'step1',
      steps: {
        step1: {
          id: 'step1', type: 'echo', config: {},
          input: { type: 'full' },
          transitions: { onSuccess: null },
        },
      },
      pipes: [{
        id: 'p1',
        stepId: 'step1',
        tableId: 'nonexistent-table',
        mappings: [{ sourcePath: 'x', columnId: 'col1' }],
      }],
    };

    const result = await registry.validatePipes(flow);
    expect(result.valid).toBe(false);
    expect(result.errors[0].code).toBe('TABLE_NOT_FOUND');
  });

  it('detects COLUMN_NOT_FOUND', async () => {
    const table = makeTable([col('A', 'string')]);
    await registry.create(table);

    const flow: Flow = {
      id: 'test-flow',
      version: '1.0.0',
      initialStepId: 'step1',
      steps: {
        step1: {
          id: 'step1', type: 'echo', config: {},
          input: { type: 'full' },
          transitions: { onSuccess: null },
        },
      },
      pipes: [{
        id: 'p1',
        stepId: 'step1',
        tableId: table.id,
        mappings: [{ sourcePath: 'x', columnId: 'nonexistent-col' }],
      }],
    };

    const result = await registry.validatePipes(flow);
    expect(result.valid).toBe(false);
    expect(result.errors[0].code).toBe('COLUMN_NOT_FOUND');
  });

  it('detects MISSING_REQUIRED', async () => {
    const reqCol = col('Required', 'string', true);
    const optCol = col('Optional', 'string', false);
    const table = makeTable([reqCol, optCol]);
    await registry.create(table);

    const flow: Flow = {
      id: 'test-flow',
      version: '1.0.0',
      initialStepId: 'step1',
      steps: {
        step1: {
          id: 'step1', type: 'echo', config: {},
          input: { type: 'full' },
          transitions: { onSuccess: null },
        },
      },
      pipes: [{
        id: 'p1',
        stepId: 'step1',
        tableId: table.id,
        mappings: [{ sourcePath: 'x', columnId: optCol.id }],
        // reqCol not mapped → should fail
      }],
    };

    const result = await registry.validatePipes(flow);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.code === 'MISSING_REQUIRED')).toBe(true);
  });

  it('returns valid for flow with no pipes', async () => {
    const flow: Flow = {
      id: 'test-flow',
      version: '1.0.0',
      initialStepId: 'step1',
      steps: {
        step1: {
          id: 'step1', type: 'echo', config: {},
          input: { type: 'full' },
          transitions: { onSuccess: null },
        },
      },
    };

    const result = await registry.validatePipes(flow);
    expect(result.valid).toBe(true);
  });
});

// ── Engine Pipe Integration ─────────────────────────────────────

describe('Engine Pipes', () => {
  it('executes a pipe on step success', async () => {
    const emailCol = col('Email', 'string', true);
    const table = makeTable([emailCol]);

    const pipe: PipeDef = {
      id: generateId(),
      stepId: 'step1',
      tableId: table.id,
      mappings: [{ sourcePath: 'email', columnId: emailCol.id }],
    };

    const flow: Flow = {
      id: 'pipe-test',
      version: '1.0.0',
      initialStepId: 'step1',
      steps: {
        step1: {
          id: 'step1',
          type: 'echo',
          config: {},
          input: { type: 'full' },
          outputKey: 'result',
          transitions: { onSuccess: null },
        },
      },
      pipes: [pipe],
    };

    const t = new TestHarness({
      handlers: [echoHandler],
      flows: [flow],
      tables: [table],
    });

    const { execution } = await t.run('pipe-test', { email: 'test@example.com' });
    t.assertCompleted(execution);

    // Verify pipe inserted
    const pipeEvents = t.events.filter(e => e.type === 'pipe.inserted');
    expect(pipeEvents).toHaveLength(1);
    expect(pipeEvents[0].tableId).toBe(table.id);
    expect(pipeEvents[0].pipeId).toBe(pipe.id);

    // Verify row in table
    const rows = await t.tableStore.query({ tableId: table.id });
    expect(rows.total).toBe(1);
    expect(rows.rows[0][emailCol.id]).toBe('test@example.com');
  });

  it('pipe failure does not affect execution', async () => {
    const emailCol = col('Email', 'string', true);

    const flow: Flow = {
      id: 'pipe-fail-test',
      version: '1.0.0',
      initialStepId: 'step1',
      steps: {
        step1: {
          id: 'step1',
          type: 'echo',
          config: {},
          input: { type: 'full' },
          outputKey: 'result',
          transitions: { onSuccess: null },
        },
      },
      pipes: [{
        id: generateId(),
        stepId: 'step1',
        tableId: 'some-table',
        mappings: [{ sourcePath: 'email', columnId: emailCol.id }],
      }],
    };

    // Create harness with a table store that always throws
    const t = new TestHarness({
      handlers: [echoHandler],
      flows: [flow],
      enableTables: true,
    });

    // Replace tableStore.insert with one that always throws
    const origInsert = t.tableStore.insert.bind(t.tableStore);
    t.tableStore.insert = async () => { throw new Error('DB is down'); };

    // Execution should still complete even though pipe fails
    const { execution } = await t.run('pipe-fail-test', { email: 'test@example.com' });
    t.assertCompleted(execution);

    // Should see pipe failure event
    const pipeFails = t.events.filter(e => e.type === 'pipe.failed');
    expect(pipeFails).toHaveLength(1);
    expect(pipeFails[0].error.message).toContain('DB is down');

    // Restore
    t.tableStore.insert = origInsert;
  });

  it('disabled pipes are skipped', async () => {
    const emailCol = col('Email', 'string', true);
    const table = makeTable([emailCol]);

    const flow: Flow = {
      id: 'disabled-pipe-test',
      version: '1.0.0',
      initialStepId: 'step1',
      steps: {
        step1: {
          id: 'step1',
          type: 'echo',
          config: {},
          input: { type: 'full' },
          outputKey: 'result',
          transitions: { onSuccess: null },
        },
      },
      pipes: [{
        id: generateId(),
        stepId: 'step1',
        tableId: table.id,
        mappings: [{ sourcePath: 'email', columnId: emailCol.id }],
        enabled: false,
      }],
    };

    const t = new TestHarness({
      handlers: [echoHandler],
      flows: [flow],
      tables: [table],
    });

    const { execution } = await t.run('disabled-pipe-test', { email: 'test@example.com' });
    t.assertCompleted(execution);

    const rows = await t.tableStore.query({ tableId: table.id });
    expect(rows.total).toBe(0);
  });

  it('pipes with on=failure fire on step failure', async () => {
    const errorCol = col('Error', 'string');
    const table = makeTable([errorCol]);

    const flow: Flow = {
      id: 'failure-pipe-test',
      version: '1.0.0',
      initialStepId: 'step1',
      steps: {
        step1: {
          id: 'step1',
          type: 'fail-always',
          config: {},
          input: { type: 'full' },
          transitions: { onFailure: null },
        },
      },
      pipes: [{
        id: generateId(),
        stepId: 'step1',
        on: 'failure',
        tableId: table.id,
        mappings: [{ sourcePath: 'message', columnId: errorCol.id }],
      }],
    };

    const t = new TestHarness({
      handlers: [failHandler],
      flows: [flow],
      tables: [table],
    });

    const { execution } = await t.run('failure-pipe-test', {});

    // Pipe should have fired on failure outcome
    const pipeEvents = t.events.filter(e => e.type === 'pipe.inserted');
    expect(pipeEvents).toHaveLength(1);
  });

  it('pipes with static values are included', async () => {
    const emailCol = col('Email', 'string', true);
    const sourceCol = col('Source', 'string', true);
    const table = makeTable([emailCol, sourceCol]);

    const flow: Flow = {
      id: 'static-pipe-test',
      version: '1.0.0',
      initialStepId: 'step1',
      steps: {
        step1: {
          id: 'step1',
          type: 'echo',
          config: {},
          input: { type: 'full' },
          outputKey: 'result',
          transitions: { onSuccess: null },
        },
      },
      pipes: [{
        id: generateId(),
        stepId: 'step1',
        tableId: table.id,
        mappings: [{ sourcePath: 'email', columnId: emailCol.id }],
        staticValues: { [sourceCol.id]: 'flow-pipe' },
      }],
    };

    const t = new TestHarness({
      handlers: [echoHandler],
      flows: [flow],
      tables: [table],
    });

    const { execution } = await t.run('static-pipe-test', { email: 'user@test.com' });
    t.assertCompleted(execution);

    const rows = await t.tableStore.query({ tableId: table.id });
    expect(rows.rows[0][sourceCol.id]).toBe('flow-pipe');
    expect(rows.rows[0][emailCol.id]).toBe('user@test.com');
  });

  it('no pipes configured — backward compatible', async () => {
    const flow: Flow = {
      id: 'no-pipes',
      version: '1.0.0',
      initialStepId: 'step1',
      steps: {
        step1: {
          id: 'step1',
          type: 'echo',
          config: {},
          input: { type: 'full' },
          transitions: { onSuccess: null },
        },
      },
    };

    const t = new TestHarness({
      handlers: [echoHandler],
      flows: [flow],
    });

    const { execution } = await t.run('no-pipes', { hello: 'world' });
    t.assertCompleted(execution);

    const pipeEvents = t.events.filter(e => e.type === 'pipe.inserted' || e.type === 'pipe.failed');
    expect(pipeEvents).toHaveLength(0);
  });

  it('pipe maps nested output paths', async () => {
    const nameCol = col('Name', 'string');
    const cityCol = col('City', 'string');
    const table = makeTable([nameCol, cityCol]);

    const flow: Flow = {
      id: 'nested-pipe-test',
      version: '1.0.0',
      initialStepId: 'step1',
      steps: {
        step1: {
          id: 'step1',
          type: 'echo',
          config: {},
          input: { type: 'full' },
          outputKey: 'result',
          transitions: { onSuccess: null },
        },
      },
      pipes: [{
        id: generateId(),
        stepId: 'step1',
        tableId: table.id,
        mappings: [
          { sourcePath: 'user.name', columnId: nameCol.id },
          { sourcePath: 'user.address.city', columnId: cityCol.id },
        ],
      }],
    };

    const t = new TestHarness({
      handlers: [echoHandler],
      flows: [flow],
      tables: [table],
    });

    const { execution } = await t.run('nested-pipe-test', {
      user: { name: 'Alice', address: { city: 'NYC' } },
    });
    t.assertCompleted(execution);

    const rows = await t.tableStore.query({ tableId: table.id });
    expect(rows.rows[0][nameCol.id]).toBe('Alice');
    expect(rows.rows[0][cityCol.id]).toBe('NYC');
  });
});

// ── EventEmittingTableStore (Row Events) ────────────────────

describe('EventEmittingTableStore', () => {
  let inner: MemoryTableStore;
  let events: any[];
  let store: EventEmittingTableStore;

  beforeEach(() => {
    inner = new MemoryTableStore();
    events = [];
    store = new EventEmittingTableStore(inner, {
      onRowInserted: e => events.push({ type: 'row.inserted', ...e }),
      onRowUpdated: e => events.push({ type: 'row.updated', ...e }),
      onRowDeleted: e => events.push({ type: 'row.deleted', ...e }),
    });
  });

  it('emits onRowInserted on insert', async () => {
    const rowId = await store.insert('tbl1', { name: 'Alice' }, 'tenant-a');
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('row.inserted');
    expect(events[0].tableId).toBe('tbl1');
    expect(events[0].rowId).toBe(rowId);
    expect(events[0].row.name).toBe('Alice');
    expect(events[0].tenantId).toBe('tenant-a');
  });

  it('emits onRowInserted for each row in insertBatch', async () => {
    const ids = await store.insertBatch('tbl1', [
      { x: 1 }, { x: 2 }, { x: 3 },
    ]);
    expect(events).toHaveLength(3);
    expect(events.map(e => e.rowId)).toEqual(ids);
    expect(events.every(e => e.type === 'row.inserted')).toBe(true);
  });

  it('emits onRowUpdated on update', async () => {
    const rowId = await store.insert('tbl1', { val: 'old' });
    events.length = 0; // clear insert event

    await store.update('tbl1', rowId, { val: 'new' });
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('row.updated');
    expect(events[0].tableId).toBe('tbl1');
    expect(events[0].rowId).toBe(rowId);
    expect(events[0].changes.val).toBe('new');
  });

  it('does not emit onRowUpdated when row not found', async () => {
    const ok = await store.update('tbl1', 'nonexistent', { val: 'x' });
    expect(ok).toBe(false);
    expect(events).toHaveLength(0);
  });

  it('emits onRowDeleted on delete', async () => {
    const rowId = await store.insert('tbl1', { val: 'doomed' });
    events.length = 0;

    await store.delete('tbl1', rowId);
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('row.deleted');
    expect(events[0].tableId).toBe('tbl1');
    expect(events[0].rowId).toBe(rowId);
  });

  it('does not emit onRowDeleted when row not found', async () => {
    const ok = await store.delete('tbl1', 'nonexistent');
    expect(ok).toBe(false);
    expect(events).toHaveLength(0);
  });

  it('read operations do not emit events', async () => {
    const rowId = await store.insert('tbl1', { val: 1 });
    events.length = 0;

    await store.get('tbl1', rowId);
    await store.query({ tableId: 'tbl1' });
    await store.count({ tableId: 'tbl1' });

    expect(events).toHaveLength(0);
  });
});

// ── Row Events Through Engine Pipes ────────────────────────

describe('Row events via pipes', () => {
  it('pipe insert emits both pipe.inserted and row.inserted', async () => {
    const emailCol = col('Email', 'string', true);
    const table = makeTable([emailCol]);

    const flow: Flow = {
      id: 'row-event-pipe',
      version: '1.0.0',
      initialStepId: 'step1',
      steps: {
        step1: {
          id: 'step1',
          type: 'echo',
          config: {},
          input: { type: 'full' },
          outputKey: 'result',
          transitions: { onSuccess: null },
        },
      },
      pipes: [{
        id: generateId(),
        stepId: 'step1',
        tableId: table.id,
        mappings: [{ sourcePath: 'email', columnId: emailCol.id }],
      }],
    };

    const t = new TestHarness({
      handlers: [echoHandler],
      flows: [flow],
      tables: [table],
    });

    await t.run('row-event-pipe', { email: 'hello@world.com' });

    const pipeEvents = t.events.filter(e => e.type === 'pipe.inserted');
    const rowEvents = t.events.filter(e => e.type === 'row.inserted');

    expect(pipeEvents).toHaveLength(1);
    expect(rowEvents).toHaveLength(1);
    expect(rowEvents[0].tableId).toBe(table.id);
    expect(rowEvents[0].row[emailCol.id]).toBe('hello@world.com');
  });
});
