/**
 * Type-safe route definitions for FlowMonkey Express integration.
 *
 * These enum-like constants define the routes that FlowMonkey uses.
 */

/**
 * API route definitions.
 */
export const Routes = {
  // ── Execution Routes ────────────────────────────────────────────────
  /**
   * POST /api/flows/:flowId/start
   * Start a new flow execution.
   */
  StartFlow: '/api/flows/:flowId/start',

  /**
   * GET /api/executions/:executionId
   * Get execution status and details.
   */
  GetExecution: '/api/executions/:executionId',

  /**
   * POST /api/executions/:executionId/resume/:stepId
   * Resume execution with a resume token.
   */
  ResumeExecution: '/api/executions/:executionId/resume/:stepId',

  /**
   * POST /api/executions/:executionId/cancel
   * Cancel a running execution.
   */
  CancelExecution: '/api/executions/:executionId/cancel',

  // ── Trigger Routes ──────────────────────────────────────────────────
  /**
   * POST /api/triggers/:triggerId
   * Receive trigger webhook/events.
   */
  Trigger: '/api/triggers/:triggerId',

  // ── Resume Token Routes ─────────────────────────────────────────────
  /**
   * POST /api/tokens/:token/resume
   * Resume execution using a resume token.
   */
  ResumeWithToken: '/api/tokens/:token/resume',

  // ── Admin Routes ────────────────────────────────────────────────────
  /**
   * GET /api/admin/flows
   * List all registered flows.
   */
  ListFlows: '/api/admin/flows',

  /**
   * GET /api/admin/handlers
   * List all registered handlers.
   */
  ListHandlers: '/api/admin/handlers',

  /**
   * GET /api/admin/executions
   * List executions with filtering.
   */
  ListExecutions: '/api/admin/executions',

  // ── Health Routes ───────────────────────────────────────────────────
  /**
   * GET /health
   * Health check endpoint.
   */
  Health: '/health',

  /**
   * GET /ready
   * Readiness check endpoint.
   */
  Ready: '/ready',
} as const;

export type RouteName = keyof typeof Routes;
export type RoutePath = (typeof Routes)[RouteName];

/**
 * Helper to build a route with parameters.
 *
 * @example
 * ```typescript
 * buildRoute(Routes.GetExecution, { executionId: '123' });
 * // => '/api/executions/123'
 * ```
 */
export function buildRoute(
  route: RoutePath,
  params: Record<string, string> = {}
): string {
  let result = route as string;
  for (const [key, value] of Object.entries(params)) {
    result = result.replace(`:${key}`, encodeURIComponent(value));
  }
  return result;
}

/**
 * Route configuration for enabling/disabling routes.
 */
export interface RouteConfig {
  /** Enable execution routes (start, get, resume, cancel) */
  executions?: boolean;
  /** Enable trigger routes */
  triggers?: boolean;
  /** Enable resume token routes */
  resumeTokens?: boolean;
  /** Enable admin routes (list flows, handlers, executions) */
  admin?: boolean;
  /** Enable health check routes */
  health?: boolean;
}

/**
 * Default route configuration - all enabled.
 */
export const DefaultRouteConfig: RouteConfig = {
  executions: true,
  triggers: true,
  resumeTokens: true,
  admin: true,
  health: true,
};
