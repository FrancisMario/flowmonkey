import type { Pool } from 'pg';
import { generateId } from '@flowmonkey/core';
import { parseExpression } from 'cron-parser';

import type {
  Trigger,
  HttpTrigger,
  ScheduleTrigger,
  TriggerStore,
  TriggerHistoryRecord,
  TriggerStats,
  CreateTrigger,
} from './types';

/**
 * Compute next cron run time.
 * Uses cron-parser library.
 */
function computeNextRun(schedule: string, timezone: string): number {
  const interval = parseExpression(schedule, { tz: timezone });
  return interval.next().getTime();
}

/**
 * PostgreSQL implementation of TriggerStore.
 */
export class PgTriggerStore implements TriggerStore {
  constructor(private pool: Pool) {}

  async create(data: CreateTrigger): Promise<Trigger> {
    const id = `trg_${generateId().slice(0, 12)}`;
    const now = Date.now();

    let nextRunAt: number | undefined;
    if (data.type === 'schedule' && data.enabled) {
      nextRunAt = computeNextRun(data.schedule, data.timezone);
    }

    const trigger: Trigger = {
      ...data,
      id,
      createdAt: now,
      updatedAt: now,
      ...(data.type === 'schedule' ? { nextRunAt } : {}),
    } as Trigger;

    await this.pool.query(
      `INSERT INTO fm_triggers (
        id, name, description, flow_id, type, enabled,
        input_schema, context_key,
        schedule, timezone, static_context, next_run_at,
        created_at, updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [
        trigger.id,
        trigger.name,
        trigger.description ?? null,
        trigger.flowId,
        trigger.type,
        trigger.enabled,
        trigger.type === 'http' ? JSON.stringify((trigger as HttpTrigger).inputSchema) : null,
        trigger.type === 'http' ? (trigger as HttpTrigger).contextKey : null,
        trigger.type === 'schedule' ? (trigger as ScheduleTrigger).schedule : null,
        trigger.type === 'schedule' ? (trigger as ScheduleTrigger).timezone : null,
        trigger.type === 'schedule' ? JSON.stringify((trigger as ScheduleTrigger).staticContext) : null,
        trigger.type === 'schedule' ? nextRunAt ?? null : null,
        now,
        now,
      ]
    );

    return trigger;
  }

  async get(id: string): Promise<Trigger | null> {
    const { rows } = await this.pool.query(
      `SELECT * FROM fm_triggers WHERE id = $1`,
      [id]
    );
    return rows[0] ? this.rowToTrigger(rows[0]) : null;
  }

  async update(id: string, updates: Partial<Trigger>): Promise<Trigger | null> {
    const current = await this.get(id);
    if (!current) return null;

    const updated = { ...current, ...updates, updatedAt: Date.now() } as Trigger;

    // Recompute next run if schedule changed
    if (
      updated.type === 'schedule' &&
      ('schedule' in updates || 'timezone' in updates || 'enabled' in updates)
    ) {
      (updated as ScheduleTrigger).nextRunAt = updated.enabled
        ? computeNextRun((updated as ScheduleTrigger).schedule, (updated as ScheduleTrigger).timezone)
        : undefined;
    }

    await this.pool.query(
      `UPDATE fm_triggers SET
        name = $2,
        description = $3,
        flow_id = $4,
        enabled = $5,
        input_schema = $6,
        context_key = $7,
        schedule = $8,
        timezone = $9,
        static_context = $10,
        next_run_at = $11,
        updated_at = $12
      WHERE id = $1`,
      [
        id,
        updated.name,
        updated.description ?? null,
        updated.flowId,
        updated.enabled,
        updated.type === 'http' ? JSON.stringify((updated as HttpTrigger).inputSchema) : null,
        updated.type === 'http' ? (updated as HttpTrigger).contextKey : null,
        updated.type === 'schedule' ? (updated as ScheduleTrigger).schedule : null,
        updated.type === 'schedule' ? (updated as ScheduleTrigger).timezone : null,
        updated.type === 'schedule' ? JSON.stringify((updated as ScheduleTrigger).staticContext) : null,
        updated.type === 'schedule' ? (updated as ScheduleTrigger).nextRunAt ?? null : null,
        updated.updatedAt,
      ]
    );

    return updated;
  }

  async delete(id: string): Promise<boolean> {
    const { rowCount } = await this.pool.query(
      `DELETE FROM fm_triggers WHERE id = $1`,
      [id]
    );
    return (rowCount ?? 0) > 0;
  }

  async list(options?: {
    flowId?: string;
    type?: 'http' | 'schedule';
    enabled?: boolean;
  }): Promise<Trigger[]> {
    const conditions: string[] = [];
    const params: unknown[] = [];
    let paramIndex = 1;

    if (options?.flowId) {
      conditions.push(`flow_id = $${paramIndex++}`);
      params.push(options.flowId);
    }
    if (options?.type) {
      conditions.push(`type = $${paramIndex++}`);
      params.push(options.type);
    }
    if (options?.enabled !== undefined) {
      conditions.push(`enabled = $${paramIndex++}`);
      params.push(options.enabled);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const { rows } = await this.pool.query(
      `SELECT * FROM fm_triggers ${where} ORDER BY created_at DESC`,
      params
    );

    return rows.map((r: Record<string, unknown>) => this.rowToTrigger(r));
  }

  async listDueSchedules(now: number): Promise<ScheduleTrigger[]> {
    const { rows } = await this.pool.query(
      `SELECT * FROM fm_triggers
       WHERE type = 'schedule'
         AND enabled = true
         AND next_run_at <= $1
       ORDER BY next_run_at ASC`,
      [now]
    );
    return rows.map((r: Record<string, unknown>) => this.rowToTrigger(r) as ScheduleTrigger);
  }

  async updateScheduleRun(id: string, lastRunAt: number, nextRunAt: number): Promise<void> {
    await this.pool.query(
      `UPDATE fm_triggers
       SET last_run_at = $2, next_run_at = $3, updated_at = $4
       WHERE id = $1`,
      [id, lastRunAt, nextRunAt, Date.now()]
    );
  }

  async logInvocation(record: Omit<TriggerHistoryRecord, 'id'>): Promise<void> {
    await this.pool.query(
      `INSERT INTO fm_trigger_history (
        trigger_id, execution_id, status,
        request_body, request_headers, request_ip,
        validation_errors, error_code, error_message,
        duration_ms, timestamp
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        record.triggerId,
        record.executionId ?? null,
        record.status,
        record.requestBody ? JSON.stringify(record.requestBody) : null,
        record.requestHeaders ? JSON.stringify(record.requestHeaders) : null,
        record.requestIp ?? null,
        record.validationErrors ? JSON.stringify(record.validationErrors) : null,
        record.errorCode ?? null,
        record.errorMessage ?? null,
        record.durationMs,
        record.timestamp,
      ]
    );
  }

