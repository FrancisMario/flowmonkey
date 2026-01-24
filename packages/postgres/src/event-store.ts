import type { Pool } from 'pg';
import type { EventBus } from '@flowmonkey/core';

// ============================================
// Types
// ============================================

export interface StoredEvent {
  id: number;
  executionId: string;
  type: string;
  stepId?: string;
  payload: Record<string, unknown>;
  timestamp: number;
}

export interface EventQuery {
  executionId?: string;
  type?: string;
  from?: number;
  to?: number;
  limit?: number;
}

// ============================================
// Implementation
// ============================================

export class PgEventStore implements EventBus {
  constructor(private pool: Pool) {}

  // --- EventBus implementation (fire and forget) ---

  onExecutionCreated(e: any) {
    this.insert('execution.created', e.executionId, undefined, e);
  }

  onExecutionStarted(e: any) {
    this.insert('execution.started', e.executionId, e.stepId, e);
  }

  onStepStarted(e: any) {
    this.insert('step.started', e.executionId, e.stepId, e);
  }

  onStepCompleted(e: any) {
    this.insert('step.completed', e.executionId, e.stepId, e);
  }

  onExecutionCompleted(e: any) {
    this.insert('execution.completed', e.executionId, undefined, e);
  }

  onExecutionFailed(e: any) {
    this.insert('execution.failed', e.executionId, e.stepId, e);
  }

  onExecutionWaiting(e: any) {
    this.insert('execution.waiting', e.executionId, e.stepId, e);
  }

  // --- Query methods ---

  async query(q: EventQuery): Promise<StoredEvent[]> {
    const conditions: string[] = [];
    const params: any[] = [];
    let paramIndex = 1;

    if (q.executionId) {
      conditions.push(`execution_id = $${paramIndex++}`);
      params.push(q.executionId);
    }
    if (q.type) {
      conditions.push(`type = $${paramIndex++}`);
      params.push(q.type);
    }
    if (q.from) {
      conditions.push(`timestamp >= $${paramIndex++}`);
      params.push(q.from);
    }
    if (q.to) {
      conditions.push(`timestamp <= $${paramIndex++}`);
      params.push(q.to);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = q.limit ?? 1000;

    const { rows } = await this.pool.query(
      `SELECT * FROM fm_events ${where} ORDER BY timestamp ASC LIMIT ${limit}`,
      params
    );

    return rows.map(r => this.toEvent(r));
  }

  async forExecution(executionId: string): Promise<StoredEvent[]> {
    return this.query({ executionId });
  }

  async byType(type: string, limit = 100): Promise<StoredEvent[]> {
    const { rows } = await this.pool.query(
      `SELECT * FROM fm_events WHERE type = $1 ORDER BY timestamp DESC LIMIT $2`,
      [type, limit]
    );
    return rows.map(r => this.toEvent(r));
  }

  // --- Internal ---

  private insert(type: string, executionId: string, stepId: string | undefined, payload: any) {
    // Fire and forget - don't block execution for observability
    this.pool.query(
      `INSERT INTO fm_events (execution_id, type, step_id, payload, timestamp)
       VALUES ($1, $2, $3, $4, $5)`,
      [executionId, type, stepId ?? null, JSON.stringify(payload), Date.now()]
    ).catch(() => {}); // Silently ignore errors
  }

  private toEvent(row: any): StoredEvent {
    return {
      id: Number(row.id),
      executionId: row.execution_id,
      type: row.type,
      stepId: row.step_id ?? undefined,
      payload: row.payload ?? {},
      timestamp: Number(row.timestamp),
    };
  }
}
