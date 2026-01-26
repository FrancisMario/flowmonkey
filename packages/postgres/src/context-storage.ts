import type { Pool } from 'pg';
import type { ContextStorage, ContextReference } from '@flowmonkey/core';

export class PgContextStorage implements ContextStorage {
  constructor(private readonly pool: Pool) {}

  async set(executionId: string, key: string, value: unknown): Promise<ContextReference> {
    const json = JSON.stringify(value);
    const size = Buffer.byteLength(json, 'utf8');
    const createdAt = Date.now();
    const summary = this.generateSummary(value, json);

    await this.pool.query(
      `INSERT INTO fm_context_storage (execution_id, key, data, size_bytes, created_at)
       VALUES ($1, $2, $3::jsonb, $4, $5)
       ON CONFLICT (execution_id, key) DO UPDATE SET data = EXCLUDED.data, size_bytes = EXCLUDED.size_bytes, created_at = EXCLUDED.created_at`,
      [executionId, key, json, size, createdAt]
    );

    return {
      _ref: `storage://${executionId}/${key}`,
      summary,
      size,
      createdAt,
    };
  }

  async get(executionId: string, key: string): Promise<unknown> {
    const result = await this.pool.query(
      'SELECT data FROM fm_context_storage WHERE execution_id = $1 AND key = $2',
      [executionId, key]
    );

    if (result.rows.length === 0) throw new Error(`Context key not found: ${key}`);
    return result.rows[0].data;
  }

  async delete(executionId: string, key: string): Promise<void> {
    await this.pool.query('DELETE FROM fm_context_storage WHERE execution_id = $1 AND key = $2', [executionId, key]);
  }

  async list(executionId: string): Promise<string[]> {
    const result = await this.pool.query('SELECT key FROM fm_context_storage WHERE execution_id = $1', [executionId]);
    return result.rows.map((r: any) => r.key);
  }

  async cleanup(executionId: string): Promise<void> {
    await this.pool.query('DELETE FROM fm_context_storage WHERE execution_id = $1', [executionId]);
  }

  private generateSummary(value: unknown, json: string): string {
    if (typeof value === 'string') return value.slice(0, 200);
    if (Array.isArray(value)) return `Array(${value.length})`;
    if (typeof value === 'object' && value !== null) {
      const keys = Object.keys(value as Record<string, unknown>).slice(0, 5);
      return `Object {${keys.join(', ')}${Object.keys(value as Record<string, unknown>).length > 5 ? '...' : ''}}`;
    }
    return json.slice(0, 200);
  }
}