  async getHistory(
    triggerId: string,
    options?: { limit?: number; status?: string }
  ): Promise<TriggerHistoryRecord[]> {
    const conditions = ['trigger_id = $1'];
    const params: unknown[] = [triggerId];
    let paramIndex = 2;

    if (options?.status) {
      conditions.push(`status = $${paramIndex++}`);
      params.push(options.status);
    }

    const limit = options?.limit ?? 100;

    const { rows } = await this.pool.query(
      `SELECT * FROM fm_trigger_history
       WHERE ${conditions.join(' AND ')}
       ORDER BY timestamp DESC
       LIMIT ${limit}`,
      params
    );

    return rows.map((r: Record<string, unknown>) => this.rowToHistory(r));
  }

  async getHistoryStats(triggerId: string, since: number): Promise<TriggerStats> {
    const { rows } = await this.pool.query(
      `SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE status = 'success') as success,
        COUNT(*) FILTER (WHERE status = 'validation_failed') as validation_failed,
        COUNT(*) FILTER (WHERE status = 'flow_not_found') as flow_not_found,
        COUNT(*) FILTER (WHERE status = 'error') as error,
        AVG(duration_ms) as avg_duration_ms
       FROM fm_trigger_history
       WHERE trigger_id = $1 AND timestamp >= $2`,
      [triggerId, since]
    );

    const r = rows[0];
    return {
      total: Number(r.total),
      success: Number(r.success),
      validationFailed: Number(r.validation_failed),
      flowNotFound: Number(r.flow_not_found),
      error: Number(r.error),
      avgDurationMs: Number(r.avg_duration_ms) || 0,
    };
  }

  private rowToTrigger(row: Record<string, unknown>): Trigger {
    const base = {
      id: row.id as string,
      name: row.name as string,
      description: (row.description as string) ?? undefined,
      flowId: row.flow_id as string,
      enabled: row.enabled as boolean,
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at),
    };

    if (row.type === 'http') {
      return {
        ...base,
        type: 'http',
        inputSchema: row.input_schema as HttpTrigger['inputSchema'],
        contextKey: row.context_key as string,
      };
    } else {
      return {
        ...base,
        type: 'schedule',
        schedule: row.schedule as string,
        timezone: row.timezone as string,
        staticContext: (row.static_context as Record<string, unknown>) ?? {},
        lastRunAt: row.last_run_at ? Number(row.last_run_at) : undefined,
        nextRunAt: row.next_run_at ? Number(row.next_run_at) : undefined,
      };
    }
  }

  private rowToHistory(row: Record<string, unknown>): TriggerHistoryRecord {
    return {
      id: Number(row.id),
      triggerId: row.trigger_id as string,
      executionId: (row.execution_id as string) ?? undefined,
      status: row.status as TriggerHistoryRecord['status'],
      requestBody: row.request_body ?? undefined,
      requestHeaders: (row.request_headers as Record<string, string>) ?? undefined,
      requestIp: (row.request_ip as string) ?? undefined,
      validationErrors: (row.validation_errors as TriggerHistoryRecord['validationErrors']) ?? undefined,
      errorCode: (row.error_code as string) ?? undefined,
      errorMessage: (row.error_message as string) ?? undefined,
      durationMs: row.duration_ms as number,
      timestamp: Number(row.timestamp),
    };
  }
}

