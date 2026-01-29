# @flowmonkey/express

HTTP routes for workflow execution, triggers, resume tokens, and health checks.

All paths are relative to your application's mount point.

---

## Execution Routes

### Start Flow

```
POST /api/flows/:flowId/start
```

Starts a new workflow execution.

**Path Parameters:**
| Name | Type | Description |
|------|------|-------------|
| `flowId` | string | Workflow definition ID |

**Request Body:**
```json
{
  "context": {},
  "idempotencyKey": "string",
  "tenantId": "string",
  "metadata": {}
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `context` | object | No | Initial workflow context |
| `idempotencyKey` | string | No | Prevents duplicate executions |
| `tenantId` | string | No | Multi-tenant isolation |
| `metadata` | object | No | Custom metadata |

**Response (201):**
```json
{
  "success": true,
  "data": {
    "executionId": "exec_abc123",
    "flowId": "order-flow",
    "status": "pending",
    "created": true,
    "idempotencyHit": false
  }
}
```

---

### Get Execution

```
GET /api/executions/:executionId
```

Retrieves execution status and details.

**Path Parameters:**
| Name | Type | Description |
|------|------|-------------|
| `executionId` | string | Execution ID |

**Response (200):**
```json
{
  "success": true,
  "data": {
    "id": "exec_abc123",
    "flowId": "order-flow",
    "flowVersion": "1.0.0",
    "status": "completed",
    "currentStepId": "notify",
    "context": {},
    "stepCount": 5,
    "createdAt": 1706500000000,
    "updatedAt": 1706500005000,
    "error": null
  }
}
```

**Status Values:** `pending` | `running` | `waiting` | `completed` | `failed` | `cancelled`

---

### Resume Execution

```
POST /api/executions/:executionId/resume/:stepId
```

Resumes a waiting execution with provided data.

**Path Parameters:**
| Name | Type | Description |
|------|------|-------------|
| `executionId` | string | Execution ID |
| `stepId` | string | Step ID to resume |

**Request Body:**
```json
{
  "data": {}
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `data` | object | Yes | Resume payload |

**Response (200):**
```json
{
  "success": true,
  "data": {
    "executionId": "exec_abc123",
    "resumed": true,
    "status": "running"
  }
}
```

---

### Cancel Execution

```
POST /api/executions/:executionId/cancel
```

Cancels a running or waiting execution.

**Path Parameters:**
| Name | Type | Description |
|------|------|-------------|
| `executionId` | string | Execution ID |

**Request Body:**
```json
{
  "reason": "string"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `reason` | string | No | Cancellation reason |

**Response (200):**
```json
{
  "success": true,
  "data": {
    "executionId": "exec_abc123",
    "cancelled": true
  }
}
```

---

## Trigger Routes

### Fire Trigger

```
POST /api/triggers/:triggerId
```

Invokes a registered trigger to start a workflow.

**Path Parameters:**
| Name | Type | Description |
|------|------|-------------|
| `triggerId` | string | Trigger ID |

**Request Body:**

Body is validated against the trigger's `inputSchema`.

```json
{
  "event": "order.created",
  "data": {
    "orderId": "ord_123",
    "amount": 99.99
  }
}
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "executionId": "exec_xyz789",
    "triggerId": "order-webhook",
    "flowId": "order-flow",
    "firedAt": 1706500000000
  }
}
```

**Response (400 - Validation Failed):**
```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_FAILED",
    "message": "Request validation failed",
    "details": [
      { "path": "data.orderId", "message": "is required", "keyword": "required" }
    ]
  }
}
```

---

## Resume Token Routes

### Resume with Token

```
POST /api/tokens/:token/resume
```

Resumes an execution using a secure resume token.

**Path Parameters:**
| Name | Type | Description |
|------|------|-------------|
| `token` | string | Resume token |

**Request Body:**

Token-specific payload.

```json
{
  "approved": true,
  "notes": "Approved by manager"
}
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "executionId": "exec_abc123",
    "resumed": true
  }
}
```

**Response (400 - Invalid Token):**
```json
{
  "success": false,
  "error": {
    "code": "TOKEN_INVALID",
    "message": "Resume token is invalid or expired"
  }
}
```

---

## Admin Routes

### List Flows

```
GET /api/admin/flows
```

Lists all registered workflow definitions.

**Response (200):**
```json
{
  "success": true,
  "data": [
    {
      "id": "order-flow",
      "version": "1.0.0",
      "description": "Process incoming orders",
      "status": "published",
      "initialStepId": "validate",
      "stepCount": 5,
      "tags": ["orders", "core"]
    }
  ]
}
```

---

### List Handlers

```
GET /api/admin/handlers
```

Lists all registered step handlers.

**Response (200):**
```json
{
  "success": true,
  "data": [
    {
      "type": "http",
      "description": "Make HTTP requests",
      "stateful": false,
      "version": "1.0.0"
    },
    {
      "type": "delay",
      "description": "Pause execution",
      "stateful": true,
      "version": "1.0.0"
    }
  ]
}
```

---

### List Executions

```
GET /api/admin/executions
```

Queries executions with filtering and pagination.

**Query Parameters:**
| Name | Type | Description |
|------|------|-------------|
| `flowId` | string | Filter by flow ID |
| `status` | string | Filter by status |
| `tenantId` | string | Filter by tenant |
| `since` | number | Created after (epoch ms) |
| `until` | number | Created before (epoch ms) |
| `limit` | number | Max results (default: 50) |
| `offset` | number | Pagination offset |

**Response (200):**
```json
{
  "success": true,
  "data": {
    "executions": [
      {
        "id": "exec_abc123",
        "flowId": "order-flow",
        "status": "running",
        "currentStepId": "process",
        "createdAt": 1706500000000
      }
    ],
    "total": 142,
    "hasMore": true
  }
}
```

---

## Health Routes

### Health Check

```
GET /health
```

Basic health check.

**Response (200):**
```json
{
  "status": "healthy",
  "timestamp": 1706500000000
}
```

---

### Readiness Check

```
GET /ready
```

Readiness check with dependency status.

**Response (200):**
```json
{
  "ready": true,
  "checks": {
    "database": true,
    "redis": true
  }
}
```

**Response (503 - Not Ready):**
```json
{
  "ready": false,
  "checks": {
    "database": true,
    "redis": false
  }
}
```

---

## Route Configuration

Routes can be enabled/disabled via `RouteConfig`:

```typescript
import { Routes, RouteConfig } from '@flowmonkey/express';

const config: RouteConfig = {
  executions: true,    // /api/flows/*, /api/executions/*
  triggers: true,      // /api/triggers/*
  resumeTokens: true,  // /api/tokens/*
  admin: true,         // /api/admin/*
  health: true,        // /health, /ready
};
```

---

## Error Format

All error responses follow this structure:

```json
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable message",
    "details": {}
  }
}
```

**Common Error Codes:**
| Code | HTTP Status | Description |
|------|-------------|-------------|
| `FLOW_NOT_FOUND` | 404 | Flow ID does not exist |
| `EXECUTION_NOT_FOUND` | 404 | Execution ID does not exist |
| `VALIDATION_FAILED` | 400 | Request body validation failed |
| `TOKEN_INVALID` | 400 | Resume token invalid or expired |
| `UNAUTHORIZED` | 401 | Missing or invalid authentication |
| `INTERNAL_ERROR` | 500 | Server error |
