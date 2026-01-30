---
title: Idempotency
description: Preventing duplicate executions in FlowMonkey.
---

# Idempotency

Idempotency ensures the same request doesn't create duplicate executions.

## Using Idempotency Keys

```typescript
const { execution, created } = await engine.create(
  'process-order',
  { order: orderData },
  {
    idempotencyKey: `order-${orderId}`,
    idempotencyTTL: 86400000  // 24 hours
  }
);

if (!created) {
  // Existing execution returned
  console.log('Using existing execution:', execution.id);
}
```

## How It Works

1. Client provides an `idempotencyKey` with the create request
2. Engine checks if an execution with that key exists
3. If found (and not expired), returns the existing execution
4. If not found, creates a new execution with the key

## Key Strategies

### Order-based

```typescript
idempotencyKey: `order-${order.id}`
```

### Request-based

```typescript
idempotencyKey: `${userId}-${requestId}`
```

### Content-based

```typescript
import { createHash } from 'crypto';
const hash = createHash('sha256').update(JSON.stringify(payload)).digest('hex');
idempotencyKey: hash
```

## TTL

Keys expire after `idempotencyTTL` milliseconds:

```typescript
idempotencyTTL: 3600000   // 1 hour
idempotencyTTL: 86400000  // 24 hours
idempotencyTTL: 604800000 // 7 days
```

After expiration, the same key can create a new execution.

## HTTP Trigger Integration

```typescript
triggers.registerHttp({
  id: 'order-webhook',
  flowId: 'process-order',
  idempotencyKeyFrom: 'headers.x-request-id'
});
```
