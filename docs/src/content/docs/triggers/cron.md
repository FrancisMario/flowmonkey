---
title: Cron Triggers
description: Scheduling flows to run at specific times.
---

# Cron Triggers

Run flows on a schedule using cron expressions.

## Setup

```typescript
import { ScheduleRunner } from '@flowmonkey/triggers';

const scheduler = new ScheduleRunner(engine, store);

// Register scheduled flow
scheduler.register({
  id: 'daily-cleanup',
  schedule: '0 2 * * *',  // 2 AM daily
  flowId: 'cleanup-old-data',
  context: { daysOld: 30 }
});

// Start the scheduler
scheduler.start();
```

## Cron Expression Format

```
┌─────────────── minute (0 - 59)
│ ┌───────────── hour (0 - 23)
│ │ ┌─────────── day of month (1 - 31)
│ │ │ ┌───────── month (1 - 12)
│ │ │ │ ┌─────── day of week (0 - 6) (Sunday to Saturday)
│ │ │ │ │
* * * * *
```

## Common Patterns

```typescript
// Every minute
schedule: '* * * * *'

// Every hour
schedule: '0 * * * *'

// Daily at midnight
schedule: '0 0 * * *'

// Weekly on Monday at 9 AM
schedule: '0 9 * * 1'

// Monthly on the 1st at noon
schedule: '0 12 1 * *'
```

## Options

| Option | Description |
|--------|-------------|
| `id` | Unique schedule identifier |
| `schedule` | Cron expression |
| `flowId` | Flow to execute |
| `context` | Initial context for execution |
| `timezone` | Timezone (default: UTC) |
| `enabled` | Enable/disable schedule |

## Graceful Shutdown

```typescript
process.on('SIGTERM', async () => {
  await scheduler.stop();
  process.exit(0);
});
```
