/**
 * @flowmonkey/forms - Type definitions
 *
 * Core types for form definitions, submissions, and security configuration.
 */

// ─────────────────────────────────────────────────────────────────────────────
// JSON Schema (reused for field validation)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * JSON Schema type (subset for form field validation)
 */
export type JSONSchema = {
  type?: string;
  properties?: Record<string, JSONSchema>;
  required?: string[];
  items?: JSONSchema;
  enum?: unknown[];
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  minItems?: number;
  maxItems?: number;
  pattern?: string;
  format?: string;
  additionalProperties?: boolean | JSONSchema;
  [key: string]: unknown;
};

// ─────────────────────────────────────────────────────────────────────────────
// Form Field Definitions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Base properties for all form fields.
 */
export interface BaseFormField {
  /** Unique field identifier (used as key in submission data) */
  name: string;
  /** Display label */
  label: string;
  /** Help text / description */
  description?: string;
  /** Whether field is required */
  required?: boolean;
  /** Default value */
  defaultValue?: unknown;
  /** Placeholder text */
  placeholder?: string;
  /** Field validation (JSON Schema) */
  validation?: JSONSchema;
}

/**
 * Text input field.
 */
export interface TextField extends BaseFormField {
  type: 'text';
  /** Minimum length */
  minLength?: number;
  /** Maximum length */
  maxLength?: number;
  /** Regex pattern */
  pattern?: string;
}

/**
 * Multi-line text area.
 */
export interface TextareaField extends BaseFormField {
  type: 'textarea';
  /** Minimum length */
  minLength?: number;
  /** Maximum length */
  maxLength?: number;
  /** Number of rows */
  rows?: number;
}

/**
 * Email input field.
 */
export interface EmailField extends BaseFormField {
  type: 'email';
}

/**
 * Number input field.
 */
export interface NumberField extends BaseFormField {
  type: 'number';
  /** Minimum value */
  min?: number;
  /** Maximum value */
  max?: number;
  /** Step increment */
  step?: number;
}

/**
 * Single select dropdown.
 */
export interface SelectField extends BaseFormField {
  type: 'select';
  /** Available options */
  options: Array<{ value: string; label: string }>;
  /** Allow multiple selections */
  multiple?: boolean;
}

/**
 * Checkbox field (boolean).
 */
export interface CheckboxField extends BaseFormField {
  type: 'checkbox';
}

/**
 * Radio button group.
 */
export interface RadioField extends BaseFormField {
  type: 'radio';
  /** Available options */
  options: Array<{ value: string; label: string }>;
}

/**
 * Date input field.
 */
export interface DateField extends BaseFormField {
  type: 'date';
  /** Minimum date (ISO string) */
  minDate?: string;
  /** Maximum date (ISO string) */
  maxDate?: string;
}

/**
 * File upload field.
 */
export interface FileField extends BaseFormField {
  type: 'file';
  /** Accepted MIME types */
  accept?: string[];
  /** Maximum file size in bytes */
  maxSize?: number;
  /** Allow multiple files */
  multiple?: boolean;
}

/**
 * Hidden field (for pre-filled data).
 */
export interface HiddenField extends BaseFormField {
  type: 'hidden';
}

/**
 * Union of all form field types.
 */
export type FormField =
  | TextField
  | TextareaField
  | EmailField
  | NumberField
  | SelectField
  | CheckboxField
  | RadioField
  | DateField
  | FileField
  | HiddenField;

// ─────────────────────────────────────────────────────────────────────────────
// Security Configuration
// ─────────────────────────────────────────────────────────────────────────────

/**
 * CAPTCHA provider configuration.
 */
export interface CaptchaConfig {
  /** CAPTCHA provider */
  provider: 'recaptcha-v2' | 'recaptcha-v3' | 'hcaptcha' | 'turnstile' | 'custom';
  /** Site key (public, for frontend) */
  siteKey: string;
  /** Secret key (private, for verification) */
  secretKey: string;
  /** Minimum score threshold (for v3 providers) */
  minScore?: number;
  /** Custom verification endpoint (for 'custom' provider) */
  verifyUrl?: string;
}

/**
 * Rate limiting configuration.
 */
export interface RateLimitConfig {
  /** Maximum submissions per window */
  maxSubmissions: number;
  /** Window duration in seconds */
  windowSeconds: number;
  /** Key function: 'ip', 'fingerprint', or custom key */
  keyBy: 'ip' | 'fingerprint' | 'formId' | 'combined';
  /** Enable sliding window (vs fixed window) */
  slidingWindow?: boolean;
}

/**
 * Honeypot field configuration.
 */
export interface HoneypotConfig {
  /** Field name for the honeypot */
  fieldName: string;
  /** Whether to also check for filled hidden field */
  checkHidden?: boolean;
}

/**
 * Submission deduplication configuration.
 */
export interface DeduplicationConfig {
  /** Enable deduplication */
  enabled: boolean;
  /** Fields to hash for duplicate detection */
  hashFields: string[];
  /** Time window for duplicate detection (seconds) */
  windowSeconds: number;
}

/**
 * Combined security settings for a form.
 */
