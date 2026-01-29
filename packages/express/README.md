# @flowmonkey/express

Express integration for FlowMonkey workflow engine.

This package provides a complete REST API for managing FlowMonkey workflows, including a dependency injection container, pre-built route handlers, middleware, and a fluent builder API.

## Table of Contents

- [Installation](#installation)
- [Quick Start](#quick-start)
- [FlowMonkeyExpress Builder](#flowmonkeyexpress-builder)
  - [Basic Configuration](#basic-configuration)
  - [Database Configuration](#database-configuration)
  - [Registering Handlers and Flows](#registering-handlers-and-flows)
  - [Route Configuration](#route-configuration)
  - [Middleware](#middleware)
  - [Context Extraction](#context-extraction)
  - [Lifecycle Hooks](#lifecycle-hooks)
- [Available Routes](#available-routes)
  - [Execution Routes](#execution-routes)
  - [Resume Token Routes](#resume-token-routes)
  - [Admin Routes](#admin-routes)
  - [Health Routes](#health-routes)
- [Service Container](#service-container)
  - [Service Tokens](#service-tokens)
  - [Resolving Services](#resolving-services)
  - [Registering Custom Services](#registering-custom-services)
- [Middleware](#middleware-1)
  - [Context Middleware](#context-middleware)
  - [Error Handler](#error-handler)
  - [Async Handler](#async-handler)
- [Custom Routes](#custom-routes)
- [API Reference](#api-reference)

## Installation

```bash
pnpm add @flowmonkey/express @flowmonkey/core @flowmonkey/postgres
```

## Quick Start

```typescript
import express from 'express';
import { Pool } from 'pg';
import { FlowMonkeyExpress } from '@flowmonkey/express';
import { httpHandler, delayHandler } from '@flowmonkey/handlers';

const app = express();
app.use(express.json());

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// Build FlowMonkey integration
const flowmonkey = await FlowMonkeyExpress.builder()
  .app(app)
  .database(pool)
  .handler(httpHandler)
  .handler(delayHandler)
  .flow({
    id: 'my-workflow',
    version: '1.0.0',
    name: 'My Workflow',
    initialStepId: 'start',
    steps: {
      start: {
        id: 'start',
        type: 'http',
        config: { url: 'https://api.example.com/data' },
        input: { type: 'static', value: {} },
        outputKey: 'data',
        transitions: { onSuccess: null },
      },
    },
  })
  .build();

app.listen(3000, () => {
  console.log('FlowMonkey server running on port 3000');
});
```

This sets up a complete REST API with routes for managing executions, flows, and health checks.

## FlowMonkeyExpress Builder

The builder provides a fluent API for configuring FlowMonkey integration.

### Basic Configuration

```typescript
const flowmonkey = await FlowMonkeyExpress.builder()
  .app(app)                    // Express application (required)
  .database(pool)              // PostgreSQL pool (recommended)
  .build();
```

### Database Configuration

For production use, provide a PostgreSQL connection pool:

```typescript
import { Pool } from 'pg';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

const flowmonkey = await FlowMonkeyExpress.builder()
  .app(app)
  .database(pool)
  .build();
```

The builder automatically:
- Creates `PgExecutionStore` for execution persistence
- Creates `PgFlowStore` for flow definitions
- Creates `PgJobStore` for background jobs
- Creates `PgEventStore` for event logging
- Applies the database schema if needed

For custom stores:

```typescript
const flowmonkey = await FlowMonkeyExpress.builder()
  .app(app)
  .stateStore(customStateStore)
  .flowRegistry(customFlowRegistry)
  .handlerRegistry(customHandlerRegistry)
  .build();
```

### Registering Handlers and Flows

Add handlers and flows through the builder:

```typescript
import { httpHandler, delayHandler } from '@flowmonkey/handlers';
import { HttpHandler, TransformHandler } from '@flowmonkey/handlers/class';

const flowmonkey = await FlowMonkeyExpress.builder()
  .app(app)
  .database(pool)
  
  // Function-based handlers
  .handler(httpHandler)
  .handler(delayHandler)
  
  // Class-based handlers
  .handler(new HttpHandler())
  .handler(new TransformHandler())
  
  // Flows
  .flow(orderWorkflow)
  .flow(notificationWorkflow)
  
  .build();
```

You can also add handlers and flows after building:

```typescript
const flowmonkey = await FlowMonkeyExpress.builder()
  .app(app)
  .database(pool)
  .build();

// Add later
flowmonkey.registerHandler(customHandler);
flowmonkey.registerFlow(newWorkflow);
```

### Route Configuration

Control which routes are registered:

```typescript
const flowmonkey = await FlowMonkeyExpress.builder()
  .app(app)
  .routes({
    executions: true,     // POST /flows/:flowId/start, GET/POST /executions/:id
    resumeTokens: true,   // POST /tokens/:token/resume
    admin: false,         // GET /admin/flows, /admin/handlers (disabled)
    health: true,         // GET /health, /ready
  })
  .build();
```

Add a prefix to all routes:

```typescript
const flowmonkey = await FlowMonkeyExpress.builder()
  .app(app)
  .prefix('/api/v1')
  .build();

// Routes become:
// POST /api/v1/flows/:flowId/start
// GET /api/v1/executions/:executionId
// etc.
```

### Middleware

Add middleware applied to all FlowMonkey routes:

```typescript
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';

const flowmonkey = await FlowMonkeyExpress.builder()
  .app(app)
  .use(helmet())
  .use(rateLimit({ windowMs: 15 * 60 * 1000, max: 100 }))
  .use((req, res, next) => {
    console.log(`FlowMonkey request: ${req.method} ${req.path}`);
    next();
  })
  .build();
```

### Context Extraction

Extract tenant, user, and metadata from requests:

```typescript
const flowmonkey = await FlowMonkeyExpress.builder()
  .app(app)
  .context({
    // Extract tenant ID from header or JWT
    getTenantId: (req) => {
      return req.headers['x-tenant-id'] as string 
        || (req as any).user?.tenantId;
    },
    
    // Extract user ID from authenticated user
    getUserId: (req) => {
      return (req as any).user?.id;
    },
    
    // Add custom metadata to executions
    getMetadata: (req) => ({
      userAgent: req.headers['user-agent'],
      ip: req.ip,
      requestId: req.headers['x-request-id'],
    }),
  })
  .build();
```

This data is automatically attached to executions created via the API.

### Lifecycle Hooks

Hook into FlowMonkey lifecycle events:

```typescript
const flowmonkey = await FlowMonkeyExpress.builder()
  .app(app)
  .hooks({
    // Called when container is configured
    onContainerReady: (container) => {
      console.log('Container ready');
      
      // Register additional services
      container.registerFactory(
        Symbol.for('my:Logger'),
        () => new Logger()
      );
    },
    
    // Called after routes are registered
    onRoutesRegistered: (app) => {
      console.log('Routes registered');
    },
    
    // Called when an execution starts
    onExecutionStart: (executionId) => {
      metrics.increment('executions.started');
    },
    
    // Called when an execution completes
    onExecutionComplete: (executionId, success) => {
      if (success) {
        metrics.increment('executions.completed');
      } else {
        metrics.increment('executions.failed');
      }
    },
  })
  .build();
```

## Available Routes

### Execution Routes

#### Start Execution

```http
POST /api/flows/:flowId/start
Content-Type: application/json

{
  "context": {
    "user": { "id": "123", "name": "Alice" },
    "order": { "total": 99.99 }
  },
  "options": {
    "idempotencyKey": "unique-request-id",
    "idempotencyTTL": 86400000
  }
}
```

Response:

```json
{
  "execution": {
    "id": "exec_abc123",
    "flowId": "my-workflow",
    "status": "pending",
    "createdAt": 1706500000000
  },
  "created": true
}
```

#### Get Execution

```http
GET /api/executions/:executionId
```

Response:

```json
{
  "id": "exec_abc123",
  "flowId": "my-workflow",
  "flowVersion": "1.0.0",
  "currentStepId": "process-data",
  "status": "running",
  "context": {
    "user": { "id": "123" },
    "data": { "fetched": true }
  },
  "stepCount": 2,
  "createdAt": 1706500000000,
  "updatedAt": 1706500100000
}
```

#### Cancel Execution

```http
POST /api/executions/:executionId/cancel
Content-Type: application/json

{
  "reason": "User requested cancellation"
}
```

Response:

```json
{
  "cancelled": true
}
```

### Resume Token Routes

#### Resume with Token

```http
POST /api/tokens/:token/resume
Content-Type: application/json

{
  "data": {
    "approved": true,
    "comment": "Looks good"
  }
}
```

Response:

```json
{
  "execution": {
    "id": "exec_abc123",
    "status": "running"
  }
}
```

### Admin Routes

#### List Flows

```http
GET /api/admin/flows
```

Response:

```json
{
  "flows": [
    {
      "id": "order-workflow",
      "version": "1.0.0",
      "name": "Order Processing"
    },
    {
      "id": "notification-workflow",
      "version": "2.1.0",
      "name": "Notification Service"
    }
  ]
}
```

#### List Handlers

```http
GET /api/admin/handlers
```

Response:

```json
{
  "handlers": [
    {
      "type": "http",
      "name": "HTTP Request",
      "category": "external",
      "stateful": false
    },
    {
      "type": "delay",
      "name": "Delay",
      "category": "utility",
      "stateful": false
    }
  ]
}
```

### Health Routes

#### Health Check

```http
GET /health
```

Response:

```json
{
  "status": "ok",
  "timestamp": 1706500000000
}
```

#### Readiness Check

```http
GET /ready
```

Response (healthy):

```json
{
  "status": "ready",
  "checks": {
    "database": "ok",
    "handlers": "ok"
  }
}
```

Response (unhealthy):

```json
{
  "status": "not ready",
  "checks": {
    "database": "error: connection refused",
    "handlers": "ok"
  }
}
```

## Service Container

The service container manages dependencies and allows access to FlowMonkey internals.

### Service Tokens

```typescript
import { ServiceTokens } from '@flowmonkey/express';

// Available tokens
ServiceTokens.ExecutionEngine    // Engine instance
ServiceTokens.FlowRegistry       // Flow registry
ServiceTokens.HandlerRegistry    // Handler registry
ServiceTokens.EventBus           // Event bus
ServiceTokens.StateStore         // Execution store
ServiceTokens.ContextStorage     // Context storage
ServiceTokens.JobStore           // Job queue
ServiceTokens.EventStore         // Event log
ServiceTokens.ResumeTokenManager // Resume tokens
ServiceTokens.VaultProvider      // Secrets vault
ServiceTokens.JobRunner          // Job processor
ServiceTokens.DatabasePool       // PostgreSQL pool
ServiceTokens.ExpressApp         // Express app
```

### Resolving Services

```typescript
const flowmonkey = await FlowMonkeyExpress.builder()
  .app(app)
  .database(pool)
  .build();

// Get container
const container = flowmonkey.getContainer();

// Resolve services
const engine = container.resolve(ServiceTokens.ExecutionEngine);
const flows = container.resolve(ServiceTokens.FlowRegistry);
const handlers = container.resolve(ServiceTokens.HandlerRegistry);

// Shortcut methods
const engine = flowmonkey.getEngine();
```

### Registering Custom Services

```typescript
const flowmonkey = await FlowMonkeyExpress.builder()
  .app(app)
  .hooks({
    onContainerReady: (container) => {
      // Register instance
      container.registerInstance(
        Symbol.for('my:Config'),
        { apiKey: process.env.API_KEY }
      );
      
      // Register factory (lazy creation)
      container.registerFactory(
        Symbol.for('my:ApiClient'),
        (c) => {
          const config = c.resolve(Symbol.for('my:Config'));
          return new ApiClient(config.apiKey);
        }
      );
    },
  })
  .build();

// Later: resolve custom service
const apiClient = flowmonkey.resolve(Symbol.for('my:ApiClient'));
```

## Middleware

### Context Middleware

Extracts tenant/user information and attaches it to the request:

```typescript
import { createContextMiddleware } from '@flowmonkey/express';

const contextMiddleware = createContextMiddleware(container, {
  getTenantId: (req) => req.headers['x-tenant-id'] as string,
  getUserId: (req) => (req as any).user?.id,
});

app.use('/api', contextMiddleware);
```

### Error Handler

Handles errors and returns appropriate HTTP responses:

```typescript
import { createErrorHandler } from '@flowmonkey/express';

const errorHandler = createErrorHandler();

// Apply after routes
app.use(errorHandler);
```

Error types and status codes:

| Error Type | Status Code |
|------------|-------------|
| `ValidationError` | 400 |
| `UnauthorizedError` | 401 |
| `NotFoundError` | 404 |
| Other errors | 500 |

### Async Handler

Wraps async route handlers to catch errors:

```typescript
import { asyncHandler } from '@flowmonkey/express';

app.get('/custom', asyncHandler(async (req, res) => {
  const data = await fetchData();
  res.json(data);
}));
```

## Custom Routes

Add custom routes that access FlowMonkey services:

```typescript
const flowmonkey = await FlowMonkeyExpress.builder()
  .app(app)
  .database(pool)
  .hooks({
    onRoutesRegistered: (expressApp) => {
      const container = flowmonkey.getContainer();
      const engine = container.resolve(ServiceTokens.ExecutionEngine);
      
      // Custom route to run and wait for completion
      expressApp.post('/api/flows/:flowId/run-sync', async (req, res, next) => {
        try {
          const { execution } = await engine.create(req.params.flowId, req.body);
          const result = await engine.run(execution.id);
          res.json(result);
        } catch (error) {
          next(error);
        }
      });
      
      // Custom metrics endpoint
      expressApp.get('/api/metrics', async (req, res) => {
        const store = container.resolve(ServiceTokens.StateStore);
        const running = await store.findByStatus('running', 1000);
        const waiting = await store.findByStatus('waiting', 1000);
        
        res.json({
          executions: {
            running: running.length,
            waiting: waiting.length,
          },
        });
      });
    },
  })
  .build();
```

## API Reference

### FlowMonkeyExpress

```typescript
class FlowMonkeyExpress {
  // Create builder
  static builder(): FlowMonkeyExpressBuilder;
  
  // Get service container
  getContainer(): ServiceContainer;
  
  // Resolve service by token
  resolve<T>(token: ServiceToken): T;
  
  // Register handler after build
  registerHandler(handler: StepHandler): void;
  
  // Register flow after build
  registerFlow(flow: Flow): void;
  
  // Get engine instance
  getEngine(): Engine;
}
```

### FlowMonkeyExpressBuilder

```typescript
class FlowMonkeyExpressBuilder {
  // Required: Express app
  app(app: Application): this;
  
  // PostgreSQL pool
  database(pool: Pool): this;
  
  // Custom stores
  stateStore(store: StateStore): this;
  handlerRegistry(registry: HandlerRegistry): this;
  flowRegistry(registry: FlowRegistry): this;
  eventBus(bus: EventBus): this;
  
  // Vault for secrets
  vault(provider: VaultProvider): this;
  
  // Route configuration
  routes(config: RouteConfig): this;
  prefix(prefix: string): this;
  
  // Middleware
  use(...middleware: RequestHandler[]): this;
  
  // Context extraction
  context(options: ContextMiddlewareOptions): this;
  
  // Add handler
  handler(handler: StepHandler): this;
  
  // Add flow
  flow(flow: Flow): this;
  
  // Lifecycle hooks
  hooks(hooks: LifecycleHooks): this;
  
  // Build instance
  build(): Promise<FlowMonkeyExpress>;
}
```

### ServiceContainer

```typescript
class ServiceContainer {
  // Register instance
  registerInstance<T>(token: ServiceToken, instance: T): this;
  
  // Register factory
  registerFactory<T>(
    token: ServiceToken,
    factory: (container: ServiceContainer) => T,
    singleton?: boolean
  ): this;
  
  // Resolve service
  resolve<T>(token: ServiceToken): T;
  
  // Try to resolve (returns undefined if not found)
  tryResolve<T>(token: ServiceToken): T | undefined;
  
  // Check if registered
  has(token: ServiceToken): boolean;
  
  // Get all registered tokens
  getRegisteredTokens(): ServiceToken[];
  
  // Clear all services
  clear(): void;
}
```

### Route Types

```typescript
interface RouteConfig {
  executions?: boolean;    // Default: true
  resumeTokens?: boolean;  // Default: true
  admin?: boolean;         // Default: true
  health?: boolean;        // Default: true
}

interface ContextMiddlewareOptions {
  getTenantId?: (req: Request) => string | undefined;
  getUserId?: (req: Request) => string | undefined;
  getMetadata?: (req: Request) => Record<string, unknown>;
}

interface LifecycleHooks {
  onContainerReady?: (container: ServiceContainer) => void | Promise<void>;
  onRoutesRegistered?: (app: Application) => void | Promise<void>;
  onExecutionStart?: (executionId: string) => void;
  onExecutionComplete?: (executionId: string, success: boolean) => void;
}
```

## License

MIT
