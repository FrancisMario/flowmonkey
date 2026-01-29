/**
 * FlowMonkeyExpress - Main integration class for Express applications.
 *
 * Provides a simple way to integrate FlowMonkey into an Express application
 * with minimal configuration.
 */

import type { Application, Router, RequestHandler } from 'express';
import type { Pool } from 'pg';
import type {
  Engine,
  FlowRegistry,
  HandlerRegistry,
  EventBus,
  StepHandler,
  Flow,
  StateStore,
  VaultProvider,
} from '@flowmonkey/core';
import { ServiceContainer } from './container';
import { ServiceTokens } from './tokens';
import {
  createContextMiddleware,
  createErrorHandler,
  type ContextMiddlewareOptions,
} from './middleware';
import {
  registerExecutionRoutes,
  registerResumeTokenRoutes,
  registerAdminRoutes,
  registerHealthRoutes,
} from './handlers';
import { type RouteConfig, DefaultRouteConfig } from './routes';

/**
 * Configuration for FlowMonkeyExpress.
 */
export interface FlowMonkeyExpressConfig {
  /**
   * Express application instance.
   */
  app: Application;

  /**
   * PostgreSQL connection pool (required for production).
   */
  database?: Pool;

  /**
   * Custom state store implementation.
   * If not provided, will use PgExecutionStore with database pool.
   */
  stateStore?: StateStore;

  /**
   * Custom handler registry.
   * If not provided, will create a default registry.
   */
  handlerRegistry?: HandlerRegistry;

  /**
   * Custom flow registry.
   * If not provided, will create a default registry.
   */
  flowRegistry?: FlowRegistry;

  /**
   * Custom event bus.
   * If not provided, will create a default event bus.
   */
  eventBus?: EventBus;

  /**
   * Custom vault provider.
   * If not provided, will use NoopVaultProvider.
   */
  vaultProvider?: VaultProvider;

  /**
   * Route configuration.
   */
  routes?: RouteConfig;

  /**
   * Context middleware options.
   */
  context?: ContextMiddlewareOptions;

  /**
   * Route prefix (default: '').
   */
  prefix?: string;

  /**
   * Additional middleware to apply before FlowMonkey routes.
   */
  middleware?: RequestHandler[];

  /**
   * Lifecycle hooks.
   */
  hooks?: {
    /** Called before container is fully configured */
    onContainerReady?: (container: ServiceContainer) => void | Promise<void>;
    /** Called after routes are registered */
    onRoutesRegistered?: (app: Application) => void | Promise<void>;
    /** Called when an execution starts */
    onExecutionStart?: (executionId: string) => void;
    /** Called when an execution completes */
    onExecutionComplete?: (executionId: string, success: boolean) => void;
  };
}

/**
 * Builder for FlowMonkeyExpress configuration.
 */
export class FlowMonkeyExpressBuilder {
  private config: Partial<FlowMonkeyExpressConfig> = {};
  private handlers: Array<StepHandler | { type: string; handler: StepHandler }> = [];
  private flows: Flow[] = [];

  /**
   * Set the Express application.
   */
  app(app: Application): this {
    this.config.app = app;
    return this;
  }

  /**
   * Set the database pool.
   */
  database(pool: Pool): this {
    this.config.database = pool;
    return this;
  }

  /**
   * Set custom state store.
   */
  stateStore(store: StateStore): this {
    this.config.stateStore = store;
    return this;
  }

  /**
   * Set custom handler registry.
   */
  handlerRegistry(registry: HandlerRegistry): this {
    this.config.handlerRegistry = registry;
    return this;
  }

  /**
   * Set custom flow registry.
   */
  flowRegistry(registry: FlowRegistry): this {
    this.config.flowRegistry = registry;
    return this;
  }

  /**
   * Set custom event bus.
   */
  eventBus(bus: EventBus): this {
    this.config.eventBus = bus;
    return this;
  }

  /**
   * Set vault provider.
   */
  vault(provider: VaultProvider): this {
    this.config.vaultProvider = provider;
    return this;
  }

  /**
   * Configure routes.
   */
  routes(config: RouteConfig): this {
    this.config.routes = config;
    return this;
  }

  /**
   * Set route prefix.
   */
  prefix(prefix: string): this {
    this.config.prefix = prefix;
    return this;
  }

  /**
   * Add middleware.
   */
  use(...middleware: RequestHandler[]): this {
    this.config.middleware = [...(this.config.middleware ?? []), ...middleware];
    return this;
  }

  /**
   * Configure context extraction.
   */
  context(options: ContextMiddlewareOptions): this {
    this.config.context = options;
    return this;
  }

  /**
   * Add a handler.
   */
  handler(handler: StepHandler): this {
    this.handlers.push(handler);
    return this;
  }

  /**
   * Add a flow.
   */
  flow(flow: Flow): this {
    this.flows.push(flow);
    return this;
  }

  /**
   * Add lifecycle hooks.
   */
  hooks(hooks: FlowMonkeyExpressConfig['hooks']): this {
    this.config.hooks = { ...this.config.hooks, ...hooks };
    return this;
  }

