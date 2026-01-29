import { EventEmitter } from 'events';
import type { Engine } from '@flowmonkey/core';
import type {
  Trigger,
  TriggerStore,
  TriggerResult,
  WakeSignaler,
  CreateTrigger,
} from './types';
import { handleTrigger, clearSchemaCache, type RequestMeta } from './http-handler';
import { ScheduleRunner } from './schedule-runner';

// Re-export for convenience
export { clearSchemaCache };

/**
 * HTTP adapter configuration.
 */
export interface HttpAdapterConfig {
  /** Express, Fastify, Hono, or Koa app instance */
  app: unknown;
  /** Framework type */
  framework: 'express' | 'fastify' | 'hono' | 'koa';
  /** Base path for trigger endpoints (default: '/triggers') */
  basePath?: string;
  /** Middleware to apply to all trigger routes */
  middleware?: unknown[];
  /** Custom response formatter */
  formatResponse?: (result: FireResult) => unknown;
  /** Custom error formatter */
  formatError?: (error: Error) => unknown;
  /** Enable GET /:triggerId info endpoint (default: false) */
  infoEndpoint?: boolean;
}

/**
 * Schedule adapter configuration.
 */
export interface ScheduleAdapterConfig {
  /** Enable the scheduler */
  enabled: boolean;
  /** Poll interval in ms (default: 60000) */
  checkInterval?: number;
  /** Default timezone (default: 'UTC') */
  timezone?: string;
}

/**
 * TriggerService configuration options.
 */
export interface TriggerServiceConfig {
  /** HTTP adapter for webhook triggers */
  http?: HttpAdapterConfig;
  /** Schedule adapter for cron triggers */
  schedule?: ScheduleAdapterConfig;
  /** Optional wake signaler for notifying workers */
  signals?: WakeSignaler;
}

/**
 * Result from firing a trigger.
 */
export interface FireResult {
  executionId: string;
  triggerId: string;
  flowId: string;
  firedAt: number;
}

/**
 * Filter options for listing triggers.
 */
export interface TriggerFilter {
  flowId?: string;
  type?: 'http' | 'schedule';
  enabled?: boolean;
}

/**
 * Events emitted by TriggerService.
 */
export interface TriggerServiceEvents {
  fired: { triggerId: string; executionId: string; flowId: string; duration: number };
  error: { triggerId: string; error: { code: string; message: string } };
  registered: { triggerId: string; type: 'http' | 'schedule' };
  deleted: { triggerId: string };
}

/**
 * Unified API for trigger management and execution.
 *
 * @example
 * ```typescript
 * const triggers = new TriggerService(store, engine, {
 *   http: { app, framework: 'express', basePath: '/webhooks' },
 *   schedule: { enabled: true },
 * });
 *
 * await triggers.register({
 *   id: 'my-webhook',
 *   type: 'http',
 *   name: 'My Webhook',
 *   flowId: 'my-flow',
 *   enabled: true,
 *   inputSchema: { type: 'object' },
 *   contextKey: 'payload',
 * });
 * ```
 */
export class TriggerService extends EventEmitter {
  private readonly store: TriggerStore;
  private readonly engine: Engine;
  private readonly signals?: WakeSignaler;
  private readonly httpConfig?: HttpAdapterConfig;
  private readonly scheduleConfig?: ScheduleAdapterConfig;
  private readonly scheduleRunner?: ScheduleRunner;
  private httpMounted = false;

  constructor(
    store: TriggerStore,
    engine: Engine,
    config?: TriggerServiceConfig
  ) {
    super();
    this.store = store;
    this.engine = engine;
    this.signals = config?.signals;
    this.httpConfig = config?.http;
    this.scheduleConfig = config?.schedule;

    // Mount HTTP routes if app provided
    if (this.httpConfig?.app) {
      this.mountHttpRoutes();
    }

    // Create and optionally start schedule runner
    if (this.scheduleConfig) {
      this.scheduleRunner = new ScheduleRunner(
        {
          triggerStore: this.store,
          flowRegistry: this.engine.flows,
          engine: this.engine,
          signals: this.signals,
        },
        { intervalMs: this.scheduleConfig.checkInterval }
      );

      if (this.scheduleConfig.enabled) {
        this.scheduleRunner.start();
      }
    }
  }

