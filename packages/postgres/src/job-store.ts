import type { Pool } from 'pg';
import { createHash } from 'crypto';

// ============================================
// Types
// ============================================

export type JobStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface JobProgress {
  percent: number;
  message?: string;
}

export interface Job {
  id: string;
  executionId: string;
  stepId: string;
  handler: string;
  status: JobStatus;
  input: unknown;
  result?: unknown;
  error?: JobError;
  runnerId?: string;
  heartbeatAt?: number;
  heartbeatMs: number;
  attempts: number;
  maxAttempts: number;
  createdAt: number;
  updatedAt: number;
  // Checkpoint and progress support
  instanceId?: string;
  checkpoint?: unknown;
  progress?: JobProgress;
}

export interface JobError {
  code: string;
  message: string;
  details?: unknown;
}

export interface CreateJobParams {
  executionId: string;
  stepId: string;
  handler: string;
  input: unknown;
  maxAttempts?: number;
  heartbeatMs?: number;
}

// ============================================
// Interface
// ============================================

export interface JobStore {
  /** Get or create a job (idempotent via deterministic ID) */
  getOrCreate(params: CreateJobParams): Promise<Job>;

  /** Get job by ID */
  get(jobId: string): Promise<Job | null>;

  /** Get job for execution step */
  getForStep(executionId: string, stepId: string): Promise<Job | null>;

  /** Claim job (acquire lease) */
  claim(jobId: string, runnerId: string): Promise<boolean>;

  /** Heartbeat (extend lease) */
  heartbeat(jobId: string, runnerId: string): Promise<boolean>;

  /** Complete job with result */
  complete(jobId: string, runnerId: string, result: unknown): Promise<boolean>;

  /** Fail job with error */
  fail(jobId: string, runnerId: string, error: JobError): Promise<boolean>;

  /** Find stalled jobs (lease expired) */
  findStalled(now: number, limit?: number): Promise<Job[]>;

  /** Reset stalled job to pending */
  resetStalled(jobId: string): Promise<boolean>;

  /** List jobs by status */
  listByStatus(status: JobStatus, limit?: number): Promise<Job[]>;

  /** List jobs for execution */
  listForExecution(executionId: string): Promise<Job[]>;

  // ── Checkpoint and Progress Methods ─────────────────────────────

  /**
   * Claim job with a new instance ID.
   * Returns the instance ID if successful, null otherwise.
   */
  claimWithInstance(jobId: string, runnerId: string, instanceId: string): Promise<boolean>;

  /**
   * Save checkpoint data for a job.
   * Only succeeds if instanceId matches the current owner.
   */
  saveCheckpoint(jobId: string, instanceId: string, data: unknown): Promise<boolean>;

  /**
   * Get checkpoint data for a job.
   */
  getCheckpoint(jobId: string): Promise<unknown | null>;

  /**
   * Update progress for a job.
   * Only succeeds if instanceId matches the current owner.
   */
  updateProgress(jobId: string, instanceId: string, progress: JobProgress): Promise<boolean>;

  /**
   * Check if the given instanceId is still the active owner of the job.
   */
  isInstanceActive(jobId: string, instanceId: string): Promise<boolean>;

  /**
   * Get the current instance ID for a job.
   */
  getInstanceId(jobId: string): Promise<string | null>;
}

// ============================================
// Implementation
// ============================================

export class PgJobStore implements JobStore {
  constructor(private pool: Pool) {}

  async getOrCreate(params: CreateJobParams): Promise<Job> {
    const jobId = this.computeJobId(params);
    const now = Date.now();

    await this.pool.query(
      `INSERT INTO fm_jobs (
        id, execution_id, step_id, handler, status, input,
        heartbeat_ms, attempts, max_attempts, created_at, updated_at
      ) VALUES ($1,$2,$3,$4,'pending',$5,$6,0,$7,$8,$8)
      ON CONFLICT (id) DO NOTHING`,
      [
        jobId,
        params.executionId,
        params.stepId,
        params.handler,
        JSON.stringify(params.input),
        params.heartbeatMs ?? 30000,
        params.maxAttempts ?? 3,
        now,
      ]
    );

    return (await this.get(jobId))!;
  }