  /**
   * Build the FlowMonkeyExpress instance.
   */
  async build(): Promise<FlowMonkeyExpress> {
    if (!this.config.app) {
      throw new Error('Express app is required. Call .app(expressApp) first.');
    }

    const instance = new FlowMonkeyExpress(this.config as FlowMonkeyExpressConfig);

    // Register handlers
    for (const h of this.handlers) {
      if ('type' in h && 'handler' in h) {
        instance.registerHandler(h.handler);
      } else {
        instance.registerHandler(h as StepHandler);
      }
    }

    // Register flows
    for (const flow of this.flows) {
      await instance.registerFlow(flow);
    }

    return instance;
  }
}

/**
 * FlowMonkeyExpress - Main integration class.
 *
 * @example
 * ```typescript
 * import express from 'express';
 * import { Pool } from 'pg';
 * import { FlowMonkeyExpress } from '@flowmonkey/express';
 *
 * const app = express();
 * const pool = new Pool({ connectionString: process.env.DATABASE_URL });
 *
 * const flowmonkey = await FlowMonkeyExpress.builder()
 *   .app(app)
 *   .database(pool)
 *   .handler(httpHandler)
 *   .flow(myWorkflow)
 *   .build();
 *
 * // Routes are automatically registered
 * app.listen(3000);
 * ```
 */
export class FlowMonkeyExpress {
  private container: ServiceContainer;
  private app: Application;
  private config: FlowMonkeyExpressConfig;
  private _initialized = false;

  constructor(config: FlowMonkeyExpressConfig) {
    this.config = {
      ...config,
      routes: { ...DefaultRouteConfig, ...config.routes },
    };
    this.app = config.app;
    this.container = new ServiceContainer();

    this.setupContainer();
    this.setupRoutes();
  }

  /**
   * Check if FlowMonkey is initialized.
   */
  get isInitialized(): boolean {
    return this._initialized;
  }

  /**
   * Create a builder for configuring FlowMonkeyExpress.
   */
  static builder(): FlowMonkeyExpressBuilder {
    return new FlowMonkeyExpressBuilder();
  }

  /**
   * Get the service container.
   */
  getContainer(): ServiceContainer {
    return this.container;
  }

  /**
   * Get a service by token.
   */
  resolve<T>(token: symbol): T {
    return this.container.resolve<T>(token as typeof ServiceTokens[keyof typeof ServiceTokens]);
  }

  /**
   * Register a handler.
   */
  registerHandler(handler: StepHandler): void {
    const registry = this.container.resolve<HandlerRegistry>(ServiceTokens.HandlerRegistry);
    registry.register(handler);
  }

  /**
   * Register a flow.
   */
  async registerFlow(flow: Flow): Promise<void> {
    const registry = this.container.resolve<FlowRegistry>(ServiceTokens.FlowRegistry);
    await registry.register(flow);
  }

  /**
   * Get the execution engine.
   */
  getEngine(): Engine {
    return this.container.resolve<Engine>(ServiceTokens.ExecutionEngine);
  }

  private setupContainer(): void {
    // Register provided services or create defaults
    if (this.config.database) {
      this.container.registerInstance(ServiceTokens.DatabasePool, this.config.database);
    }

    if (this.config.stateStore) {
      this.container.registerInstance(ServiceTokens.StateStore, this.config.stateStore);
    }

    if (this.config.handlerRegistry) {
      this.container.registerInstance(ServiceTokens.HandlerRegistry, this.config.handlerRegistry);
    }

    if (this.config.flowRegistry) {
      this.container.registerInstance(ServiceTokens.FlowRegistry, this.config.flowRegistry);
    }

    if (this.config.eventBus) {
      this.container.registerInstance(ServiceTokens.EventBus, this.config.eventBus);
    }

    if (this.config.vaultProvider) {
      this.container.registerInstance(ServiceTokens.VaultProvider, this.config.vaultProvider);
    }

    // Call hook
    this.config.hooks?.onContainerReady?.(this.container);
  }

  private setupRoutes(): void {
    const { routes, prefix = '', middleware = [], context } = this.config;

    // Import express Router
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Router } = require('express') as typeof import('express');
    const router: Router = Router();

    // Apply context middleware
    router.use(createContextMiddleware(this.container, context));

    // Apply custom middleware
    for (const mw of middleware) {
      router.use(mw);
    }

    // Register routes based on configuration
    if (routes?.executions) {
      registerExecutionRoutes(router);
    }

    if (routes?.resumeTokens) {
      registerResumeTokenRoutes(router);
    }

    if (routes?.admin) {
      registerAdminRoutes(router);
    }

    if (routes?.health) {
      registerHealthRoutes(router);
    }

    // Apply error handler
    router.use(createErrorHandler());

    // Mount router on app
    this.app.use(prefix, router);

    // Call hook
    this.config.hooks?.onRoutesRegistered?.(this.app);

    this._initialized = true;
  }
}
