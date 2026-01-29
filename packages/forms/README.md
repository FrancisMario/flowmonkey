# @flowmonkey/forms

Secure form submission handling for FlowMonkey workflows. Create forms that trigger workflows with built-in security features like CAPTCHA, rate limiting, honeypot fields, and duplicate detection.

## Installation

```bash
npm install @flowmonkey/forms
# or
pnpm add @flowmonkey/forms
```

## Quick Start

```typescript
import { FormService, MemoryFormStore, MemorySubmissionStore } from '@flowmonkey/forms';
import { Engine } from '@flowmonkey/core';

// Create stores (use PgFormStore/PgSubmissionStore for production)
const formStore = new MemoryFormStore();
const submissionStore = new MemorySubmissionStore();

// Create form service
const formService = new FormService(formStore, submissionStore, engine);

// Create a form
const form = await formService.createForm({
  name: 'Contact Form',
  flowId: 'contact-workflow',
  contextKey: 'formData',
  fields: [
    { name: 'email', type: 'email', label: 'Email', required: true },
    { name: 'name', type: 'text', label: 'Name', required: true, minLength: 2 },
    { name: 'message', type: 'textarea', label: 'Message', required: true },
  ],
  enabled: true,
  successMessage: 'Thank you for your message!',
});

// Process a submission
const result = await formService.submit(form.id, {
  email: 'user@example.com',
  name: 'John Doe',
  message: 'Hello, I have a question...',
}, {
  ip: req.ip,
  userAgent: req.headers['user-agent'],
});

if (result.success) {
  console.log(`Submission ${result.submissionId} triggered execution ${result.executionId}`);
}
```

## Features

### Form Fields

Supported field types with validation:

```typescript
const fields: FormField[] = [
  // Text input
  { name: 'username', type: 'text', label: 'Username', required: true, minLength: 3, maxLength: 20 },
  
  // Email with format validation
  { name: 'email', type: 'email', label: 'Email', required: true },
  
  // Multi-line text
  { name: 'bio', type: 'textarea', label: 'Bio', maxLength: 500, rows: 5 },
  
  // Number with range
  { name: 'age', type: 'number', label: 'Age', min: 18, max: 120 },
  
  // Single select dropdown
  { 
    name: 'country', 
    type: 'select', 
    label: 'Country',
    options: [
      { value: 'us', label: 'United States' },
      { value: 'uk', label: 'United Kingdom' },
    ]
  },
  
  // Checkbox (boolean)
  { name: 'subscribe', type: 'checkbox', label: 'Subscribe to newsletter', defaultValue: false },
  
  // Radio buttons
  {
    name: 'plan',
    type: 'radio',
    label: 'Plan',
    options: [
      { value: 'free', label: 'Free' },
      { value: 'pro', label: 'Pro' },
    ]
  },
  
  // Date picker
  { name: 'birthdate', type: 'date', label: 'Birth Date' },
  
  // File upload
  { name: 'resume', type: 'file', label: 'Resume', accept: ['application/pdf'], maxSize: 5_000_000 },
  
  // Hidden field (pre-filled data)
  { name: 'source', type: 'hidden', defaultValue: 'website' },
];
```

### Security Features

#### CAPTCHA Verification

Support for reCAPTCHA v2/v3, hCaptcha, and Cloudflare Turnstile:

```typescript
const form = await formService.createForm({
  // ...fields
  security: {
    captcha: {
      provider: 'recaptcha-v3',
      siteKey: 'your-site-key',
      secretKey: 'your-secret-key',
      minScore: 0.5, // Minimum score threshold (v3 only)
    },
  },
});

// Submit with CAPTCHA token
await formService.submit(formId, data, {
  captchaToken: 'token-from-frontend',
  ip: req.ip,
});
```

#### Rate Limiting

Prevent abuse with configurable rate limits:

```typescript
const form = await formService.createForm({
  // ...fields
  security: {
    rateLimit: {
      maxSubmissions: 5,      // Max submissions per window
      windowSeconds: 3600,    // 1 hour window
      keyBy: 'ip',            // Rate limit by: 'ip', 'fingerprint', 'formId', 'combined'
    },
  },
});

// Requires rate limit store
const formService = new FormService(formStore, submissionStore, engine, {
  rateLimitStore: new MemoryRateLimitStore(), // or PgRateLimitStore
});
```

#### Honeypot Fields

Catch bots with invisible honeypot fields:

```typescript
const form = await formService.createForm({
  // ...fields
  security: {
    honeypot: {
      fieldName: '_hp_field', // Hidden field name
    },
  },
});
```

In your HTML, add a hidden field that humans won't fill:

```html
<input type="text" name="_hp_field" style="display:none" tabindex="-1" autocomplete="off">
```

