---
title: Cancellation
description: Cancelling executions in FlowMonkey.
---

# Cancellation

Executions can be cancelled while running or waiting.

## Cancelling an Execution

```typescript
const result = await engine.cancel(executionId, {
  source: 'user',
  reason: 'Customer requested cancellation'
});

if (result.cancelled) {
  console.log('Execution cancelled');
} else {
  console.log('Cannot cancel:', result.error);
}
```

## Cancellation Sources

| Source | Description |
|--------|-------------|
| `user` | User-initiated cancellation |
| `system` | System-initiated (e.g., cleanup) |
| `timeout` | Execution timeout |
| `admin` | Administrative action |

## Cancellable States

- ✅ `pending` - Can be cancelled
- ✅ `running` - Can be cancelled (between steps)
- ✅ `waiting` - Can be cancelled
- ❌ `completed` - Cannot be cancelled
- ❌ `failed` - Cannot be cancelled
- ❌ `cancelled` - Already cancelled

## Cancellation Data

After cancellation:

```typescript
const execution = await store.load(executionId);

console.log(execution.status);  // 'cancelled'
console.log(execution.cancellation);
// {
//   source: 'user',
//   reason: 'Customer requested cancellation',
//   cancelledAt: 1706300000000
// }
```

## Cleanup Handlers

Register cleanup logic for cancellation:

```typescript
engine.on('cancelled', async (execution) => {
  // Cleanup resources
  await releaseReservations(execution.context.reservationId);
  await notifyUser(execution.context.userId, 'Order cancelled');
});
```
