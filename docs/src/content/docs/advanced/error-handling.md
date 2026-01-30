---
title: Error Handling
description: Handling errors in FlowMonkey workflows.
---

# Error Handling

FlowMonkey provides comprehensive error handling at multiple levels.

## Error Types

```typescript
interface ExecutionError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}
```

### Error Codes

| Code | Description |
|------|-------------|
| `HANDLER_ERROR` | Handler threw an exception |
| `HANDLER_NOT_FOUND` | No handler for step type |
| `INPUT_RESOLUTION_ERROR` | Failed to resolve input |
| `INVALID_TRANSITION` | Invalid transition target |
| `TIMEOUT` | Step timed out |
| `VALIDATION_ERROR` | Input validation failed |

## Handler Errors

### Throwing Exceptions

```typescript
async execute({ input }) {
  if (!input.required) {
    throw new Error('Missing required field');
  }
  // ...
}
// Result: failure with HANDLER_ERROR
```

### Returning Failure

```typescript
async execute({ input }) {
  if (!input.required) {
    return Result.failure({
      code: 'VALIDATION_ERROR',
      message: 'Missing required field',
      details: { field: 'required' }
    });
  }
  // ...
}
```

## Error Transitions

Handle errors with `onFailure`:

```typescript
{
  id: 'risky-step',
  type: 'external-api',
  transitions: {
    onSuccess: 'continue',
    onFailure: 'handle-error'
  }
}
```

## Error Handler Steps

Create dedicated error handling steps:

```typescript
'handle-error': {
  id: 'handle-error',
  type: 'error-handler',
  input: { type: 'full' },  // Get full context including error
  transitions: { onSuccess: 'notify-admin' }
}
```

## Accessing Error Info

In the error handler, access error details:

```typescript
const errorHandler: StepHandler = {
  type: 'error-handler',
  async execute({ context, execution }) {
    const error = execution.error;
    
    await logError({
      code: error?.code,
      message: error?.message,
      stepId: execution.currentStepId,
      context
    });
    
    return Result.success({ handled: true });
  }
};
```

## Retry Strategies

### Simple Retry

```typescript
const retryHandler: StepHandler = {
  type: 'retry-check',
  async execute({ context }) {
    const attempts = (context.retryCount as number) || 0;
    
    if (attempts < 3) {
      return Result.success({ 
        retryCount: attempts + 1,
        shouldRetry: true 
      });
    }
    
    return Result.failure({
      code: 'MAX_RETRIES',
      message: 'Max retry attempts reached'
    });
  }
};
```

### Exponential Backoff

```typescript
const backoffDelay = Math.min(
  1000 * Math.pow(2, attempts),
  30000  // Max 30 seconds
);

return Result.wait({
  wakeAt: Date.now() + backoffDelay,
  reason: `Retry attempt ${attempts + 1}`
});
```

## Best Practices

1. **Always define `onFailure`** for steps that can fail
2. **Log errors** in error handler steps
3. **Notify on critical failures**
4. **Implement retry logic** for transient errors
5. **Set appropriate timeouts**