  /**
   * Register a new trigger.
   * Auto-registers routes for HTTP triggers and schedules for cron triggers.
   */
  async register(trigger: Trigger | (CreateTrigger & { id: string })): Promise<void> {
    // Check if trigger with this ID already exists
    const existing = await this.store.get(trigger.id);
    if (existing) {
      throw new Error(`Trigger '${trigger.id}' already exists`);
    }

    // Warn if registering HTTP trigger without HTTP adapter
    if (trigger.type === 'http' && !this.httpConfig?.app) {
      console.warn(
        `Warning: HTTP trigger '${trigger.id}' registered but no HTTP adapter configured.\n` +
        `         Trigger endpoint will not be accessible.\n` +
        `         To fix: Pass { http: { app, framework } } to TriggerService constructor.`
      );
    }

    // Warn if registering schedule trigger without scheduler
    if (trigger.type === 'schedule' && !this.scheduleConfig?.enabled) {
      console.warn(
        `Warning: Schedule trigger '${trigger.id}' registered but scheduler not enabled.\n` +
        `         Trigger will never fire.\n` +
        `         To fix: Pass { schedule: { enabled: true } } to TriggerService constructor.`
      );
    }

    // Create trigger in store (store will handle ID generation if needed)
    const createData = this.toCreateTrigger(trigger);
    await this.store.create(createData);

    // Clear schema cache to pick up new trigger
    clearSchemaCache();

    this.emit('registered', { triggerId: trigger.id, type: trigger.type });
  }

  /**
   * Update a trigger.
   */
  async update(id: string, updates: Partial<Trigger>): Promise<void> {
    const result = await this.store.update(id, updates);
    if (!result) {
      throw new Error(`Trigger '${id}' not found`);
    }

    // Clear schema cache in case inputSchema changed
    clearSchemaCache();
  }

  /**
   * Delete a trigger.
   */
  async delete(id: string): Promise<void> {
    const deleted = await this.store.delete(id);
    if (!deleted) {
      throw new Error(`Trigger '${id}' not found`);
    }

    clearSchemaCache();
    this.emit('deleted', { triggerId: id });
  }

  /**
   * Get a trigger by ID.
   */
  async get(id: string): Promise<Trigger | undefined> {
    const trigger = await this.store.get(id);
    return trigger ?? undefined;
  }

  /**
   * List triggers with optional filter.
   */
  async list(filter?: TriggerFilter): Promise<Trigger[]> {
    return this.store.list(filter);
  }

  /**
   * Fire a trigger programmatically.
   */
  async fire(triggerId: string, payload: unknown): Promise<FireResult> {
    const startTime = Date.now();
    const trigger = await this.store.get(triggerId);

    if (!trigger) {
      throw new Error(`Trigger '${triggerId}' not found`);
    }

    if (!trigger.enabled) {
      throw new Error(`Trigger '${triggerId}' is disabled`);
    }

    const flow = this.engine.flows.get(trigger.flowId);
    if (!flow) {
      throw new Error(`Flow '${trigger.flowId}' not found`);
    }

    // Build context based on trigger type
    let context: Record<string, unknown>;
    if (trigger.type === 'http') {
      context = { [trigger.contextKey]: payload };
    } else {
      context = { ...trigger.staticContext, ...(payload as Record<string, unknown> ?? {}) };
    }

    const result = await this.engine.create(trigger.flowId, context);
    const executionId = result.execution.id;

    // Signal worker if available
    if (this.signals) {
      await this.signals.signal(executionId);
    }

    const duration = Date.now() - startTime;
    const fireResult: FireResult = {
      executionId,
      triggerId,
      flowId: trigger.flowId,
      firedAt: startTime,
    };

    this.emit('fired', { triggerId, executionId, flowId: trigger.flowId, duration });

    return fireResult;
  }