/**
 * In-memory implementation for testing.
 */
export class MemoryTriggerStore implements TriggerStore {
  private triggers = new Map<string, Trigger>();
  private history: TriggerHistoryRecord[] = [];
  private historyId = 0;

  async create(data: CreateTrigger): Promise<Trigger> {
    const id = `trg_${generateId().slice(0, 12)}`;
    const now = Date.now();

    let nextRunAt: number | undefined;
    if (data.type === 'schedule' && data.enabled) {
      nextRunAt = computeNextRun(data.schedule, data.timezone);
    }

    const trigger: Trigger = {
      ...data,
      id,
      createdAt: now,
      updatedAt: now,
      ...(data.type === 'schedule' ? { nextRunAt } : {}),
    } as Trigger;

    this.triggers.set(id, trigger);
    return trigger;
  }

  async get(id: string): Promise<Trigger | null> {
    return this.triggers.get(id) ?? null;
  }

  async update(id: string, updates: Partial<Trigger>): Promise<Trigger | null> {
    const current = this.triggers.get(id);
    if (!current) return null;

    const updated = { ...current, ...updates, updatedAt: Date.now() } as Trigger;

    if (
      updated.type === 'schedule' &&
      ('schedule' in updates || 'timezone' in updates || 'enabled' in updates)
    ) {
      (updated as ScheduleTrigger).nextRunAt = updated.enabled
        ? computeNextRun((updated as ScheduleTrigger).schedule, (updated as ScheduleTrigger).timezone)
        : undefined;
    }

    this.triggers.set(id, updated);
    return updated;
  }

  async delete(id: string): Promise<boolean> {
    return this.triggers.delete(id);
  }

  async list(options?: {
    flowId?: string;
    type?: 'http' | 'schedule';
    enabled?: boolean;
  }): Promise<Trigger[]> {
    let results = [...this.triggers.values()];

    if (options?.flowId) {
      results = results.filter((t) => t.flowId === options.flowId);
    }
    if (options?.type) {
      results = results.filter((t) => t.type === options.type);
    }
    if (options?.enabled !== undefined) {
      results = results.filter((t) => t.enabled === options.enabled);
    }

    return results.sort((a, b) => b.createdAt - a.createdAt);
  }

  async listDueSchedules(now: number): Promise<ScheduleTrigger[]> {
    return [...this.triggers.values()]
      .filter(
        (t): t is ScheduleTrigger =>
          t.type === 'schedule' && t.enabled && t.nextRunAt !== undefined && t.nextRunAt <= now
      )
      .sort((a, b) => (a.nextRunAt ?? 0) - (b.nextRunAt ?? 0));
  }

  async updateScheduleRun(id: string, lastRunAt: number, nextRunAt: number): Promise<void> {
    const trigger = this.triggers.get(id) as ScheduleTrigger | undefined;
    if (trigger && trigger.type === 'schedule') {
      trigger.lastRunAt = lastRunAt;
      trigger.nextRunAt = nextRunAt;
      trigger.updatedAt = Date.now();
    }
  }

  async logInvocation(record: Omit<TriggerHistoryRecord, 'id'>): Promise<void> {
    this.history.push({ ...record, id: ++this.historyId });
  }

  async getHistory(
    triggerId: string,
    options?: { limit?: number; status?: string }
  ): Promise<TriggerHistoryRecord[]> {
    let results = this.history.filter((h) => h.triggerId === triggerId);

    if (options?.status) {
      results = results.filter((h) => h.status === options.status);
    }

    return results
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, options?.limit ?? 100);
  }

  async getHistoryStats(triggerId: string, since: number): Promise<TriggerStats> {
    const records = this.history.filter(
      (h) => h.triggerId === triggerId && h.timestamp >= since
    );

    const stats: TriggerStats = {
      total: records.length,
      success: 0,
      validationFailed: 0,
      flowNotFound: 0,
      error: 0,
      avgDurationMs: 0,
    };

    let totalDuration = 0;
    for (const r of records) {
      if (r.status === 'success') stats.success++;
      else if (r.status === 'validation_failed') stats.validationFailed++;
      else if (r.status === 'flow_not_found') stats.flowNotFound++;
      else if (r.status === 'error') stats.error++;
      totalDuration += r.durationMs;
    }

    stats.avgDurationMs = records.length > 0 ? totalDuration / records.length : 0;
    return stats;
  }

  // Test helpers
  clear(): void {
    this.triggers.clear();
    this.history = [];
    this.historyId = 0;
  }
}
