---
title: Quick Start
description: Build your first FlowMonkey workflow in 5 minutes.
---

# Quick Start

Let's build a simple greeting workflow to understand the basics.

## Setup

First, create a new project and install dependencies:

```bash
mkdir my-workflow
cd my-workflow
pnpm init
pnpm add @flowmonkey/core typescript tsx
```

## Create a Handler

Handlers execute individual step types. Create `src/handlers.ts`:

```typescript
import { type StepHandler, Result } from '@flowmonkey/core';

export const greetHandler: StepHandler = {
  type: 'greet',
  async execute({ input }) {
    const { name } = input as { name: string };
    return Result.success({ 
      message: `Hello, ${name}!`,
      timestamp: new Date().toISOString(),
    });
  },
};
```

## Define a Flow

Flows define the workflow structure. Create `src/flows.ts`:

```typescript
import type { Flow } from '@flowmonkey/core';

export const greetingFlow: Flow = {
  id: 'greeting',
  version: '1.0.0',
  name: 'Greeting Flow',
  initialStepId: 'say-hello',
  steps: {
    'say-hello': {
      id: 'say-hello',
      type: 'greet',
      config: {},
      input: { type: 'key', key: 'user' },
      outputKey: 'greeting',
      transitions: { 
        onSuccess: null,  // null means complete the flow
      },
    },
  },
};
```

## Run the Flow

Create `src/index.ts`:

```typescript
import {
  Engine,
  DefaultFlowRegistry,
  DefaultHandlerRegistry,
  MemoryStore,
} from '@flowmonkey/core';
import { greetHandler } from './handlers';
import { greetingFlow } from './flows';

async function main() {
  // 1. Set up registries
  const store = new MemoryStore();
  const handlers = new DefaultHandlerRegistry();
  const flows = new DefaultFlowRegistry();

  // 2. Register handlers and flows
  handlers.register(greetHandler);
  flows.register(greetingFlow);

  // 3. Create engine
  const engine = new Engine(store, handlers, flows);

  // 4. Create and run an execution
  const { execution } = await engine.create('greeting', {
    user: { name: 'World' },
  });

  console.log('Created execution:', execution.id);
  console.log('Status:', execution.status);

  // 5. Run to completion
  const result = await engine.run(execution.id);
  console.log('Final status:', result.status);

  // 6. Check the result
  const completed = await store.load(execution.id);
  console.log('Output:', completed?.context.greeting);
}

main().catch(console.error);
```

## Run It

```bash
npx tsx src/index.ts
```

Output:

```
Created execution: exec_abc123...
Status: pending
Final status: completed
Output: { message: 'Hello, World!', timestamp: '2026-01-27T...' }
```

## What Happened?

1. **Engine created** an execution with initial context `{ user: { name: 'World' } }`
2. **Engine ran** the `say-hello` step
3. **Handler** received `{ name: 'World' }` (resolved from `user` key)
4. **Handler** returned success with greeting message
5. **Engine** stored output in context under `greeting` key
6. **Transition** `onSuccess: null` completed the flow

## Next Steps

- [Core Concepts](/getting-started/concepts/) - Understand flows, steps, and handlers
- [Input Selectors](/core/input-selectors/) - Learn all input resolution methods
- [Custom Handlers](/handlers/custom/) - Build your own handlers
