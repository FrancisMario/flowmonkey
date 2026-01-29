/**
 * @flowmonkey/forms - PostgreSQL Stores
 *
 * Production-ready PostgreSQL implementations for forms.
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
  FormField,
  FormSecurityConfig,
  SubmissionMeta,
  ValidationError,
} from './types';

/** Minimal pg Pool interface */
interface Pool {
  query<R = unknown>(
    sql: string,
    values?: unknown[]
  ): Promise<{ rows: R[]; rowCount: number | null }>;
}

// ─────────────────────────────────────────────────────────────────────────────
// PostgreSQL Form Store
// ─────────────────────────────────────────────────────────────────────────────

interface FormRow {
  id: string;
  name: string;
  description: string | null;
  tenant_id: string | null;
  flow_id: string;
  context_key: string;
  fields: FormField[];
  security: FormSecurityConfig | null;
  enabled: boolean;
  success_redirect: string | null;
  success_message: string | null;
  css_class: string | null;
  submit_label: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * PostgreSQL form store implementation.
 */
export class PgFormStore implements FormStore {
  constructor(private readonly pool: Pool) {}

  private rowToForm(row: FormRow): FormDefinition {
    return {
      id: row.id,
      name: row.name,
      description: row.description ?? undefined,
      tenantId: row.tenant_id ?? undefined,
      flowId: row.flow_id,
      contextKey: row.context_key,
      fields: row.fields,
      security: row.security ?? undefined,
      enabled: row.enabled,
      successRedirect: row.success_redirect ?? undefined,
      successMessage: row.success_message ?? undefined,
      cssClass: row.css_class ?? undefined,
      submitLabel: row.submit_label ?? undefined,
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at),
    };
  }

  async create(input: CreateFormDefinition): Promise<FormDefinition> {
    const now = Date.now();
    const id = input.id ?? `form_${crypto.randomUUID().slice(0, 8)}`;

    const sql = `
      INSERT INTO fm_forms (
        id, name, description, tenant_id, flow_id, context_key,
        fields, security, enabled,
        success_redirect, success_message, css_class, submit_label,
        created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
      RETURNING *
    `;

    const result = await this.pool.query<FormRow>(sql, [
      id,
      input.name,
      input.description ?? null,
      input.tenantId ?? null,
      input.flowId,
      input.contextKey,
      JSON.stringify(input.fields),
      input.security ? JSON.stringify(input.security) : null,
      input.enabled,
      input.successRedirect ?? null,
      input.successMessage ?? null,
      input.cssClass ?? null,
      input.submitLabel ?? null,
      now,
      now,
    ]);

    return this.rowToForm(result.rows[0]);
  }

  async get(id: string): Promise<FormDefinition | null> {
    const sql = 'SELECT * FROM fm_forms WHERE id = $1';
    const result = await this.pool.query<FormRow>(sql, [id]);
    return result.rows[0] ? this.rowToForm(result.rows[0]) : null;
  }

