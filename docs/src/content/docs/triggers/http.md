---
title: HTTP Triggers
description: Starting flows via HTTP webhooks.
---

# HTTP Triggers

Start flow executions via HTTP requests.

## Setup

```typescript
import express from 'express';
import { createHttpHandler } from '@flowmonkey/triggers';

const app = express();
const handler = createHttpHandler(engine, store);

// Register webhook endpoint
app.post('/webhooks/:triggerId', handler);
```

## Registration

```typescript
triggers.registerHttp({
  id: 'github-webhook',
  path: '/webhooks/github',
  flowId: 'process-github-event',
  method: 'POST',
  transform: (req) => ({
    event: req.headers['x-github-event'],
    payload: req.body
  }),
  idempotencyKeyFrom: 'headers.x-github-delivery'
});
```

## Options

| Option | Description |
|--------|-------------|
| `id` | Unique trigger identifier |
| `path` | URL path for the webhook |
| `flowId` | Flow to start |
| `method` | HTTP method (default: POST) |
| `transform` | Transform request to context |
| `idempotencyKeyFrom` | Extract idempotency key |

## Authentication

Add authentication middleware:

```typescript
const authenticatedHandler = (req, res, next) => {
  const secret = req.headers['x-webhook-secret'];
  if (secret !== process.env.WEBHOOK_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
};

app.post('/webhooks/:triggerId', authenticatedHandler, handler);
```
