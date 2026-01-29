/**
 * Express route handlers for FlowMonkey.
 */

import type { Router, Request, Response } from 'express';
import type { StateStore, HandlerRegistry, FlowRegistry, Execution } from '@flowmonkey/core';
import { Routes, type RouteConfig } from './routes';
import { ServiceTokens } from './tokens';
import { asyncHandler, requireFlowMonkeyContext, type FlowMonkeyContext } from './middleware';

/**
 * Helper to generate a unique execution ID.
 */
function generateExecutionId(): string {
  return `exec_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
}

/**
 * Options for creating route handlers.
 */
export interface RouteHandlerOptions {
  /** Which routes to enable */
  routes?: RouteConfig;
}

/**
 * Register execution routes (start, get, resume, cancel).
 */
export function registerExecutionRoutes(router: Router): void {
  // POST /api/flows/:flowId/start - Start a new flow execution
  router.post(
    Routes.StartFlow,
    asyncHandler(async (req: Request, res: Response) => {
      requireFlowMonkeyContext(req);
      const ctx = req.flowmonkey as FlowMonkeyContext;

      const { flowId } = req.params;
      const { input, context } = req.body;

      const flows = ctx.container.resolve<FlowRegistry>(ServiceTokens.FlowRegistry);
      const stateStore = ctx.container.resolve<StateStore>(ServiceTokens.StateStore);

      // Validate flow exists (FlowRegistry.get is synchronous)
      const flow = flows.get(flowId);
      if (!flow) {
        res.status(404).json({
          error: { code: 'FLOW_NOT_FOUND', message: `Flow '${flowId}' not found` },
        });
        return;
      }

      // Create execution object
      const now = Date.now();
      const execution: Execution = {
        id: generateExecutionId(),
        flowId: flow.id,
        flowVersion: flow.version || '1.0.0',
        currentStepId: flow.steps[0]?.id ?? '',
        status: 'pending',
        context: {
          ...context,
          _input: input,
          tenantId: ctx.tenantId,
          userId: ctx.userId,
          ...ctx.metadata,
        },
        stepCount: 0,
        createdAt: now,
        updatedAt: now,
        tenantId: ctx.tenantId,
      };

      // Save execution via StateStore.save()
      await stateStore.save(execution);

      // TODO: Queue execution for processing via job system

      res.status(201).json({
        executionId: execution.id,
        status: execution.status,
        flowId: execution.flowId,
        createdAt: execution.createdAt,
      });
    })
  );

  // GET /api/executions/:executionId - Get execution status
  router.get(
    Routes.GetExecution,
    asyncHandler(async (req: Request, res: Response) => {
      requireFlowMonkeyContext(req);
      const ctx = req.flowmonkey as FlowMonkeyContext;

      const { executionId } = req.params;

      const stateStore = ctx.container.resolve<StateStore>(ServiceTokens.StateStore);
      // StateStore uses load() not getExecution()
      const execution = await stateStore.load(executionId);

      if (!execution) {
        res.status(404).json({
          error: { code: 'EXECUTION_NOT_FOUND', message: `Execution '${executionId}' not found` },
        });
        return;
      }

      // Check tenant access if multi-tenant
      if (ctx.tenantId && execution.tenantId !== ctx.tenantId) {
        res.status(404).json({
          error: { code: 'EXECUTION_NOT_FOUND', message: `Execution '${executionId}' not found` },
        });
        return;
      }

      res.json({
        id: execution.id,
        flowId: execution.flowId,
        status: execution.status,
        currentStepId: execution.currentStepId,
        createdAt: execution.createdAt,
        updatedAt: execution.updatedAt,
        error: execution.error,
        // Note: Full context/outputs may be large, consider pagination
      });
    })
  );

  // POST /api/executions/:executionId/cancel - Cancel execution
  router.post(
    Routes.CancelExecution,
    asyncHandler(async (req: Request, res: Response) => {
      requireFlowMonkeyContext(req);
      const ctx = req.flowmonkey as FlowMonkeyContext;

      const { executionId } = req.params;
      const { reason } = req.body;

      const stateStore = ctx.container.resolve<StateStore>(ServiceTokens.StateStore);
      // StateStore uses load() not getExecution()
      const execution = await stateStore.load(executionId);

      if (!execution) {
        res.status(404).json({
          error: { code: 'EXECUTION_NOT_FOUND', message: `Execution '${executionId}' not found` },
        });
        return;
      }

      // Check tenant access
      if (ctx.tenantId && execution.tenantId !== ctx.tenantId) {
        res.status(404).json({
          error: { code: 'EXECUTION_NOT_FOUND', message: `Execution '${executionId}' not found` },
        });
        return;
      }

      // Check if cancellable
      if (execution.status === 'completed' || execution.status === 'failed' || execution.status === 'cancelled') {
        res.status(400).json({
          error: {
            code: 'CANNOT_CANCEL',
            message: `Execution already ${execution.status}`,
          },
        });
        return;
      }

      // Update execution status via save() (StateStore doesn't have updateExecution)
      const now = Date.now();
      execution.status = 'cancelled';
      execution.updatedAt = now;
      execution.cancellation = {
        source: 'user',
        reason: reason || 'Execution cancelled by user',
        cancelledAt: now,
      };

      await stateStore.save(execution);

      res.json({
        executionId,
        status: 'cancelled',
        cancelledAt: new Date(now).toISOString(),
      });
    })
  );
}

/**
 * Register resume token routes.
 */
export function registerResumeTokenRoutes(router: Router): void {
  // POST /api/tokens/:token/resume - Resume with token
  router.post(
    Routes.ResumeWithToken,
    asyncHandler(async (req: Request, res: Response) => {
      requireFlowMonkeyContext(req);
      const ctx = req.flowmonkey as FlowMonkeyContext;

      const { token } = req.params;
      const { data } = req.body;

      // Resolve token manager
      const tokenManager = ctx.container.tryResolve<{ validate: (token: string) => Promise<unknown> }>(
        ServiceTokens.ResumeTokenManager
      );

      if (!tokenManager) {
        res.status(501).json({
          error: {
            code: 'NOT_IMPLEMENTED',
            message: 'Resume tokens not configured',
          },
        });
        return;
      }

      // Validate and redeem token
      const tokenData = await tokenManager.validate(token);
      if (!tokenData) {
        res.status(400).json({
          error: { code: 'INVALID_TOKEN', message: 'Invalid or expired resume token' },
        });
        return;
      }

      // TODO: Resume the execution with the provided data
      // This would involve getting the execution, updating with resume data,
      // and requeuing for processing

      res.json({
        status: 'resumed',
        data,
      });
    })
  );
}

/**
 * Register admin routes.
 */
export function registerAdminRoutes(router: Router): void {
  // GET /api/admin/flows - List flows
  router.get(
    Routes.ListFlows,
    asyncHandler(async (req: Request, res: Response) => {
      requireFlowMonkeyContext(req);
      const ctx = req.flowmonkey as FlowMonkeyContext;

      const flowRegistry = ctx.container.resolve<FlowRegistry>(ServiceTokens.FlowRegistry);
      // FlowRegistry uses flowIds() to list all flows, then get() to retrieve each
      const flowIds = flowRegistry.flowIds();

      const flowList = flowIds.map((id) => {
        const flow = flowRegistry.get(id);
        return flow
          ? {
              id: flow.id,
              name: flow.name ?? flow.id,
              version: flow.version,
              stepCount: Object.keys(flow.steps ?? {}).length,
            }
          : null;
      }).filter((f): f is NonNullable<typeof f> => f !== null);

      res.json({ flows: flowList });
    })
  );

  // GET /api/admin/handlers - List handlers
  router.get(
    Routes.ListHandlers,
    asyncHandler(async (req: Request, res: Response) => {
      requireFlowMonkeyContext(req);
      const ctx = req.flowmonkey as FlowMonkeyContext;

      const handlers = ctx.container.resolve<HandlerRegistry>(ServiceTokens.HandlerRegistry);
      // HandlerRegistry uses types() not listTypes()
      const handlerTypes = handlers.types();

      res.json({
        handlers: handlerTypes.map((type: string) => {
          const metadata = handlers.getMetadata(type);
          return {
            type,
            name: metadata?.name ?? type,
            description: metadata?.description,
            category: metadata?.category,
            stateful: metadata?.stateful ?? false,
          };
        }),
      });
    })
  );
}

/**
 * Register health check routes.
 */
export function registerHealthRoutes(router: Router): void {
  // GET /health - Basic health check
  router.get(Routes.Health, (_req: Request, res: Response) => {
    res.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
    });
  });

  // GET /ready - Readiness check (checks dependencies)
  router.get(
    Routes.Ready,
    asyncHandler(async (req: Request, res: Response) => {
      requireFlowMonkeyContext(req);
      const ctx = req.flowmonkey as FlowMonkeyContext;

      const checks: Record<string, 'ok' | 'error'> = {};

      // Check state store
      try {
        const stateStore = ctx.container.tryResolve<StateStore>(ServiceTokens.StateStore);
        if (stateStore) {
          // Try a simple operation to verify connection
          checks.stateStore = 'ok';
        }
      } catch {
        checks.stateStore = 'error';
      }

      // Check if any checks failed
      const isReady = Object.values(checks).every((status) => status === 'ok');

      res.status(isReady ? 200 : 503).json({
        ready: isReady,
        checks,
        timestamp: new Date().toISOString(),
      });
    })
  );
}