  /**
   * Enable a trigger.
   */
  async enable(id: string): Promise<void> {
    await this.update(id, { enabled: true });
  }

  /**
   * Disable a trigger.
   */
  async disable(id: string): Promise<void> {
    await this.update(id, { enabled: false });
  }

  /**
   * Graceful shutdown.
   */
  async shutdown(): Promise<void> {
    if (this.scheduleRunner) {
      this.scheduleRunner.stop();
    }
  }

  /**
   * Health check.
   */
  async isHealthy(): Promise<boolean> {
    try {
      // Try to list triggers as a basic health check
      await this.store.list({ enabled: true });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Handle an HTTP trigger request directly (for custom integrations).
   */
  async handleTrigger(
    triggerId: string,
    body: unknown,
    meta?: RequestMeta
  ): Promise<TriggerResult> {
    const result = await handleTrigger(
      {
        triggerStore: this.store,
        flowRegistry: this.engine.flows,
        engine: this.engine,
        signals: this.signals,
      },
      triggerId,
      body,
      meta ?? {}
    );

    // Emit events based on result
    if (result.status === 201 && result.body && typeof result.body === 'object' && 'executionId' in result.body) {
      const trigger = await this.store.get(triggerId);
      if (trigger) {
        this.emit('fired', {
          triggerId,
          executionId: (result.body as { executionId: string }).executionId,
          flowId: trigger.flowId,
          duration: 0, // Not tracked in handleTrigger
        });
      }
    } else if (result.status >= 400) {
      this.emit('error', {
        triggerId,
        error: {
          code: result.status === 400 ? 'VALIDATION_ERROR' : 'TRIGGER_ERROR',
          message: (result.body as { error?: string })?.error ?? 'Unknown error',
        },
      });
    }

    return result;
  }

  /**
   * Get the schedule runner (for testing/advanced use).
   */
  get scheduler(): ScheduleRunner | undefined {
    return this.scheduleRunner;
  }

  // --- Private helpers ---

  private toCreateTrigger(trigger: Trigger | (CreateTrigger & { id: string })): CreateTrigger {
    // Keep id (optional in CreateTrigger), strip out createdAt/updatedAt
    const { createdAt: _createdAt, updatedAt: _updatedAt, ...rest } = trigger as Trigger;
    return rest as CreateTrigger;
  }

  private mountHttpRoutes(): void {
    if (this.httpMounted || !this.httpConfig?.app) return;

    const app = this.httpConfig.app;
    const basePath = this.httpConfig.basePath ?? '/triggers';
    const framework = this.httpConfig.framework;

    switch (framework) {
      case 'express':
        this.mountExpress(app, basePath);
        break;
      case 'fastify':
        this.mountFastify(app, basePath);
        break;
      case 'hono':
        this.mountHono(app, basePath);
        break;
      case 'koa':
        this.mountKoa(app, basePath);
        break;
      default:
        throw new Error(`Unsupported framework: ${framework}`);
    }

    this.httpMounted = true;
  }

  private formatSuccessResponse(result: TriggerResult): unknown {
    if (this.httpConfig?.formatResponse && result.status === 201) {
      const body = result.body as { executionId: string };
      return this.httpConfig.formatResponse({
        executionId: body.executionId,
        triggerId: '', // Will be filled by caller
        flowId: '', // Will be filled by caller
        firedAt: Date.now(),
      });
    }
    return result.body;
  }

  private formatErrorResponse(result: TriggerResult): unknown {
    if (this.httpConfig?.formatError && result.status >= 400) {
      const body = result.body as { error?: string };
      return this.httpConfig.formatError(new Error(body?.error ?? 'Unknown error'));
    }
    return result.body;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private mountExpress(app: any, basePath: string): void {
    const middleware = this.httpConfig?.middleware ?? [];

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    app.post(`${basePath}/:triggerId`, ...middleware, async (req: any, res: any) => {
      const result = await this.handleTrigger(req.params.triggerId, req.body, {
        headers: req.headers as Record<string, string>,
        ip: req.ip,
      });

      const body = result.status >= 400
        ? this.formatErrorResponse(result)
        : this.formatSuccessResponse(result);

      res.status(result.status).json(body);
    });

    if (this.httpConfig?.infoEndpoint) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      app.get(`${basePath}/:triggerId`, ...middleware, async (req: any, res: any) => {
        const trigger = await this.store.get(req.params.triggerId);
        if (!trigger) {
          return res.status(404).json({ error: 'Trigger not found' });
        }
        res.json({
          id: trigger.id,
          name: trigger.name,
          type: trigger.type,
          enabled: trigger.enabled,
        });
      });
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private mountFastify(app: any, basePath: string): void {
    app.post(
      `${basePath}/:triggerId`,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      async (request: any, reply: any) => {
        const result = await this.handleTrigger(
          request.params.triggerId,
          request.body,
          {
            headers: request.headers as Record<string, string>,
            ip: request.ip,
          }
        );

        const body = result.status >= 400
          ? this.formatErrorResponse(result)
          : this.formatSuccessResponse(result);

        return reply.status(result.status).send(body);
      }
    );

    if (this.httpConfig?.infoEndpoint) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      app.get(`${basePath}/:triggerId`, async (request: any, reply: any) => {
        const trigger = await this.store.get(request.params.triggerId);
        if (!trigger) {
          return reply.status(404).send({ error: 'Trigger not found' });
        }
        return reply.send({
          id: trigger.id,
          name: trigger.name,
          type: trigger.type,
          enabled: trigger.enabled,
        });
      });
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private mountHono(app: any, basePath: string): void {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    app.post(`${basePath}/:triggerId`, async (c: any) => {
      const triggerId = c.req.param('triggerId');
      let body: unknown;
      try {
        body = await c.req.json();
      } catch {
        body = {};
      }

      const result = await this.handleTrigger(triggerId, body, {
        headers: Object.fromEntries(c.req.raw.headers),
        ip: c.req.header('x-forwarded-for') ?? c.req.raw?.socket?.remoteAddress,
      });

      const responseBody = result.status >= 400
        ? this.formatErrorResponse(result)
        : this.formatSuccessResponse(result);

      return c.json(responseBody, result.status);
    });

    if (this.httpConfig?.infoEndpoint) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      app.get(`${basePath}/:triggerId`, async (c: any) => {
        const triggerId = c.req.param('triggerId');
        const trigger = await this.store.get(triggerId);
        if (!trigger) {
          return c.json({ error: 'Trigger not found' }, 404);
        }
        return c.json({
          id: trigger.id,
          name: trigger.name,
          type: trigger.type,
          enabled: trigger.enabled,
        });
      });
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private mountKoa(app: any, basePath: string): void {
    const pathPattern = new RegExp(`^${basePath}/([^/]+)$`);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    app.use(async (ctx: any, next: any) => {
      const match = ctx.path.match(pathPattern);

      if (match) {
        const triggerId = match[1];

        if (ctx.method === 'POST') {
          const result = await this.handleTrigger(triggerId, ctx.request.body, {
            headers: ctx.headers as Record<string, string>,
            ip: ctx.ip,
          });

          ctx.status = result.status;
          ctx.body = result.status >= 400
            ? this.formatErrorResponse(result)
            : this.formatSuccessResponse(result);
          return;
        }

        if (ctx.method === 'GET' && this.httpConfig?.infoEndpoint) {
          const trigger = await this.store.get(triggerId);
          if (!trigger) {
            ctx.status = 404;
            ctx.body = { error: 'Trigger not found' };
            return;
          }
          ctx.body = {
            id: trigger.id,
            name: trigger.name,
            type: trigger.type,
            enabled: trigger.enabled,
          };
          return;
        }
      }

      await next();
    });
  }
}

// Legacy type alias for backwards compatibility
export type TriggerServiceOptions = TriggerServiceConfig;

