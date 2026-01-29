import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MemoryTriggerStore, TriggerService, clearSchemaCache } from '../src/index';
import { mockFlowRegistry, mockEngine, resetMocks } from './fixtures';

describe('TriggerService', () => {
  let store: MemoryTriggerStore;
  let service: TriggerService;

  beforeEach(async () => {
    store = new MemoryTriggerStore();
    clearSchemaCache();
    resetMocks();
    mockEngine.create.mockResolvedValue({
      execution: { id: 'exec_svc' },
      created: true,
      idempotencyHit: false,
    });

    service = new TriggerService(store, mockEngine, {
      schedule: { enabled: false }, // Don't auto-start scheduler
    });

    await store.create({
      id: 'test-trigger',
      type: 'http',
      name: 'Test',
      flowId: 'test-flow',
      enabled: true,
      inputSchema: { type: 'object' },
      contextKey: 'data',
    });
  });

  it('exposes handleTrigger directly', async () => {
    const result = await service.handleTrigger('test-trigger', { foo: 'bar' });

    expect(result.status).toBe(201);
    expect((result.body as { executionId: string }).executionId).toBe('exec_svc');
  });

  it('scheduler is undefined when schedule config not provided', () => {
    const serviceNoSchedule = new TriggerService(store, mockEngine);
    expect(serviceNoSchedule.scheduler).toBeUndefined();
  });

  it('scheduler exists when schedule config provided', () => {
    const serviceWithSchedule = new TriggerService(store, mockEngine, {
      schedule: { enabled: false },
    });
    expect(serviceWithSchedule.scheduler).toBeDefined();
    expect(serviceWithSchedule.scheduler!.isRunning()).toBe(false);
  });

  it('scheduler auto-starts when enabled', async () => {
    const serviceAutoStart = new TriggerService(store, mockEngine, {
      schedule: { enabled: true, checkInterval: 60000 },
    });
    expect(serviceAutoStart.scheduler!.isRunning()).toBe(true);
    await serviceAutoStart.shutdown();
    expect(serviceAutoStart.scheduler!.isRunning()).toBe(false);
  });

  describe('register', () => {
    it('registers a new trigger', async () => {
      await service.register({
        id: 'new-trigger',
        type: 'http',
        name: 'New Trigger',
        flowId: 'test-flow',
        enabled: true,
        inputSchema: { type: 'object' },
        contextKey: 'payload',
      });

      const trigger = await service.get('new-trigger');
      expect(trigger).toBeDefined();
      expect(trigger!.name).toBe('New Trigger');
    });

    it('throws if trigger already exists', async () => {
      await expect(service.register({
        id: 'test-trigger', // Already exists
        type: 'http',
        name: 'Duplicate',
        flowId: 'test-flow',
        enabled: true,
        inputSchema: { type: 'object' },
        contextKey: 'payload',
      })).rejects.toThrow("Trigger 'test-trigger' already exists");
    });
  });

  describe('CRUD operations', () => {
    it('gets a trigger by ID', async () => {
      const trigger = await service.get('test-trigger');
      expect(trigger).toBeDefined();
      expect(trigger!.name).toBe('Test');
    });

    it('returns undefined for non-existent trigger', async () => {
      const trigger = await service.get('non-existent');
      expect(trigger).toBeUndefined();
    });

    it('updates a trigger', async () => {
      await service.update('test-trigger', { name: 'Updated' });
      const trigger = await service.get('test-trigger');
      expect(trigger!.name).toBe('Updated');
    });

    it('throws when updating non-existent trigger', async () => {
      await expect(service.update('non-existent', { name: 'Nope' }))
        .rejects.toThrow("Trigger 'non-existent' not found");
    });

    it('deletes a trigger', async () => {
      await service.delete('test-trigger');
      const trigger = await service.get('test-trigger');
      expect(trigger).toBeUndefined();
    });

    it('throws when deleting non-existent trigger', async () => {
      await expect(service.delete('non-existent'))
        .rejects.toThrow("Trigger 'non-existent' not found");
    });

    it('lists triggers', async () => {
      const triggers = await service.list();
      expect(triggers.length).toBe(1);
    });

    it('lists triggers with filter', async () => {
      await store.create({
        id: 'schedule-trigger',
        type: 'schedule',
        name: 'Schedule',
        flowId: 'test-flow',
        enabled: true,
        schedule: '0 9 * * *',
        timezone: 'UTC',
        staticContext: {},
      });

      const httpTriggers = await service.list({ type: 'http' });
      expect(httpTriggers.length).toBe(1);

      const scheduleTriggers = await service.list({ type: 'schedule' });
      expect(scheduleTriggers.length).toBe(1);
    });
  });

  describe('enable/disable', () => {
    it('enables a trigger', async () => {
      await service.update('test-trigger', { enabled: false });
      await service.enable('test-trigger');
      const trigger = await service.get('test-trigger');
      expect(trigger!.enabled).toBe(true);
    });

    it('disables a trigger', async () => {
      await service.disable('test-trigger');
      const trigger = await service.get('test-trigger');
      expect(trigger!.enabled).toBe(false);
    });
  });

  describe('fire', () => {
    it('fires a trigger programmatically', async () => {
      const result = await service.fire('test-trigger', { data: 'test' });
      expect(result.executionId).toBe('exec_svc');
      expect(result.triggerId).toBe('test-trigger');
      expect(result.flowId).toBe('test-flow');
    });

    it('throws for non-existent trigger', async () => {
      await expect(service.fire('non-existent', {}))
        .rejects.toThrow("Trigger 'non-existent' not found");
    });

    it('throws for disabled trigger', async () => {
      await service.disable('test-trigger');
      await expect(service.fire('test-trigger', {}))
        .rejects.toThrow("Trigger 'test-trigger' is disabled");
    });
  });

  describe('health check', () => {
    it('returns true when healthy', async () => {
      const healthy = await service.isHealthy();
      expect(healthy).toBe(true);
    });
  });

  describe('HTTP adapter', () => {
    it('mounts routes when http config provided', () => {
      const mockExpress = {
        use: vi.fn(),
        get: vi.fn(),
        post: vi.fn(),
      };

      // Constructor mounts the routes
      void new TriggerService(store, mockEngine, {
        http: { app: mockExpress, framework: 'express', basePath: '/webhooks' },
      });

      expect(mockExpress.post).toHaveBeenCalledWith('/webhooks/:triggerId', expect.any(Function));
    });

    it('mounts GET endpoint when infoEndpoint enabled', () => {
      const mockExpress = {
        use: vi.fn(),
        get: vi.fn(),
        post: vi.fn(),
      };

      // Constructor mounts the routes
      void new TriggerService(store, mockEngine, {
        http: { app: mockExpress, framework: 'express', basePath: '/webhooks', infoEndpoint: true },
      });

      expect(mockExpress.get).toHaveBeenCalledWith('/webhooks/:triggerId', expect.any(Function));
    });

    it('throws for unsupported framework', () => {
      const mockApp = { post: vi.fn() };

      expect(() => new TriggerService(store, mockEngine, {
        http: { app: mockApp, framework: 'unknown' as 'express' },
      })).toThrow('Unsupported framework');
    });
  });
});
