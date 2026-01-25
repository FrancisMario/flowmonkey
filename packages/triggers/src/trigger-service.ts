import type { FlowRegistry, Engine } from '@flowmonkey/core';
import type { TriggerStore, TriggerResult, WakeSignaler } from './types';
import { handleTrigger, type RequestMeta } from './http-handler';
import { ScheduleRunner } from './schedule-runner';

/**
 * Options for TriggerService.
 */
export interface TriggerServiceOptions {
  triggerStore: TriggerStore;
  flowRegistry: FlowRegistry;
  engine: Engine;
  signals?: WakeSignaler;

  /** Path prefix for trigger endpoint (default: '/trigger') */
  basePath?: string;
  /** Schedule runner poll interval in ms (default: 60000) */
  scheduleIntervalMs?: number;
}

/**
 * Unified API for triggers.
 * Wraps HTTP handling and schedule running in one service.
 *
 * @example
 * ```typescript
 * const triggers = new TriggerService({
 *   triggerStore,
 *   flowRegistry,
 *   engine,
 *   signals,
 * });
 *
 * // Mount HTTP endpoint - framework detected internally
 * triggers.mount(app);
 *
 * // Start schedule runner
 * triggers.startScheduler();
 * ```
 */
export class TriggerService {
  private readonly store: TriggerStore;
  private readonly flows: FlowRegistry;
  private readonly engine: Engine;
  private readonly signals?: WakeSignaler;
  private readonly basePath: string;
  private readonly scheduleRunner: ScheduleRunner;

  constructor(options: TriggerServiceOptions) {
    this.store = options.triggerStore;
    this.flows = options.flowRegistry;
    this.engine = options.engine;
    this.signals = options.signals;
    this.basePath = options.basePath ?? '/trigger';

    this.scheduleRunner = new ScheduleRunner(
      {
        triggerStore: this.store,
        flowRegistry: this.flows,
        engine: this.engine,
        signals: this.signals,
      },
      { intervalMs: options.scheduleIntervalMs }
    );
  }

  /**
   * Mount the HTTP trigger endpoint on a server/app.
   * Auto-detects Express, Fastify, Hono, or Koa.
   *
   * @param app - Express app, Fastify instance, Hono app, or Koa app
   * @param options - Override basePath if needed
   */
  mount(app: unknown, options?: { basePath?: string }): void {
    const path = options?.basePath ?? this.basePath;

    if (this.isExpress(app)) {
      this.mountExpress(app, path);
    } else if (this.isFastify(app)) {
      this.mountFastify(app, path);
    } else if (this.isHono(app)) {
      this.mountHono(app, path);
    } else if (this.isKoa(app)) {
      this.mountKoa(app, path);
    } else {
      throw new Error(
        'Unsupported server type. Pass Express, Fastify, Hono, or Koa app.'
      );
    }
  }

  /**
   * Start the schedule runner (polls for due triggers).
   * Idempotent — calling multiple times has no effect.
   */
  startScheduler(): void {
    this.scheduleRunner.start();
  }

  /**
   * Stop the schedule runner gracefully.
   */
  stopScheduler(): void {
    this.scheduleRunner.stop();
  }

  /**
   * Stop all services (scheduler, etc).
   */
  async stop(): Promise<void> {
    this.stopScheduler();
  }

  /**
   * Direct access to handleTrigger for custom integrations.
   */
  async handleTrigger(
    triggerId: string,
    body: unknown,
    meta?: RequestMeta
  ): Promise<TriggerResult> {
    return handleTrigger(
      {
        triggerStore: this.store,
        flowRegistry: this.flows,
        engine: this.engine,
        signals: this.signals,
      },
      triggerId,
      body,
      meta ?? {}
    );
  }

  /**
   * Direct access to the schedule runner for testing/advanced use.
   */
  get scheduler(): ScheduleRunner {
    return this.scheduleRunner;
  }

  /**
   * Get the configured base path.
   */
  getBasePath(): string {
    return this.basePath;
  }

  // --- Framework detection ---

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private isExpress(app: any): boolean {
    // Express has `use`, `get`, `post` methods and `_router`
    return (
      typeof app?.use === 'function' &&
      typeof app?.post === 'function' &&
      typeof app?.get === 'function' &&
      !this.isFastify(app) &&
      !this.isHono(app)
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private isFastify(app: any): boolean {
    // Fastify has `register`, `route`, and `version` property
    return (
      typeof app?.register === 'function' &&
      typeof app?.route === 'function' &&
      typeof app?.version === 'string'
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private isHono(app: any): boolean {
    // Hono instances have constructor name 'Hono'
    return app?.constructor?.name === 'Hono';
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private isKoa(app: any): boolean {
    // Koa has `use`, `context`, and `middleware` array
    return (
      typeof app?.use === 'function' &&
      Array.isArray(app?.middleware) &&
      app?.context !== undefined
    );
  }

  // --- Framework mounts ---

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private mountExpress(app: any, basePath: string): void {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    app.post(`${basePath}/:triggerId`, async (req: any, res: any) => {
      const result = await this.handleTrigger(req.params.triggerId, req.body, {
        headers: req.headers as Record<string, string>,
        ip: req.ip,
      });
      res.status(result.status).json(result.body);
    });
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
        return reply.status(result.status).send(result.body);
      }
    );
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
        ip:
          c.req.header('x-forwarded-for') ??
          c.req.raw?.socket?.remoteAddress,
      });

      return c.json(result.body, result.status);
    });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private mountKoa(app: any, basePath: string): void {
    // For Koa, we need a router. We'll add a simple middleware.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    app.use(async (ctx: any, next: any) => {
      const pathPattern = new RegExp(`^${basePath}/([^/]+)$`);
      const match = ctx.path.match(pathPattern);

      if (ctx.method === 'POST' && match) {
        const triggerId = match[1];
        const result = await this.handleTrigger(triggerId, ctx.request.body, {
          headers: ctx.headers as Record<string, string>,
          ip: ctx.ip,
        });

        ctx.status = result.status;
        ctx.body = result.body;
      } else {
        await next();
      }
    });
  }
}