  async update(id: string, updates: UpdateFormDefinition): Promise<FormDefinition | null> {
    const setClauses: string[] = ['updated_at = $2'];
    const values: unknown[] = [id, Date.now()];
    let paramIndex = 3;

    if (updates.name !== undefined) {
      setClauses.push(`name = $${paramIndex++}`);
      values.push(updates.name);
    }
    if (updates.description !== undefined) {
      setClauses.push(`description = $${paramIndex++}`);
      values.push(updates.description);
    }
    if (updates.tenantId !== undefined) {
      setClauses.push(`tenant_id = $${paramIndex++}`);
      values.push(updates.tenantId);
    }
    if (updates.flowId !== undefined) {
      setClauses.push(`flow_id = $${paramIndex++}`);
      values.push(updates.flowId);
    }
    if (updates.contextKey !== undefined) {
      setClauses.push(`context_key = $${paramIndex++}`);
      values.push(updates.contextKey);
    }
    if (updates.fields !== undefined) {
      setClauses.push(`fields = $${paramIndex++}`);
      values.push(JSON.stringify(updates.fields));
    }
    if (updates.security !== undefined) {
      setClauses.push(`security = $${paramIndex++}`);
      values.push(updates.security ? JSON.stringify(updates.security) : null);
    }
    if (updates.enabled !== undefined) {
      setClauses.push(`enabled = $${paramIndex++}`);
      values.push(updates.enabled);
    }
    if (updates.successRedirect !== undefined) {
      setClauses.push(`success_redirect = $${paramIndex++}`);
      values.push(updates.successRedirect);
    }
    if (updates.successMessage !== undefined) {
      setClauses.push(`success_message = $${paramIndex++}`);
      values.push(updates.successMessage);
    }
    if (updates.cssClass !== undefined) {
      setClauses.push(`css_class = $${paramIndex++}`);
      values.push(updates.cssClass);
    }
    if (updates.submitLabel !== undefined) {
      setClauses.push(`submit_label = $${paramIndex++}`);
      values.push(updates.submitLabel);
    }

    const sql = `UPDATE fm_forms SET ${setClauses.join(', ')} WHERE id = $1 RETURNING *`;
    const result = await this.pool.query<FormRow>(sql, values);
    return result.rows[0] ? this.rowToForm(result.rows[0]) : null;
  }

  async delete(id: string): Promise<boolean> {
    const sql = 'DELETE FROM fm_forms WHERE id = $1';
    const result = await this.pool.query(sql, [id]);
    return (result.rowCount ?? 0) > 0;
  }

