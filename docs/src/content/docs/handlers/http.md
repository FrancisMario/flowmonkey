---
title: HTTP Handler
description: Making HTTP requests in FlowMonkey workflows.
---

# HTTP Handler

The HTTP handler makes HTTP requests to external APIs.

## Usage

```typescript
{
  id: 'fetch-user',
  type: 'http',
  config: {
    timeout: 30000,
  },
  input: {
    type: 'template',
    template: {
      url: 'https://api.example.com/users/${userId}',
      method: 'GET',
      headers: {
        'Authorization': 'Bearer ${auth.token}'
      }
    }
  },
  outputKey: 'user',
  transitions: { onSuccess: 'next-step' }
}
```

## Input Schema

```typescript
interface HttpInput {
  url: string;
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  headers?: Record<string, string>;
  body?: unknown;
  timeout?: number;
}
```

## Examples

### GET Request

```typescript
input: {
  type: 'template',
  template: {
    url: 'https://api.example.com/users/${user.id}',
    method: 'GET'
  }
}
```

### POST Request with Body

```typescript
input: {
  type: 'template',
  template: {
    url: 'https://api.example.com/orders',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: {
      userId: '${user.id}',
      items: '${cart.items}',
      total: '${cart.total}'
    }
  }
}
```

## Output

```typescript
{
  status: 200,
  headers: { 'content-type': 'application/json' },
  body: { /* parsed response */ }
}
```

## Error Handling

The handler returns failure for:
- Non-2xx status codes
- Network errors
- Timeout exceeded

Use `onFailure` transition for error handling:

```typescript
transitions: {
  onSuccess: 'process-response',
  onFailure: 'handle-api-error'
}
```