  async get(jobId: string): Promise<Job | null> {
    const { rows } = await this.pool.query(
      `SELECT * FROM fm_jobs WHERE id = $1`,
      [jobId]
    );
    return rows[0] ? this.toJob(rows[0]) : null;
  }

  async getForStep(executionId: string, stepId: string): Promise<Job | null> {
    const { rows } = await this.pool.query(
      `SELECT * FROM fm_jobs WHERE execution_id = $1 AND step_id = $2`,
      [executionId, stepId]
    );
    return rows[0] ? this.toJob(rows[0]) : null;
  }

  async claim(jobId: string, runnerId: string): Promise<boolean> {
    const now = Date.now();
    const { rowCount } = await this.pool.query(
      `UPDATE fm_jobs SET
        status = 'running',
        runner_id = $2,
        heartbeat_at = $3,
        attempts = attempts + 1,
        updated_at = $3
       WHERE id = $1
         AND status = 'pending'
         AND attempts < max_attempts`,
      [jobId, runnerId, now]
    );
    return (rowCount ?? 0) > 0;
  }

  async heartbeat(jobId: string, runnerId: string): Promise<boolean> {
    const now = Date.now();
    const { rowCount } = await this.pool.query(
      `UPDATE fm_jobs SET heartbeat_at = $3, updated_at = $3
       WHERE id = $1 AND runner_id = $2 AND status = 'running'`,
      [jobId, runnerId, now]
    );
    return (rowCount ?? 0) > 0;
  }

  async complete(jobId: string, runnerId: string, result: unknown): Promise<boolean> {
    const now = Date.now();
    const { rowCount } = await this.pool.query(
      `UPDATE fm_jobs SET
        status = 'completed',
        result = $3,
        updated_at = $4
       WHERE id = $1 AND runner_id = $2 AND status = 'running'`,
      [jobId, runnerId, JSON.stringify(result), now]
    );
    return (rowCount ?? 0) > 0;
  }

  async fail(jobId: string, runnerId: string, error: JobError): Promise<boolean> {
    const now = Date.now();
    const { rowCount } = await this.pool.query(
      `UPDATE fm_jobs SET
        status = 'failed',
        error = $3,
        updated_at = $4
       WHERE id = $1 AND runner_id = $2 AND status = 'running'`,
      [jobId, runnerId, JSON.stringify(error), now]
    );
    return (rowCount ?? 0) > 0;
  }

  async findStalled(now: number, limit = 100): Promise<Job[]> {
    // Stalled = running but no heartbeat for 3x heartbeat interval
    const { rows } = await this.pool.query(
      `SELECT * FROM fm_jobs
       WHERE status = 'running'
         AND heartbeat_at < $1 - (heartbeat_ms * 3)
       ORDER BY heartbeat_at ASC
       LIMIT $2`,
      [now, limit]
    );
    return rows.map((r: any) => this.toJob(r));
  }

  async resetStalled(jobId: string): Promise<boolean> {
    const now = Date.now();
    const { rowCount } = await this.pool.query(
      `UPDATE fm_jobs SET
        status = 'pending',
        runner_id = NULL,
        heartbeat_at = NULL,
        updated_at = $2
       WHERE id = $1
         AND status = 'running'
         AND attempts < max_attempts`,
      [jobId, now]
    );
    return (rowCount ?? 0) > 0;
  }

  async listByStatus(status: JobStatus, limit = 100): Promise<Job[]> {
    const { rows } = await this.pool.query(
      `SELECT * FROM fm_jobs WHERE status = $1 ORDER BY created_at DESC LIMIT $2`,
      [status, limit]
    );
    return rows.map((r: any) => this.toJob(r));
  }

