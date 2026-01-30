---
title: Handler Overview
description: Understanding step handlers in FlowMonkey.
---

# Handler Overview

Handlers implement the logic for step types. Each handler processes input and returns a result.

## Handler Interface

```typescript
interface StepHandler {
  type: string;
  stateful?: boolean;
  execute(params: HandlerParams): Promise<HandlerResult>;
}

interface HandlerParams {
  input: unknown;
  config: object;
  context: Record<string, unknown>;
  step: Step;
  execution: Execution;
}

type HandlerResult = 
  | { type: 'success'; output: unknown }
  | { type: 'failure'; error: ExecutionError }
  | { type: 'wait'; wakeAt?: number; reason?: string };
```

## Creating a Handler

```typescript
import { type StepHandler, Result } from '@flowmonkey/core';

const myHandler: StepHandler = {
  type: 'my-handler',
  
  async execute({ input, config, context }) {
    // Your logic here
    const result = await doSomething(input);
    
    return Result.success(result);
  }
};
```

## Result Helpers

Use the `Result` helper for consistent returns:

```typescript
// Success
return Result.success({ data: 'value' });

// Failure
return Result.failure({
  code: 'VALIDATION_ERROR',
  message: 'Invalid input'
});

// Wait
return Result.wait({
  wakeAt: Date.now() + 3600000,
  reason: 'Waiting for approval'
});
```

## Registering Handlers

```typescript
import { DefaultHandlerRegistry } from '@flowmonkey/core';

const handlers = new DefaultHandlerRegistry();
handlers.register(myHandler);
handlers.register(anotherHandler);
```

## Built-in Handlers

FlowMonkey provides pre-built handlers in `@flowmonkey/handlers`:

- [HTTP Handler](/handlers/http/) - Make HTTP requests
- [Delay Handler](/handlers/delay/) - Time-based delays
- [Transform Handler](/handlers/transform/) - Data transformation

## Stateful Handlers

Set `stateful: true` for handlers that need background job processing:

```typescript
const statefulHandler: StepHandler = {
  type: 'long-running-task',
  stateful: true,
  
  async execute({ input }) {
    // Create a job, return wait
    const job = await createJob(input);
    return Result.wait({ 
      reason: `Job ${job.id} processing` 
    });
  }
};
```

## Next Steps

- [HTTP Handler](/handlers/http/) - HTTP request handler
- [Custom Handlers](/handlers/custom/) - Building custom handlers
