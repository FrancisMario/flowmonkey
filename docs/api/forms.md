# @flowmonkey/forms

HTTP routes for form management and submissions.

All paths are relative to your application's mount point.

---

## Form CRUD Routes

### List Forms

```
GET /api/forms
```

Lists all form definitions with optional filtering.

**Query Parameters:**
| Name | Type | Description |
|------|------|-------------|
| `tenantId` | string | Filter by tenant |
| `flowId` | string | Filter by associated flow |
| `enabled` | boolean | Filter by enabled status |

**Response (200):**
```json
{
  "success": true,
  "data": [
    {
      "id": "contact-form",
      "name": "Contact Form",
      "flowId": "contact-workflow",
      "enabled": true,
      "createdAt": 1706500000000
    }
  ]
}
```

---

### Create Form

```
POST /api/forms
```

Creates a new form definition.

**Request Body:**
```json
{
  "name": "Contact Form",
  "flowId": "contact-workflow",
  "contextKey": "formData",
  "tenantId": "tenant-abc",
  "fields": [
    {
      "name": "email",
      "type": "email",
      "label": "Email Address",
      "required": true
    },
    {
      "name": "message",
      "type": "textarea",
      "label": "Message",
      "required": true,
      "maxLength": 1000
    }
  ],
  "security": {
    "captcha": {
      "provider": "recaptcha-v3",
      "siteKey": "...",
      "secretKey": "...",
      "minScore": 0.5
    },
    "rateLimit": {
      "maxSubmissions": 5,
      "windowSeconds": 3600,
      "keyBy": "ip"
    },
    "honeypot": {
      "fieldName": "_hp"
    }
  },
  "enabled": true,
  "successMessage": "Thank you!"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | Yes | Form display name |
| `flowId` | string | Yes | Workflow to trigger on submit |
| `contextKey` | string | No | Key in workflow context for form data |
| `tenantId` | string | No | Multi-tenant isolation |
| `fields` | array | Yes | Form field definitions |
| `security` | object | No | Security configuration |
| `enabled` | boolean | No | Whether form accepts submissions (default: true) |
| `successMessage` | string | No | Message shown after submission |

**Response (201):**
```json
{
  "success": true,
  "data": {
    "id": "form_a1b2c3",
    "name": "Contact Form",
    "flowId": "contact-workflow",
    "enabled": true,
    "createdAt": 1706500000000,
    "updatedAt": 1706500000000
  }
}
```

---

### Get Form

```
GET /api/forms/:formId
```

Retrieves a form definition by ID.

**Path Parameters:**
| Name | Type | Description |
|------|------|-------------|
| `formId` | string | Form ID |

**Response (200):**
```json
{
  "success": true,
  "data": {
    "id": "contact-form",
    "name": "Contact Form",
    "flowId": "contact-workflow",
    "contextKey": "formData",
    "fields": [...],
    "security": {...},
    "enabled": true,
    "createdAt": 1706500000000,
    "updatedAt": 1706500000000
  }
}
```

---

### Update Form

```
PATCH /api/forms/:formId
```

Updates a form definition.

**Path Parameters:**
| Name | Type | Description |
|------|------|-------------|
| `formId` | string | Form ID |

**Request Body:**

Partial update - include only fields to change.

```json
{
  "name": "Updated Form Name",
  "enabled": false
}
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "id": "contact-form",
    "name": "Updated Form Name",
    "enabled": false,
    "updatedAt": 1706500010000
  }
}
```

---

### Delete Form

```
DELETE /api/forms/:formId
```

Deletes a form definition.

**Path Parameters:**
| Name | Type | Description |
|------|------|-------------|
| `formId` | string | Form ID |

**Response (200):**
```json
{
  "success": true,
  "data": {
    "deleted": true
  }
}
```

---

## Submission Routes

### Submit Form

```
POST /api/forms/:formId/submit
```

Submits form data and triggers the associated workflow.

**Path Parameters:**
| Name | Type | Description |
|------|------|-------------|
| `formId` | string | Form ID |

**Request Body:**

Field values matching the form definition.

```json
{
  "email": "user@example.com",
  "message": "Hello, I have a question...",
  "_captcha": "recaptcha-token"
}
```

**Request Headers:**
| Header | Description |
|--------|-------------|
| `X-Forwarded-For` | Client IP (for rate limiting) |
| `User-Agent` | Client user agent |

**Response (200):**
```json
{
  "success": true,
  "submissionId": "sub_xyz789",
  "executionId": "exec_abc123",
  "message": "Thank you!"
}
```

**Response (400 - Validation Failed):**
```json
{
  "success": false,
  "submissionId": "sub_xyz789",
  "errorCode": "VALIDATION_FAILED",
  "message": "Form validation failed",
  "errors": [
    { "field": "email", "message": "Email Address must be a valid email address" }
  ]
}
```

**Response (429 - Rate Limited):**
```json
{
  "success": false,
  "submissionId": "sub_xyz789",
  "errorCode": "RATE_LIMITED",
  "message": "Too many submissions. Try again in 3542 seconds."
}
```

---

### List Submissions

```
GET /api/forms/:formId/submissions
```

Lists submissions for a form.

**Path Parameters:**
| Name | Type | Description |
|------|------|-------------|
| `formId` | string | Form ID |

**Query Parameters:**
| Name | Type | Description |
|------|------|-------------|
| `status` | string | Filter by status |
| `since` | number | Submitted after (epoch ms) |
| `until` | number | Submitted before (epoch ms) |
| `limit` | number | Max results (default: 50) |
| `offset` | number | Pagination offset |

**Response (200):**
```json
{
  "success": true,
  "data": {
    "submissions": [
      {
        "id": "sub_xyz789",
        "formId": "contact-form",
        "status": "completed",
        "executionId": "exec_abc123",
        "submittedAt": 1706500000000,
        "durationMs": 245
      }
    ],
    "total": 89
  }
}
```

---

### Get Submission

```
GET /api/submissions/:submissionId
```

Retrieves a specific submission.

**Path Parameters:**
| Name | Type | Description |
|------|------|-------------|
| `submissionId` | string | Submission ID |

**Response (200):**
```json
{
  "success": true,
  "data": {
    "id": "sub_xyz789",
    "formId": "contact-form",
    "status": "completed",
    "data": {
      "email": "user@example.com",
      "message": "Hello..."
    },
    "meta": {
      "ip": "192.168.1.1",
      "userAgent": "Mozilla/5.0..."
    },
    "executionId": "exec_abc123",
    "submittedAt": 1706500000000,
    "completedAt": 1706500000245,
    "durationMs": 245
  }
}
```

---

## Public Routes

These routes do not require authentication.

### Get Public Form

```
GET /forms/:formId
```

Retrieves form schema for client-side rendering. Excludes sensitive security configuration.

**Path Parameters:**
| Name | Type | Description |
|------|------|-------------|
| `formId` | string | Form ID |

**Response (200):**
```json
{
  "id": "contact-form",
  "name": "Contact Form",
  "fields": [
    {
      "name": "email",
      "type": "email",
      "label": "Email Address",
      "required": true,
      "placeholder": "you@example.com"
    },
    {
      "name": "message",
      "type": "textarea",
      "label": "Message",
      "required": true,
      "maxLength": 1000,
      "rows": 5
    }
  ],
  "captcha": {
    "provider": "recaptcha-v3",
    "siteKey": "6Le..."
  },
  "honeypotField": "_hp",
  "submitLabel": "Send Message"
}
```

---

### Public Submit

```
POST /forms/:formId
```

Public form submission endpoint. Accepts `application/json` or `application/x-www-form-urlencoded`.

**Path Parameters:**
| Name | Type | Description |
|------|------|-------------|
| `formId` | string | Form ID |

**Request Body:**

Same as `/api/forms/:formId/submit`.

**Response:**

Same as `/api/forms/:formId/submit`.

---

## Route Configuration

Routes can be enabled/disabled via `FormRouteConfig`:

```typescript
import { FormRoutes, FormRouteConfig } from '@flowmonkey/forms';

