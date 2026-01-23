# @flowmonkey/core

Core execution engine for FlowMonkey workflows.

## Quick Start

```typescript
import {
  Engine,
  DefaultFlowRegistry,
  DefaultHandlerRegistry,
  MemoryStore,
  Result,
  type Flow,
  type StepHandler,
} from '@flowmonkey/core';

// 1. Define a flow
const flow: Flow = {
  id: 'greeting',
  version: '1.0.0',
  initialStepId: 'say-hello',
  steps: {
    'say-hello': {
      id: 'say-hello',
      type: 'echo',
      config: {},
      input: { type: 'key', key: 'name' },
      outputKey: 'greeting',
      transitions: { onSuccess: null },
    },
  },
};

// 2. Define a handler
const echoHandler: StepHandler = {
  type: 'echo',
  async execute({ input }) {
    return Result.success(input);
  },
};

// 3. Set up engine
const store = new MemoryStore();
const handlers = new DefaultHandlerRegistry();
const flows = new DefaultFlowRegistry();

handlers.register(echoHandler);
flows.register(flow);

const engine = new Engine(store, handlers, flows);

// 4. Run a flow
const execution = await engine.create('greeting', { name: 'World' });
const result = await engine.run(execution.id, { simulateTime: true });

console.log(result.status); // 'completed'
```

## Architecture

- **Engine** — Stateless execution orchestrator
- **StateStore** — Persistence layer (Memory, Redis, Postgres, etc.)
- **StepHandler** — Executes individual step types
- **FlowRegistry** — Stores and validates flow definitions
- **HandlerRegistry** — Stores step handlers

## Testing

```typescript
import { TestHarness } from '@flowmonkey/core/test';

const t = new TestHarness({
  handlers: [echoHandler],
  flows: [flow],
});

const { execution } = await t.run('greeting', { name: 'World' });
t.assertCompleted(execution);
t.assertContext(execution, { greeting: 'World' });
```

## License

MIT
