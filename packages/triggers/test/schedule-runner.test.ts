import { describe, it, expect, beforeEach } from 'vitest';
import { MemoryTriggerStore, ScheduleRunner } from '../src/index';
import type { ScheduleTrigger } from '../src/types';
import { mockFlowRegistry, mockEngine, resetMocks } from './fixtures';

describe('ScheduleRunner', () => {
  let store: MemoryTriggerStore;

  beforeEach(() => {
    store = new MemoryTriggerStore();
    resetMocks();
    mockEngine.create.mockResolvedValue({
      execution: { id: 'exec_scheduled' },
      created: true,
      idempotencyHit: false,
    });
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
