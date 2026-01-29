/**
 * @flowmonkey/forms - In-Memory Stores
 *
 * Memory-based implementations for testing and development.
 */

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
  SubmissionStatus,
  RateLimitConfig,
  RateLimitResult,
} from './types';

// ─────────────────────────────────────────────────────────────────────────────
// Memory Form Store
// ─────────────────────────────────────────────────────────────────────────────

/**
 * In-memory form store for testing.
 */
export class MemoryFormStore implements FormStore {
  private forms = new Map<string, FormDefinition>();
  private idCounter = 0;

  async create(input: CreateFormDefinition): Promise<FormDefinition> {
    const now = Date.now();
    const form: FormDefinition = {
      ...input,
      id: input.id ?? `form_${++this.idCounter}`,
      createdAt: now,
      updatedAt: now,
    };
    this.forms.set(form.id, form);
    return form;
  }

  async get(id: string): Promise<FormDefinition | null> {
    return this.forms.get(id) ?? null;
  }

  async update(id: string, updates: UpdateFormDefinition): Promise<FormDefinition | null> {
    const form = this.forms.get(id);
    if (!form) return null;

    const updated: FormDefinition = {
      ...form,
      ...updates,
      id: form.id, // Prevent ID change
      createdAt: form.createdAt, // Preserve creation time
      updatedAt: Date.now(),
    };
    this.forms.set(id, updated);
    return updated;
  }

  async delete(id: string): Promise<boolean> {
    return this.forms.delete(id);
  }

  async list(filter?: FormListFilter): Promise<FormDefinition[]> {
    let forms = Array.from(this.forms.values());

    if (filter?.tenantId !== undefined) {
      forms = forms.filter((f) => f.tenantId === filter.tenantId);
    }
    if (filter?.flowId !== undefined) {
      forms = forms.filter((f) => f.flowId === filter.flowId);
    }
    if (filter?.enabled !== undefined) {
      forms = forms.filter((f) => f.enabled === filter.enabled);
    }

    return forms.sort((a, b) => b.createdAt - a.createdAt);
  }

