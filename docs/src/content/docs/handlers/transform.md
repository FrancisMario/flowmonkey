---
title: Transform Handler
description: Data transformation in FlowMonkey workflows.
---

# Transform Handler

The transform handler manipulates data using JavaScript expressions.

## Usage

```typescript
{
  id: 'transform-data',
  type: 'transform',
  config: {
    expression: 'data.items.map(i => ({ id: i.id, name: i.name.toUpperCase() }))'
  },
  input: { type: 'key', key: 'orderData' },
  outputKey: 'transformedItems',
  transitions: { onSuccess: 'next-step' }
}
```

## Common Patterns

### Pick Fields

```typescript
config: {
  expression: '({ name: data.name, email: data.email })'
}
```

### Filter Arrays

```typescript
config: {
  expression: 'data.items.filter(i => i.active)'
}
```

### Combine Data

```typescript
input: { type: 'keys', keys: ['user', 'order'] }
config: {
  expression: '({ ...data.user, orderId: data.order.id })'
}
```

## Output

The result of the expression evaluation is stored in `outputKey`.
