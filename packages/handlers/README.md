# @flowmonkey/handlers

Pre-built step handlers for FlowMonkey workflows.

This package provides ready-to-use handlers for common workflow operations like HTTP requests, delays, data transformation, and batch processing. Handlers are available in both function-based and class-based styles.

## Table of Contents

- [Installation](#installation)
- [Quick Start](#quick-start)
- [Available Handlers](#available-handlers)
- [Function-Based Handlers](#function-based-handlers)
  - [HTTP Handler](#http-handler)
  - [Delay Handler](#delay-handler)
  - [Transform Handler](#transform-handler)
  - [Webhook Handler](#webhook-handler)
  - [Batch Process Handler](#batch-process-handler)
- [Class-Based Handlers](#class-based-handlers)
  - [HttpHandler](#httphandler-class)
  - [DelayHandler](#delayhandler-class)
  - [TransformHandler](#transformhandler-class)
  - [EmailReplyHandler](#emailreplyhandler-class)
  - [FormSubmitHandler](#formsubmithandler-class)
  - [BatchProcessHandler](#batchprocesshandler-class)
- [Creating Custom Handlers](#creating-custom-handlers)
  - [Function-Based Custom Handler](#function-based-custom-handler)
  - [Class-Based Custom Handler](#class-based-custom-handler)
  - [Stateful Custom Handler](#stateful-custom-handler)
- [Testing Handlers](#testing-handlers)
- [API Reference](#api-reference)

## Installation

```bash
pnpm add @flowmonkey/handlers
```

## Quick Start

```typescript
import { Engine, DefaultHandlerRegistry } from '@flowmonkey/core';
import { httpHandler, delayHandler, transformHandler } from '@flowmonkey/handlers';

const handlers = new DefaultHandlerRegistry();

// Register function-based handlers
handlers.register(httpHandler);
handlers.register(delayHandler);
handlers.register(transformHandler);

const engine = new Engine(store, handlers, flows);
```

For class-based handlers:

```typescript
import { HttpHandler, DelayHandler, TransformHandler } from '@flowmonkey/handlers/class';

// Register class-based handlers (instantiate first)
handlers.register(new HttpHandler());
handlers.register(new DelayHandler());
handlers.register(new TransformHandler());
```

## Available Handlers

| Handler | Type | Style | Description |
|---------|------|-------|-------------|
| `httpHandler` | `http` | Function | Make HTTP requests |
| `delayHandler` | `delay` | Function | Wait for a duration |
| `transformHandler` | `transform` | Function | Transform data with mappings |
| `webhookHandler` | `webhook` | Function | Send webhook events |
| `batchProcessHandler` | `batch-process` | Function | Process items in batches |
| `HttpHandler` | `http` | Class | Make HTTP requests with validation |
| `DelayHandler` | `delay` | Class | Wait for a duration with validation |
| `TransformHandler` | `transform` | Class | Transform data with validation |
| `EmailReplyHandler` | `email-reply` | Class | Wait for email reply (stateful) |
| `FormSubmitHandler` | `form-submit` | Class | Wait for form submission (stateful) |
| `BatchProcessHandler` | `batch-process` | Class | Process batches with checkpoints (stateful) |

## Function-Based Handlers

Function-based handlers are simple objects that implement the `StepHandler` interface. They are straightforward to use and understand.

### HTTP Handler

Make HTTP requests to external APIs:

```typescript
// Step configuration
{
  id: 'fetch-data',
  type: 'http',
  config: {},
  input: {
    type: 'static',
    value: {
      url: 'https://api.example.com/data',
      method: 'GET',
      headers: {
        'Authorization': 'Bearer token123',
        'Content-Type': 'application/json',
      },
      timeout: 30000,
    },
  },
  outputKey: 'apiResponse',
  transitions: { onSuccess: 'process-data' },
}
```

Input properties:

| Property | Type | Required | Default | Description |
|----------|------|----------|---------|-------------|
| `url` | string | Yes | - | Request URL |
| `method` | string | No | `'GET'` | HTTP method |
| `headers` | object | No | `{}` | Request headers |
| `body` | any | No | - | Request body (JSON serialized) |
| `timeout` | number | No | `30000` | Timeout in milliseconds |

Output format:

```typescript
{
  status: 200,
  headers: { 'content-type': 'application/json' },
  body: '{"data": ...}',
}
```

Using template input for dynamic URLs:

```typescript
input: {
  type: 'template',
  template: {
    url: 'https://api.example.com/users/${userId}',
    method: 'GET',
    headers: {
      'Authorization': 'Bearer ${auth.token}',
    },
  },
}
```

### Delay Handler

Pause execution for a specified duration:

```typescript
// Step configuration
{
  id: 'wait',
  type: 'delay',
  config: {},
  input: {
    type: 'static',
    value: { ms: 5000 }, // Wait 5 seconds
  },
  transitions: { onSuccess: 'next-step' },
}
```

Input properties:

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `ms` | number | Yes | Duration in milliseconds |

Output format:

```typescript
{ delayed: 5000 }
```

The delay handler uses the engine's wait mechanism, so executions can be persisted and resumed even across process restarts.

### Transform Handler

Transform data using mapping rules:

```typescript
// Step configuration
{
  id: 'transform-data',
  type: 'transform',
  config: {},
  input: {
    type: 'template',
    template: {
      source: '${rawData}',
      mapping: {
        id: '$.id',
        userName: '$.user.name',
        userEmail: '$.user.email',
        orderTotal: '$.order.total',
      },
    },
  },
  outputKey: 'transformed',
  transitions: { onSuccess: null },
}
```

Input properties:

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `source` | any | Yes | Source data to transform |
| `mapping` | object | Yes | Key-value mapping rules |

Mapping uses JSONPath-like syntax:
- `$.field` - Root field
- `$.nested.field` - Nested field
- `$.array[0]` - Array index
- `$.array[*].field` - All array items

Output: An object with the mapped values.

### Webhook Handler

Send webhook notifications:

```typescript
// Step configuration
{
  id: 'notify-webhook',
  type: 'webhook',
  config: {},
  input: {
    type: 'template',
    template: {
      url: 'https://hooks.example.com/notify',
      event: 'order.completed',
      payload: {
        orderId: '${order.id}',
        total: '${order.total}',
      },
      retries: 3,
    },
  },
  transitions: { onSuccess: null },
}
```

Input properties:

| Property | Type | Required | Default | Description |
|----------|------|----------|---------|-------------|
| `url` | string | Yes | - | Webhook URL |
| `event` | string | Yes | - | Event type |
| `payload` | object | No | `{}` | Event payload |
| `retries` | number | No | `3` | Retry attempts |
| `headers` | object | No | `{}` | Additional headers |

### Batch Process Handler

Process arrays in configurable batches:

```typescript
// Step configuration
{
  id: 'process-items',
  type: 'batch-process',
  config: {},
  input: {
    type: 'template',
    template: {
      items: '${orders}',
      batchSize: 10,
      processor: 'validate-order', // Handler type to use
    },
  },
  outputKey: 'results',
  transitions: { onSuccess: null },
}
```

Input properties:

| Property | Type | Required | Default | Description |
|----------|------|----------|---------|-------------|
| `items` | array | Yes | - | Items to process |
| `batchSize` | number | No | `10` | Items per batch |
| `processor` | string | No | - | Handler type for items |

## Class-Based Handlers

Class-based handlers use decorators for input declaration and validation. They provide better type safety and are recommended for complex handlers.

### HttpHandler (Class)

```typescript
import { HttpHandler } from '@flowmonkey/handlers/class';

// Register
handlers.register(new HttpHandler());

// Use in step
{
  id: 'api-call',
  type: 'http',
  config: {
    url: 'https://api.example.com/data',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: { key: 'value' },
    timeout: 30000,
    retries: 3,
  },
  input: { type: 'static', value: {} },
  outputKey: 'response',
  transitions: { onSuccess: 'next' },
}
```

The class-based HttpHandler includes:
- URL validation via `@Url()` decorator
- Timeout limits via `@Min(100)` and `@Max(300000)`
- Retry limits via `@Min(0)` and `@Max(10)`
- Automatic retry with exponential backoff
- Proper error handling for network failures

### DelayHandler (Class)

```typescript
import { DelayHandler } from '@flowmonkey/handlers/class';

handlers.register(new DelayHandler());
```

Includes validation that delay is a positive number.

### TransformHandler (Class)

```typescript
import { TransformHandler } from '@flowmonkey/handlers/class';

handlers.register(new TransformHandler());
```

Includes validation that mapping is a non-empty object.

### EmailReplyHandler (Class)

A stateful handler that waits for an email reply:

```typescript
import { EmailReplyHandler } from '@flowmonkey/handlers/class';

handlers.register(new EmailReplyHandler());

// Use in step
{
  id: 'wait-for-reply',
  type: 'email-reply',
  config: {
    to: 'approver@company.com',
    subject: 'Approval Required: ${request.title}',
    body: 'Please reply to approve or reject.',
    timeout: 86400000, // 24 hours
  },
  input: { type: 'key', key: 'request' },
  outputKey: 'approval',
  transitions: {
    onSuccess: 'process-reply',
    onResume: 'process-reply',
  },
}
```

This handler:
1. Sends an email to the recipient
2. Pauses execution waiting for a reply
3. Resumes when the reply is received (via external integration)

### FormSubmitHandler (Class)

A stateful handler that waits for form submission:

```typescript
import { FormSubmitHandler } from '@flowmonkey/handlers/class';

handlers.register(new FormSubmitHandler());

// Use in step
{
  id: 'collect-info',
  type: 'form-submit',
  config: {
    formId: 'customer-details',
    fields: [
      { name: 'name', type: 'text', required: true },
      { name: 'email', type: 'email', required: true },
      { name: 'phone', type: 'tel', required: false },
    ],
    timeout: 604800000, // 7 days
  },
  input: { type: 'static', value: {} },
  outputKey: 'formData',
  transitions: {
    onSuccess: 'process-form',
    onResume: 'process-form',
  },
}
```

This handler:
1. Creates a form token for the user
2. Pauses execution waiting for submission
3. Resumes when form data is submitted (via resume token)

### BatchProcessHandler (Class)

A stateful handler with checkpoint support:

```typescript
import { BatchProcessHandler } from '@flowmonkey/handlers/class';

handlers.register(new BatchProcessHandler());

// Use in step
{
  id: 'process-all',
  type: 'batch-process',
  config: {
    items: [], // Will be overridden by input
    batchSize: 50,
    continueOnError: true,
  },
  input: { type: 'key', key: 'items' },
  outputKey: 'results',
  transitions: {
    onSuccess: 'summarize',
    onResume: null, // Continue processing on resume
  },
}
```

Features:
- Saves progress after each batch
- Survives process restarts
- Can continue on individual item errors
- Reports detailed progress

## Creating Custom Handlers

### Function-Based Custom Handler

```typescript
import { Result, type StepHandler } from '@flowmonkey/core';

export const validateOrderHandler: StepHandler = {
  type: 'validate-order',
  metadata: {
    type: 'validate-order',
    name: 'Validate Order',
    description: 'Validates order data before processing',
    category: 'data',
    stateful: false,
    configSchema: {
      type: 'object',
      properties: {
        minTotal: { type: 'number', default: 0 },
        maxItems: { type: 'number', default: 100 },
      },
    },
  },
  async execute({ input, config }) {
    const order = input as Order;
    const { minTotal = 0, maxItems = 100 } = config as ValidateConfig;
    
    // Validation checks
    if (!order.items || order.items.length === 0) {
      return Result.failure({
        code: 'NO_ITEMS',
        message: 'Order must have at least one item',
      });
    }
    
    if (order.items.length > maxItems) {
      return Result.failure({
        code: 'TOO_MANY_ITEMS',
        message: `Order cannot have more than ${maxItems} items`,
      });
    }
    
    const total = order.items.reduce((sum, item) => sum + item.price, 0);
    
    if (total < minTotal) {
      return Result.failure({
        code: 'BELOW_MINIMUM',
        message: `Order total ${total} is below minimum ${minTotal}`,
      });
    }
    
    return Result.success({
      ...order,
      validated: true,
      total,
      validatedAt: Date.now(),
    });
  },
};
```

### Class-Based Custom Handler

Class-based handlers extend `StatelessHandler` or `StatefulHandler`. Both base classes have full access to all decorators (`@Handler`, `@Input`, and validation decorators like `@Min`, `@Max`, `@Email`, etc.). The only difference between them is the lifecycle - stateful handlers can pause and resume, while stateless handlers complete immediately.

```typescript
import {
  Handler,
  Input,
  StatelessHandler,
  Min,
  NotEmpty,
} from '@flowmonkey/core';
import type { StepResult } from '@flowmonkey/core';

interface NotificationInput {
  channel: 'email' | 'sms' | 'slack';
  recipient: string;
  message: string;
  priority: number;
}

interface NotificationOutput {
  sent: boolean;
  messageId: string;
  timestamp: number;
}

@Handler({
  type: 'send-notification',
  name: 'Send Notification',
  description: 'Send notifications via various channels',
  category: 'external',
  defaultTimeout: 10000,
  retryable: true,
  visual: {
    icon: 'bell',
    color: '#f59e0b',
    tags: ['notification', 'messaging'],
  },
})
export class NotificationHandler extends StatelessHandler<
  NotificationInput,
  NotificationOutput
> {
  @Input({ type: 'string', source: 'config', required: true })
  channel!: 'email' | 'sms' | 'slack';

  @Input({ type: 'string', source: 'config', required: true })
  @NotEmpty()
  recipient!: string;

  @Input({ type: 'string', source: 'config', required: true })
  @NotEmpty()
  message!: string;

  @Input({ type: 'number', source: 'config', defaultValue: 1 })
  @Min(1)
  priority!: number;

  async execute(): Promise<StepResult> {
    try {
      const messageId = await this.sendToChannel();
      
      return this.success({
        sent: true,
        messageId,
        timestamp: Date.now(),
      });
    } catch (error) {
      return this.failure(
        'SEND_FAILED',
        `Failed to send ${this.channel} notification: ${error.message}`
      );
    }
  }

  private async sendToChannel(): Promise<string> {
    switch (this.channel) {
      case 'email':
        return this.sendEmail();
      case 'sms':
        return this.sendSms();
      case 'slack':
        return this.sendSlack();
      default:
        throw new Error(`Unknown channel: ${this.channel}`);
    }
  }

  private async sendEmail(): Promise<string> {
    // Email implementation
    return `email-${Date.now()}`;
  }

  private async sendSms(): Promise<string> {
    // SMS implementation
    return `sms-${Date.now()}`;
  }

  private async sendSlack(): Promise<string> {
    // Slack implementation
    return `slack-${Date.now()}`;
  }
}
```

### Stateful Custom Handler

Stateful handlers extend `StatefulHandler` for long-running operations that need checkpoints. They have access to all the same decorators as stateless handlers (`@Input`, `@Min`, `@Max`, `@Email`, etc.) plus checkpoint methods (`saveCheckpoint()`, `loadCheckpoint()`):

```typescript
import {
  Handler,
  Input,
  StatefulHandler,
  Min,
  Max,
} from '@flowmonkey/core';
import type { StepResult } from '@flowmonkey/core';

interface ImportCheckpoint {
  currentPage: number;
  totalImported: number;
  errors: string[];
}

interface ImportInput {
  sourceUrl: string;
  pageSize: number;
  maxPages: number;
}

interface ImportOutput {
  totalImported: number;
  totalPages: number;
  errors: string[];
}

@Handler({
  type: 'data-import',
  name: 'Data Import',
  description: 'Import data from external source with pagination',
  category: 'data',
  stateful: true, // Mark as stateful
})
export class DataImportHandler extends StatefulHandler<
  ImportInput,
  ImportCheckpoint,
  ImportOutput
> {
  @Input({ type: 'string', source: 'config', required: true })
  sourceUrl!: string;

  @Input({ type: 'number', source: 'config', defaultValue: 100 })
  @Min(1)
  @Max(1000)
  pageSize!: number;

  @Input({ type: 'number', source: 'config', defaultValue: 10 })
  @Min(1)
  @Max(100)
  maxPages!: number;

  async execute(): Promise<StepResult> {
    // Load checkpoint or initialize
    const checkpoint = await this.loadCheckpoint() ?? {
      currentPage: 0,
      totalImported: 0,
      errors: [],
    };

    // Fetch next page
    const page = checkpoint.currentPage + 1;
    
    try {
      const data = await this.fetchPage(page);
      
      if (data.length === 0 || page > this.maxPages) {
        // Import complete
        return this.success({
          totalImported: checkpoint.totalImported,
          totalPages: checkpoint.currentPage,
          errors: checkpoint.errors,
        });
      }

      // Process page
      const imported = await this.processData(data);
      
      // Update checkpoint
      checkpoint.currentPage = page;
      checkpoint.totalImported += imported;
      
      // Save progress
      await this.saveCheckpoint(checkpoint);

      // Continue with next page
      return this.wait({
        wakeAt: Date.now() + 1000, // Brief pause between pages
        reason: `Imported page ${page}, ${checkpoint.totalImported} records total`,
      });
      
    } catch (error) {
      checkpoint.errors.push(`Page ${page}: ${error.message}`);
      
      // Save error and continue
      await this.saveCheckpoint(checkpoint);
      
      // Skip to next page
      checkpoint.currentPage = page;
      
      return this.wait({
        wakeAt: Date.now() + 5000, // Longer pause after error
        reason: `Error on page ${page}, retrying next page`,
      });
    }
  }

  private async fetchPage(page: number): Promise<unknown[]> {
    const response = await fetch(
      `${this.sourceUrl}?page=${page}&size=${this.pageSize}`
    );
    return response.json();
  }

  private async processData(data: unknown[]): Promise<number> {
    // Process records
    return data.length;
  }
}
```

## Testing Handlers

Use the TestHarness from `@flowmonkey/core`:

```typescript
import { TestHarness } from '@flowmonkey/core/test';
import { httpHandler, transformHandler } from '@flowmonkey/handlers';

describe('HTTP Handler', () => {
  // Mock HTTP handler for testing
  const mockHttpHandler: StepHandler = {
    type: 'http',
    async execute({ input }) {
      const { url } = input as { url: string };
      return Result.success({
        status: 200,
        body: JSON.stringify({ url, mocked: true }),
      });
    },
  };

  const harness = new TestHarness({
    handlers: [mockHttpHandler],
    flows: [{
      id: 'test-http',
      version: '1.0.0',
      initialStepId: 'fetch',
      steps: {
        fetch: {
          id: 'fetch',
          type: 'http',
          config: {},
          input: {
            type: 'static',
            value: { url: 'https://api.example.com/test' },
          },
          outputKey: 'response',
          transitions: { onSuccess: null },
        },
      },
    }],
  });

  it('fetches data successfully', async () => {
    const { execution } = await harness.run('test-http', {});
    
    harness.assertCompleted(execution);
    expect(execution.context.response).toEqual({
      status: 200,
      body: JSON.stringify({ url: 'https://api.example.com/test', mocked: true }),
    });
  });
});
```

For class-based handlers:

```typescript
import { TestHarness } from '@flowmonkey/core/test';
import { TransformHandler } from '@flowmonkey/handlers/class';

describe('TransformHandler', () => {
  const harness = new TestHarness({
    handlers: [new TransformHandler()],
    flows: [{
      id: 'test-transform',
      version: '1.0.0',
      initialStepId: 'transform',
      steps: {
        transform: {
          id: 'transform',
          type: 'transform',
          config: {
            mapping: {
              name: '$.user.name',
              email: '$.user.email',
            },
          },
          input: { type: 'full' },
          outputKey: 'result',
          transitions: { onSuccess: null },
        },
      },
    }],
  });

  it('transforms data according to mapping', async () => {
    const { execution } = await harness.run('test-transform', {
      user: { name: 'Alice', email: 'alice@example.com', id: 123 },
    });
    
    harness.assertCompleted(execution);
    expect(execution.context.result).toEqual({
      name: 'Alice',
      email: 'alice@example.com',
    });
  });
});
```

## API Reference

### Function-Based Exports

```typescript
import {
  httpHandler,
  delayHandler,
  transformHandler,
  webhookHandler,
  batchProcessHandler,
} from '@flowmonkey/handlers';
```

### Class-Based Exports

```typescript
import {
  HttpHandler,
  DelayHandler,
  TransformHandler,
  EmailReplyHandler,
  FormSubmitHandler,
  BatchProcessHandler,
} from '@flowmonkey/handlers/class';

// Type exports
import type {
  HttpSuccessOutput,
  HttpFailureOutput,
  DelaySuccessOutput,
  TransformSuccessOutput,
  TransformFailureOutput,
  EmailReplyCheckpoint,
  EmailReplySuccessOutput,
  EmailReplyFailureOutput,
  FormSubmitCheckpoint,
  FormField,
  FormSubmitSuccessOutput,
  FormSubmitFailureOutput,
  BatchProcessCheckpoint,
  BatchItemResult,
  BatchProcessSuccessOutput,
  BatchProcessFailureOutput,
} from '@flowmonkey/handlers/class';
```

### Handler Registration

```typescript
import { DefaultHandlerRegistry } from '@flowmonkey/core';

const handlers = new DefaultHandlerRegistry();

// Function-based
handlers.register(httpHandler);

// Class-based
handlers.register(new HttpHandler());

// Custom
handlers.register(myCustomHandler);
```

## License

MIT
