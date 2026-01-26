/**
 * MemoryStore Tests
 *
 * Tests for the in-memory StateStore implementation covering:
 * - Basic CRUD operations (save, load, delete)
 * - Data isolation via cloning
 * - Wake-ready execution queries
 * - Status-based filtering
 * - Idempotency key lookups
 * - Parent/child hierarchy queries
 * - Timeout detection for executions and waits
 *
 * @see README.md for full test documentation
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { MemoryStore } from '../impl/memory-store';
import type { Execution } from '../types/execution';

function createExecution(overrides: Partial<Execution> = {}): Execution {
  return {
    id: `exec_${Math.random().toString(36).slice(2)}`,
    flowId: 'test-flow',
    flowVersion: '1.0.0',
    currentStepId: 'step1',
    status: 'pending',
    context: {},
    stepCount: 0,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

describe('MemoryStore', () => {
  let store: MemoryStore;

  beforeEach(() => {
    store = new MemoryStore();
  });

  describe('basic operations', () => {
    it('saves and loads executions', async () => {
      const exec = createExecution({ id: 'exec_1' });
      await store.save(exec);

      const loaded = await store.load('exec_1');
      expect(loaded).toEqual(exec);
    });

    it('returns null for non-existent execution', async () => {
      const loaded = await store.load('non_existent');
      expect(loaded).toBeNull();
    });

    it('deletes executions', async () => {
      const exec = createExecution({ id: 'exec_1' });
      await store.save(exec);

      const deleted = await store.delete('exec_1');
      expect(deleted).toBe(true);

      const loaded = await store.load('exec_1');
      expect(loaded).toBeNull();
    });

    it('returns false when deleting non-existent execution', async () => {
      const deleted = await store.delete('non_existent');
      expect(deleted).toBe(false);
    });

    it('clones data to prevent mutation', async () => {
      const exec = createExecution({ id: 'exec_1' });
      await store.save(exec);

      const loaded1 = await store.load('exec_1');
      loaded1!.context.mutated = true;

      const loaded2 = await store.load('exec_1');
      expect(loaded2!.context.mutated).toBeUndefined();
    });
  });

  describe('listWakeReady', () => {
    it('returns waiting executions with wakeAt <= now', async () => {
      const now = Date.now();
      await store.save(createExecution({ id: 'ready', status: 'waiting', wakeAt: now - 1000 }));
      await store.save(createExecution({ id: 'not_ready', status: 'waiting', wakeAt: now + 5000 }));
      await store.save(createExecution({ id: 'running', status: 'running' }));

      const ready = await store.listWakeReady(now);
      expect(ready).toEqual(['ready']);
    });

    it('respects limit', async () => {
      const now = Date.now();
      for (let i = 0; i < 10; i++) {
        await store.save(createExecution({ id: `exec_${i}`, status: 'waiting', wakeAt: now - 1000 }));
      }

      const ready = await store.listWakeReady(now, 3);
      expect(ready).toHaveLength(3);
    });
  });

  describe('listByStatus', () => {
    it('returns executions with matching status', async () => {
      await store.save(createExecution({ id: 'pending1', status: 'pending' }));
      await store.save(createExecution({ id: 'running1', status: 'running' }));
      await store.save(createExecution({ id: 'pending2', status: 'pending' }));

      const pending = await store.listByStatus('pending');
      expect(pending).toHaveLength(2);
      expect(pending.map(e => e.id).sort()).toEqual(['pending1', 'pending2']);
    });

    it('respects limit', async () => {
      for (let i = 0; i < 10; i++) {
        await store.save(createExecution({ id: `exec_${i}`, status: 'pending' }));
      }

      const pending = await store.listByStatus('pending', 5);
      expect(pending).toHaveLength(5);
    });
  });

  describe('findByIdempotencyKey', () => {
    it('finds execution by flowId and idempotency key', async () => {
      const now = Date.now();
      await store.save(createExecution({
        id: 'exec_1',
        flowId: 'flow-a',
        idempotencyKey: 'key-123',
        idempotencyExpiresAt: now + 60000,
      }));

      const found = await store.findByIdempotencyKey('flow-a', 'key-123', 60000);
      expect(found).not.toBeNull();
      expect(found!.id).toBe('exec_1');
    });

    it('returns null for different flowId', async () => {
      const now = Date.now();
      await store.save(createExecution({
        id: 'exec_1',
        flowId: 'flow-a',
        idempotencyKey: 'key-123',
        idempotencyExpiresAt: now + 60000,
      }));

      const found = await store.findByIdempotencyKey('flow-b', 'key-123', 60000);
      expect(found).toBeNull();
    });

    it('returns null for different key', async () => {
      const now = Date.now();
      await store.save(createExecution({
        id: 'exec_1',
        flowId: 'flow-a',
        idempotencyKey: 'key-123',
        idempotencyExpiresAt: now + 60000,
      }));

      const found = await store.findByIdempotencyKey('flow-a', 'key-456', 60000);
      expect(found).toBeNull();
    });

    it('returns null for expired idempotency', async () => {
      const now = Date.now();
      await store.save(createExecution({
        id: 'exec_1',
        flowId: 'flow-a',
        idempotencyKey: 'key-123',
        idempotencyExpiresAt: now - 1000, // Expired
      }));

      const found = await store.findByIdempotencyKey('flow-a', 'key-123', 60000);
      expect(found).toBeNull();
    });

    it('returns null when no idempotencyExpiresAt set', async () => {
      await store.save(createExecution({
        id: 'exec_1',
        flowId: 'flow-a',
        idempotencyKey: 'key-123',
        // No idempotencyExpiresAt
      }));

      const found = await store.findByIdempotencyKey('flow-a', 'key-123', 60000);
      expect(found).toBeNull();
    });
  });

  describe('findChildren', () => {
    it('finds child executions by parentExecutionId', async () => {
      await store.save(createExecution({ id: 'parent' }));
      await store.save(createExecution({ id: 'child1', parentExecutionId: 'parent' }));
      await store.save(createExecution({ id: 'child2', parentExecutionId: 'parent' }));
      await store.save(createExecution({ id: 'other' }));

      const children = await store.findChildren('parent');
      expect(children).toHaveLength(2);
      expect(children.map(e => e.id).sort()).toEqual(['child1', 'child2']);
    });

    it('returns empty array when no children', async () => {
      await store.save(createExecution({ id: 'parent' }));

      const children = await store.findChildren('parent');
      expect(children).toEqual([]);
    });
  });

  describe('findTimedOutExecutions', () => {
    it('finds executions exceeding default timeout', async () => {
      const now = Date.now();
      const oldTime = now - (25 * 60 * 60 * 1000); // 25 hours ago

      await store.save(createExecution({
        id: 'old_exec',
        status: 'running',
        createdAt: oldTime,
      }));
      await store.save(createExecution({
        id: 'new_exec',
        status: 'running',
        createdAt: now - 1000, // 1 second ago
      }));

      const timedOut = await store.findTimedOutExecutions(now);
      expect(timedOut).toHaveLength(1);
      expect(timedOut[0].id).toBe('old_exec');
    });

    it('finds executions exceeding custom timeout', async () => {
      const now = Date.now();
      const oneHourAgo = now - (60 * 60 * 1000);

      await store.save(createExecution({
        id: 'short_timeout_exec',
        status: 'running',
        createdAt: oneHourAgo,
        timeoutConfig: { executionTimeoutMs: 30 * 60 * 1000 }, // 30 min timeout
      }));

      const timedOut = await store.findTimedOutExecutions(now);
      expect(timedOut).toHaveLength(1);
      expect(timedOut[0].id).toBe('short_timeout_exec');
    });

    it('excludes terminal statuses', async () => {
      const now = Date.now();
      const oldTime = now - (25 * 60 * 60 * 1000);

      await store.save(createExecution({ id: 'completed', status: 'completed', createdAt: oldTime }));
      await store.save(createExecution({ id: 'failed', status: 'failed', createdAt: oldTime }));
      await store.save(createExecution({ id: 'cancelled', status: 'cancelled', createdAt: oldTime }));
      await store.save(createExecution({ id: 'running', status: 'running', createdAt: oldTime }));

      const timedOut = await store.findTimedOutExecutions(now);
      expect(timedOut).toHaveLength(1);
      expect(timedOut[0].id).toBe('running');
    });
  });

  describe('findTimedOutWaits', () => {
    it('finds waiting executions exceeding default wait timeout', async () => {
      const now = Date.now();
      const eightDaysAgo = now - (8 * 24 * 60 * 60 * 1000); // 8 days

      await store.save(createExecution({
        id: 'old_wait',
        status: 'waiting',
        waitStartedAt: eightDaysAgo,
      }));
      await store.save(createExecution({
        id: 'new_wait',
        status: 'waiting',
        waitStartedAt: now - 1000,
      }));

      const timedOut = await store.findTimedOutWaits(now);
      expect(timedOut).toHaveLength(1);
      expect(timedOut[0].id).toBe('old_wait');
    });

    it('finds waiting executions exceeding custom wait timeout', async () => {
      const now = Date.now();
      const oneHourAgo = now - (60 * 60 * 1000);

      await store.save(createExecution({
        id: 'short_wait',
        status: 'waiting',
        waitStartedAt: oneHourAgo,
        timeoutConfig: { waitTimeoutMs: 30 * 60 * 1000 }, // 30 min timeout
      }));

      const timedOut = await store.findTimedOutWaits(now);
      expect(timedOut).toHaveLength(1);
      expect(timedOut[0].id).toBe('short_wait');
    });

    it('only includes waiting status', async () => {
      const now = Date.now();
      const eightDaysAgo = now - (8 * 24 * 60 * 60 * 1000);

      await store.save(createExecution({ id: 'running', status: 'running', waitStartedAt: eightDaysAgo }));
      await store.save(createExecution({ id: 'pending', status: 'pending', waitStartedAt: eightDaysAgo }));
      await store.save(createExecution({ id: 'waiting', status: 'waiting', waitStartedAt: eightDaysAgo }));

      const timedOut = await store.findTimedOutWaits(now);
      expect(timedOut).toHaveLength(1);
      expect(timedOut[0].id).toBe('waiting');
    });

    it('requires waitStartedAt to be set', async () => {
      const now = Date.now();

      await store.save(createExecution({
        id: 'no_wait_started',
        status: 'waiting',
        // No waitStartedAt
      }));

      const timedOut = await store.findTimedOutWaits(now);
      expect(timedOut).toHaveLength(0);
    });
  });

  describe('test helpers', () => {
    it('clear removes all executions', async () => {
      await store.save(createExecution({ id: 'exec_1' }));
      await store.save(createExecution({ id: 'exec_2' }));
      expect(store.count()).toBe(2);

      store.clear();
      expect(store.count()).toBe(0);
    });

    it('count returns number of executions', async () => {
      expect(store.count()).toBe(0);
      await store.save(createExecution({ id: 'exec_1' }));
      expect(store.count()).toBe(1);
      await store.save(createExecution({ id: 'exec_2' }));
      expect(store.count()).toBe(2);
    });
  });
});
