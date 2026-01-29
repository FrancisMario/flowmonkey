import { describe, it, expect, beforeEach } from 'vitest';
import { MemoryTriggerStore } from '../src/index';
import type { HttpTrigger, ScheduleTrigger } from '../src/types';

describe('MemoryTriggerStore', () => {
  let store: MemoryTriggerStore;

  beforeEach(() => {
    store = new MemoryTriggerStore();
  });

  describe('create', () => {
    it('creates an HTTP trigger', async () => {
      const trigger = await store.create({
        type: 'http',
        name: 'Test Webhook',
        flowId: 'test-flow',
        enabled: true,
        inputSchema: { type: 'object' },
        contextKey: 'payload',
      });

      expect(trigger.id).toMatch(/^trg_/);
      expect(trigger.name).toBe('Test Webhook');
      expect(trigger.type).toBe('http');
      expect(trigger.flowId).toBe('test-flow');
      expect(trigger.enabled).toBe(true);
      expect((trigger as HttpTrigger).inputSchema).toEqual({ type: 'object' });
      expect((trigger as HttpTrigger).contextKey).toBe('payload');
      expect(trigger.createdAt).toBeGreaterThan(0);
    });

    it('creates a schedule trigger with computed nextRunAt', async () => {
      const trigger = await store.create({
        type: 'schedule',
        name: 'Daily Report',
        flowId: 'report-flow',
        enabled: true,
        schedule: '0 9 * * *',
        timezone: 'UTC',
        staticContext: { type: 'daily' },
      });

      expect(trigger.id).toMatch(/^trg_/);
      expect(trigger.type).toBe('schedule');
      expect((trigger as ScheduleTrigger).schedule).toBe('0 9 * * *');
      expect((trigger as ScheduleTrigger).nextRunAt).toBeGreaterThan(Date.now());
    });
  });

  describe('CRUD operations', () => {
    it('gets a trigger by ID', async () => {
      const created = await store.create({
        type: 'http',
        name: 'Test',
        flowId: 'test-flow',
        enabled: true,
        inputSchema: {},
        contextKey: 'data',
      });

      const found = await store.get(created.id);
      expect(found).toEqual(created);
    });

    it('returns null for non-existent trigger', async () => {
      const found = await store.get('trg_nonexistent');
      expect(found).toBeNull();
    });

    it('updates a trigger', async () => {
      const created = await store.create({
        type: 'http',
        name: 'Test',
        flowId: 'test-flow',
        enabled: true,
        inputSchema: {},
        contextKey: 'data',
      });

      const updated = await store.update(created.id, { name: 'Updated Name' });
      expect(updated?.name).toBe('Updated Name');
      expect(updated?.updatedAt).toBeGreaterThanOrEqual(created.updatedAt);
    });

    it('deletes a trigger', async () => {
      const created = await store.create({
        type: 'http',
        name: 'Test',
        flowId: 'test-flow',
        enabled: true,
        inputSchema: {},
        contextKey: 'data',
      });

      const deleted = await store.delete(created.id);
      expect(deleted).toBe(true);

      const found = await store.get(created.id);
      expect(found).toBeNull();
    });
  });

  describe('list', () => {
    beforeEach(async () => {
      await store.create({
        type: 'http',
        name: 'HTTP 1',
        flowId: 'flow-a',
        enabled: true,
        inputSchema: {},
        contextKey: 'data',
      });
      await store.create({
        type: 'http',
        name: 'HTTP 2',
        flowId: 'flow-b',
        enabled: false,
        inputSchema: {},
        contextKey: 'data',
      });
      await store.create({
        type: 'schedule',
        name: 'Schedule 1',
        flowId: 'flow-a',
        enabled: true,
        schedule: '0 * * * *',
        timezone: 'UTC',
        staticContext: {},
      });
    });

    it('lists all triggers', async () => {
      const all = await store.list();
      expect(all).toHaveLength(3);
    });

    it('filters by flowId', async () => {
      const filtered = await store.list({ flowId: 'flow-a' });
      expect(filtered).toHaveLength(2);
    });

    it('filters by type', async () => {
      const filtered = await store.list({ type: 'http' });
      expect(filtered).toHaveLength(2);
    });

    it('filters by enabled', async () => {
      const filtered = await store.list({ enabled: true });
      expect(filtered).toHaveLength(2);
    });
  });

  describe('history', () => {
    it('logs and retrieves invocations', async () => {
      const trigger = await store.create({
        type: 'http',
        name: 'Test',
        flowId: 'test-flow',
        enabled: true,
        inputSchema: {},
        contextKey: 'data',
      });

      const now = Date.now();

      await store.logInvocation({
        triggerId: trigger.id,
        status: 'success',
        executionId: 'exec_123',
        durationMs: 50,
        timestamp: now,
      });

      await store.logInvocation({
        triggerId: trigger.id,
        status: 'validation_failed',
        validationErrors: [{ path: 'name', message: 'required', keyword: 'required' }],
        durationMs: 5,
        timestamp: now + 1000, // Later timestamp
      });

      const history = await store.getHistory(trigger.id);
      expect(history).toHaveLength(2);
      expect(history[0].status).toBe('validation_failed'); // Most recent first
    });

    it('calculates stats', async () => {
      const trigger = await store.create({
        type: 'http',
        name: 'Test',
        flowId: 'test-flow',
        enabled: true,
        inputSchema: {},
        contextKey: 'data',
      });

      const since = Date.now() - 1000;

      await store.logInvocation({
        triggerId: trigger.id,
        status: 'success',
        durationMs: 100,
        timestamp: Date.now(),
      });
      await store.logInvocation({
        triggerId: trigger.id,
        status: 'success',
        durationMs: 200,
        timestamp: Date.now(),
      });
      await store.logInvocation({
        triggerId: trigger.id,
        status: 'validation_failed',
        durationMs: 10,
        timestamp: Date.now(),
      });

      const stats = await store.getHistoryStats(trigger.id, since);
      expect(stats.total).toBe(3);
      expect(stats.success).toBe(2);
      expect(stats.validationFailed).toBe(1);
      expect(stats.avgDurationMs).toBeCloseTo(103.33, 0);
    });
  });
});
