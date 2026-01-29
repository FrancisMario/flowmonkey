/**
 * @flowmonkey/forms - Route Definitions
 *
 * Type-safe route definitions for form endpoints.
 */

/**
 * Form API route definitions.
 */
export const FormRoutes = {
  // ── Form CRUD Routes ────────────────────────────────────────────────────
  /**
   * GET /api/forms
   * List all forms (with optional filtering).
   * Query params: tenantId, flowId, enabled
   */
  ListForms: '/api/forms',

  /**
   * POST /api/forms
   * Create a new form definition.
   */
  CreateForm: '/api/forms',

  /**
   * GET /api/forms/:formId
   * Get a form definition by ID.
   */
  GetForm: '/api/forms/:formId',

  /**
   * PATCH /api/forms/:formId
   * Update a form definition.
   */
  UpdateForm: '/api/forms/:formId',

  /**
   * DELETE /api/forms/:formId
   * Delete a form.
   */
  DeleteForm: '/api/forms/:formId',

  // ── Submission Routes ───────────────────────────────────────────────────
  /**
   * POST /api/forms/:formId/submit
   * Submit form data (triggers workflow).
   */
  SubmitForm: '/api/forms/:formId/submit',

  /**
   * GET /api/forms/:formId/submissions
   * List submissions for a form.
   * Query params: status, since, until, limit, offset
   */
  ListSubmissions: '/api/forms/:formId/submissions',

  /**
   * GET /api/submissions/:submissionId
   * Get a specific submission.
   */
  GetSubmission: '/api/submissions/:submissionId',

  // ── Public Form Routes ──────────────────────────────────────────────────
  /**
   * GET /forms/:formId
   * Get form schema for rendering (public, no auth required).
   * Returns fields, security requirements (captcha site key), styling.
   */
  GetPublicForm: '/forms/:formId',

  /**
   * POST /forms/:formId
   * Public form submission endpoint.
   * Accepts form-encoded or JSON data.
   */
  PublicSubmit: '/forms/:formId',
} as const;

export type FormRouteName = keyof typeof FormRoutes;
export type FormRoutePath = (typeof FormRoutes)[FormRouteName];

/**
 * Helper to build a route with parameters.
 *
 * @example
 * ```typescript
 * buildFormRoute(FormRoutes.GetForm, { formId: 'contact-form' });
 * // => '/api/forms/contact-form'
 *
 * buildFormRoute(FormRoutes.SubmitForm, { formId: 'contact-form' });
 * // => '/api/forms/contact-form/submit'
 * ```
 */
export function buildFormRoute(
  route: FormRoutePath,
  params: Record<string, string> = {}
): string {
  let result = route as string;
  for (const [key, value] of Object.entries(params)) {
    result = result.replace(`:${key}`, encodeURIComponent(value));
  }
  return result;
}

/**
 * Route configuration for enabling/disabling route groups.
 */
export interface FormRouteConfig {
  /** Enable form CRUD routes (admin) */
  admin?: boolean;
  /** Enable submission listing routes (admin) */
  submissions?: boolean;
  /** Enable public form routes (no auth) */
  public?: boolean;
  /** Base path prefix (default: none) */
  basePath?: string;
}

/**
 * Default route configuration - all enabled.
 */
export const DefaultFormRouteConfig: FormRouteConfig = {
  admin: true,
  submissions: true,
  public: true,
};

/**
 * Public form data returned for rendering.
 * Excludes sensitive security config like secret keys.
 */
export interface PublicFormData {
  id: string;
  name: string;
  description?: string;
  fields: Array<{
    name: string;
    type: string;
    label: string;
    description?: string;
    required?: boolean;
    placeholder?: string;
    options?: Array<{ value: string; label: string }>;
    // Field-specific config
    minLength?: number;
    maxLength?: number;
    min?: number;
    max?: number;
    pattern?: string;
    accept?: string[];
    maxSize?: number;
    multiple?: boolean;
    rows?: number;
  }>;
  /** CAPTCHA site key (if required) */
  captcha?: {
    provider: string;
    siteKey: string;
  };
  /** Honeypot field name (if configured) */
  honeypotField?: string;
  /** Custom CSS class */
  cssClass?: string;
  /** Submit button text */
  submitLabel?: string;
}

/**
 * Transform form definition to public data (removes secrets).
 */
export function toPublicFormData(form: {
  id: string;
  name: string;
  description?: string;
  fields: Array<{
    name: string;
    type: string;
    label: string;
    description?: string;
    required?: boolean;
    placeholder?: string;
    options?: Array<{ value: string; label: string }>;
    minLength?: number;
    maxLength?: number;
    min?: number;
    max?: number;
    pattern?: string;
    accept?: string[];
    maxSize?: number;
    multiple?: boolean;
    rows?: number;
  }>;
  security?: {
    captcha?: {
      provider: string;
      siteKey: string;
    };
    honeypot?: {
      fieldName: string;
    };
  };
  cssClass?: string;
  submitLabel?: string;
}): PublicFormData {
  return {
    id: form.id,
    name: form.name,
    description: form.description,
    fields: form.fields.map((f) => ({
      name: f.name,
      type: f.type,
      label: f.label,
      description: f.description,
      required: f.required,
      placeholder: f.placeholder,
      options: f.options,
      minLength: f.minLength,
      maxLength: f.maxLength,
      min: f.min,
      max: f.max,
      pattern: f.pattern,
      accept: f.accept,
      maxSize: f.maxSize,
      multiple: f.multiple,
      rows: f.rows,
    })),
    captcha: form.security?.captcha
      ? {
          provider: form.security.captcha.provider,
          siteKey: form.security.captcha.siteKey,
        }
      : undefined,
    honeypotField: form.security?.honeypot?.fieldName,
    cssClass: form.cssClass,
    submitLabel: form.submitLabel,
  };
}

/**
 * Standard API response wrapper.
 */
export interface FormApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
}

/**
 * Submission response.
 */
export interface SubmitResponse {
  success: boolean;
  submissionId: string;
  executionId?: string;
  message?: string;
  redirect?: string;
  errors?: Array<{
    field: string;
    message: string;
  }>;
}
