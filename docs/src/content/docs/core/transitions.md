---
title: Transitions
description: Controlling flow between steps in FlowMonkey.
---

# Transitions

Transitions define what happens after a step executes. They control the flow of execution based on step outcomes.

## Transition Structure

```typescript
interface Transitions {
  onSuccess: string | null;  // Next step on success, null to complete
  onFailure?: string | null; // Next step on failure (optional)
  onResume?: string | null;  // Next step after wait resume (optional)
}
```

## Basic Transitions

### Success Transition

Every step must define `onSuccess`:

```typescript
transitions: {
  onSuccess: 'next-step'  // Continue to 'next-step'
}

transitions: {
  onSuccess: null  // Complete the flow
}
```

### Failure Transition

Optional `onFailure` handles handler failures:

```typescript
transitions: {
  onSuccess: 'process-payment',
  onFailure: 'handle-validation-error'  // If handler returns failure
}
```

Without `onFailure`, the execution fails when a handler fails.

### Resume Transition

Optional `onResume` for wait/resume flows:

```typescript
transitions: {
  onSuccess: null,        // Not used when waiting
  onResume: 'process-approval'  // After resume() is called
}
```

## Transition Behavior

### On Success

When a handler returns `Result.success()`:

1. Output stored in context (if `outputKey` defined)
2. Execution moves to `onSuccess` step
3. If `onSuccess: null`, execution completes

```typescript
// Handler
return Result.success({ validated: true });

// Step config
outputKey: 'validation',
transitions: { onSuccess: 'next-step' }

// Result
// context.validation = { validated: true }
// currentStepId = 'next-step'
```

### On Failure

When a handler returns `Result.failure()`:

1. Error stored in execution
2. If `onFailure` defined, execution moves to that step
3. If no `onFailure`, execution status becomes `failed`

```typescript
// Handler
return Result.failure({ 
  code: 'VALIDATION_ERROR', 
  message: 'Invalid email' 
});

// Step config with onFailure
transitions: { 
  onSuccess: 'next-step',
  onFailure: 'handle-error' 
}
// Result: currentStepId = 'handle-error'

// Step config without onFailure
transitions: { onSuccess: 'next-step' }
// Result: execution.status = 'failed'
```

### On Wait

When a handler returns `Result.wait()`:

1. Execution status becomes `waiting`
2. Wait metadata stored
3. Flow pauses until `resume()` called

```typescript
// Handler
return Result.wait({ 
  wakeAt: Date.now() + 86400000,
  reason: 'Awaiting approval' 
});

// Result
// execution.status = 'waiting'
// execution.waitMetadata = { wakeAt: ..., reason: '...' }
```

### On Resume

When `engine.resume()` is called on a waiting execution:

1. Resume data merged into context
2. If `onResume` defined, go to that step
3. Otherwise, re-execute the current step

```typescript
// Resume with data
await engine.resume(executionId, { approved: true });

// Step config with onResume
transitions: { 
  onSuccess: null,
  onResume: 'process-approval'  // Go here after resume
}

// Step config without onResume
transitions: { onSuccess: null }
// Re-executes current step with new context
```

## Common Patterns

### Linear Flow

```typescript
steps: {
  'step-1': {
    transitions: { onSuccess: 'step-2' }
  },
  'step-2': {
    transitions: { onSuccess: 'step-3' }
  },
  'step-3': {
    transitions: { onSuccess: null }  // Complete
  }
}
```

### Branching

```typescript
steps: {
  'validate': {
    type: 'validate-order',
    transitions: {
      onSuccess: 'process',
      onFailure: 'reject'
    }
  },
  'process': {
    transitions: { onSuccess: 'confirm' }
  },
  'reject': {
    transitions: { onSuccess: null }
  },
  'confirm': {
    transitions: { onSuccess: null }
  }
}
```

### Error Recovery

```typescript
steps: {
  'call-api': {
    type: 'http',
    transitions: {
      onSuccess: 'process-response',
      onFailure: 'retry-or-fallback'
    }
  },
  'retry-or-fallback': {
    type: 'conditional',
    // Check retry count, decide to retry or use fallback
    transitions: {
      onSuccess: 'use-fallback',  // Based on handler logic
    }
  },
  'process-response': {
    transitions: { onSuccess: null }
  },
  'use-fallback': {
    transitions: { onSuccess: null }
  }
}
```

### Wait and Resume

```typescript
steps: {
  'request-approval': {
    type: 'send-approval-request',
    transitions: { onSuccess: 'wait-for-approval' }
  },
  'wait-for-approval': {
    type: 'wait',
    // Handler returns Result.wait()
    transitions: {
      onSuccess: null,  // Not used
      onResume: 'check-approval'
    }
  },
  'check-approval': {
    type: 'check-approval-status',
    // Checks context.approved (from resume data)
    transitions: {
      onSuccess: 'process-approved',
      onFailure: 'process-rejected'
    }
  },
  'process-approved': {
    transitions: { onSuccess: null }
  },
  'process-rejected': {
    transitions: { onSuccess: null }
  }
}
```

### Convergence

Multiple paths converging to a single step:

```typescript
steps: {
  'check-type': {
    type: 'router',
    transitions: {
      onSuccess: 'type-a-handler',  // Or 'type-b-handler' based on logic
    }
  },
  'type-a-handler': {
    transitions: { onSuccess: 'finalize' }  // Converge
  },
  'type-b-handler': {
    transitions: { onSuccess: 'finalize' }  // Converge
  },
  'finalize': {
    transitions: { onSuccess: null }
  }
}
```

## Validation

Transitions are validated when a flow is registered:

- All transition targets must be valid step IDs or `null`
- Circular references are allowed (for loops)
- Missing step references cause registration errors

```typescript
// Invalid - 'nonexistent' is not a step
transitions: { onSuccess: 'nonexistent' }
// Error: Invalid transition target 'nonexistent'
```

## Next Steps

- [Execution Lifecycle](/core/execution-lifecycle/) - Full state machine
- [Waiting & Resume](/advanced/waiting-resume/) - Pause/resume patterns
- [Error Handling](/advanced/error-handling/) - Error strategies