export interface FormSecurityConfig {
  /** CAPTCHA configuration */
  captcha?: CaptchaConfig;
  /** Rate limiting configuration */
  rateLimit?: RateLimitConfig;
  /** Honeypot configuration */
  honeypot?: HoneypotConfig;
  /** Deduplication configuration */
  deduplication?: DeduplicationConfig;
  /** Allowed origins for CORS */
  allowedOrigins?: string[];
  /** CSRF token requirement */
  csrfRequired?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Form Definition
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Complete form definition.
 */
export interface FormDefinition {
  /** Unique form identifier */
  id: string;
  /** Human-readable form name */
  name: string;
  /** Form description */
  description?: string;
  /** Tenant ID for multi-tenancy */
  tenantId?: string;
  /** Flow to trigger on submission */
  flowId: string;
  /** Key in flow context where form data is stored */
  contextKey: string;
  /** Form fields */
  fields: FormField[];
  /** Security configuration */
  security?: FormSecurityConfig;
  /** Whether form is active */
  enabled: boolean;
  /** Success redirect URL */
  successRedirect?: string;
  /** Success message (if no redirect) */
  successMessage?: string;
  /** Custom CSS class for styling */
  cssClass?: string;
  /** Submit button text */
  submitLabel?: string;
  /** Metadata timestamps */
  createdAt: number;
  updatedAt: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Form Submission
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Submission status.
 */
export type SubmissionStatus =
  | 'pending'
  | 'validated'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'duplicate'
  | 'rate_limited'
  | 'captcha_failed'
  | 'validation_failed';

/**
 * Validation error details.
 */
export interface ValidationError {
  /** Field name */
  field: string;
  /** Error message */
  message: string;
  /** JSON Schema keyword that failed */
  keyword?: string;
}

/**
 * Form submission record.
 */
export interface FormSubmission {
  /** Unique submission identifier */
  id: string;
  /** Form this submission belongs to */
  formId: string;
  /** Tenant ID (copied from form) */
  tenantId?: string;
  /** Execution ID (after flow started) */
  executionId?: string;
  /** Submission status */
  status: SubmissionStatus;
  /** Submitted data */
  data: Record<string, unknown>;
  /** Validation errors (if any) */
  validationErrors?: ValidationError[];
  /** Client metadata */
  meta: SubmissionMeta;
  /** Processing duration in ms */
  durationMs?: number;
  /** Timestamp */
  submittedAt: number;
  /** Processing completion time */
  completedAt?: number;
}

/**
 * Submission metadata from client.
 */
export interface SubmissionMeta {
  /** Client IP address */
  ip?: string;
  /** User agent string */
  userAgent?: string;
  /** Referer URL */
  referer?: string;
  /** Browser fingerprint (if provided) */
  fingerprint?: string;
  /** CAPTCHA response token */
  captchaToken?: string;
  /** CSRF token */
  csrfToken?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Store Interfaces
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Input for creating a form (id optional).
 */
export type CreateFormDefinition = Omit<FormDefinition, 'id' | 'createdAt' | 'updatedAt'> & {
  id?: string;
};

/**
 * Input for updating a form.
 */
export type UpdateFormDefinition = Partial<Omit<FormDefinition, 'id' | 'createdAt' | 'updatedAt'>>;

/**
 * Form store filter options.
 */
export interface FormListFilter {
  tenantId?: string;
  flowId?: string;
  enabled?: boolean;
}

/**
 * Form store interface.
 */
export interface FormStore {
  /** Create a new form */
  create(form: CreateFormDefinition): Promise<FormDefinition>;
  /** Get form by ID */
  get(id: string): Promise<FormDefinition | null>;
  /** Update form */
  update(id: string, updates: UpdateFormDefinition): Promise<FormDefinition | null>;
  /** Delete form */
  delete(id: string): Promise<boolean>;
  /** List forms with optional filters */
  list(filter?: FormListFilter): Promise<FormDefinition[]>;
}

/**
 * Submission store filter options.
 */
export interface SubmissionListFilter {
  formId?: string;
  tenantId?: string;
  status?: SubmissionStatus;
  since?: number;
  until?: number;
  limit?: number;
  offset?: number;
}

/**
 * Submission store interface.
 */
export interface SubmissionStore {
  /** Create a new submission */
  create(submission: Omit<FormSubmission, 'id'>): Promise<FormSubmission>;
  /** Get submission by ID */
  get(id: string): Promise<FormSubmission | null>;
  /** Update submission status */
  updateStatus(
    id: string,
    status: SubmissionStatus,
    updates?: { executionId?: string; durationMs?: number; completedAt?: number }
  ): Promise<FormSubmission | null>;
  /** List submissions with filters */
  list(filter?: SubmissionListFilter): Promise<FormSubmission[]>;
  /** Count submissions matching filter */
  count(filter?: SubmissionListFilter): Promise<number>;
  /** Check for duplicate submission */
  findDuplicate(formId: string, hash: string, windowSeconds: number): Promise<FormSubmission | null>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Service Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Result from form submission processing.
 */
export interface SubmitResult {
  success: boolean;
  submissionId: string;
  executionId?: string;
  errors?: ValidationError[];
  errorCode?: string;
  message?: string;
  redirect?: string;
}

/**
 * Rate limit check result.
 */
export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
  retryAfter?: number;
}

/**
 * CAPTCHA verification result.
 */
export interface CaptchaResult {
  success: boolean;
  score?: number;
  errorCodes?: string[];
}

/**
 * Rate limit store interface.
 */
export interface RateLimitStore {
  /** Check and increment rate limit counter */
  check(key: string, config: RateLimitConfig): Promise<RateLimitResult>;
  /** Reset rate limit for a key */
  reset(key: string): Promise<void>;
}

/**
 * Deduplication store interface.
 */
export interface DeduplicationStore {
  /** Check if submission is a duplicate */
  isDuplicate(formId: string, hash: string, windowSeconds: number): Promise<boolean>;
  /** Record a submission hash */
  record(formId: string, hash: string, submissionId: string): Promise<void>;
}
