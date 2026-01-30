---
title: Steps
description: Understanding step definitions in FlowMonkey flows.
---

# Steps

A **Step** is a single unit of work within a flow. Steps define what handler to run, how to get input, and where to go next.

## Step Structure

```typescript
interface Step {
  id: string;              // Unique ID within the flow
  type: string;            // Handler type to execute
  config: object;          // Static configuration
  input: InputSelector;    // How to resolve input from context
  outputKey?: string;      // Where to store result in context
  transitions: Transitions; // Next steps based on outcome
  timeout?: number;        // Step-level timeout (ms)
  retries?: RetryConfig;   // Retry configuration
}
```

## Basic Step

```typescript
const step: Step = {
  id: 'send-welcome-email',
  type: 'email',
  config: {
    template: 'welcome',
    from: 'noreply@example.com',
  },
  input: { type: 'key', key: 'user' },
  outputKey: 'welcomeEmail',
  transitions: {
    onSuccess: 'create-account',
    onFailure: 'log-email-failure',
  },
};
```

## Step Properties

### id

Unique identifier within the flow. Used for transitions and execution tracking.

```typescript
id: 'validate-order'
id: 'step-1'
id: 'send_notification'
```

### type

The handler type to execute. Must match a registered handler.

```typescript
type: 'http'        // Built-in HTTP handler
type: 'email'       // Custom email handler
type: 'transform'   // Data transformation handler
```

### config

Static configuration passed to the handler. This is **not** resolved from context.

```typescript
config: {
  timeout: 30000,
  retryOnFailure: true,
  template: 'welcome-email',
}
```

### input

Defines how to resolve input data from the execution context. See [Input Selectors](/core/input-selectors/) for all options.

```typescript
// Single key
input: { type: 'key', key: 'user' }

// Multiple keys
input: { type: 'keys', keys: ['user', 'order'] }

// Dot notation path
input: { type: 'path', path: 'order.shipping.address' }

// Template with interpolation
input: { 
  type: 'template', 
  template: {
    url: 'https://api.example.com/users/${user.id}',
    headers: { 'X-Order-Id': '${order.id}' }
  }
}

// Entire context
input: { type: 'full' }

// Static value
input: { type: 'static', value: { foo: 'bar' } }
```

### outputKey

Where to store the handler's result in the execution context.

```typescript
outputKey: 'validationResult'

// After step executes:
// context.validationResult = { valid: true, ... }
```

If `outputKey` is omitted, the result is not stored in context.

### transitions

Defines the next step based on the handler's outcome.

```typescript
transitions: {
  onSuccess: 'next-step',     // Step ID or null to complete
  onFailure: 'error-handler', // Optional failure handler
  onResume: 'resume-step',    // Optional: step after wait resume
}
```

## Step Execution

When a step executes:

1. **Input Resolution**: Resolve input from context using the selector
2. **Handler Execution**: Call the handler with input, config, and context
3. **Result Processing**:
   - **Success**: Store output in context, follow `onSuccess`
   - **Failure**: Store error, follow `onFailure` (or fail execution)
   - **Wait**: Pause execution, store wait metadata

## Timeout

Step-level timeout (overrides flow default):

```typescript
{
  id: 'external-api-call',
  type: 'http',
  config: { url: 'https://slow-api.example.com' },
  timeout: 60000,  // 60 seconds
  // ...
}
```

## Retry Configuration

Configure automatic retries:

```typescript
{
  id: 'flaky-api-call',
  type: 'http',
  config: {},
  retries: {
    maxAttempts: 3,
    backoff: 'exponential',
    initialDelay: 1000,
    maxDelay: 30000,
  },
  // ...
}
```

## Complete Example

```typescript
const steps: Record<string, Step> = {
  'validate-input': {
    id: 'validate-input',
    type: 'validate',
    config: {
      schema: {
        type: 'object',
        required: ['email', 'name'],
      },
    },
    input: { type: 'key', key: 'userData' },
    outputKey: 'validated',
    transitions: {
      onSuccess: 'create-user',
      onFailure: 'validation-failed',
    },
  },
  
  'create-user': {
    id: 'create-user',
    type: 'http',
    config: {},
    input: {
      type: 'template',
      template: {
        url: 'https://api.example.com/users',
        method: 'POST',
        body: '${validated}',
      },
    },
    outputKey: 'user',
    timeout: 10000,
    transitions: {
      onSuccess: 'send-welcome',
      onFailure: 'creation-failed',
    },
  },
  
  'send-welcome': {
    id: 'send-welcome',
    type: 'email',
    config: { template: 'welcome' },
    input: { type: 'key', key: 'user' },
    outputKey: 'email',
    transitions: { onSuccess: null },
  },
  
  'validation-failed': {
    id: 'validation-failed',
    type: 'log',
    config: { level: 'warn' },
    input: { type: 'static', value: { error: 'Validation failed' } },
    transitions: { onSuccess: null },
  },
  
  'creation-failed': {
    id: 'creation-failed',
    type: 'notify',
    config: { channel: 'errors' },
    input: { type: 'full' },
    transitions: { onSuccess: null },
  },
};
```

## Next Steps

- [Input Selectors](/core/input-selectors/) - All input resolution options
- [Transitions](/core/transitions/) - Control flow between steps
- [Handlers](/handlers/overview/) - Building step handlers
