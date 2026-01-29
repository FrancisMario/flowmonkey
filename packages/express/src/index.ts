/**
 * @flowmonkey/express - Express integration for FlowMonkey workflows.
 *
 * This package provides a simple way to integrate FlowMonkey into an Express
 * application with minimal configuration.
 *
 * @example
 * ```typescript
 * import express from 'express';
 * import { Pool } from 'pg';
 * import { FlowMonkeyExpress } from '@flowmonkey/express';
 * import { httpHandler, delayHandler } from '@flowmonkey/handlers';
 *
 * const app = express();
 * app.use(express.json());
 *
 * const pool = new Pool({ connectionString: process.env.DATABASE_URL });
 *
 * const flowmonkey = await FlowMonkeyExpress.builder()
 *   .app(app)
 *   .database(pool)
 *   .handler(httpHandler)
 *   .handler(delayHandler)
 *   .flow({
 *     id: 'my-workflow',
 *     name: 'My Workflow',
 *     steps: [
 *       { id: 'step1', type: 'http', config: { url: 'https://api.example.com' } }
 *     ]
 *   })
 *   .context({
 *     getTenantId: (req) => req.headers['x-tenant-id'] as string,
 *     getUserId: (req) => req.user?.id,
 *   })
 *   .build();
 *
 * // Routes are automatically registered:
 * // POST /api/flows/:flowId/start
 * // GET /api/executions/:executionId
 * // POST /api/executions/:executionId/cancel
 * // GET /api/admin/flows
 * // GET /api/admin/handlers
 * // GET /health
 * // GET /ready
 *
 * app.listen(3000, () => {
 *   console.log('FlowMonkey server running on port 3000');
 * });
 * ```
 */

// Main class
export { FlowMonkeyExpress, FlowMonkeyExpressBuilder } from './flowmonkey-express';
export type { FlowMonkeyExpressConfig } from './flowmonkey-express';

// Service container
export { ServiceContainer, type ServiceFactory } from './container';
export { ServiceTokens, type ServiceToken } from './tokens';

// Routes
export { Routes, buildRoute, DefaultRouteConfig } from './routes';
export type { RouteName, RoutePath, RouteConfig } from './routes';

// Middleware
export {
  createContextMiddleware,
  createErrorHandler,
  asyncHandler,
  requireFlowMonkeyContext,
  validateServices,
} from './middleware';
export type {
  FlowMonkeyContext,
  ContextMiddlewareOptions,
  ErrorResponse,
} from './middleware';

// Route handlers (for custom routing)
export {
  registerExecutionRoutes,
  registerResumeTokenRoutes,
  registerAdminRoutes,
  registerHealthRoutes,
} from './handlers';
export type { RouteHandlerOptions } from './handlers';
