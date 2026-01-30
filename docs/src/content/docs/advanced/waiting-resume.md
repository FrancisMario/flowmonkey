---
title: Waiting & Resume
description: Pausing and resuming executions in FlowMonkey.
---

# Waiting & Resume

Executions can pause and wait for external events or scheduled wake times.

## Entering Wait State

Handlers return `Result.wait()` to pause execution:

```typescript
const approvalHandler: StepHandler = {
  type: 'request-approval',
  async execute({ input }) {
    // Send approval request
    await sendApprovalEmail(input.approver, input.request);
    
    // Pause execution
    return Result.wait({
      reason: 'Awaiting manager approval',
      wakeAt: Date.now() + 86400000  // Auto-wake in 24 hours
    });
  }
};
```

## Resuming Execution

Resume with optional data:

```typescript
// External event triggers resume
await engine.resume(executionId, {
  approved: true,
  approvedBy: 'manager@company.com',
  approvedAt: new Date().toISOString()
});
```

## Resume Data

Resume data is merged into context:

```typescript
// Before resume
context: { request: { ... } }

// Resume with data
await engine.resume(executionId, { approved: true });

// After resume
context: { 
  request: { ... },
  resumeData: { approved: true }
}
```

## Auto-Wake

Set `wakeAt` for automatic resumption:

```typescript
return Result.wait({
  wakeAt: Date.now() + 3600000  // 1 hour
});
```

Requires a job runner to poll for wake-ready executions.

## Transition After Resume

Use `onResume` to specify the next step:

```typescript
transitions: {
  onSuccess: null,  // Not used when waiting
  onResume: 'check-approval-result'
}
```

Without `onResume`, the current step re-executes.

## Example: Approval Workflow

```typescript
const flow: Flow = {
  id: 'approval-workflow',
  initialStepId: 'request',
  steps: {
    request: {
      id: 'request',
      type: 'send-approval-request',
      input: { type: 'full' },
      transitions: { onSuccess: 'wait' }
    },
    wait: {
      id: 'wait',
      type: 'wait-for-approval',
      input: { type: 'static', value: {} },
      transitions: {
        onSuccess: null,
        onResume: 'process-decision'
      }
    },
    'process-decision': {
      id: 'process-decision',
      type: 'check-approval',
      input: { type: 'key', key: 'resumeData' },
      transitions: {
        onSuccess: 'approved',
        onFailure: 'rejected'
      }
    },
    approved: {
      id: 'approved',
      type: 'process-approved',
      input: { type: 'full' },
      transitions: { onSuccess: null }
    },
    rejected: {
      id: 'rejected',
      type: 'process-rejected',
      input: { type: 'full' },
      transitions: { onSuccess: null }
    }
  }
};
```
