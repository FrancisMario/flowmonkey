import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  MemoryTriggerStore,
  handleTrigger,
  ScheduleRunner,
  TriggerService,
  clearSchemaCache,
} from './index';
import type { HttpTrigger, ScheduleTrigger, TriggerStore } from './types';
import type { FlowRegistry, Engine } from '@flowmonkey/core';

// Mock FlowRegistry
const mockFlowRegistry = {
  get: vi.fn(),
  has: vi.fn(),
  register: vi.fn(),
  flowIds: vi.fn(),
  versions: vi.fn(),
  validate: vi.fn(),
} as unknown as FlowRegistry & { get: ReturnType<typeof vi.fn> };

// Mock Engine
const mockEngine = {
  create: vi.fn(),
  tick: vi.fn(),
  run: vi.fn(),
  cancel: vi.fn(),
  get: vi.fn(),
} as unknown as Engine & { create: ReturnType<typeof vi.fn> };

// Mock flow
const mockFlow = {
  id: 'test-flow',
  version: '1.0.0',
  initialStepId: 'start',
  steps: {},
};

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

describe('handleTrigger', () => {
  let store: TriggerStore;
  let httpTrigger: HttpTrigger;

  beforeEach(async () => {
    store = new MemoryTriggerStore();
    clearSchemaCache();
    vi.clearAllMocks();

    httpTrigger = (await store.create({
      type: 'http',
      name: 'Order Webhook',
      flowId: 'order-flow',
      enabled: true,
      inputSchema: {
        type: 'object',
        properties: {
          orderId: { type: 'string' },
          amount: { type: 'number', minimum: 0 },
        },
        required: ['orderId', 'amount'],
      },
      contextKey: 'order',
    })) as HttpTrigger;

    mockFlowRegistry.get.mockReturnValue(mockFlow);
    mockEngine.create.mockResolvedValue({
      execution: { id: 'exec_abc123' },
      created: true,
      idempotencyHit: false,
    });
  });

  it('returns 404 for non-existent trigger', async () => {
    const result = await handleTrigger(
      { triggerStore: store, flowRegistry: mockFlowRegistry, engine: mockEngine },
      'trg_nonexistent',
      {}
    );

    expect(result.status).toBe(404);
    expect(result.body).toEqual({ error: 'Trigger not found' });
  });

  it('returns 403 for disabled trigger', async () => {
    await store.update(httpTrigger.id, { enabled: false });

    const result = await handleTrigger(
      { triggerStore: store, flowRegistry: mockFlowRegistry, engine: mockEngine },
      httpTrigger.id,
      { orderId: 'ORD-001', amount: 100 }
    );

    expect(result.status).toBe(403);
    expect(result.body).toEqual({ error: 'Trigger is disabled' });
  });

  it('returns 400 for validation failure', async () => {
    const result = await handleTrigger(
      { triggerStore: store, flowRegistry: mockFlowRegistry, engine: mockEngine },
      httpTrigger.id,
      { orderId: 'ORD-001' } // Missing amount
    );

    expect(result.status).toBe(400);
    expect((result.body as { error: string }).error).toBe('Validation failed');
    expect((result.body as { errors: unknown[] }).errors).toBeDefined();

    // Check history was logged
    const history = await store.getHistory(httpTrigger.id);
    expect(history[0].status).toBe('validation_failed');
  });

  it('returns 500 for missing flow', async () => {
    mockFlowRegistry.get.mockReturnValue(undefined);

    const result = await handleTrigger(
      { triggerStore: store, flowRegistry: mockFlowRegistry, engine: mockEngine },
      httpTrigger.id,
      { orderId: 'ORD-001', amount: 100 }
    );

    expect(result.status).toBe(500);
    expect(result.body).toEqual({ error: 'Flow not found' });

    const history = await store.getHistory(httpTrigger.id);
    expect(history[0].status).toBe('flow_not_found');
  });

  it('creates execution on success', async () => {
    const result = await handleTrigger(
      { triggerStore: store, flowRegistry: mockFlowRegistry, engine: mockEngine },
      httpTrigger.id,
      { orderId: 'ORD-001', amount: 100 }
    );

    expect(result.status).toBe(201);
    expect((result.body as { executionId: string }).executionId).toBe('exec_abc123');

    expect(mockEngine.create).toHaveBeenCalledWith(
      'order-flow',
      { order: { orderId: 'ORD-001', amount: 100 } }
    );

    const history = await store.getHistory(httpTrigger.id);
    expect(history[0].status).toBe('success');
    expect(history[0].executionId).toBe('exec_abc123');
  });

  it('signals worker when signals provided', async () => {
    const mockSignals = { signal: vi.fn() };

    await handleTrigger(
      {
        triggerStore: store,
        flowRegistry: mockFlowRegistry,
        engine: mockEngine,
        signals: mockSignals,
      },
      httpTrigger.id,
      { orderId: 'ORD-001', amount: 100 }
    );

    expect(mockSignals.signal).toHaveBeenCalledWith('exec_abc123');
  });
});

