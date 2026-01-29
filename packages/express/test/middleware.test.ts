/**
 * Tests for Express middleware.
 */

import { describe, it, expect, vi } from 'vitest';
import express, { type Express, type Request, type Response } from 'express';
import request from 'supertest';
import {
  createContextMiddleware,
  createErrorHandler,
  asyncHandler,
  requireFlowMonkeyContext,
} from '../src/middleware';
import { ServiceContainer } from '../src/container';
import { ServiceTokens } from '../src/tokens';
import { createMockStateStore } from './fixtures';

function createTestApp(): Express {
  const app = express();
  app.use(express.json());
  return app;
}

describe('Middleware', () => {
  describe('createContextMiddleware', () => {
    it('attaches flowmonkey context to request', async () => {
      const app = createTestApp();
      const container = new ServiceContainer();

      app.use(createContextMiddleware(container));

      app.get('/test', (req: Request, res: Response) => {
        res.json({
          hasContext: !!req.flowmonkey,
          hasContainer: !!req.flowmonkey?.container,
        });
      });

      const response = await request(app).get('/test');

      expect(response.status).toBe(200);
      expect(response.body.hasContext).toBe(true);
      expect(response.body.hasContainer).toBe(true);
    });

    it('extracts tenant ID using getTenantId option', async () => {
      const app = createTestApp();
      const container = new ServiceContainer();

      app.use(
        createContextMiddleware(container, {
          getTenantId: (req) => req.headers['x-tenant-id'] as string,
        })
      );

      app.get('/test', (req: Request, res: Response) => {
        res.json({ tenantId: req.flowmonkey?.tenantId });
      });

      const response = await request(app)
        .get('/test')
        .set('X-Tenant-ID', 'tenant-abc');

      expect(response.body.tenantId).toBe('tenant-abc');
    });

    it('extracts user ID using getUserId option', async () => {
      const app = createTestApp();
      const container = new ServiceContainer();

      app.use(
        createContextMiddleware(container, {
          getUserId: (req) => req.headers['x-user-id'] as string,
        })
      );

      app.get('/test', (req: Request, res: Response) => {
        res.json({ userId: req.flowmonkey?.userId });
      });

      const response = await request(app)
        .get('/test')
        .set('X-User-ID', 'user-123');

      expect(response.body.userId).toBe('user-123');
    });

    it('extracts metadata using getMetadata option', async () => {
      const app = createTestApp();
      const container = new ServiceContainer();

      app.use(
        createContextMiddleware(container, {
          getMetadata: (req) => ({
            userAgent: req.headers['user-agent'],
            custom: 'value',
          }),
        })
      );

      app.get('/test', (req: Request, res: Response) => {
        res.json({ metadata: req.flowmonkey?.metadata });
      });

      const response = await request(app)
        .get('/test')
        .set('User-Agent', 'test-agent');

      expect(response.body.metadata.custom).toBe('value');
      expect(response.body.metadata.userAgent).toBe('test-agent');
    });

    it('provides empty metadata by default', async () => {
      const app = createTestApp();
      const container = new ServiceContainer();

      app.use(createContextMiddleware(container));

      app.get('/test', (req: Request, res: Response) => {
        res.json({ metadata: req.flowmonkey?.metadata });
      });

      const response = await request(app).get('/test');

      expect(response.body.metadata).toEqual({});
    });
  });

  describe('createErrorHandler', () => {
    it('handles errors with 500 status', async () => {
      const app = createTestApp();

      app.get('/error', () => {
        throw new Error('Test error');
      });

      app.use(createErrorHandler());

      const response = await request(app).get('/error');

      expect(response.status).toBe(500);
      expect(response.body.error.code).toBe('INTERNAL_ERROR');
      expect(response.body.error.message).toBe('Test error');
    });

    it('handles ValidationError with 400 status', async () => {
      const app = createTestApp();

      app.get('/error', () => {
        const err = new Error('Invalid input');
        err.name = 'ValidationError';
        throw err;
      });

      app.use(createErrorHandler());

      const response = await request(app).get('/error');

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('handles NotFoundError with 404 status', async () => {
      const app = createTestApp();

      app.get('/error', () => {
        const err = new Error('Resource not found');
        err.name = 'NotFoundError';
        throw err;
      });

      app.use(createErrorHandler());

      const response = await request(app).get('/error');

      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe('NOT_FOUND');
    });

    it('handles UnauthorizedError with 401 status', async () => {
      const app = createTestApp();

      app.get('/error', () => {
        const err = new Error('Not authorized');
        err.name = 'UnauthorizedError';
        throw err;
      });

      app.use(createErrorHandler());

      const response = await request(app).get('/error');

      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe('UNAUTHORIZED');
    });
  });

  describe('asyncHandler', () => {
    it('catches async errors and forwards to error handler', async () => {
      const app = createTestApp();

      app.get(
        '/async-error',
        asyncHandler(async () => {
          throw new Error('Async error');
        })
      );

      app.use(createErrorHandler());

      const response = await request(app).get('/async-error');

      expect(response.status).toBe(500);
      expect(response.body.error.message).toBe('Async error');
    });

    it('passes through successful responses', async () => {
      const app = createTestApp();

      app.get(
        '/async-success',
        asyncHandler(async (_req: Request, res: Response) => {
          res.json({ success: true });
        })
      );

      const response = await request(app).get('/async-success');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });

    it('handles promises that resolve', async () => {
      const app = createTestApp();

      app.get(
        '/async-delay',
        asyncHandler(async (_req: Request, res: Response) => {
          await new Promise((resolve) => setTimeout(resolve, 10));
          res.json({ delayed: true });
        })
      );

      const response = await request(app).get('/async-delay');

      expect(response.status).toBe(200);
      expect(response.body.delayed).toBe(true);
    });
  });

  describe('requireFlowMonkeyContext', () => {
    it('throws if context is missing', () => {
      const req = {} as Request;

      expect(() => requireFlowMonkeyContext(req)).toThrow(
        'FlowMonkey context not attached'
      );
    });

    it('passes if context is present', () => {
      const container = new ServiceContainer();
      const req = {
        flowmonkey: {
          container,
          metadata: {},
        },
      } as Request;

      expect(() => requireFlowMonkeyContext(req)).not.toThrow();
    });
  });
});
