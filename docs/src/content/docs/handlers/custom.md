---
title: Custom Handlers
description: Building custom step handlers for FlowMonkey.
---

# Custom Handlers

Create custom handlers to implement any step logic.

## Basic Structure

```typescript
import { type StepHandler, Result } from '@flowmonkey/core';

export const myCustomHandler: StepHandler = {
  type: 'my-custom-type',
  
  async execute({ input, config, context, step, execution }) {
    // Implement your logic
    const result = await processData(input);
    
    return Result.success(result);
  }
};
```

## Complete Example

```typescript
import { type StepHandler, Result } from '@flowmonkey/core';

interface EmailInput {
  to: string;
  subject: string;
  body: string;
}

interface EmailConfig {
  from: string;
  template?: string;
}

export const emailHandler: StepHandler = {
  type: 'email',
  
  async execute({ input, config }) {
    const { to, subject, body } = input as EmailInput;
    const { from, template } = config as EmailConfig;
    
    try {
      const messageId = await sendEmail({
        from,
        to,
        subject,
        body: template ? renderTemplate(template, { body }) : body
      });
      
      return Result.success({
        sent: true,
        messageId,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      return Result.failure({
        code: 'EMAIL_SEND_ERROR',
        message: error.message
      });
    }
  }
};
```

## Handler Params

```typescript
interface HandlerParams {
  input: unknown;        // Resolved from input selector
  config: object;        // Static step config
  context: Record<string, unknown>;  // Full execution context
  step: Step;            // Current step definition
  execution: Execution;  // Full execution object
}
```

## Returning Results

### Success

```typescript
return Result.success({ 
  data: 'any output data'
});
```

### Failure

```typescript
return Result.failure({
  code: 'ERROR_CODE',
  message: 'Human-readable message',
  details: { /* optional details */ }
});
```

### Wait

```typescript
return Result.wait({
  wakeAt: Date.now() + 3600000,  // Optional: auto-wake time
  reason: 'Waiting for approval'  // Optional: description
});
```

## Stateful Handlers

For long-running operations, mark the handler as stateful:

```typescript
export const batchProcessHandler: StepHandler = {
  type: 'batch-process',
  stateful: true,  // Requires job runner
  
  async execute({ input }) {
    // Create a background job
    const jobId = await createBackgroundJob(input);
    
    // Return wait - job runner will resume when complete
    return Result.wait({
      reason: `Processing batch job ${jobId}`
    });
  }
};
```

## Registering Handlers

```typescript
import { DefaultHandlerRegistry } from '@flowmonkey/core';
import { emailHandler, batchProcessHandler } from './handlers';

const handlers = new DefaultHandlerRegistry();
handlers.register(emailHandler);
handlers.register(batchProcessHandler);
```

## Testing Handlers

```typescript
import { describe, it, expect } from 'vitest';
import { emailHandler } from './email-handler';

describe('emailHandler', () => {
  it('sends email successfully', async () => {
    const result = await emailHandler.execute({
      input: {
        to: 'test@example.com',
        subject: 'Test',
        body: 'Hello'
      },
      config: { from: 'noreply@example.com' },
      context: {},
      step: {} as any,
      execution: {} as any
    });
    
    expect(result.type).toBe('success');
    expect(result.output.sent).toBe(true);
  });
});
```
