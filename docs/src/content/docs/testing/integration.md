---
title: Integration Testing
description: Integration testing FlowMonkey with real dependencies.
---

# Integration Testing

Test FlowMonkey with real databases and services.

## PostgreSQL Integration

```typescript
import { Pool } from 'pg';
import { PgExecutionStore, applySchema } from '@flowmonkey/postgres';
import { Engine } from '@flowmonkey/core';

describe('integration tests', () => {
  let pool: Pool;
  let store: PgExecutionStore;
  let engine: Engine;

  beforeAll(async () => {
    pool = new Pool({
      host: 'localhost',
      database: 'flowmonkey_test',
      user: 'postgres',
      password: 'password'
    });
    
    await applySchema(pool);
    store = new PgExecutionStore(pool);
    engine = new Engine(store, handlers, flows);
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    // Clean up between tests
    await pool.query('TRUNCATE executions');
  });

  it('persists execution', async () => {
    const { execution } = await engine.create('my-flow', { data: 'value' });
    await engine.run(execution.id);

    const loaded = await store.load(execution.id);
    expect(loaded?.status).toBe('completed');
  });
});
```

## Docker Compose Setup

```yaml
# docker-compose.test.yml
version: '3.8'

services:
  postgres:
    image: postgres:15
    environment:
      POSTGRES_DB: flowmonkey_test
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: password
    ports:
      - "5432:5432"

  redis:
    image: redis:7
    ports:
      - "6379:6379"
```

Run tests:

```bash
docker-compose -f docker-compose.test.yml up -d
pnpm test:integration
docker-compose -f docker-compose.test.yml down
```

## Testing Triggers

```typescript
import request from 'supertest';
import express from 'express';
import { createHttpHandler, TriggerService } from '@flowmonkey/triggers';

describe('HTTP triggers', () => {
  let app: express.Application;
  let triggers: TriggerService;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    
    triggers = new TriggerService(engine, store);
    triggers.registerHttp({
      id: 'test-webhook',
      path: '/webhooks/test',
      flowId: 'webhook-flow'
    });
    
    app.post('/webhooks/:triggerId', createHttpHandler(triggers));
  });

  it('starts flow on webhook', async () => {
    const response = await request(app)
      .post('/webhooks/test-webhook')
      .send({ event: 'test' })
      .expect(202);

    expect(response.body.executionId).toBeDefined();
  });
});
```

## Testing with Mocks

Use dependency injection for external services:

```typescript
const createEngine = (deps: {
  emailService?: EmailService;
  paymentService?: PaymentService;
}) => {
  const handlers = new DefaultHandlerRegistry();
  
  handlers.register({
    type: 'send-email',
    async execute({ input }) {
      await deps.emailService?.send(input);
      return Result.success({ sent: true });
    }
  });
  
  return new Engine(new MemoryStore(), handlers, flows);
};

// In tests
const mockEmailService = {
  send: vi.fn().mockResolvedValue(undefined)
};

const engine = createEngine({ emailService: mockEmailService });
```

## CI/CD Integration

```yaml
# .github/workflows/test.yml
name: Tests

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    
    services:
      postgres:
        image: postgres:15
        env:
          POSTGRES_DB: flowmonkey_test
          POSTGRES_USER: postgres
          POSTGRES_PASSWORD: password
        ports:
          - 5432:5432

    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v2
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'pnpm'
      
      - run: pnpm install
      - run: pnpm test
        env:
          DATABASE_URL: postgres://postgres:password@localhost:5432/flowmonkey_test
```