#### Duplicate Detection

Prevent duplicate submissions within a time window:

```typescript
const form = await formService.createForm({
  // ...fields
  security: {
    deduplication: {
      enabled: true,
      hashFields: ['email', 'message'], // Fields to hash for comparison
      windowSeconds: 300,               // 5 minute window
    },
  },
});

// Requires deduplication store
const formService = new FormService(formStore, submissionStore, engine, {
  deduplicationStore: new MemoryDeduplicationStore(), // or PgDeduplicationStore
});
```

### Multi-Tenancy

Isolate forms by tenant:

```typescript
const form = await formService.createForm({
  name: 'Contact Form',
  tenantId: 'tenant-123',
  // ...
});

// List forms for a tenant
const tenantForms = await formService.listForms({ tenantId: 'tenant-123' });
```

### Events

Listen to form lifecycle events:

```typescript
formService.on('form:created', ({ formId, name }) => {
  console.log(`Form ${name} created with ID ${formId}`);
});

formService.on('submission', ({ formId, submissionId, status }) => {
  console.log(`New submission ${submissionId} for form ${formId}`);
});

formService.on('completed', ({ formId, submissionId, executionId, durationMs }) => {
  console.log(`Submission ${submissionId} completed in ${durationMs}ms`);
});

formService.on('failed', ({ formId, submissionId, errorCode, message }) => {
  console.error(`Submission ${submissionId} failed: ${errorCode}`);
});
```

## Route Definitions

Use the pre-defined routes for your API:

```typescript
import { FormRoutes, buildFormRoute } from '@flowmonkey/forms';

// Example with Express
app.get(FormRoutes.ListForms, async (req, res) => {
  const forms = await formService.listForms();
  res.json({ success: true, data: forms });
});

app.post(FormRoutes.SubmitForm, async (req, res) => {
  const { formId } = req.params;
  const result = await formService.submit(formId, req.body, {
    ip: req.ip,
    userAgent: req.headers['user-agent'],
    captchaToken: req.body._captcha,
  });
  res.json(result);
});

// Build routes with parameters
const url = buildFormRoute(FormRoutes.GetForm, { formId: 'contact-form' });
// => '/api/forms/contact-form'
```

## Public Form Data

Get form schema for frontend rendering (without secrets):

```typescript
import { toPublicFormData } from '@flowmonkey/forms';

app.get('/forms/:formId', async (req, res) => {
  const form = await formService.getForm(req.params.formId);
  if (!form || !form.enabled) {
    return res.status(404).json({ error: 'Form not found' });
  }
  
  // Returns fields, captcha site key (not secret), honeypot field name, etc.
  res.json(toPublicFormData(form));
});
```

## Database Schema

For production, use the PostgreSQL stores:

```typescript
import { Pool } from 'pg';
import {
  applyFormSchema,
  PgFormStore,
  PgSubmissionStore,
  PgRateLimitStore,
  PgDeduplicationStore,
} from '@flowmonkey/forms';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// Apply schema (run on startup or in migrations)
await applyFormSchema(pool);

// Create stores
const formStore = new PgFormStore(pool);
const submissionStore = new PgSubmissionStore(pool);
const rateLimitStore = new PgRateLimitStore(pool);
const deduplicationStore = new PgDeduplicationStore(pool);

// Create service
const formService = new FormService(formStore, submissionStore, engine, {
  rateLimitStore,
  deduplicationStore,
});
```

## API Reference

### FormService

| Method | Description |
|--------|-------------|
| `createForm(input)` | Create a new form definition |
| `getForm(id)` | Get form by ID |
| `updateForm(id, updates)` | Update form definition |
| `deleteForm(id)` | Delete a form |
| `listForms(filter?)` | List forms with optional filtering |
| `submit(formId, data, meta)` | Process a form submission |
| `getSubmission(id)` | Get submission by ID |
| `listSubmissions(filter?)` | List submissions with filtering |
| `countSubmissions(filter?)` | Count submissions matching filter |

### Validation

| Function | Description |
|----------|-------------|
| `validateSubmission(form, data)` | Validate form data against fields |
| `buildSchemaFromFields(fields)` | Build JSON Schema from field definitions |
| `checkHoneypot(data, fieldName)` | Check if honeypot field was filled (spam) |
| `computeSubmissionHash(data, fields)` | Compute hash for deduplication |
| `applyDefaults(fields, data)` | Apply default values to submission |
| `sanitizeSubmission(data, honeypot?)` | Remove honeypot field from data |

### CAPTCHA

| Function | Description |
|----------|-------------|
| `verifyCaptcha(config, token, ip?)` | Verify CAPTCHA token |
| `createCaptchaProvider(config)` | Create provider instance |

## License

MIT
