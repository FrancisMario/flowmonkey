# FlowMonkey API Reference

API documentation organized by package.

## Packages

| Package | Description |
|---------|-------------|
| [@flowmonkey/express](api/express.md) | Execution, trigger, token, admin, and health routes |
| [@flowmonkey/forms](api/forms.md) | Form CRUD and submission routes |
| [@flowmonkey/triggers](api/triggers.md) | Trigger types and programmatic usage |

---

## Quick Reference

All paths are relative to your application's mount point: `<prefix>/...`

### @flowmonkey/express

```
POST   /api/flows/:flowId/start                    Start workflow
GET    /api/executions/:executionId                Get execution
POST   /api/executions/:executionId/resume/:stepId Resume execution
POST   /api/executions/:executionId/cancel         Cancel execution
POST   /api/triggers/:triggerId                    Fire trigger
POST   /api/tokens/:token/resume                   Resume with token
GET    /api/admin/flows                            List flows
GET    /api/admin/handlers                         List handlers
GET    /api/admin/executions                       List executions
GET    /health                                     Health check
GET    /ready                                      Readiness check
```

### @flowmonkey/forms

```
GET    /api/forms                                  List forms
POST   /api/forms                                  Create form
GET    /api/forms/:formId                          Get form
PATCH  /api/forms/:formId                          Update form
DELETE /api/forms/:formId                          Delete form
POST   /api/forms/:formId/submit                   Submit form
GET    /api/forms/:formId/submissions              List submissions
GET    /api/submissions/:submissionId              Get submission
GET    /forms/:formId                              Public form schema
POST   /forms/:formId                              Public form submit
```

---

## Response Format

**Success:**
```json
{
  "success": true,
  "data": { ... }
}
```

**Error:**
```json
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable message"
  }
}
```

See individual package docs for error codes.
