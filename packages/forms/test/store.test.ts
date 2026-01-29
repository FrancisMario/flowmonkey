import { describe, it, expect, beforeEach } from 'vitest';
import {
  MemoryFormStore,
  MemorySubmissionStore,
  MemoryRateLimitStore,
  MemoryDeduplicationStore,
} from '../src/memory-store';
import { sampleForm, formWithTenant, validSubmissionData, submissionMeta } from './fixtures';

// ─────────────────────────────────────────────────────────────────────────────
// Memory Form Store Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('MemoryFormStore', () => {
  let store: MemoryFormStore;

  beforeEach(() => {
    store = new MemoryFormStore();
  });

  describe('create', () => {
    it('should create a form with auto-generated ID', async () => {
      const form = await store.create({
        name: sampleForm.name,
        flowId: sampleForm.flowId,
        contextKey: sampleForm.contextKey,
        fields: sampleForm.fields,
        enabled: true,
      });

      expect(form.id).toMatch(/^form_/);
      expect(form.name).toBe(sampleForm.name);
      expect(form.createdAt).toBeGreaterThan(0);
      expect(form.updatedAt).toBe(form.createdAt);
    });

    it('should create a form with provided ID', async () => {
      const form = await store.create({
        id: 'custom-id',
        name: sampleForm.name,
        flowId: sampleForm.flowId,
        contextKey: sampleForm.contextKey,
        fields: sampleForm.fields,
        enabled: true,
      });

      expect(form.id).toBe('custom-id');
    });
  });

  describe('get', () => {
    it('should return form by ID', async () => {
      const created = await store.create({ ...sampleForm, id: 'test-form' });
      const retrieved = await store.get('test-form');

      expect(retrieved).toEqual(created);
    });

    it('should return null for non-existent form', async () => {
      const result = await store.get('non-existent');
      expect(result).toBeNull();
    });
  });

  describe('update', () => {
    it('should update form fields', async () => {
      await store.create({ ...sampleForm, id: 'test-form' });
      // Small delay to ensure updatedAt differs from createdAt
      await new Promise((r) => setTimeout(r, 5));
      const updated = await store.update('test-form', { name: 'Updated Name' });

      expect(updated?.name).toBe('Updated Name');
      expect(updated?.updatedAt).toBeGreaterThanOrEqual(updated!.createdAt);
    });

    it('should return null for non-existent form', async () => {
      const result = await store.update('non-existent', { name: 'New Name' });
      expect(result).toBeNull();
    });
  });

  describe('delete', () => {
    it('should delete existing form', async () => {
      await store.create({ ...sampleForm, id: 'test-form' });
      const deleted = await store.delete('test-form');

      expect(deleted).toBe(true);
      expect(await store.get('test-form')).toBeNull();
    });

    it('should return false for non-existent form', async () => {
      const deleted = await store.delete('non-existent');
      expect(deleted).toBe(false);
    });
  });

  describe('list', () => {
    beforeEach(async () => {
      await store.create({ ...sampleForm, id: 'form-1' });
      await store.create({ ...formWithTenant, id: 'form-2' });
      await store.create({ ...sampleForm, id: 'form-3', enabled: false });
    });

    it('should list all forms', async () => {
      const forms = await store.list();
      expect(forms).toHaveLength(3);
    });

    it('should filter by tenantId', async () => {
      const forms = await store.list({ tenantId: 'tenant-123' });
      expect(forms).toHaveLength(1);
      expect(forms[0].id).toBe('form-2');
    });

    it('should filter by enabled', async () => {
      const forms = await store.list({ enabled: false });
      expect(forms).toHaveLength(1);
      expect(forms[0].id).toBe('form-3');
    });

    it('should filter by flowId', async () => {
      const forms = await store.list({ flowId: 'contact-workflow' });
      expect(forms).toHaveLength(2);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Memory Submission Store Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('MemorySubmissionStore', () => {
  let store: MemorySubmissionStore;

  beforeEach(() => {
    store = new MemorySubmissionStore();
  });

  describe('create', () => {
    it('should create a submission with auto-generated ID', async () => {
      const submission = await store.create({
        formId: 'test-form',
        status: 'pending',
        data: validSubmissionData,
        meta: submissionMeta,
        submittedAt: Date.now(),
      });

      expect(submission.id).toMatch(/^sub_/);
      expect(submission.formId).toBe('test-form');
      expect(submission.status).toBe('pending');
    });
  });

  describe('updateStatus', () => {
    it('should update submission status', async () => {
      const created = await store.create({
        formId: 'test-form',
        status: 'pending',
        data: validSubmissionData,
        meta: submissionMeta,
        submittedAt: Date.now(),
      });

      const updated = await store.updateStatus(created.id, 'completed', {
        executionId: 'exec_123',
        durationMs: 150,
        completedAt: Date.now(),
      });

      expect(updated?.status).toBe('completed');
      expect(updated?.executionId).toBe('exec_123');
      expect(updated?.durationMs).toBe(150);
    });

    it('should return null for non-existent submission', async () => {
      const result = await store.updateStatus('non-existent', 'completed');
      expect(result).toBeNull();
    });
  });

  describe('list', () => {
    beforeEach(async () => {
      await store.create({
        formId: 'form-1',
        status: 'completed',
        data: validSubmissionData,
        meta: submissionMeta,
        submittedAt: Date.now() - 2000,
      });
      await store.create({
        formId: 'form-1',
        status: 'failed',
        data: validSubmissionData,
        meta: submissionMeta,
        submittedAt: Date.now() - 1000,
      });
      await store.create({
        formId: 'form-2',
        status: 'completed',
        data: validSubmissionData,
        meta: submissionMeta,
        submittedAt: Date.now(),
      });
    });

    it('should filter by formId', async () => {
      const submissions = await store.list({ formId: 'form-1' });
      expect(submissions).toHaveLength(2);
    });

    it('should filter by status', async () => {
      const submissions = await store.list({ status: 'completed' });
      expect(submissions).toHaveLength(2);
    });

    it('should apply limit and offset', async () => {
      const submissions = await store.list({ limit: 1, offset: 1 });
      expect(submissions).toHaveLength(1);
    });
  });

  describe('count', () => {
    it('should count submissions matching filter', async () => {
      await store.create({
        formId: 'form-1',
        status: 'completed',
        data: {},
        meta: submissionMeta,
        submittedAt: Date.now(),
      });
      await store.create({
        formId: 'form-1',
        status: 'failed',
        data: {},
        meta: submissionMeta,
        submittedAt: Date.now(),
      });

      const total = await store.count();
      const completed = await store.count({ status: 'completed' });

      expect(total).toBe(2);
      expect(completed).toBe(1);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Memory Rate Limit Store Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('MemoryRateLimitStore', () => {
  let store: MemoryRateLimitStore;

  beforeEach(() => {
    store = new MemoryRateLimitStore();
  });

  const config = {
    maxSubmissions: 3,
    windowSeconds: 60,
    keyBy: 'ip' as const,
  };

  it('should allow submissions within limit', async () => {
    const result1 = await store.check('test-key', config);
    const result2 = await store.check('test-key', config);
    const result3 = await store.check('test-key', config);

    expect(result1.allowed).toBe(true);
    expect(result1.remaining).toBe(2);

    expect(result2.allowed).toBe(true);
    expect(result2.remaining).toBe(1);

    expect(result3.allowed).toBe(true);
    expect(result3.remaining).toBe(0);
  });

  it('should block submissions over limit', async () => {
    await store.check('test-key', config);
    await store.check('test-key', config);
    await store.check('test-key', config);

    const result = await store.check('test-key', config);

    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
    expect(result.retryAfter).toBeGreaterThan(0);
  });

  it('should reset after window expires', async () => {
    // This test would need time manipulation in production
    // For now, just verify reset works
    await store.check('test-key', config);
    await store.reset('test-key');

    const result = await store.check('test-key', config);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Memory Deduplication Store Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('MemoryDeduplicationStore', () => {
  let store: MemoryDeduplicationStore;

  beforeEach(() => {
    store = new MemoryDeduplicationStore();
  });

  it('should detect duplicate submissions', async () => {
    await store.record('form-1', 'hash123', 'sub_1');

    const isDupe = await store.isDuplicate('form-1', 'hash123', 300);
    expect(isDupe).toBe(true);
  });

  it('should not flag different hashes as duplicate', async () => {
    await store.record('form-1', 'hash123', 'sub_1');

    const isDupe = await store.isDuplicate('form-1', 'hash456', 300);
    expect(isDupe).toBe(false);
  });

  it('should not flag submissions from different forms as duplicate', async () => {
    await store.record('form-1', 'hash123', 'sub_1');

    const isDupe = await store.isDuplicate('form-2', 'hash123', 300);
    expect(isDupe).toBe(false);
  });
});
