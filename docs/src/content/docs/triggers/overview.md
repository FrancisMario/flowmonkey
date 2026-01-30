---
title: Triggers Overview
description: Starting flows from external events in FlowMonkey.
---

# Triggers Overview

Triggers start flow executions from external events—HTTP requests, schedules, or events.

## Installation

```bash
pnpm add @flowmonkey/triggers
```

## Trigger Types

- **HTTP** - Start flows via HTTP webhooks
- **Cron** - Schedule flows to run at specific times

## HTTP Trigger

```typescript
import { TriggerService } from '@flowmonkey/triggers';

const triggers = new TriggerService(engine, store);

triggers.registerHttp({
  id: 'order-webhook',
  path: '/webhooks/orders',
  flowId: 'process-order',
  transform: (req) => ({ order: req.body })
});
```

## Cron Trigger

```typescript
triggers.registerCron({
  id: 'daily-report',
  schedule: '0 9 * * *',  // 9 AM daily
  flowId: 'generate-report',
  context: { type: 'daily' }
});
```

## Next Steps

- [HTTP Triggers](/triggers/http/) - HTTP webhook triggers
- [Cron Triggers](/triggers/cron/) - Scheduled triggers
