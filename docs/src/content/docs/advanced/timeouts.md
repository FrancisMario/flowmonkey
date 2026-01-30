---
title: Timeouts
description: Configuring step and execution timeouts.
---

# Timeouts

FlowMonkey supports timeouts at the step level to prevent runaway executions.

## Step Timeout

```typescript
{
  id: 'slow-api-call',
  type: 'http',
  timeout: 30000,  // 30 seconds
  config: {},
  input: { type: 'key', key: 'request' },
  transitions: {
    onSuccess: 'next',
    onFailure: 'handle-timeout'
  }
}
```

## Behavior

When a step times out:

1. Handler execution is aborted
2. Step result is `failure` with code `TIMEOUT`
3. `onFailure` transition is followed (if defined)

## Timeout Error

```typescript
{
  type: 'failure',
  error: {
    code: 'TIMEOUT',
    message: 'Step timed out after 30000ms'
  }
}
```

## Handler Timeout

Handlers can respect abort signals:

```typescript
const httpHandler: StepHandler = {
  type: 'http',
  async execute({ input, config }, { signal }) {
    const response = await fetch(input.url, {
      signal,  // Pass abort signal
      timeout: config.timeout
    });
    return Result.success(await response.json());
  }
};
```

## Recommendations

- Set reasonable timeouts for external calls
- Always define `onFailure` for steps with timeouts
- Log timeout events for debugging
- Consider retry logic for transient failures