const config: FormRouteConfig = {
  admin: true,        // /api/forms/*
  submissions: true,  // /api/forms/*/submissions, /api/submissions/*
  public: true,       // /forms/*
  basePath: '',       // Optional prefix
};
```

---

## Field Types

| Type | Description | Additional Properties |
|------|-------------|-----------------------|
| `text` | Single-line text input | `minLength`, `maxLength`, `pattern` |
| `textarea` | Multi-line text input | `minLength`, `maxLength`, `rows` |
| `email` | Email address input | `minLength`, `maxLength` |
| `number` | Numeric input | `min`, `max` |
| `select` | Dropdown selection | `options[]` |
| `checkbox` | Boolean checkbox | - |
| `radio` | Radio button group | `options[]` |
| `date` | Date picker | `min`, `max` |
| `file` | File upload | `accept[]`, `maxSize` |
| `hidden` | Hidden field | - |

---

## Security Options

### CAPTCHA

```json
{
  "captcha": {
    "provider": "recaptcha-v3",
    "siteKey": "public-key",
    "secretKey": "secret-key",
    "minScore": 0.5
  }
}
```

**Providers:** `recaptcha-v2` | `recaptcha-v3` | `hcaptcha` | `turnstile` | `custom`

### Rate Limiting

```json
{
  "rateLimit": {
    "maxSubmissions": 5,
    "windowSeconds": 3600,
    "keyBy": "ip"
  }
}
```

**Rate Limit Headers (429 Response):**
| Header | Description |
|--------|-------------|
| `Retry-After` | Seconds until limit resets |
| `X-RateLimit-Limit` | Max submissions allowed |
| `X-RateLimit-Remaining` | Submissions remaining |
| `X-RateLimit-Reset` | Reset time (epoch seconds) |

### Honeypot

```json
{
  "honeypot": {
    "fieldName": "_hp"
  }
}
```

### Deduplication

```json
{
  "deduplication": {
    "windowSeconds": 300,
    "fields": ["email", "message"]
  }
}
```

---

## Error Codes

| Code | HTTP Status | Description |
|------|-------------|-------------|
| `FORM_NOT_FOUND` | 404 | Form ID does not exist |
| `FORM_DISABLED` | 400 | Form is not accepting submissions |
| `VALIDATION_FAILED` | 400 | Field validation failed |
| `CAPTCHA_FAILED` | 400 | CAPTCHA verification failed |
| `RATE_LIMITED` | 429 | Too many submissions |
| `DUPLICATE_SUBMISSION` | 400 | Duplicate submission detected |
| `HONEYPOT_TRIGGERED` | 400 | Bot detected via honeypot |
