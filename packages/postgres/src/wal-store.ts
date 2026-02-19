/**
 * PgWALStore — Postgres-backed Write-Ahead Log.
 *
 * Stores failed pipe writes for retry. While the WAL concept originally
 * targets local disk (to survive DB outages), a Postgres WAL is useful
 * for scenarios where transient failures (e.g. constraint violations,
 * concurrent conflicts) benefit from structured retry.
 *
 * For true DB-outage resilience, use FileWAL (in core) or RedisWAL.
 */

import type { Pool } from 'pg';
import type { WALEntry } from '@flowmonkey/core';
import type { WriteAheadLog } from '@flowmonkey/core';

export class PgWALStore implements WriteAheadLog {
  constructor(private pool: Pool) {}

  async append(entry: WALEntry): Promise<void> {
    await this.pool.query(
      `INSERT INTO fm_wal_entries
        (id, table_id, tenant_id, data, pipe_id, execution_id, flow_id, step_id, error, attempts, created_at, acked)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, FALSE)`,
      [
        entry.id,
        entry.tableId,
        entry.tenantId ?? null,
        JSON.stringify(entry.data),
        entry.pipeId,
        entry.executionId,
        entry.flowId,
        entry.stepId,
        entry.error,
        entry.attempts,
        entry.createdAt,
      ]
    );
  }

  async readPending(limit = 100): Promise<WALEntry[]> {
    const { rows } = await this.pool.query(
      `SELECT * FROM fm_wal_entries
       WHERE acked = FALSE
       ORDER BY created_at ASC
       LIMIT $1`,
      [limit]
    );
    return rows.map((r: any) => this.toWALEntry(r));
  }

  async ack(id: string): Promise<void> {
    await this.pool.query(
      `UPDATE fm_wal_entries SET acked = TRUE WHERE id = $1`,
      [id]
    );
  }

  async compact(): Promise<void> {
    await this.pool.query(
      `DELETE FROM fm_wal_entries WHERE acked = TRUE`
    );
  }

  // --- Private ---

  private toWALEntry(row: any): WALEntry {
    return {
      id: row.id,
      tableId: row.table_id,
      tenantId: row.tenant_id ?? undefined,
      data: typeof row.data === 'string' ? JSON.parse(row.data) : row.data,
      pipeId: row.pipe_id,
      executionId: row.execution_id,
      flowId: row.flow_id,
      stepId: row.step_id,
      error: row.error,
      attempts: row.attempts,
      createdAt: Number(row.created_at),
    };
  }
}
