/**
 * @flowmonkey/forms - Form Service
 *
 * Core service for managing forms and processing submissions.
 */

import { EventEmitter } from 'events';
import type { Engine } from '@flowmonkey/core';
import type {
  FormDefinition,
  FormSubmission,
  FormStore,
  SubmissionStore,
  RateLimitStore,
  DeduplicationStore,
  CreateFormDefinition,
  UpdateFormDefinition,
  FormListFilter,
  SubmissionListFilter,
  SubmitResult,
  SubmissionMeta,
  RateLimitResult,
} from './types';
import {
  validateSubmission,
  checkHoneypot,
  computeSubmissionHash,
  applyDefaults,
  sanitizeSubmission,
} from './validation';
import { verifyCaptcha } from './captcha';

// ─────────────────────────────────────────────────────────────────────────────
// Service Configuration
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Form service configuration.
 */
export interface FormServiceConfig {
  /** Optional rate limit store (required if forms use rate limiting) */
  rateLimitStore?: RateLimitStore;
  /** Optional deduplication store (required if forms use deduplication) */
  deduplicationStore?: DeduplicationStore;
  /** Default success message when no redirect or message is configured */
  defaultSuccessMessage?: string;
  /** Enable debug logging */
  debug?: boolean;
}

/**
 * Events emitted by FormService.
 */
export interface FormServiceEvents {
  /** Emitted when a form submission is received */
  submission: {
    formId: string;
    submissionId: string;
    status: 'pending' | 'validated';
  };
  /** Emitted when a submission is processed successfully */
  completed: {
    formId: string;
    submissionId: string;
    executionId: string;
    durationMs: number;
  };
  /** Emitted when a submission fails */
  failed: {
    formId: string;
    submissionId: string;
    errorCode: string;
    message: string;
  };
  /** Emitted when a form is created */
  'form:created': { formId: string; name: string };
  /** Emitted when a form is updated */
  'form:updated': { formId: string };
  /** Emitted when a form is deleted */
  'form:deleted': { formId: string };
}

// ─────────────────────────────────────────────────────────────────────────────
// Form Service
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Core service for managing forms and processing submissions.
 *
 * @example
 * ```typescript
 * const formService = new FormService(
 *   formStore,
 *   submissionStore,
 *   engine,
 *   { rateLimitStore, deduplicationStore }
 * );
 *
 * // Create a form
 * const form = await formService.createForm({
 *   name: 'Contact Form',
 *   flowId: 'contact-workflow',
 *   contextKey: 'formData',
 *   fields: [
 *     { name: 'email', type: 'email', label: 'Email', required: true },
 *     { name: 'message', type: 'textarea', label: 'Message', required: true },
 *   ],
 *   security: {
 *     captcha: { provider: 'recaptcha-v3', siteKey: '...', secretKey: '...' },
 *     rateLimit: { maxSubmissions: 5, windowSeconds: 3600, keyBy: 'ip' },
 *   },
 *   enabled: true,
 * });
 *
 * // Process a submission
 * const result = await formService.submit(form.id, formData, {
 *   ip: req.ip,
 *   userAgent: req.headers['user-agent'],
 *   captchaToken: req.body.captchaToken,
 * });
 * ```
 */
export class FormService extends EventEmitter {
  private readonly formStore: FormStore;
  private readonly submissionStore: SubmissionStore;
  private readonly engine: Engine;
  private readonly config: FormServiceConfig;