describe('ScheduleRunner', () => {
  let store: MemoryTriggerStore;

  beforeEach(() => {
    store = new MemoryTriggerStore();
    vi.clearAllMocks();
    mockFlowRegistry.get.mockReturnValue(mockFlow);
    mockEngine.create.mockResolvedValue({ execution: { id: 'exec_scheduled' }, created: true, idempotencyHit: false });
  });

  it('fires due schedule triggers', async () => {
    const trigger = await store.create({
      type: 'schedule',
      name: 'Test Schedule',
      flowId: 'test-flow',
      enabled: true,
      schedule: '* * * * *', // Every minute
      timezone: 'UTC',
      staticContext: { source: 'cron' },
    });

    // Set nextRunAt to past
    await store.updateScheduleRun(trigger.id, 0, Date.now() - 1000);

    const runner = new ScheduleRunner(
      {
        triggerStore: store,
        flowRegistry: mockFlowRegistry,
        engine: mockEngine,
      },
      { intervalMs: 100 }
    );

    await runner.tickOnce();

    expect(mockEngine.create).toHaveBeenCalledWith('test-flow', { source: 'cron' });

    // Check history
    const history = await store.getHistory(trigger.id);
    expect(history[0].status).toBe('success');
    expect(history[0].executionId).toBe('exec_scheduled');

    // Check nextRunAt was updated
    const updated = await store.get(trigger.id);
    expect((updated as ScheduleTrigger).nextRunAt).toBeGreaterThan(Date.now());
  });

  it('handles flow not found', async () => {
    mockFlowRegistry.get.mockReturnValue(undefined);

    const trigger = await store.create({
      type: 'schedule',
      name: 'Test Schedule',
      flowId: 'missing-flow',
      enabled: true,
      schedule: '* * * * *',
      timezone: 'UTC',
      staticContext: {},
    });

    await store.updateScheduleRun(trigger.id, 0, Date.now() - 1000);

    const runner = new ScheduleRunner({
      triggerStore: store,
      flowRegistry: mockFlowRegistry,
      engine: mockEngine,
    });

    await runner.tickOnce();

    const history = await store.getHistory(trigger.id);
    expect(history[0].status).toBe('flow_not_found');

    // Still advances schedule
    const updated = await store.get(trigger.id);
    expect((updated as ScheduleTrigger).nextRunAt).toBeGreaterThan(Date.now());
  });

  it('starts and stops correctly', () => {
    const runner = new ScheduleRunner(
      {
        triggerStore: store,
        flowRegistry: mockFlowRegistry,
        engine: mockEngine,
      },
      { intervalMs: 10000 }
    );

    expect(runner.isRunning()).toBe(false);

    runner.start();
    expect(runner.isRunning()).toBe(true);

    runner.start(); // Idempotent
    expect(runner.isRunning()).toBe(true);

    runner.stop();
    expect(runner.isRunning()).toBe(false);
  });
});

describe('TriggerService', () => {
  let store: MemoryTriggerStore;
  let service: TriggerService;

  beforeEach(async () => {
    store = new MemoryTriggerStore();
    clearSchemaCache();
    vi.clearAllMocks();

    mockFlowRegistry.get.mockReturnValue(mockFlow);
    mockEngine.create.mockResolvedValue({ execution: { id: 'exec_svc' }, created: true, idempotencyHit: false });

    service = new TriggerService({
      triggerStore: store,
      flowRegistry: mockFlowRegistry,
      engine: mockEngine,
      basePath: '/webhooks',
    });

    await store.create({
      type: 'http',
      name: 'Test',
      flowId: 'test-flow',
      enabled: true,
      inputSchema: { type: 'object' },
      contextKey: 'data',
    });
  });

  it('exposes handleTrigger directly', async () => {
    const triggers = await store.list();
    const result = await service.handleTrigger(triggers[0].id, { foo: 'bar' });

    expect(result.status).toBe(201);
    expect((result.body as { executionId: string }).executionId).toBe('exec_svc');
  });

  it('starts and stops scheduler', async () => {
    expect(service.scheduler.isRunning()).toBe(false);

    service.startScheduler();
    expect(service.scheduler.isRunning()).toBe(true);

    await service.stop();
    expect(service.scheduler.isRunning()).toBe(false);
  });

  it('returns configured base path', () => {
    expect(service.getBasePath()).toBe('/webhooks');
  });

  describe('mount detection', () => {
    it('throws for unsupported app type', () => {
      expect(() => service.mount({})).toThrow('Unsupported server type');
    });

    it('detects Express-like app', () => {
      const mockExpress = {
        use: vi.fn(),
        get: vi.fn(),
        post: vi.fn(),
      };

      // Should not throw
      expect(() => service.mount(mockExpress)).not.toThrow();
      expect(mockExpress.post).toHaveBeenCalled();
    });

    it('detects Fastify-like app', () => {
      const mockFastify = {
        register: vi.fn(),
        route: vi.fn(),
        post: vi.fn(),
        version: '4.0.0',
      };

      expect(() => service.mount(mockFastify)).not.toThrow();
      expect(mockFastify.post).toHaveBeenCalled();
    });

    it('detects Hono-like app', () => {
      class Hono {
        post = vi.fn();
      }
      const mockHono = new Hono();

      expect(() => service.mount(mockHono)).not.toThrow();
      expect(mockHono.post).toHaveBeenCalled();
    });

    it('detects Koa-like app', () => {
      const mockKoa = {
        use: vi.fn(),
        middleware: [],
        context: {},
      };

      expect(() => service.mount(mockKoa)).not.toThrow();
      expect(mockKoa.use).toHaveBeenCalled();
    });
  });
});
