import type { Pool } from 'pg';
import type { Execution, ExecutionStatus, StateStore, Lock } from '@flowmonkey/core';

export class PgExecutionStore implements StateStore {
  constructor(private pool: Pool) {}

  async load(id: string): Promise<Execution | null> {
    const { rows } = await this.pool.query(
      `SELECT * FROM fm_executions WHERE id = $1`,
      [id]
    );
    return rows[0] ? this.toExecution(rows[0]) : null;
  }

  async save(execution: Execution): Promise<void> {
    await this.pool.query(
      `INSERT INTO fm_executions (
        id, flow_id, flow_version, current_step, status, context,
        wake_at, wait_reason, error, step_count, history,
        tenant_id, metadata, created_at, updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
      ON CONFLICT (id) DO UPDATE SET
        current_step = EXCLUDED.current_step,
        status = EXCLUDED.status,
        context = EXCLUDED.context,
        wake_at = EXCLUDED.wake_at,
        wait_reason = EXCLUDED.wait_reason,
        error = EXCLUDED.error,
        step_count = EXCLUDED.step_count,
        history = EXCLUDED.history,
        metadata = EXCLUDED.metadata,
        updated_at = EXCLUDED.updated_at`,
      [
        execution.id,
        execution.flowId,
        execution.flowVersion,
        execution.currentStepId,
        execution.status,
        JSON.stringify(execution.context),
        execution.wakeAt ?? null,
        execution.waitReason ?? null,
        execution.error ? JSON.stringify(execution.error) : null,
        execution.stepCount,
        execution.history ? JSON.stringify(execution.history) : null,
        execution.tenantId ?? null,
        execution.metadata ? JSON.stringify(execution.metadata) : null,
        execution.createdAt,
        execution.updatedAt,
      ]
    );
  }

  async delete(id: string): Promise<boolean> {
    const { rowCount } = await this.pool.query(
      `DELETE FROM fm_executions WHERE id = $1`,
      [id]
    );
    return (rowCount ?? 0) > 0;
  }

  async listWakeReady(now: number, limit = 100): Promise<string[]> {
    const { rows } = await this.pool.query(
      `SELECT id FROM fm_executions
       WHERE status = 'waiting' AND wake_at <= $1
       ORDER BY wake_at ASC LIMIT $2`,
      [now, limit]
    );
    return rows.map(r => r.id);
  }

  async listByStatus(status: ExecutionStatus, limit = 100): Promise<Execution[]> {
    const { rows } = await this.pool.query(
      `SELECT * FROM fm_executions
       WHERE status = $1
       ORDER BY created_at DESC LIMIT $2`,
      [status, limit]
    );
    return rows.map(r => this.toExecution(r));
  }

  async acquireLock(id: string, ttlMs: number): Promise<Lock | null> {
    const owner = crypto.randomUUID();
    const expiresAt = Date.now() + ttlMs;

    // Try to acquire
    const { rowCount } = await this.pool.query(
      `INSERT INTO fm_locks (key, owner, expires_at)
       VALUES ($1, $2, $3)
       ON CONFLICT (key) DO UPDATE
       SET owner = EXCLUDED.owner, expires_at = EXCLUDED.expires_at
       WHERE fm_locks.expires_at < $4`,
      [`exec:${id}`, owner, expiresAt, Date.now()]
    );

    if ((rowCount ?? 0) === 0) {
      return null; // Lock held by someone else
    }

    return {
      release: async () => {
        await this.pool.query(
          `DELETE FROM fm_locks WHERE key = $1 AND owner = $2`,
          [`exec:${id}`, owner]
        );
      },
      extend: async (newTtlMs: number) => {
        const newExpiresAt = Date.now() + newTtlMs;
        const { rowCount } = await this.pool.query(
          `UPDATE fm_locks SET expires_at = $3
           WHERE key = $1 AND owner = $2`,
          [`exec:${id}`, owner, newExpiresAt]
        );
        return (rowCount ?? 0) > 0;
      },
    };
  }

  private toExecution(row: any): Execution {
    return {
      id: row.id,
      flowId: row.flow_id,
      flowVersion: row.flow_version,
      currentStepId: row.current_step,
      status: row.status,
      context: row.context ?? {},
      wakeAt: row.wake_at ? Number(row.wake_at) : undefined,
      waitReason: row.wait_reason ?? undefined,
      error: row.error ?? undefined,
      stepCount: row.step_count,
      history: row.history ?? undefined,
      tenantId: row.tenant_id ?? undefined,
      metadata: row.metadata ?? undefined,
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at),
    };
  }
}
