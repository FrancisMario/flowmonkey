---
title: Core Concepts
description: Understanding the fundamental concepts in FlowMonkey.
---

# Core Concepts

FlowMonkey is built around a few simple concepts that compose together to enable complex workflows.

## The Engine

The **Engine** is the heart of FlowMonkey. It's completely stateless—all mutable state lives in `Execution` objects persisted via a `StateStore`.

```typescript
const engine = new Engine(store, handlers, flows);
```

The engine is responsible for:

- Creating new executions
- Running executions step-by-step
- Handling transitions between steps
- Managing waiting and resume
- Coordinating cancellation

## Flows

A **Flow** is a workflow definition. It contains:

- Unique identifier and version
- A set of steps
- An initial step ID
- Optional metadata

```typescript
const flow: Flow = {
  id: 'order-processing',
  version: '1.0.0',
  name: 'Order Processing',
  initialStepId: 'validate-order',
  steps: {
    'validate-order': { /* step definition */ },
    'process-payment': { /* step definition */ },
    'send-confirmation': { /* step definition */ },
  },
};
```

Flows are **immutable definitions**. When you need to change a flow, create a new version.

## Steps

A **Step** is a single unit of work within a flow. Each step has:

| Property | Description |
|----------|-------------|
| `id` | Unique identifier within the flow |
| `type` | Handler type to execute |
| `config` | Static configuration for the handler |
| `input` | Input selector (how to get data from context) |
| `outputKey` | Where to store the result in context |
| `transitions` | What to do after execution |

```typescript
const step: Step = {
  id: 'send-email',
  type: 'email',
  config: { 
    template: 'welcome',
  },
  input: { type: 'key', key: 'user' },
  outputKey: 'emailResult',
  transitions: {
    onSuccess: 'next-step',
    onFailure: 'handle-error',
  },
};
```

## Handlers

**Handlers** implement the actual logic for step types. They receive input and return a result:

```typescript
const emailHandler: StepHandler = {
  type: 'email',
  async execute({ input, config, context, step, execution }) {
    // Do the work
    await sendEmail(input.email, config.template);
    
    // Return result
    return Result.success({ sent: true });
  },
};
```

Handlers can return three types of results:

- **Success**: Step completed, continue to `onSuccess` transition
- **Failure**: Step failed, continue to `onFailure` transition
- **Wait**: Pause execution until resumed or woken

## Executions

An **Execution** is a running instance of a flow. It tracks:

| Property | Description |
|----------|-------------|
| `id` | Unique execution ID |
| `flowId` | The flow being executed |
| `status` | Current status (pending, running, waiting, completed, failed, cancelled) |
| `context` | Accumulated data from step outputs |
| `currentStepId` | The step currently being executed |
| `history` | Record of all executed steps |
| `error` | Error details if failed |

```typescript
// Execution lifecycle
pending → running → completed
                 → failed
                 → waiting → running → ...
                 → cancelled
```

## Context

The **context** is a key-value store that accumulates data as steps execute. Each step can:

1. **Read** from context using input selectors
2. **Write** to context via `outputKey`

```typescript
// Initial context
{ user: { name: 'Alice', email: 'alice@example.com' } }

// After 'validate' step (outputKey: 'validated')
{ 
  user: { name: 'Alice', email: 'alice@example.com' },
  validated: { valid: true, normalizedEmail: 'alice@example.com' }
}

// After 'send-email' step (outputKey: 'emailResult')
{ 
  user: { ... },
  validated: { ... },
  emailResult: { sent: true, messageId: 'msg_123' }
}
```

## Registries

FlowMonkey uses registries to manage handlers and flows:

```typescript
// Handler registry
const handlers = new DefaultHandlerRegistry();
handlers.register(emailHandler);
handlers.register(httpHandler);

// Flow registry
const flows = new DefaultFlowRegistry();
flows.register(orderFlow);
flows.register(refundFlow);
```

## State Store

The **StateStore** interface defines how executions are persisted:

```typescript
interface StateStore {
  save(execution: Execution): Promise<void>;
  load(id: string): Promise<Execution | null>;
  delete(id: string): Promise<void>;
  findByIdempotencyKey(key: string): Promise<Execution | null>;
}
```

FlowMonkey provides:

- `MemoryStore` - For development and testing
- `PgExecutionStore` - PostgreSQL persistence for production

## Next Steps

- [Engine](/core/engine/) - Deep dive into the execution engine
- [Input Selectors](/core/input-selectors/) - All ways to resolve input
- [Transitions](/core/transitions/) - Control flow between steps
