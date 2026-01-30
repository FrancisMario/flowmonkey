---
title: Input Selectors
description: How to resolve step input from execution context.
---

# Input Selectors

Input selectors define how step input is resolved from the execution context. FlowMonkey provides six selector types for different use cases.

## Selector Types

| Type | Description | Use Case |
|------|-------------|----------|
| `key` | Single key from context | Most common, simple data access |
| `keys` | Multiple keys as object | Combining data from multiple sources |
| `path` | Dot notation path | Accessing nested properties |
| `template` | String interpolation | Building URLs, messages, etc. |
| `full` | Entire context | When you need everything |
| `static` | Static value | Constants, configuration |

## key

Retrieves a single top-level key from context.

```typescript
input: { type: 'key', key: 'user' }

// Context: { user: { name: 'Alice', email: 'alice@example.com' }, order: { id: '123' } }
// Input:   { name: 'Alice', email: 'alice@example.com' }
```

**Best for**: Simple data access where you need one piece of context data.

## keys

Retrieves multiple keys as a combined object.

```typescript
input: { type: 'keys', keys: ['user', 'order'] }

// Context: { user: { name: 'Alice' }, order: { id: '123' }, other: 'ignored' }
// Input:   { user: { name: 'Alice' }, order: { id: '123' } }
```

**Best for**: When a handler needs data from multiple context keys.

## path

Uses dot notation to access nested properties.

```typescript
input: { type: 'path', path: 'order.shipping.address' }

// Context: { order: { shipping: { address: { city: 'NYC', zip: '10001' } } } }
// Input:   { city: 'NYC', zip: '10001' }
```

Supports array access:

```typescript
input: { type: 'path', path: 'order.items.0.name' }

// Context: { order: { items: [{ name: 'Widget' }, { name: 'Gadget' }] } }
// Input:   'Widget'
```

**Best for**: Extracting specific nested data without passing the full parent.

## template

String interpolation with `${path}` syntax. Works recursively on objects.

```typescript
input: {
  type: 'template',
  template: {
    url: 'https://api.example.com/users/${user.id}/orders/${order.id}',
    method: 'GET',
    headers: {
      'Authorization': 'Bearer ${auth.token}',
      'X-Request-Id': '${requestId}'
    }
  }
}

// Context: { 
//   user: { id: '123' }, 
//   order: { id: '456' }, 
//   auth: { token: 'abc' },
//   requestId: 'req-789'
// }
// Input: {
//   url: 'https://api.example.com/users/123/orders/456',
//   method: 'GET',
//   headers: {
//     'Authorization': 'Bearer abc',
//     'X-Request-Id': 'req-789'
//   }
// }
```

Template strings work in:
- Object values (strings)
- Array elements
- Nested objects

```typescript
input: {
  type: 'template',
  template: {
    message: 'Hello ${user.name}, your order ${order.id} is confirmed!',
    items: ['${order.items.0.name}', '${order.items.1.name}'],
    nested: {
      deep: {
        value: '${some.deep.path}'
      }
    }
  }
}
```

**Best for**: Building dynamic values, URLs, messages, API payloads.

## full

Returns the entire execution context.

```typescript
input: { type: 'full' }

// Context: { user: { name: 'Alice' }, order: { id: '123' }, step1Result: { ok: true } }
// Input:   { user: { name: 'Alice' }, order: { id: '123' }, step1Result: { ok: true } }
```

**Best for**: Handlers that need access to all accumulated data (e.g., final report generation).

## static

Returns a static value, ignoring context entirely.

```typescript
input: { type: 'static', value: { action: 'cleanup', force: true } }

// Context: { anything: 'ignored' }
// Input:   { action: 'cleanup', force: true }
```

**Best for**: Configuration, constants, steps that don't need context data.

## Error Handling

Input resolution can fail in several ways:

### Missing Key

```typescript
input: { type: 'key', key: 'nonexistent' }
// Error: INPUT_RESOLUTION_ERROR - Key 'nonexistent' not found in context
```

### Invalid Path

```typescript
input: { type: 'path', path: 'user.address.city' }
// Context: { user: { name: 'Alice' } }  // no address
// Error: INPUT_RESOLUTION_ERROR - Path 'user.address.city' not found
```

### Template Resolution Failure

```typescript
input: { type: 'template', template: { url: '${missing.path}' } }
// Error: INPUT_RESOLUTION_ERROR - Template variable 'missing.path' not found
```

## Choosing the Right Selector

| Scenario | Recommended Selector |
|----------|---------------------|
| Pass one context key to handler | `key` |
| Handler needs multiple keys | `keys` |
| Extract nested value | `path` |
| Build dynamic URL/message | `template` |
| Handler needs everything | `full` |
| Fixed configuration value | `static` |

## Examples

### HTTP Request with Template

```typescript
{
  id: 'fetch-user-orders',
  type: 'http',
  input: {
    type: 'template',
    template: {
      url: 'https://api.example.com/users/${user.id}/orders',
      method: 'GET',
      headers: {
        'Authorization': 'Bearer ${auth.accessToken}'
      }
    }
  },
  // ...
}
```

### Email with Multiple Keys

```typescript
{
  id: 'send-order-confirmation',
  type: 'email',
  input: {
    type: 'keys',
    keys: ['user', 'order', 'payment']
  },
  // Handler receives: { user: {...}, order: {...}, payment: {...} }
}
```

### Validation with Path

```typescript
{
  id: 'validate-shipping-address',
  type: 'validate-address',
  input: {
    type: 'path',
    path: 'order.shipping.address'
  },
  // Handler receives just the address object
}
```

## Next Steps

- [Transitions](/core/transitions/) - Control flow between steps
- [Steps](/core/steps/) - Complete step reference
- [Handlers](/handlers/custom/) - Building custom handlers