  /** Clear all forms (for testing) */
  clear(): void {
    this.forms.clear();
    this.idCounter = 0;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Memory Submission Store
// ─────────────────────────────────────────────────────────────────────────────

/**
 * In-memory submission store for testing.
 */
export class MemorySubmissionStore implements SubmissionStore {
  private submissions = new Map<string, FormSubmission>();
  private idCounter = 0;

  async create(input: Omit<FormSubmission, 'id'>): Promise<FormSubmission> {
    const submission: FormSubmission = {
      ...input,
      id: `sub_${++this.idCounter}`,
    };
    this.submissions.set(submission.id, submission);
    return submission;
  }

  async get(id: string): Promise<FormSubmission | null> {
    return this.submissions.get(id) ?? null;
  }

  async updateStatus(
    id: string,
    status: SubmissionStatus,
    updates?: { executionId?: string; durationMs?: number; completedAt?: number }
  ): Promise<FormSubmission | null> {
    const submission = this.submissions.get(id);
    if (!submission) return null;

    const updated: FormSubmission = {
      ...submission,
      status,
      ...updates,
    };
    this.submissions.set(id, updated);
    return updated;
  }

  async list(filter?: SubmissionListFilter): Promise<FormSubmission[]> {
    let submissions = Array.from(this.submissions.values());

    if (filter?.formId !== undefined) {
      submissions = submissions.filter((s) => s.formId === filter.formId);
    }
    if (filter?.tenantId !== undefined) {
      submissions = submissions.filter((s) => s.tenantId === filter.tenantId);
    }
    if (filter?.status !== undefined) {
      submissions = submissions.filter((s) => s.status === filter.status);
    }
    if (filter?.since !== undefined) {
      submissions = submissions.filter((s) => s.submittedAt >= filter.since!);
    }
    if (filter?.until !== undefined) {
      submissions = submissions.filter((s) => s.submittedAt <= filter.until!);
    }

    // Sort by submitted time descending
    submissions.sort((a, b) => b.submittedAt - a.submittedAt);

    // Apply pagination
    const offset = filter?.offset ?? 0;
    const limit = filter?.limit ?? submissions.length;
    return submissions.slice(offset, offset + limit);
  }

  async count(filter?: SubmissionListFilter): Promise<number> {
    // Re-use list logic but just return count
    const submissions = await this.list({ ...filter, limit: undefined, offset: undefined });
    return submissions.length;
  }

  async findDuplicate(
    formId: string,
    hash: string,
    windowSeconds: number
  ): Promise<FormSubmission | null> {
    const cutoff = Date.now() - windowSeconds * 1000;
    const submissions = Array.from(this.submissions.values());

    return (
      submissions.find(
        (s) =>
          s.formId === formId &&
          s.submittedAt >= cutoff &&
          this.computeHash(s.data) === hash
      ) ?? null
    );
  }

  /** Simple hash for testing (production should use proper hashing) */
  private computeHash(data: Record<string, unknown>): string {
    return JSON.stringify(data);
  }

  /** Clear all submissions (for testing) */
  clear(): void {
    this.submissions.clear();
    this.idCounter = 0;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Memory Rate Limit Store
// ─────────────────────────────────────────────────────────────────────────────

interface RateLimitEntry {
  count: number;
  windowStart: number;
  windowEnd: number;
}

/**
 * In-memory rate limit store for testing.
 */
export class MemoryRateLimitStore implements RateLimitStore {
  private limits = new Map<string, RateLimitEntry>();

  async check(key: string, config: RateLimitConfig): Promise<RateLimitResult> {
    const now = Date.now();
    const windowMs = config.windowSeconds * 1000;
    const entry = this.limits.get(key);

    // No existing entry or window expired
    if (!entry || now >= entry.windowEnd) {
      const newEntry: RateLimitEntry = {
        count: 1,
        windowStart: now,
        windowEnd: now + windowMs,
      };
      this.limits.set(key, newEntry);

      return {
        allowed: true,
        remaining: config.maxSubmissions - 1,
        resetAt: newEntry.windowEnd,
      };
    }

    // Within window - check limit
    if (entry.count >= config.maxSubmissions) {
      return {
        allowed: false,
        remaining: 0,
        resetAt: entry.windowEnd,
        retryAfter: Math.ceil((entry.windowEnd - now) / 1000),
      };
    }

    // Increment counter
    entry.count++;
    this.limits.set(key, entry);

    return {
      allowed: true,
      remaining: config.maxSubmissions - entry.count,
      resetAt: entry.windowEnd,
    };
  }

  async reset(key: string): Promise<void> {
    this.limits.delete(key);
  }

  /** Clear all limits (for testing) */
  clear(): void {
    this.limits.clear();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Memory Deduplication Store
// ─────────────────────────────────────────────────────────────────────────────

interface DedupEntry {
  submissionId: string;
  createdAt: number;
}

/**
 * In-memory deduplication store for testing.
 */
export class MemoryDeduplicationStore implements DeduplicationStore {
  private entries = new Map<string, DedupEntry>();

  private makeKey(formId: string, hash: string): string {
    return `${formId}:${hash}`;
  }

  async isDuplicate(formId: string, hash: string, windowSeconds: number): Promise<boolean> {
    const key = this.makeKey(formId, hash);
    const entry = this.entries.get(key);
    if (!entry) return false;

    const cutoff = Date.now() - windowSeconds * 1000;
    return entry.createdAt >= cutoff;
  }

  async record(formId: string, hash: string, submissionId: string): Promise<void> {
    const key = this.makeKey(formId, hash);
    this.entries.set(key, {
      submissionId,
      createdAt: Date.now(),
    });
  }

  /** Clear all entries (for testing) */
  clear(): void {
    this.entries.clear();
  }
}