  async list(filter?: FormListFilter): Promise<FormDefinition[]> {
    const conditions: string[] = [];
    const values: unknown[] = [];
    let paramIndex = 1;

    if (filter?.tenantId !== undefined) {
      conditions.push(`tenant_id = $${paramIndex++}`);
      values.push(filter.tenantId);
    }
    if (filter?.flowId !== undefined) {
      conditions.push(`flow_id = $${paramIndex++}`);
      values.push(filter.flowId);
    }
    if (filter?.enabled !== undefined) {
      conditions.push(`enabled = $${paramIndex++}`);
      values.push(filter.enabled);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const sql = `SELECT * FROM fm_forms ${whereClause} ORDER BY created_at DESC`;

    const result = await this.pool.query<FormRow>(sql, values);
    return result.rows.map((row) => this.rowToForm(row));
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PostgreSQL Submission Store
// ─────────────────────────────────────────────────────────────────────────────

interface SubmissionRow {
  id: string;
  form_id: string;
  tenant_id: string | null;
  execution_id: string | null;
  status: SubmissionStatus;
  data: Record<string, unknown>;
  validation_errors: ValidationError[] | null;
  meta: SubmissionMeta;
  duration_ms: number | null;
  submitted_at: string;
  completed_at: string | null;
}

/**
 * PostgreSQL submission store implementation.
 */
export class PgSubmissionStore implements SubmissionStore {
  constructor(private readonly pool: Pool) {}

  private rowToSubmission(row: SubmissionRow): FormSubmission {
    return {
      id: row.id,
      formId: row.form_id,
      tenantId: row.tenant_id ?? undefined,
      executionId: row.execution_id ?? undefined,
      status: row.status,
      data: row.data,
      validationErrors: row.validation_errors ?? undefined,
      meta: row.meta,
      durationMs: row.duration_ms ?? undefined,
      submittedAt: Number(row.submitted_at),
      completedAt: row.completed_at ? Number(row.completed_at) : undefined,
    };
  }

  async create(input: Omit<FormSubmission, 'id'>): Promise<FormSubmission> {
    const id = `sub_${crypto.randomUUID().slice(0, 8)}`;

    const sql = `
      INSERT INTO fm_form_submissions (
        id, form_id, tenant_id, execution_id, status,
        data, validation_errors, meta,
        duration_ms, submitted_at, completed_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING *
    `;

    const result = await this.pool.query<SubmissionRow>(sql, [
      id,
      input.formId,
      input.tenantId ?? null,
      input.executionId ?? null,
      input.status,
      JSON.stringify(input.data),
      input.validationErrors ? JSON.stringify(input.validationErrors) : null,
      JSON.stringify(input.meta),
      input.durationMs ?? null,
      input.submittedAt,
      input.completedAt ?? null,
    ]);

    return this.rowToSubmission(result.rows[0]);
  }

  async get(id: string): Promise<FormSubmission | null> {
    const sql = 'SELECT * FROM fm_form_submissions WHERE id = $1';
    const result = await this.pool.query<SubmissionRow>(sql, [id]);
    return result.rows[0] ? this.rowToSubmission(result.rows[0]) : null;
  }

  async updateStatus(
    id: string,
    status: SubmissionStatus,
    updates?: { executionId?: string; durationMs?: number; completedAt?: number }
  ): Promise<FormSubmission | null> {
    const setClauses: string[] = ['status = $2'];
    const values: unknown[] = [id, status];
    let paramIndex = 3;

    if (updates?.executionId !== undefined) {
      setClauses.push(`execution_id = $${paramIndex++}`);
      values.push(updates.executionId);
    }
    if (updates?.durationMs !== undefined) {
      setClauses.push(`duration_ms = $${paramIndex++}`);
      values.push(updates.durationMs);
    }
    if (updates?.completedAt !== undefined) {
      setClauses.push(`completed_at = $${paramIndex++}`);
      values.push(updates.completedAt);
    }

    const sql = `UPDATE fm_form_submissions SET ${setClauses.join(', ')} WHERE id = $1 RETURNING *`;
    const result = await this.pool.query<SubmissionRow>(sql, values);
    return result.rows[0] ? this.rowToSubmission(result.rows[0]) : null;
  }

  async list(filter?: SubmissionListFilter): Promise<FormSubmission[]> {
    const conditions: string[] = [];
    const values: unknown[] = [];
    let paramIndex = 1;

    if (filter?.formId !== undefined) {
      conditions.push(`form_id = $${paramIndex++}`);
      values.push(filter.formId);
    }
    if (filter?.tenantId !== undefined) {
      conditions.push(`tenant_id = $${paramIndex++}`);
      values.push(filter.tenantId);
    }
    if (filter?.status !== undefined) {
      conditions.push(`status = $${paramIndex++}`);
      values.push(filter.status);
    }
    if (filter?.since !== undefined) {
      conditions.push(`submitted_at >= $${paramIndex++}`);
      values.push(filter.since);
    }
    if (filter?.until !== undefined) {
      conditions.push(`submitted_at <= $${paramIndex++}`);
      values.push(filter.until);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    let sql = `SELECT * FROM fm_form_submissions ${whereClause} ORDER BY submitted_at DESC`;

    if (filter?.limit !== undefined) {
      sql += ` LIMIT $${paramIndex++}`;
      values.push(filter.limit);
    }
    if (filter?.offset !== undefined) {
      sql += ` OFFSET $${paramIndex++}`;
      values.push(filter.offset);
    }

    const result = await this.pool.query<SubmissionRow>(sql, values);
    return result.rows.map((row) => this.rowToSubmission(row));
  }

  async count(filter?: SubmissionListFilter): Promise<number> {
    const conditions: string[] = [];
    const values: unknown[] = [];
    let paramIndex = 1;

    if (filter?.formId !== undefined) {
      conditions.push(`form_id = $${paramIndex++}`);
      values.push(filter.formId);
    }
    if (filter?.tenantId !== undefined) {
      conditions.push(`tenant_id = $${paramIndex++}`);
      values.push(filter.tenantId);
    }
    if (filter?.status !== undefined) {
      conditions.push(`status = $${paramIndex++}`);
      values.push(filter.status);
    }
    if (filter?.since !== undefined) {
      conditions.push(`submitted_at >= $${paramIndex++}`);
      values.push(filter.since);
    }
    if (filter?.until !== undefined) {
      conditions.push(`submitted_at <= $${paramIndex++}`);
      values.push(filter.until);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const sql = `SELECT COUNT(*) as count FROM fm_form_submissions ${whereClause}`;

    const result = await this.pool.query<{ count: string }>(sql, values);
    return parseInt(result.rows[0]?.count ?? '0', 10);
  }

  async findDuplicate(
    formId: string,
    hash: string,
    windowSeconds: number
  ): Promise<FormSubmission | null> {
    const cutoff = Date.now() - windowSeconds * 1000;
    const sql = `
      SELECT s.* FROM fm_form_submissions s
      JOIN fm_form_dedup d ON d.submission_id = s.id
      WHERE d.form_id = $1 AND d.hash = $2 AND s.submitted_at >= $3
      ORDER BY s.submitted_at DESC
      LIMIT 1
    `;

    const result = await this.pool.query<SubmissionRow>(sql, [formId, hash, cutoff]);
    return result.rows[0] ? this.rowToSubmission(result.rows[0]) : null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PostgreSQL Rate Limit Store
// ─────────────────────────────────────────────────────────────────────────────

/**
 * PostgreSQL rate limit store implementation.
 */
export class PgRateLimitStore implements RateLimitStore {
  constructor(private readonly pool: Pool) {}

  async check(key: string, config: RateLimitConfig): Promise<RateLimitResult> {
    const now = Date.now();
    const windowMs = config.windowSeconds * 1000;

    // Use upsert with conflict handling for atomic rate limiting
    const sql = `
      INSERT INTO fm_form_rate_limits (key, count, window_start, window_end)
      VALUES ($1, 1, $2, $3)
      ON CONFLICT (key) DO UPDATE SET
        count = CASE
          WHEN fm_form_rate_limits.window_end <= $2 THEN 1
          ELSE fm_form_rate_limits.count + 1
        END,
        window_start = CASE
          WHEN fm_form_rate_limits.window_end <= $2 THEN $2
          ELSE fm_form_rate_limits.window_start
        END,
        window_end = CASE
          WHEN fm_form_rate_limits.window_end <= $2 THEN $3
          ELSE fm_form_rate_limits.window_end
        END
      RETURNING count, window_end
    `;

    const result = await this.pool.query<{ count: number; window_end: string }>(sql, [
      key,
      now,
      now + windowMs,
    ]);

    const row = result.rows[0];
    const count = row.count;
    const windowEnd = Number(row.window_end);

    if (count > config.maxSubmissions) {
      return {
        allowed: false,
        remaining: 0,
        resetAt: windowEnd,
        retryAfter: Math.ceil((windowEnd - now) / 1000),
      };
    }

    return {
      allowed: true,
      remaining: config.maxSubmissions - count,
      resetAt: windowEnd,
    };
  }

  async reset(key: string): Promise<void> {
    await this.pool.query('DELETE FROM fm_form_rate_limits WHERE key = $1', [key]);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PostgreSQL Deduplication Store
// ─────────────────────────────────────────────────────────────────────────────

/**
 * PostgreSQL deduplication store implementation.
 */
export class PgDeduplicationStore implements DeduplicationStore {
  constructor(private readonly pool: Pool) {}

  async isDuplicate(formId: string, hash: string, windowSeconds: number): Promise<boolean> {
    const cutoff = Date.now() - windowSeconds * 1000;
    const sql = `
      SELECT 1 FROM fm_form_dedup
      WHERE form_id = $1 AND hash = $2 AND created_at >= $3
      LIMIT 1
    `;

    const result = await this.pool.query(sql, [formId, hash, cutoff]);
    return result.rows.length > 0;
  }

  async record(formId: string, hash: string, submissionId: string): Promise<void> {
    const sql = `
      INSERT INTO fm_form_dedup (form_id, hash, submission_id, created_at)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (form_id, hash) DO UPDATE SET
        submission_id = EXCLUDED.submission_id,
        created_at = EXCLUDED.created_at
    `;

    await this.pool.query(sql, [formId, hash, submissionId, Date.now()]);
  }
}
