/**
 * Express middleware for FlowMonkey.
 */

import type { Request, Response, NextFunction, RequestHandler } from 'express';
import type { ServiceContainer } from './container';
import { ServiceTokens } from './tokens';

/**
 * Context attached to Express requests.
 */
export interface FlowMonkeyContext {
  /** Service container for accessing FlowMonkey services */
  container: ServiceContainer;
  /** Tenant ID (if multi-tenant) */
  tenantId?: string;
  /** User ID (if authenticated) */
  userId?: string;
  /** Request metadata */
  metadata: Record<string, unknown>;
}

// Extend Express Request type
declare global {
  namespace Express {
    interface Request {
      flowmonkey?: FlowMonkeyContext;
    }
  }
}

/**
 * Options for FlowMonkey context middleware.
 */
export interface ContextMiddlewareOptions {
  /** Extract tenant ID from request */
  getTenantId?: (req: Request) => string | undefined;
  /** Extract user ID from request */
  getUserId?: (req: Request) => string | undefined;
  /** Extract additional metadata */
  getMetadata?: (req: Request) => Record<string, unknown>;
}

/**
 * Create middleware that attaches FlowMonkey context to requests.
 */
export function createContextMiddleware(
  container: ServiceContainer,
  options: ContextMiddlewareOptions = {}
): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    req.flowmonkey = {
      container,
      tenantId: options.getTenantId?.(req),
      userId: options.getUserId?.(req),
      metadata: options.getMetadata?.(req) ?? {},
    };
    next();
  };
}

/**
 * Error response format.
 */
export interface ErrorResponse {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

/**
 * Create error handling middleware for FlowMonkey routes.
 */
export function createErrorHandler(): (
  err: Error,
  req: Request,
  res: Response,
  next: NextFunction
) => void {
  return (err: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error('FlowMonkey error:', err);

    // Check for known error types
    const errorResponse: ErrorResponse = {
      error: {
        code: 'INTERNAL_ERROR',
        message: err.message || 'An unexpected error occurred',
      },
    };

    // Handle specific error types
    if (err.name === 'ValidationError') {
      res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: err.message,
        },
      });
      return;
    }

    if (err.name === 'NotFoundError') {
      res.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: err.message,
        },
      });
      return;
    }

    if (err.name === 'UnauthorizedError') {
      res.status(401).json({
        error: {
          code: 'UNAUTHORIZED',
          message: err.message,
        },
      });
      return;
    }

    // Default to 500
    res.status(500).json(errorResponse);
  };
}

/**
 * Request validation helpers.
 */
export function requireFlowMonkeyContext(
  req: Request
): asserts req is Request & { flowmonkey: FlowMonkeyContext } {
  if (!req.flowmonkey) {
    const err = new Error('FlowMonkey context not attached. Did you forget the middleware?');
    err.name = 'ConfigurationError';
    throw err;
  }
}

/**
 * Async handler wrapper to catch errors.
 */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<void>
): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

/**
 * Validate that required services are registered.
 */
export function validateServices(container: ServiceContainer, tokens: symbol[]): void {
  const missing = tokens.filter(token => !container.has(token as typeof ServiceTokens[keyof typeof ServiceTokens]));
  if (missing.length > 0) {
    throw new Error(
      `Missing required services: ${missing.map(t => String(t)).join(', ')}`
    );
  }
}
