/**
 * Tests for Express route handlers.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import express, { type Express, type Router } from 'express';
import request from 'supertest';
import type { Execution } from '@flowmonkey/core';
import {
  registerExecutionRoutes,
  registerAdminRoutes,
  registerHealthRoutes,
} from '../src/handlers';
import { createContextMiddleware, createErrorHandler } from '../src/middleware';
import { ServiceContainer } from '../src/container';
import { ServiceTokens } from '../src/tokens';
import {
  createMockStateStore,
  createMockFlowRegistry,
  createMockHandlerRegistry,
  createTestExecution,
} from './fixtures';

function setupTestApp(): {
  app: Express;
  router: Router;
  container: ServiceContainer;
  stateStore: ReturnType<typeof createMockStateStore>;
  flowRegistry: ReturnType<typeof createMockFlowRegistry>;
  handlerRegistry: ReturnType<typeof createMockHandlerRegistry>;
} {
  const app = express();
  app.use(express.json());

  const container = new ServiceContainer();
  const stateStore = createMockStateStore();
  const flowRegistry = createMockFlowRegistry();
  const handlerRegistry = createMockHandlerRegistry();

  container.registerInstance(ServiceTokens.StateStore, stateStore);
  container.registerInstance(ServiceTokens.FlowRegistry, flowRegistry);
  container.registerInstance(ServiceTokens.HandlerRegistry, handlerRegistry);

  app.use(createContextMiddleware(container));

  const router = express.Router();

  return { app, router, container, stateStore, flowRegistry, handlerRegistry };
}

describe('Route Handlers', () => {
  describe('Health Routes', () => {
    it('GET /health returns healthy status', async () => {
      const { app, router } = setupTestApp();
      registerHealthRoutes(router);
      app.use(router);

      const response = await request(app).get('/health');

      expect(response.status).toBe(200);
      expect(response.body.status).toBe('healthy');
      expect(response.body.timestamp).toBeDefined();
    });

    it('GET /ready returns ready status when state store available', async () => {
      const { app, router, container, stateStore } = setupTestApp();
      registerHealthRoutes(router);
      app.use(router);

      const response = await request(app).get('/ready');

      expect(response.status).toBe(200);
      expect(response.body.ready).toBe(true);
      expect(response.body.checks.stateStore).toBe('ok');
    });
  });

  describe('Admin Routes', () => {
    it('GET /api/admin/flows lists all flows', async () => {
      const { app, router } = setupTestApp();
      registerAdminRoutes(router);
      app.use(router);
      app.use(createErrorHandler());

      const response = await request(app).get('/api/admin/flows');

      expect(response.status).toBe(200);
      expect(response.body.flows).toBeInstanceOf(Array);
      expect(response.body.flows.length).toBeGreaterThan(0);
      expect(response.body.flows[0]).toMatchObject({
        id: 'test-flow',
        name: 'Test Flow',
        version: '1.0.0',
      });
    });

    it('GET /api/admin/handlers lists all handlers', async () => {
      const { app, router } = setupTestApp();
      registerAdminRoutes(router);
      app.use(router);
      app.use(createErrorHandler());

      const response = await request(app).get('/api/admin/handlers');

      expect(response.status).toBe(200);
      expect(response.body.handlers).toBeInstanceOf(Array);
      expect(response.body.handlers.length).toBe(2);
      expect(response.body.handlers).toContainEqual(
        expect.objectContaining({ type: 'transform', name: 'Transform' })
      );
    });
  });

  describe('Execution Routes', () => {
    describe('POST /api/flows/:flowId/start', () => {
      it('creates new execution for valid flow', async () => {
        const { app, router, stateStore } = setupTestApp();
        registerExecutionRoutes(router);
        app.use(router);
        app.use(createErrorHandler());

        const response = await request(app)
          .post('/api/flows/test-flow/start')
          .send({ input: { name: 'test' } });

        expect(response.status).toBe(201);
        expect(response.body.executionId).toBeDefined();
        expect(response.body.status).toBe('pending');
        expect(response.body.flowId).toBe('test-flow');
        expect(stateStore.save).toHaveBeenCalled();
      });

      it('returns 404 for unknown flow', async () => {
        const { app, router } = setupTestApp();
        registerExecutionRoutes(router);
        app.use(router);
        app.use(createErrorHandler());

        const response = await request(app)
          .post('/api/flows/unknown-flow/start')
          .send({ input: {} });

        expect(response.status).toBe(404);
        expect(response.body.error.code).toBe('FLOW_NOT_FOUND');
      });

      it('includes context in execution', async () => {
        const { app, router, stateStore } = setupTestApp();
        registerExecutionRoutes(router);
        app.use(router);
        app.use(createErrorHandler());

        await request(app)
          .post('/api/flows/test-flow/start')
          .send({
            input: { data: 'test' },
            context: { customKey: 'customValue' },
          });

        const savedExecution = (stateStore.save as ReturnType<typeof import('vitest').vi.fn>).mock.calls[0][0] as Execution;
        expect(savedExecution.context._input).toEqual({ data: 'test' });
        expect(savedExecution.context.customKey).toBe('customValue');
      });
    });

    describe('GET /api/executions/:executionId', () => {
      it('returns execution details', async () => {
        const { app, router, stateStore } = setupTestApp();
        registerExecutionRoutes(router);
        app.use(router);
        app.use(createErrorHandler());

        // Create an execution
        const execution = createTestExecution({
          id: 'exec-test-123',
          status: 'running',
        });
        await stateStore.save(execution);

        const response = await request(app).get('/api/executions/exec-test-123');

        expect(response.status).toBe(200);
        expect(response.body.id).toBe('exec-test-123');
        expect(response.body.flowId).toBe('test-flow');
        expect(response.body.status).toBe('running');
      });

      it('returns 404 for unknown execution', async () => {
        const { app, router } = setupTestApp();
        registerExecutionRoutes(router);
        app.use(router);
        app.use(createErrorHandler());

        const response = await request(app).get('/api/executions/unknown-id');

        expect(response.status).toBe(404);
        expect(response.body.error.code).toBe('EXECUTION_NOT_FOUND');
      });

      it('enforces tenant isolation', async () => {
        const { app, container, stateStore } = setupTestApp();
        
        // Setup with tenant extraction
        const tenantApp = express();
        tenantApp.use(express.json());
        tenantApp.use(
          createContextMiddleware(container, {
            getTenantId: (req) => req.headers['x-tenant-id'] as string,
          })
        );
        const router = express.Router();
        registerExecutionRoutes(router);
        tenantApp.use(router);
        tenantApp.use(createErrorHandler());

        // Create execution for tenant-a
        const execution = createTestExecution({
          id: 'tenant-exec-123',
          tenantId: 'tenant-a',
        });
        await stateStore.save(execution);

        // Tenant-a can access
        const accessA = await request(tenantApp)
          .get('/api/executions/tenant-exec-123')
          .set('X-Tenant-ID', 'tenant-a');

        expect(accessA.status).toBe(200);

        // Tenant-b cannot access
        const accessB = await request(tenantApp)
          .get('/api/executions/tenant-exec-123')
          .set('X-Tenant-ID', 'tenant-b');

        expect(accessB.status).toBe(404);
      });
    });

    describe('POST /api/executions/:executionId/cancel', () => {
      it('cancels running execution', async () => {
        const { app, router, stateStore } = setupTestApp();
        registerExecutionRoutes(router);
        app.use(router);
        app.use(createErrorHandler());

        // Create a running execution
        const execution = createTestExecution({
          id: 'exec-to-cancel',
          status: 'running',
        });
        await stateStore.save(execution);

        const response = await request(app)
          .post('/api/executions/exec-to-cancel/cancel')
          .send({ reason: 'Test cancellation' });

        expect(response.status).toBe(200);
        expect(response.body.status).toBe('cancelled');
        expect(response.body.executionId).toBe('exec-to-cancel');
      });

      it('returns 400 for completed execution', async () => {
        const { app, router, stateStore } = setupTestApp();
        registerExecutionRoutes(router);
        app.use(router);
        app.use(createErrorHandler());

        // Create a completed execution
        const execution = createTestExecution({
          id: 'exec-completed',
          status: 'completed',
        });
        await stateStore.save(execution);

        const response = await request(app)
          .post('/api/executions/exec-completed/cancel')
          .send({});

        expect(response.status).toBe(400);
        expect(response.body.error.code).toBe('CANNOT_CANCEL');
      });

      it('returns 400 for already cancelled execution', async () => {
        const { app, router, stateStore } = setupTestApp();
        registerExecutionRoutes(router);
        app.use(router);
        app.use(createErrorHandler());

        const execution = createTestExecution({
          id: 'exec-already-cancelled',
          status: 'cancelled',
        });
        await stateStore.save(execution);

        const response = await request(app)
          .post('/api/executions/exec-already-cancelled/cancel')
          .send({});

        expect(response.status).toBe(400);
        expect(response.body.error.code).toBe('CANNOT_CANCEL');
      });

      it('returns 404 for unknown execution', async () => {
        const { app, router } = setupTestApp();
        registerExecutionRoutes(router);
        app.use(router);
        app.use(createErrorHandler());

        const response = await request(app)
          .post('/api/executions/unknown-id/cancel')
          .send({});

        expect(response.status).toBe(404);
        expect(response.body.error.code).toBe('EXECUTION_NOT_FOUND');
      });

      it('records cancellation reason', async () => {
        const { app, router, stateStore } = setupTestApp();
        registerExecutionRoutes(router);
        app.use(router);
        app.use(createErrorHandler());

        const execution = createTestExecution({
          id: 'exec-with-reason',
          status: 'waiting',
        });
        await stateStore.save(execution);

        await request(app)
          .post('/api/executions/exec-with-reason/cancel')
          .send({ reason: 'User requested cancellation' });

        const savedExecution = stateStore._executions.get('exec-with-reason');
        expect(savedExecution?.cancellation?.reason).toBe('User requested cancellation');
        expect(savedExecution?.cancellation?.source).toBe('user');
      });
    });
  });
});
