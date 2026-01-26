/**
 * Engine Tests
 *
 * Comprehensive tests for the core execution engine covering:
 * - Flow execution (simple, branching, wait/resume)
 * - Error handling and recovery via onFailure transitions
 * - Cancellation system (with children and token invalidation)
 * - Idempotency/deduplication via idempotency keys
 * - Max steps protection against infinite loops
 * - Status transitions and terminal states
 * - Event bus emissions
 * - Create options (custom IDs, metadata, timeouts)
 *
 * @see README.md for full test documentation
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { TestHarness } from './harness';
import { Engine } from '../engine/execution-engine';
import { MemoryStore } from '../impl/memory-store';
import { DefaultHandlerRegistry } from '../impl/handler-registry';
import { DefaultFlowRegistry } from '../impl/flow-registry';
import { echoHandler, transformHandler, delayHandler, failHandler, branchHandler, setHandler, slowHandler, contextSetHandler } from './handlers';
import { simpleFlow, branchFlow, waitFlow, errorFlow, infiniteFlow, longWaitFlow } from './flows';
import type { Flow } from '../types/flow';
import type { ResumeTokenManager, ResumeToken } from '../interfaces/resume-token-manager';

describe('Engine', () => {
  let t: TestHarness;

  beforeEach(() => {
    t = new TestHarness({
      handlers: [echoHandler, transformHandler, delayHandler, failHandler, branchHandler, setHandler, slowHandler, contextSetHandler],
      flows: [simpleFlow, branchFlow, waitFlow, errorFlow, infiniteFlow, longWaitFlow],
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

    it('tracks waitStartedAt', async () => {
      const e = await t.create('wait', { message: 'hi' });
      await t.tick(e.id); // echo
      await t.tick(e.id); // delay → wait
      
      const exec = await t.engine.get(e.id);
      expect(exec?.waitStartedAt).toBeDefined();
      expect(exec?.waitStartedAt).toBeGreaterThan(0);
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
    it('cancels execution with full result', async () => {
      const e = await t.create('wait', { message: 'hi' });
      await t.tick(e.id);
      await t.tick(e.id); // waiting

      const result = await t.engine.cancel(e.id, { source: 'user', reason: 'test cancel' });
      expect(result.cancelled).toBe(true);
      expect(result.previousStatus).toBe('waiting');

      const final = await t.engine.get(e.id);
      t.assertCancelled(final!);
      expect(final?.cancellation?.source).toBe('user');
      expect(final?.cancellation?.reason).toBe('test cancel');
    });

    it('supports legacy string reason', async () => {
      const e = await t.create('wait', { message: 'hi' });
      await t.tick(e.id);
      await t.tick(e.id);

      const result = await t.engine.cancel(e.id, 'legacy reason');
      expect(result.cancelled).toBe(true);

      const final = await t.engine.get(e.id);
      expect(final?.cancellation?.reason).toBe('legacy reason');
    });

    it('returns false for already terminal', async () => {
      const { execution } = await t.run('simple', { message: 'test' });
      const result = await t.engine.cancel(execution.id);
      expect(result.cancelled).toBe(false);
      expect(result.previousStatus).toBe('completed');
    });

    it('prevents tick on cancelling execution', async () => {
      const e = await t.create('wait', { message: 'hi' });
      await t.tick(e.id);
      
      // Manually set to cancelling to test the guard
      const exec = await t.engine.get(e.id);
      exec!.status = 'cancelling';
      await t.store.save(exec!);

      const result = await t.tick(e.id);
      expect(result.status).toBe('cancelling');
      expect(result.done).toBe(false);
    });
  });

  describe('idempotency', () => {
    it('returns existing execution on duplicate key', async () => {
      const result1 = await t.createWithResult('simple', { message: 'first' }, {
        idempotencyKey: 'unique-key-1',
      });
      expect(result1.created).toBe(true);
      expect(result1.idempotencyHit).toBe(false);

      const result2 = await t.createWithResult('simple', { message: 'second' }, {
        idempotencyKey: 'unique-key-1',
      });
      expect(result2.created).toBe(false);
      expect(result2.idempotencyHit).toBe(true);
      expect(result2.execution.id).toBe(result1.execution.id);
      // Original context should be preserved
      expect(result2.execution.context.message).toBe('first');
    });

    it('allows different keys', async () => {
      const result1 = await t.createWithResult('simple', { message: 'first' }, {
        idempotencyKey: 'key-a',
      });
      const result2 = await t.createWithResult('simple', { message: 'second' }, {
        idempotencyKey: 'key-b',
      });
      
      expect(result1.execution.id).not.toBe(result2.execution.id);
      expect(result1.created).toBe(true);
      expect(result2.created).toBe(true);
    });

    it('allows same key for different flows', async () => {
      const result1 = await t.createWithResult('simple', { message: 'first' }, {
        idempotencyKey: 'same-key',
      });
      const result2 = await t.createWithResult('branch', { type: 'a' }, {
        idempotencyKey: 'same-key',
      });
      
      expect(result1.execution.id).not.toBe(result2.execution.id);
    });

    it('stores idempotency fields on execution', async () => {
      const result = await t.createWithResult('simple', { message: 'test' }, {
        idempotencyKey: 'my-key',
        idempotencyWindowMs: 60000, // 1 minute
      });

      expect(result.execution.idempotencyKey).toBe('my-key');
      expect(result.execution.idempotencyExpiresAt).toBeDefined();
      expect(result.execution.idempotencyExpiresAt).toBeGreaterThan(Date.now());
    });

    it('respects idempotency window expiration', async () => {
      // This is tricky to test without time manipulation, but we can verify the expiration is set
      const result = await t.createWithResult('simple', { message: 'test' }, {
        idempotencyKey: 'expires-key',
        idempotencyWindowMs: 1000, // 1 second
      });

      // The expiration should be about 1 second from now
      const expectedExpiry = Date.now() + 1000;
      expect(result.execution.idempotencyExpiresAt).toBeGreaterThan(Date.now());
      expect(result.execution.idempotencyExpiresAt).toBeLessThan(expectedExpiry + 100);
    });
  });

  describe('max steps limit', () => {
    it('fails execution when max steps exceeded', async () => {
      // Create a harness with low max steps
      const t2 = new TestHarness({
        handlers: [echoHandler],
        flows: [infiniteFlow],
        maxSteps: 10,
      });

      const e = await t2.create('infinite', {});
      
      // Tick until it fails
      let result;
      for (let i = 0; i < 15; i++) {
        result = await t2.tick(e.id);
        if (result.done) break;
      }

      expect(result!.done).toBe(true);
      expect(result!.status).toBe('failed');
      expect(result!.error?.code).toBe('MAX_STEPS');
    });
  });

  describe('flow and step errors', () => {
    it('fails when flow not found', async () => {
      await expect(t.engine.create('non-existent', {})).rejects.toThrow('Flow "non-existent" not found');
    });

    it('fails when handler not found', async () => {
      const noHandlerFlow: Flow = {
        id: 'no-handler',
        version: '1.0.0',
        initialStepId: 'step1',
        steps: {
          step1: {
            id: 'step1',
            type: 'unknown-handler',
            config: {},
            input: { type: 'static', value: null },
            transitions: {},
          },
        },
      };
      t.flows.register(noHandlerFlow);

      const e = await t.create('no-handler', {});
      const result = await t.tick(e.id);

      expect(result.done).toBe(true);
      expect(result.status).toBe('failed');
      expect(result.error?.code).toBe('HANDLER_NOT_FOUND');
    });

    it('rejects invalid flow at registration', () => {
      const badFlow: Flow = {
        id: 'bad-flow',
        version: '1.0.0',
        initialStepId: 'missing-step',
        steps: {},
      };
      
      expect(() => t.flows.register(badFlow)).toThrow('At least one step required');
    });

    it('rejects invalid transition at registration', () => {
      const badTransitionFlow: Flow = {
        id: 'bad-transition',
        version: '1.0.0',
        initialStepId: 'step1',
        steps: {
          step1: {
            id: 'step1',
            type: 'echo',
            config: {},
            input: { type: 'static', value: 'test' },
            transitions: { onSuccess: 'non-existent-step' },
          },
        },
      };
      
      expect(() => t.flows.register(badTransitionFlow)).toThrow('not found');
    });
  });

  describe('create options', () => {
    it('supports custom execution ID', async () => {
      const result = await t.createWithResult('simple', { message: 'test' }, {
        executionId: 'custom-id-123',
      });

      expect(result.execution.id).toBe('custom-id-123');
    });

    it('supports tenant ID', async () => {
      const result = await t.createWithResult('simple', { message: 'test' }, {
        tenantId: 'tenant-abc',
      });

      expect(result.execution.tenantId).toBe('tenant-abc');
    });

    it('supports parent execution ID', async () => {
      const parent = await t.create('simple', { message: 'parent' });
      const child = await t.createWithResult('simple', { message: 'child' }, {
        parentExecutionId: parent.id,
      });

      expect(child.execution.parentExecutionId).toBe(parent.id);
    });

    it('supports metadata', async () => {
      const result = await t.createWithResult('simple', { message: 'test' }, {
        metadata: { source: 'test', priority: 'high' },
      });

      expect(result.execution.metadata).toEqual({ source: 'test', priority: 'high' });
    });

    it('supports timeout config', async () => {
      const result = await t.createWithResult('simple', { message: 'test' }, {
        timeoutConfig: {
          executionTimeoutMs: 300000,
          waitTimeoutMs: 60000,
        },
      });

      expect(result.execution.timeoutConfig).toEqual({
        executionTimeoutMs: 300000,
        waitTimeoutMs: 60000,
      });
    });
  });

  describe('cancellation with children', () => {
    it('cancels child executions recursively', async () => {
      // Create parent in waiting state
      const parent = await t.create('long-wait', {});
      await t.tick(parent.id); // start
      await t.tick(parent.id); // wait

      // Create children
      const child1 = await t.create('long-wait', {}, { parentExecutionId: parent.id });
      await t.tick(child1.id);
      await t.tick(child1.id);

      const child2 = await t.create('long-wait', {}, { parentExecutionId: parent.id });
      await t.tick(child2.id);
      await t.tick(child2.id);

      // Cancel parent
      const result = await t.engine.cancel(parent.id, { source: 'user', reason: 'test' });

      expect(result.cancelled).toBe(true);
      expect(result.childrenCancelled).toBe(2);

      // Verify children are cancelled
      const finalChild1 = await t.engine.get(child1.id);
      const finalChild2 = await t.engine.get(child2.id);

      expect(finalChild1?.status).toBe('cancelled');
      expect(finalChild2?.status).toBe('cancelled');
      expect(finalChild1?.cancellation?.source).toBe('parent');
      expect(finalChild2?.cancellation?.source).toBe('parent');
    });
  });

  describe('cancellation with token manager', () => {
    it('invalidates resume tokens on cancel', async () => {
      const tokens: Map<string, ResumeToken> = new Map();
      let tokenCounter = 0;
      
      // Helper to create tokens for testing
      const createToken = (executionId: string, stepId: string, expiresAt?: number): ResumeToken => {
        const token: ResumeToken = {
          token: `token_${++tokenCounter}_${Date.now()}`,
          executionId,
          stepId,
          status: 'active',
          createdAt: Date.now(),
          expiresAt: expiresAt ?? Date.now() + 3600000,
        };
        tokens.set(token.token, token);
        return token;
      };

      const mockTokenManager: ResumeTokenManager = {
        async generate(executionId, stepId, options) {
          return createToken(executionId, stepId, options?.expiresInMs ? Date.now() + options.expiresInMs : undefined);
        },
        async get(token) {
          return tokens.get(token) ?? null;
        },
        async validate(token) {
          const t = tokens.get(token);
          if (!t) return { valid: false, reason: 'Token not found' };
          if (t.status !== 'active') return { valid: false, reason: `Token is ${t.status}` };
          return { valid: true };
        },
        async markUsed(token) {
          const t = tokens.get(token);
          if (t) t.status = 'used';
        },
        async revoke(token) {
          const t = tokens.get(token);
          if (t) t.status = 'revoked';
        },
        async listByExecution(executionId) {
          return Array.from(tokens.values()).filter(t => t.executionId === executionId);
        },
        async cleanupExpired() {
          let count = 0;
          const now = Date.now();
          for (const [key, t] of tokens) {
            if (t.expiresAt && t.expiresAt < now) {
              tokens.delete(key);
              count++;
            }
          }
          return count;
        },
      };

      // Create engine with token manager
      const store = new MemoryStore();
      const handlers = new DefaultHandlerRegistry();
      const flows = new DefaultFlowRegistry();
      handlers.register(echoHandler);
      handlers.register(delayHandler);
      handlers.register(setHandler);
      flows.register(longWaitFlow);

      const engine = new Engine(store, handlers, flows, undefined, {
        recordHistory: true,
        tokenManager: mockTokenManager,
      });

      // Create and start execution
      const result = await engine.create('long-wait', {});
      await engine.tick(result.execution.id);
      await engine.tick(result.execution.id);

      // Simulate creating tokens for this execution
      const token1 = createToken(result.execution.id, 'wait', Date.now() + 60000);
      const token2 = createToken(result.execution.id, 'wait', Date.now() + 60000);
      expect(token1.status).toBe('active');
      expect(token2.status).toBe('active');

      // Cancel
      const cancelResult = await engine.cancel(result.execution.id);

      // Verify tokens were found and revoked
      expect(cancelResult.tokensInvalidated).toBe(2);

      // Verify tokens are revoked
      const remainingTokens = await mockTokenManager.listByExecution(result.execution.id);
      expect(remainingTokens.every(t => t.status === 'revoked')).toBe(true);
    });
  });

  describe('execution status transitions', () => {
    it('transitions pending → running → completed', async () => {
      const e = await t.create('simple', { message: 'test' });
      expect(e.status).toBe('pending');

      const r1 = await t.tick(e.id);
      expect(r1.status).toBe('running');

      const r2 = await t.tick(e.id);
      expect(r2.status).toBe('completed');
      expect(r2.done).toBe(true);
    });

    it('transitions pending → running → waiting → completed', async () => {
      const e = await t.create('wait', { message: 'test' });
      
      await t.tick(e.id); // echo
      const r1 = await t.tick(e.id); // delay → waiting
      expect(r1.status).toBe('waiting');

      // After wake, engine may complete multiple steps in one tick
      // depending on flow structure. The wait flow goes: start → wait → finish
      // When waking, it runs finish step which completes the execution
      const r2 = await t.tick(e.id); // wake and run finish → can be running or completed
      expect(['running', 'completed']).toContain(r2.status);

      // If not completed yet, one more tick should do it
      if (r2.status !== 'completed') {
        const r3 = await t.tick(e.id);
        expect(r3.status).toBe('completed');
      }
    });

    it('transitions to failed on unhandled error', async () => {
      const failOnlyFlow: Flow = {
        id: 'fail-only',
        version: '1.0.0',
        initialStepId: 'fail',
        steps: {
          fail: {
            id: 'fail',
            type: 'fail',
            config: { code: 'TEST_ERROR' },
            input: { type: 'full' },
            transitions: {}, // No onFailure handler
          },
        },
      };
      t.flows.register(failOnlyFlow);

      const { execution } = await t.run('fail-only', {});
      expect(execution.status).toBe('failed');
      expect(execution.error?.code).toBe('TEST_ERROR');
    });
  });

  describe('input resolution', () => {
    it('resolves key input', async () => {
      const { execution } = await t.run('simple', { message: 'hello' });
      expect(execution.context.echoed).toBe('hello');
    });

    it('resolves full context input', async () => {
      const { execution } = await t.run('branch', { type: 'a', extra: 'data' });
      t.assertCompleted(execution);
    });

    it('resolves static input', async () => {
      const { execution } = await t.run('wait', { message: 'test' });
      expect(execution.context.result).toBe('done');
    });
  });

  describe('events', () => {
    it('emits execution lifecycle events', async () => {
      const { events } = await t.run('simple', { message: 'test' });

      const types = events.map(e => e.type);
      expect(types).toContain('created');
      expect(types).toContain('started');
      expect(types).toContain('step.started');
      expect(types).toContain('step.completed');
      expect(types).toContain('completed');
    });

    it('emits waiting event', async () => {
      const e = await t.create('wait', { message: 'test' });
      await t.tick(e.id); // echo
      await t.tick(e.id); // delay → waiting

      const waitEvent = t.events.find(ev => ev.type === 'waiting');
      expect(waitEvent).toBeDefined();
      expect(waitEvent.executionId).toBe(e.id);
    });

    it('emits failed event on error', async () => {
      const failOnlyFlow: Flow = {
        id: 'fail-only-2',
        version: '1.0.0',
        initialStepId: 'fail',
        steps: {
          fail: {
            id: 'fail',
            type: 'fail',
            config: {},
            input: { type: 'full' },
            transitions: {},
          },
        },
      };
      t.flows.register(failOnlyFlow);

      await t.run('fail-only-2', {});

      const failEvent = t.events.find(ev => ev.type === 'failed');
      expect(failEvent).toBeDefined();
      expect(failEvent.error).toBeDefined();
    });
  });

  describe('flow versioning', () => {
    it('stores flow version at creation', async () => {
      const e = await t.create('simple', { message: 'test' });
      expect(e.flowVersion).toBe('1.0.0');
    });
  });

  describe('terminal status handling', () => {
    it('returns done for completed execution', async () => {
      const { execution } = await t.run('simple', { message: 'test' });
      
      const result = await t.tick(execution.id);
      expect(result.done).toBe(true);
      expect(result.status).toBe('completed');
    });

    it('returns done for failed execution', async () => {
      const failFlow: Flow = {
        id: 'fail-terminal',
        version: '1.0.0',
        initialStepId: 'fail',
        steps: {
          fail: {
            id: 'fail',
            type: 'fail',
            config: {},
            input: { type: 'full' },
            transitions: {},
          },
        },
      };
      t.flows.register(failFlow);

      const { execution } = await t.run('fail-terminal', {});
      expect(execution.status).toBe('failed');
      
      const result = await t.tick(execution.id);
      expect(result.done).toBe(true);
      expect(result.status).toBe('failed');
    });

    it('returns done for cancelled execution', async () => {
      const e = await t.create('long-wait', {});
      await t.tick(e.id);
      await t.tick(e.id);

      await t.engine.cancel(e.id);

      const result = await t.tick(e.id);
      expect(result.done).toBe(true);
      expect(result.status).toBe('cancelled');
    });
  });

  describe('get method', () => {
    it('returns null for non-existent execution', async () => {
      const result = await t.engine.get('non-existent');
      expect(result).toBeNull();
    });

    it('returns execution by ID', async () => {
      const e = await t.create('simple', { message: 'test' });
      const loaded = await t.engine.get(e.id);
      expect(loaded).not.toBeNull();
      expect(loaded!.id).toBe(e.id);
    });
  });
});
