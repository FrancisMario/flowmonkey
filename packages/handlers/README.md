# @flowmonkey/handlers

Pre-built step handlers for FlowMonkey workflows.

## Installation

```bash
pnpm add @flowmonkey/handlers
```

## Available Handlers

| Handler | Type | Description |
|---------|------|-------------|
| `httpHandler` | `http` | Make HTTP requests |
| `delayHandler` | `delay` | Wait for a duration |
| `llmHandler` | `llm` | Language model calls (stub) |
| `webhookHandler` | `webhook` | Send webhook events |
| `transformHandler` | `transform` | Transform data with expressions |
| `batchProcessHandler` | `batch-process` | Process items in batches |

## Usage

```typescript
import { Engine, DefaultHandlerRegistry } from '@flowmonkey/core';
import { httpHandler, delayHandler, webhookHandler } from '@flowmonkey/handlers';

const handlers = new DefaultHandlerRegistry();
handlers.register(httpHandler);
handlers.register(delayHandler);
handlers.register(webhookHandler);

const engine = new Engine(store, handlers, flows);
```

## Handler Details

### HTTP Handler

Make HTTP requests:

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
      headers: { 'Authorization': 'Bearer token' },
      timeout: 30000,
    },
  },
  outputKey: 'apiResponse',
  transitions: { onSuccess: 'process-data' },
}

// Output format
{
  status: 200,
  headers: { 'content-type': 'application/json' },
  body: '{"data": ...}',
}
```

Input properties:
- `url` (required): Request URL
- `method`: HTTP method (default: GET)
- `headers`: Request headers
- `body`: Request body (JSON serialized)
- `timeout`: Request timeout in ms (default: 30000)

### Delay Handler

Wait for a specified duration:

```typescript
// Step configuration
{
  id: 'wait',
  type: 'delay',
  config: {},
  input: { type: 'static', value: { ms: 5000 } },
  transitions: { onSuccess: 'next-step' },
}

// Output
{ delayed: 5000 }
```

### LLM Handler

Language model invocation (stub for integration):

```typescript
// Step configuration
{
  id: 'generate',
  type: 'llm',
  config: {},
  input: {
    type: 'template',
    template: {
      model: 'gpt-4',
      prompt: 'Summarize: ${document.content}',
      temperature: 0.7,
      maxTokens: 500,
      system: 'You are a helpful assistant.',
    },
  },
  outputKey: 'summary',
  transitions: { onSuccess: null },
}
```

> Note: This is a stub implementation. Replace with actual LLM API calls (OpenAI, Anthropic, etc.).

### Webhook Handler

Send webhook notifications:

```typescript
// Step configuration
{
  id: 'notify',
  type: 'webhook',
  config: {},
  input: {
    type: 'template',
    template: {
      url: 'https://hooks.example.com/notify',
      event: 'order.completed',
      payload: { orderId: '${order.id}' },
      retries: 3,
    },
  },
  transitions: { onSuccess: null },
}
```

### Transform Handler

Transform data using JSONPath-like expressions:

```typescript
// Step configuration
{
  id: 'transform',
  type: 'transform',
  config: {},
  input: {
    type: 'static',
    value: {
      source: '${rawData}',
      mapping: {
        id: '$.id',
        name: '$.user.name',
        total: '$.items[*].price | sum',
      },
    },
  },
  outputKey: 'transformed',
  transitions: { onSuccess: null },
}
```

### Batch Process Handler

Process arrays in batches:

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
      processor: 'process-order',  // Handler type
    },
  },
  outputKey: 'results',
  transitions: { onSuccess: null },
}
```

## Creating Custom Handlers

```typescript
import type { StepHandler, HandlerParams } from '@flowmonkey/core';
import { Result } from '@flowmonkey/core';

export const myHandler: StepHandler = {
  type: 'my-handler',
  metadata: {
    type: 'my-handler',
    name: 'My Custom Handler',
    description: 'Does something custom',
    category: 'utility', // 'control' | 'data' | 'external' | 'ai' | 'utility'
    stateful: false,
    configSchema: {
      type: 'object',
      properties: {
        option: { type: 'string' },
      },
    },
  },
  async execute(params: HandlerParams) {
    const { input, config, context, execution, step } = params;
    
    try {
      // Do work
      const result = await doSomething(input);
      
      // Store additional context
      context.set('additionalData', { timestamp: Date.now() });
      
      return Result.success(result);
    } catch (error) {
      return Result.failure({
        code: 'MY_ERROR',
        message: error.message,
      });
    }
  },
};
```

## Stateful Handlers

For long-running operations, create stateful handlers:

```typescript
export const longRunningHandler: StepHandler = {
  type: 'long-running',
  metadata: {
    type: 'long-running',
    name: 'Long Running Task',
    description: 'Runs in background',
    category: 'external',
    stateful: true,  // Mark as stateful
    configSchema: {},
  },
  async execute(params) {
    const { input, context } = params;
    
    // Create a job for background processing
    const jobId = await createBackgroundJob(input);
    
    // Return wait result - execution will pause
    return Result.wait({
      wakeAt: Date.now() + 3600000, // Check in 1 hour
      reason: `Waiting for job ${jobId}`,
    });
  },
};
```

## Testing Handlers

```typescript
import { TestHarness } from '@flowmonkey/core/test';
import { httpHandler } from '@flowmonkey/handlers';

// Mock fetch for HTTP handler tests
const mockHttpHandler: StepHandler = {
  type: 'http',
  async execute({ input }) {
    return Result.success({
      status: 200,
      body: JSON.stringify({ mocked: true }),
    });
  },
};

const harness = new TestHarness({
  handlers: [mockHttpHandler],
  flows: [myFlow],
});

// Run tests with mocked handlers
const { execution } = await harness.run('my-flow', { data: 'test' });
```

## License

MIT