  constructor(
    formStore: FormStore,
    submissionStore: SubmissionStore,
    engine: Engine,
    config?: FormServiceConfig
  ) {
    super();
    this.formStore = formStore;
    this.submissionStore = submissionStore;
    this.engine = engine;
    this.config = config ?? {};
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Form CRUD
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Create a new form definition.
   */
  async createForm(input: CreateFormDefinition): Promise<FormDefinition> {
    const form = await this.formStore.create(input);
    this.emit('form:created', { formId: form.id, name: form.name });
    return form;
  }

  /**
   * Get a form by ID.
   */
  async getForm(id: string): Promise<FormDefinition | null> {
    return this.formStore.get(id);
  }

  /**
   * Update a form definition.
   */
  async updateForm(id: string, updates: UpdateFormDefinition): Promise<FormDefinition | null> {
    const form = await this.formStore.update(id, updates);
    if (form) {
      this.emit('form:updated', { formId: id });
    }
    return form;
  }

  /**
   * Delete a form.
   */
  async deleteForm(id: string): Promise<boolean> {
    const deleted = await this.formStore.delete(id);
    if (deleted) {
      this.emit('form:deleted', { formId: id });
    }
    return deleted;
  }

  /**
   * List forms with optional filtering.
   */
  async listForms(filter?: FormListFilter): Promise<FormDefinition[]> {
    return this.formStore.list(filter);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Submission Processing
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Submit form data and trigger the associated workflow.
   */
  async submit(
    formId: string,
    data: Record<string, unknown>,
    meta: SubmissionMeta
  ): Promise<SubmitResult> {
    const startTime = Date.now();

    // Get form
    const form = await this.formStore.get(formId);
    if (!form) {
      return {
        success: false,
        submissionId: '',
        errorCode: 'FORM_NOT_FOUND',
        message: 'Form not found',
      };
    }

    if (!form.enabled) {
      return {
        success: false,
        submissionId: '',
        errorCode: 'FORM_DISABLED',
        message: 'Form is not accepting submissions',
      };
    }

    // Create pending submission
    const submission = await this.submissionStore.create({
      formId: form.id,
      tenantId: form.tenantId,
      status: 'pending',
      data,
      meta,
      submittedAt: startTime,
    });

    this.emit('submission', {
      formId: form.id,
      submissionId: submission.id,
      status: 'pending',
    });

    try {
      // ─── Security Checks ─────────────────────────────────────────────

      // Check honeypot
      if (form.security?.honeypot) {
        if (checkHoneypot(data, form.security.honeypot.fieldName)) {
          await this.failSubmission(submission.id, 'validation_failed', 'HONEYPOT_TRIGGERED');
          return {
            success: false,
            submissionId: submission.id,
            errorCode: 'HONEYPOT_TRIGGERED',
            message: 'Submission rejected',
          };
        }
      }

      // Check rate limit
      if (form.security?.rateLimit) {
        const rateLimitResult = await this.checkRateLimit(form, meta);
        if (!rateLimitResult.allowed) {
          await this.failSubmission(submission.id, 'rate_limited', 'RATE_LIMITED');
          return {
            success: false,
            submissionId: submission.id,
            errorCode: 'RATE_LIMITED',
            message: `Too many submissions. Try again in ${rateLimitResult.retryAfter} seconds.`,
          };
        }
      }

      // Check CAPTCHA
      if (form.security?.captcha) {
        if (!meta.captchaToken) {
          await this.failSubmission(submission.id, 'captcha_failed', 'CAPTCHA_MISSING');
          return {
            success: false,
            submissionId: submission.id,
            errorCode: 'CAPTCHA_MISSING',
            message: 'CAPTCHA verification required',
          };
        }

        const captchaResult = await verifyCaptcha(
          form.security.captcha,
          meta.captchaToken,
          meta.ip
        );

        if (!captchaResult.success) {
          await this.failSubmission(submission.id, 'captcha_failed', 'CAPTCHA_FAILED');
          return {
            success: false,
            submissionId: submission.id,
            errorCode: 'CAPTCHA_FAILED',
            message: 'CAPTCHA verification failed',
          };
        }
      }

      // Check deduplication
      if (form.security?.deduplication?.enabled) {
        const isDupe = await this.checkDuplicate(form, data);
        if (isDupe) {
          await this.failSubmission(submission.id, 'duplicate', 'DUPLICATE_SUBMISSION');
          return {
            success: false,
            submissionId: submission.id,
            errorCode: 'DUPLICATE_SUBMISSION',
            message: 'This submission appears to be a duplicate',
          };
        }
      }

      // ─── Validation ──────────────────────────────────────────────────

      // Sanitize data (remove honeypot field)
      const sanitizedData = sanitizeSubmission(data, form.security?.honeypot?.fieldName);

      // Apply defaults
      const dataWithDefaults = applyDefaults(form.fields, sanitizedData);

      // Validate
      const errors = validateSubmission(form, dataWithDefaults);
      if (errors.length > 0) {
        await this.submissionStore.updateStatus(submission.id, 'validation_failed');
        return {
          success: false,
          submissionId: submission.id,
          errors,
          errorCode: 'VALIDATION_FAILED',
          message: 'Form validation failed',
        };
      }

      // Update status to validated
      await this.submissionStore.updateStatus(submission.id, 'validated');

      // ─── Trigger Flow ────────────────────────────────────────────────

      // Update status to processing
      await this.submissionStore.updateStatus(submission.id, 'processing');

      // Build flow context
      const context = {
        [form.contextKey]: dataWithDefaults,
        _form: {
          id: form.id,
          submissionId: submission.id,
          submittedAt: startTime,
        },
      };

      // Start flow execution
      const { execution } = await this.engine.create(form.flowId, context);

      // Record deduplication hash
      if (form.security?.deduplication?.enabled && this.config.deduplicationStore) {
        const hash = computeSubmissionHash(
          dataWithDefaults,
          form.security.deduplication.hashFields
        );
        await this.config.deduplicationStore.record(form.id, hash, submission.id);
      }

      // Update submission with execution ID
      const durationMs = Date.now() - startTime;
      await this.submissionStore.updateStatus(submission.id, 'completed', {
        executionId: execution.id,
        durationMs,
        completedAt: Date.now(),
      });

      this.emit('completed', {
        formId: form.id,
        submissionId: submission.id,
        executionId: execution.id,
        durationMs,
      });

      return {
        success: true,
        submissionId: submission.id,
        executionId: execution.id,
        redirect: form.successRedirect,
        message: form.successMessage ?? this.config.defaultSuccessMessage ?? 'Submission received',
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      await this.failSubmission(submission.id, 'failed', 'EXECUTION_ERROR', errorMessage);

      return {
        success: false,
        submissionId: submission.id,
        errorCode: 'EXECUTION_ERROR',
        message: 'Failed to process submission',
      };
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Submission Queries
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Get a submission by ID.
   */
  async getSubmission(id: string): Promise<FormSubmission | null> {
    return this.submissionStore.get(id);
  }

  /**
   * List submissions with optional filtering.
   */
  async listSubmissions(filter?: SubmissionListFilter): Promise<FormSubmission[]> {
    return this.submissionStore.list(filter);
  }

  /**
   * Count submissions matching filter.
   */
  async countSubmissions(filter?: SubmissionListFilter): Promise<number> {
    return this.submissionStore.count(filter);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Internal Helpers
  // ─────────────────────────────────────────────────────────────────────────

  private async checkRateLimit(
    form: FormDefinition,
    meta: SubmissionMeta
  ): Promise<RateLimitResult> {
    if (!form.security?.rateLimit || !this.config.rateLimitStore) {
      return { allowed: true, remaining: Infinity, resetAt: 0 };
    }

    const config = form.security.rateLimit;
    let key: string;

    switch (config.keyBy) {
      case 'ip':
        key = `form:${form.id}:ip:${meta.ip ?? 'unknown'}`;
        break;
      case 'fingerprint':
        key = `form:${form.id}:fp:${meta.fingerprint ?? 'unknown'}`;
        break;
      case 'formId':
        key = `form:${form.id}`;
        break;
      case 'combined':
        key = `form:${form.id}:${meta.ip ?? 'unknown'}:${meta.fingerprint ?? 'unknown'}`;
        break;
      default:
        key = `form:${form.id}:ip:${meta.ip ?? 'unknown'}`;
    }

    return this.config.rateLimitStore.check(key, config);
  }

  private async checkDuplicate(
    form: FormDefinition,
    data: Record<string, unknown>
  ): Promise<boolean> {
    if (!form.security?.deduplication?.enabled || !this.config.deduplicationStore) {
      return false;
    }

    const { hashFields, windowSeconds } = form.security.deduplication;
    const hash = computeSubmissionHash(data, hashFields);

    return this.config.deduplicationStore.isDuplicate(form.id, hash, windowSeconds);
  }

  private async failSubmission(
    submissionId: string,
    status: 'validation_failed' | 'rate_limited' | 'captcha_failed' | 'duplicate' | 'failed',
    errorCode: string,
    message?: string
  ): Promise<void> {
    await this.submissionStore.updateStatus(submissionId, status, {
      completedAt: Date.now(),
    });

    const submission = await this.submissionStore.get(submissionId);
    if (submission) {
      this.emit('failed', {
        formId: submission.formId,
        submissionId,
        errorCode,
        message: message ?? errorCode,
      });
    }
  }
}