  async listForExecution(executionId: string): Promise<Job[]> {
    const { rows } = await this.pool.query(
      `SELECT * FROM fm_jobs WHERE execution_id = $1 ORDER BY created_at ASC`,
      [executionId]
    );
    return rows.map((r: any) => this.toJob(r));
  }

  // ── Checkpoint and Progress Methods ─────────────────────────────

  async claimWithInstance(jobId: string, runnerId: string, instanceId: string): Promise<boolean> {
    const now = Date.now();
    const { rowCount } = await this.pool.query(
      `UPDATE fm_jobs SET
        status = 'running',
        runner_id = $2,
        instance_id = $3,
        heartbeat_at = $4,
        attempts = attempts + 1,
        updated_at = $4,
        progress = NULL
       WHERE id = $1
         AND status = 'pending'
         AND attempts < max_attempts`,
      [jobId, runnerId, instanceId, now]
    );
    return (rowCount ?? 0) > 0;
  }

  async saveCheckpoint(jobId: string, instanceId: string, data: unknown): Promise<boolean> {
    const now = Date.now();
    const { rowCount } = await this.pool.query(
      `UPDATE fm_jobs SET
        checkpoint = $3,
        heartbeat_at = $4,
        updated_at = $4
       WHERE id = $1
         AND instance_id = $2
         AND status = 'running'`,
      [jobId, instanceId, JSON.stringify(data), now]
    );
    return (rowCount ?? 0) > 0;
  }

  async getCheckpoint(jobId: string): Promise<unknown | null> {
    const { rows } = await this.pool.query(
      `SELECT checkpoint FROM fm_jobs WHERE id = $1`,
      [jobId]
    );
    return rows[0]?.checkpoint ?? null;
  }

  async updateProgress(jobId: string, instanceId: string, progress: JobProgress): Promise<boolean> {
    const now = Date.now();
    const { rowCount } = await this.pool.query(
      `UPDATE fm_jobs SET
        progress = $3,
        heartbeat_at = $4,
        updated_at = $4
       WHERE id = $1
         AND instance_id = $2
         AND status = 'running'`,
      [jobId, instanceId, JSON.stringify(progress), now]
    );
    return (rowCount ?? 0) > 0;
  }

  async isInstanceActive(jobId: string, instanceId: string): Promise<boolean> {
    const { rows } = await this.pool.query(
      `SELECT 1 FROM fm_jobs
       WHERE id = $1
         AND instance_id = $2
         AND status = 'running'`,
      [jobId, instanceId]
    );
    return rows.length > 0;
  }

  async getInstanceId(jobId: string): Promise<string | null> {
    const { rows } = await this.pool.query(
      `SELECT instance_id FROM fm_jobs WHERE id = $1`,
      [jobId]
    );
    return rows[0]?.instance_id ?? null;
  }

  /**
   * Deterministic job ID ensures idempotency.
   * Same execution + step + handler + input = same job ID.
   */
  private computeJobId(params: CreateJobParams): string {
    const data = JSON.stringify({
      e: params.executionId,
      s: params.stepId,
      h: params.handler,
      i: params.input,
    });
    return createHash('sha256').update(data).digest('hex').slice(0, 32);
  }

  private toJob(row: any): Job {
    return {
      id: row.id,
      executionId: row.execution_id,
      stepId: row.step_id,
      handler: row.handler,
      status: row.status,
      input: row.input,
      result: row.result ?? undefined,
      error: row.error ?? undefined,
      runnerId: row.runner_id ?? undefined,
      heartbeatAt: row.heartbeat_at ? Number(row.heartbeat_at) : undefined,
      heartbeatMs: row.heartbeat_ms,
      attempts: row.attempts,
      maxAttempts: row.max_attempts,
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at),
      // Checkpoint and progress
      instanceId: row.instance_id ?? undefined,
      checkpoint: row.checkpoint ?? undefined,
      progress: row.progress ?? undefined,
    };
  }
}
