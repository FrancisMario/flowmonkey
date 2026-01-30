---
title: Result Helpers
description: Result helper functions for handlers.
---

# Result Helpers

The `Result` object provides helper functions for handler returns.

## Import

```typescript
import { Result } from '@flowmonkey/core';
```

## Methods

### Result.success()

Returns a successful result.

```typescript
Result.success(output: unknown): HandlerResult
```

**Example:**

```typescript
return Result.success({
  userId: '123',
  created: true
});
```

### Result.failure()

Returns a failure result.

```typescript
Result.failure(error: ExecutionError): HandlerResult
```

**Example:**

```typescript
return Result.failure({
  code: 'VALIDATION_ERROR',
  message: 'Email is required',
  details: { field: 'email' }
});
```

### Result.wait()

Returns a wait result.

```typescript
Result.wait(metadata?: WaitMetadata): HandlerResult
```

**Example:**

```typescript
return Result.wait({
  wakeAt: Date.now() + 3600000,
  reason: 'Waiting for approval'
});
```

## WaitMetadata

```typescript
interface WaitMetadata {
  wakeAt?: number;    // Unix timestamp for auto-wake
  reason?: string;    // Human-readable reason
}
```

## Type Checking

```typescript
const result = await handler.execute(params);

if (result.type === 'success') {
  console.log(result.output);
}

if (result.type === 'failure') {
  console.log(result.error.code);
}

if (result.type === 'wait') {
  console.log(result.wakeAt);
}
```
