---
title: Delay Handler
description: Time-based delays in FlowMonkey workflows.
---

# Delay Handler

The delay handler pauses execution for a specified duration.

## Usage

```typescript
{
  id: 'wait-30-seconds',
  type: 'delay',
  config: {},
  input: {
    type: 'static',
    value: { duration: 30000 }  // milliseconds
  },
  outputKey: 'delayResult',
  transitions: { onSuccess: 'next-step' }
}
```

## Input Schema

```typescript
interface DelayInput {
  duration: number;  // milliseconds
}
```

## Dynamic Delays

Calculate delay from context:

```typescript
{
  id: 'wait-until-ready',
  type: 'delay',
  input: {
    type: 'template',
    template: {
      duration: '${config.retryDelay}'
    }
  },
  transitions: { onSuccess: 'retry-step' }
}
```

## Behavior

For short delays (< 1 second), the handler uses `setTimeout`.

For longer delays, the handler returns `Result.wait()` with `wakeAt` time, allowing the execution to be persisted and resumed later by a job runner.

## Output

```typescript
{
  delayed: true,
  duration: 30000,
  completedAt: 1706300030000
}
```
