/**
 * @flowmonkey/forms - Public API
 */

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type {
  // Core types
  FormDefinition,
  FormSubmission,
  FormField,
  TextField,
  TextareaField,
  EmailField,
  NumberField,
  SelectField,
  CheckboxField,
  RadioField,
  DateField,
  FileField,
  HiddenField,
  BaseFormField,

  // Security types
  FormSecurityConfig,
  CaptchaConfig,
  RateLimitConfig,
  HoneypotConfig,
  DeduplicationConfig,

  // Submission types
  SubmissionStatus,
  SubmissionMeta,
  ValidationError,
  SubmitResult,
  RateLimitResult,
  CaptchaResult,

  // Store interfaces
  FormStore,
  SubmissionStore,
  RateLimitStore,
  DeduplicationStore,
  CreateFormDefinition,
  UpdateFormDefinition,
  FormListFilter,
  SubmissionListFilter,

  // JSON Schema
  JSONSchema,
} from './types';

// ─────────────────────────────────────────────────────────────────────────────
// Stores
// ─────────────────────────────────────────────────────────────────────────────

// Memory stores (for testing)
export {
  MemoryFormStore,
  MemorySubmissionStore,
  MemoryRateLimitStore,
  MemoryDeduplicationStore,
} from './memory-store';

// PostgreSQL stores (for production)
export {
  PgFormStore,
  PgSubmissionStore,
  PgRateLimitStore,
  PgDeduplicationStore,
} from './pg-store';

// ─────────────────────────────────────────────────────────────────────────────
// Service
// ─────────────────────────────────────────────────────────────────────────────

export {
  FormService,
  type FormServiceConfig,
  type FormServiceEvents,
} from './service';

// ─────────────────────────────────────────────────────────────────────────────
// Validation
// ─────────────────────────────────────────────────────────────────────────────

export {
  validateSubmission,
  buildSchemaFromFields,
  checkHoneypot,
  computeSubmissionHash,
  applyDefaults,
  sanitizeSubmission,
} from './validation';

// ─────────────────────────────────────────────────────────────────────────────
// CAPTCHA
// ─────────────────────────────────────────────────────────────────────────────

export {
  verifyCaptcha,
  createCaptchaProvider,
  type CaptchaProvider,
  RecaptchaV2Provider,
  RecaptchaV3Provider,
  HCaptchaProvider,
  TurnstileProvider,
  CustomCaptchaProvider,
} from './captcha';

// ─────────────────────────────────────────────────────────────────────────────
// Routes
// ─────────────────────────────────────────────────────────────────────────────

export {
  FormRoutes,
  buildFormRoute,
  toPublicFormData,
  DefaultFormRouteConfig,
  type FormRouteName,
  type FormRoutePath,
  type FormRouteConfig,
  type PublicFormData,
  type FormApiResponse,
  type SubmitResponse,
} from './routes';

// ─────────────────────────────────────────────────────────────────────────────
// Schema
// ─────────────────────────────────────────────────────────────────────────────

export {
  formSchema,
  applyFormSchema,
  cleanupFormData,
  FORM_SCHEMA_VERSION,
} from './schema';
