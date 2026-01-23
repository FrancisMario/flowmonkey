import { describe, it, expect, beforeEach } from 'vitest';
import { TestHarness } from './harness';
import { echoHandler, transformHandler, delayHandler, failHandler, branchHandler, setHandler } from './handlers';
import { simpleFlow, branchFlow, waitFlow, errorFlow } from './flows';

describe('Engine', () => {
  let t: TestHarness;

  beforeEach(() => {
    t = new TestHarness({
      handlers: [echoHandler, transformHandler, delayHandler, failHandler, branchHandler, setHandler],
      flows: [simpleFlow, branchFlow, waitFlow, errorFlow],
    });
  });

  describe('simple flow', () => {
    it('runs to completion', async () => {
      const { execution } = await t.run('simple', { message: 'hello' });
      t.assertCompleted(execution);
      t.assertContext(execution, { echoed: 'hello', result: 'HELLO' });
      expect(execution.stepCount).toBe(2);
    });

    it('records history', async () => {
      const { execution } = await t.run('simple', { message: 'test' });
      expect(execution.history).toHaveLength(2);
      expect(execution.history![0].stepId).toBe('echo');
      expect(execution.history![1].stepId).toBe('transform');
    });
  });

  describe('branching', () => {
    it('takes branch a', async () => {
      const { execution } = await t.run('branch', { type: 'a' });
      t.assertCompleted(execution);
      t.assertContext(execution, { result: 'handled-a' });
    });

    it('takes branch b', async () => {
      const { execution } = await t.run('branch', { type: 'b' });
      t.assertCompleted(execution);
      t.assertContext(execution, { result: 'handled-b' });
    });

    it('takes default', async () => {
      const { execution } = await t.run('branch', { type: 'x' });
      t.assertCompleted(execution);
      t.assertContext(execution, { result: 'handled-default' });
    });
  });

  describe('wait/resume', () => {
    it('handles wait', async () => {
      const { execution } = await t.run('wait', { message: 'hi' });
      t.assertCompleted(execution);
      t.assertContext(execution, { started: 'hi', result: 'done' });
    });

    it('tick returns waiting', async () => {
      const e = await t.create('wait', { message: 'hi' });
      await t.tick(e.id); // echo
      const r = await t.tick(e.id); // delay → wait
      expect(r.status).toBe('waiting');
      expect(r.wakeAt).toBeDefined();
    });
  });

  describe('error handling', () => {
    it('follows onFailure', async () => {
      const { execution } = await t.run('error', {});
      t.assertCompleted(execution);
      t.assertContext(execution, { result: 'recovered' });
    });
  });

  describe('cancellation', () => {
    it('cancels execution', async () => {
      const e = await t.create('wait', { message: 'hi' });
      await t.tick(e.id);
      await t.tick(e.id); // waiting

      const ok = await t.engine.cancel(e.id, 'test');
      expect(ok).toBe(true);

      const final = await t.engine.get(e.id);
      t.assertFailed(final!, 'CANCELLED');
    });
  });
});
