import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MemoryTriggerStore, handleTrigger, clearSchemaCache } from '../src/index';
import type { HttpTrigger, TriggerStore } from '../src/types';
import { mockFlowRegistry, mockEngine, mockFlow, resetMocks } from './fixtures';

describe('handleTrigger', () => {
  let store: TriggerStore;
  let httpTrigger: HttpTrigger;

  beforeEach(async () => {
    store = new MemoryTriggerStore();
    clearSchemaCache();
    resetMocks();

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
