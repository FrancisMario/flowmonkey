---
title: Flows
description: Defining workflow structures in FlowMonkey.
---

# Flows

A **Flow** is a workflow definition that describes the steps to execute and how they connect.

## Flow Structure

```typescript
interface Flow {
  id: string;              // Unique identifier
  version: string;         // Semantic version
  name?: string;           // Human-readable name
  description?: string;    // Optional description
  initialStepId: string;   // First step to execute
  steps: Record<string, Step>;  // Step definitions
  metadata?: Record<string, unknown>;  // Custom metadata
}
```

## Basic Example

```typescript
const orderFlow: Flow = {
  id: 'process-order',
  version: '1.0.0',
  name: 'Order Processing',
  description: 'Validates and processes customer orders',
  initialStepId: 'validate',
  steps: {
    validate: {
      id: 'validate',
      type: 'validate-order',
      config: {},
      input: { type: 'key', key: 'order' },
      outputKey: 'validation',
      transitions: {
        onSuccess: 'charge-payment',
        onFailure: 'reject-order',
      },
    },
    'charge-payment': {
      id: 'charge-payment',
      type: 'http',
      config: {
        timeout: 30000,
      },
      input: {
        type: 'template',
        template: {
          url: 'https://api.stripe.com/v1/charges',
          method: 'POST',
          body: {
            amount: '${validation.total}',
            currency: 'usd',
          },
        },
      },
      outputKey: 'payment',
      transitions: {
        onSuccess: 'send-confirmation',
        onFailure: 'refund-and-notify',
      },
    },
    'send-confirmation': {
      id: 'send-confirmation',
      type: 'email',
      config: { template: 'order-confirmation' },
      input: { type: 'full' },
      outputKey: 'email',
      transitions: { onSuccess: null },  // Complete flow
    },
    'reject-order': {
      id: 'reject-order',
      type: 'email',
      config: { template: 'order-rejected' },
      input: { type: 'keys', keys: ['order', 'validation'] },
      outputKey: 'rejection',
      transitions: { onSuccess: null },
    },
    'refund-and-notify': {
      id: 'refund-and-notify',
      type: 'http',
      config: {},
      input: { type: 'key', key: 'payment' },
      outputKey: 'refund',
      transitions: { onSuccess: null },
    },
  },
};
```

## Flow Versioning

Flows should be versioned using semantic versioning:

```typescript
const flowV1: Flow = {
  id: 'order-processing',
  version: '1.0.0',
  // ...
};

const flowV2: Flow = {
  id: 'order-processing',
  version: '2.0.0',
  // Updated steps, new transitions, etc.
};
```

The registry can store multiple versions:

```typescript
flows.register(flowV1);
flows.register(flowV2);

// Get specific version
const flow = flows.get('order-processing', '1.0.0');

// Get latest version
const latest = flows.get('order-processing');
```

## Flow Registration

Register flows with the flow registry:

```typescript
import { DefaultFlowRegistry } from '@flowmonkey/core';

const flows = new DefaultFlowRegistry();

// Register a single flow
flows.register(orderFlow);

// Register multiple flows
flows.register(refundFlow);
flows.register(notificationFlow);

// Check if flow exists
if (flows.has('process-order')) {
  const flow = flows.get('process-order');
}
```

## Flow Validation

Flows are validated on registration:

- All step IDs must be unique
- `initialStepId` must reference a valid step
- All transition targets must reference valid steps or be `null`
- Step types must have registered handlers (validated at runtime)

## Visual Flow

```
┌─────────────────────────────────────────────────────┐
│                   process-order                      │
├─────────────────────────────────────────────────────┤
│                                                      │
│    ┌──────────┐                                     │
│    │ validate │                                     │
│    └────┬─────┘                                     │
│         │                                            │
│    success│failure                                   │
│         │    │                                       │
│         ▼    └────────────┐                         │
│  ┌──────────────┐         ▼                         │
│  │charge-payment│   ┌─────────────┐                 │
│  └──────┬───────┘   │reject-order │                 │
│         │           └──────┬──────┘                 │
│    success│failure         │                         │
│         │    │             ▼                         │
│         ▼    │         [complete]                   │
│  ┌───────────────┐                                  │
│  │send-confirmation│    ┌────────────────┐          │
│  └───────┬───────┘◄────│refund-and-notify│          │
│          │              └────────────────┘          │
│          ▼                                          │
│      [complete]                                     │
│                                                      │
└─────────────────────────────────────────────────────┘
```

## Next Steps

- [Steps](/core/steps/) - Step definition details
- [Transitions](/core/transitions/) - Control flow logic
- [Input Selectors](/core/input-selectors/) - Data resolution
