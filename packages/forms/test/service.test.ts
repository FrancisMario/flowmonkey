import { describe, it, expect, beforeEach, vi } from 'vitest';
import { FormService } from '../src/service';
import { MemoryFormStore, MemorySubmissionStore, MemoryRateLimitStore, MemoryDeduplicationStore } from '../src/memory-store';
import { mockEngine, sampleForm, formWithSecurity, validSubmissionData, submissionMeta, resetMocks } from './fixtures';

describe('FormService', () => {
  let formStore: MemoryFormStore;
  let submissionStore: MemorySubmissionStore;
  let rateLimitStore: MemoryRateLimitStore;
  let deduplicationStore: MemoryDeduplicationStore;
  let service: FormService;

  beforeEach(() => {
    resetMocks();
    formStore = new MemoryFormStore();
    submissionStore = new MemorySubmissionStore();
    rateLimitStore = new MemoryRateLimitStore();
    deduplicationStore = new MemoryDeduplicationStore();

    service = new FormService(formStore, submissionStore, mockEngine, {
      rateLimitStore,
      deduplicationStore,
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Form CRUD
  // ─────────────────────────────────────────────────────────────────────────

  describe('Form CRUD', () => {
    it('should create a form', async () => {
      const form = await service.createForm({
        name: sampleForm.name,
        flowId: sampleForm.flowId,
        contextKey: sampleForm.contextKey,
        fields: sampleForm.fields,
        enabled: true,
      });

      expect(form.id).toBeDefined();
      expect(form.name).toBe(sampleForm.name);
    });

    it('should get a form by ID', async () => {
      const created = await service.createForm({ ...sampleForm });
      const retrieved = await service.getForm(created.id);

      expect(retrieved).toEqual(created);
    });

    it('should update a form', async () => {
      const created = await service.createForm({ ...sampleForm });
      const updated = await service.updateForm(created.id, { name: 'Updated Form' });

      expect(updated?.name).toBe('Updated Form');
    });

    it('should delete a form', async () => {
      const created = await service.createForm({ ...sampleForm });
      const deleted = await service.deleteForm(created.id);
      const retrieved = await service.getForm(created.id);

      expect(deleted).toBe(true);
      expect(retrieved).toBeNull();
    });

    it('should list forms with filters', async () => {
      await service.createForm({ ...sampleForm, id: 'form-1' });
      await service.createForm({ ...sampleForm, id: 'form-2', enabled: false });

      const enabled = await service.listForms({ enabled: true });
      expect(enabled).toHaveLength(1);
      expect(enabled[0].id).toBe('form-1');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Submission Processing
  // ─────────────────────────────────────────────────────────────────────────

  describe('submit', () => {
    it('should process valid submission and trigger flow', async () => {
      const form = await service.createForm({ ...sampleForm });

      const result = await service.submit(form.id, validSubmissionData, submissionMeta);

      expect(result.success).toBe(true);
      expect(result.submissionId).toBeDefined();
      expect(result.executionId).toBe('exec_abc123');
      expect(mockEngine.create).toHaveBeenCalledWith(
        form.flowId,
        expect.objectContaining({
          [form.contextKey]: expect.objectContaining({
            email: validSubmissionData.email,
          }),
        })
      );
    });

    it('should return error for non-existent form', async () => {
      const result = await service.submit('non-existent', validSubmissionData, submissionMeta);

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('FORM_NOT_FOUND');
    });

    it('should return error for disabled form', async () => {
      const form = await service.createForm({ ...sampleForm, enabled: false });

      const result = await service.submit(form.id, validSubmissionData, submissionMeta);

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('FORM_DISABLED');
    });

    it('should return validation errors for invalid data', async () => {
      const form = await service.createForm({ ...sampleForm });

      const result = await service.submit(
        form.id,
        {
          email: 'not-an-email',
          name: 'J', // too short
        },
        submissionMeta
      );

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('VALIDATION_FAILED');
      expect(result.errors).toBeDefined();
      expect(result.errors!.length).toBeGreaterThan(0);
    });

    it('should apply default values', async () => {
      const form = await service.createForm({ ...sampleForm });

      await service.submit(
        form.id,
        { email: 'test@example.com', name: 'John Doe' },
        submissionMeta
      );

      // Check that defaults were applied in the engine call
      expect(mockEngine.create).toHaveBeenCalledWith(
        form.flowId,
        expect.objectContaining({
          [form.contextKey]: expect.objectContaining({
            subscribe: false, // default value
            priority: 'medium', // default value
          }),
        })
      );
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Security Features
  // ─────────────────────────────────────────────────────────────────────────

  describe('Security', () => {
    it('should detect honeypot spam', async () => {
      const form = await service.createForm({ ...formWithSecurity });

      const result = await service.submit(
        form.id,
        {
          email: 'test@example.com',
          comment: 'Hello',
          _hp_field: 'bot filled this',
        },
        submissionMeta
      );

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('HONEYPOT_TRIGGERED');
    });

    it('should enforce rate limiting', async () => {
      const form = await service.createForm({
        ...formWithSecurity,
        security: {
          rateLimit: {
            maxSubmissions: 2,
            windowSeconds: 60,
            keyBy: 'ip',
          },
        },
      });

      // First two should succeed
      const result1 = await service.submit(form.id, { email: 'a@example.com', comment: 'Test 1' }, submissionMeta);
      const result2 = await service.submit(form.id, { email: 'b@example.com', comment: 'Test 2' }, submissionMeta);

      expect(result1.success).toBe(true);
      expect(result2.success).toBe(true);

      // Third should be rate limited
      const result3 = await service.submit(form.id, { email: 'c@example.com', comment: 'Test 3' }, submissionMeta);

      expect(result3.success).toBe(false);
      expect(result3.errorCode).toBe('RATE_LIMITED');
    });

    it('should detect duplicate submissions', async () => {
      const form = await service.createForm({
        ...formWithSecurity,
        security: {
          deduplication: {
            enabled: true,
            hashFields: ['email', 'comment'],
            windowSeconds: 300,
          },
        },
      });

      const data = { email: 'test@example.com', comment: 'Hello' };

      // First submission should succeed
      const result1 = await service.submit(form.id, data, submissionMeta);
      expect(result1.success).toBe(true);

      // Duplicate should be rejected
      const result2 = await service.submit(form.id, data, submissionMeta);
      expect(result2.success).toBe(false);
      expect(result2.errorCode).toBe('DUPLICATE_SUBMISSION');
    });

    it('should require CAPTCHA when configured', async () => {
      const form = await service.createForm({ ...formWithSecurity });

      const result = await service.submit(
        form.id,
        { email: 'test@example.com', comment: 'Hello' },
        { ...submissionMeta, captchaToken: undefined }
      );

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('CAPTCHA_MISSING');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Submission Queries
  // ─────────────────────────────────────────────────────────────────────────

  describe('Submission Queries', () => {
    it('should get submission by ID', async () => {
      const form = await service.createForm({ ...sampleForm });
      const submitResult = await service.submit(form.id, validSubmissionData, submissionMeta);

      const submission = await service.getSubmission(submitResult.submissionId);

      expect(submission).toBeDefined();
      expect(submission?.id).toBe(submitResult.submissionId);
      expect(submission?.status).toBe('completed');
    });

    it('should list submissions with filters', async () => {
      const form = await service.createForm({ ...sampleForm });
      await service.submit(form.id, validSubmissionData, submissionMeta);
      await service.submit(form.id, validSubmissionData, submissionMeta);

      const submissions = await service.listSubmissions({ formId: form.id });

      expect(submissions).toHaveLength(2);
    });

    it('should count submissions', async () => {
      const form = await service.createForm({ ...sampleForm });
      await service.submit(form.id, validSubmissionData, submissionMeta);
      await service.submit(form.id, validSubmissionData, submissionMeta);

      const count = await service.countSubmissions({ formId: form.id });

      expect(count).toBe(2);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Events
  // ─────────────────────────────────────────────────────────────────────────

  describe('Events', () => {
    it('should emit form:created event', async () => {
      const handler = vi.fn();
      service.on('form:created', handler);

      await service.createForm({ ...sampleForm });

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({ name: sampleForm.name })
      );
    });

    it('should emit completed event on successful submission', async () => {
      const handler = vi.fn();
      service.on('completed', handler);

      const form = await service.createForm({ ...sampleForm });
      await service.submit(form.id, validSubmissionData, submissionMeta);

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          formId: form.id,
          executionId: 'exec_abc123',
        })
      );
    });

    it('should emit failed event on security error', async () => {
      const handler = vi.fn();
      service.on('failed', handler);

      const form = await service.createForm({
        ...sampleForm,
        security: {
          honeypot: { fieldName: '_hp' },
        },
      });
      await service.submit(form.id, { ...validSubmissionData, _hp: 'bot' }, submissionMeta);

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          formId: form.id,
          errorCode: 'HONEYPOT_TRIGGERED',
        })
      );
    });
  });
});
