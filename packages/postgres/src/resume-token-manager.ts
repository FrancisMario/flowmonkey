import type { Pool } from 'pg';
import type { ResumeTokenManager, ResumeToken } from '@flowmonkey/core';
import { randomBytes } from 'crypto';

export class PgResumeTokenManager implements ResumeTokenManager {
  constructor(private readonly pool: Pool) {}

  private generateSecureToken(): string {
    return randomBytes(32).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  }

  private rowToToken(row: any): ResumeToken {
    return {
      token: row.token,
      executionId: row.execution_id,
      stepId: row.step_id,
      status: row.status,
      createdAt: Number(row.created_at),
      expiresAt: row.expires_at ? Number(row.expires_at) : undefined,
      usedAt: row.used_at ? Number(row.used_at) : undefined,
      metadata: row.metadata || undefined,
    };
  }

  async generate(executionId: string, stepId: string, options?: { expiresInMs?: number; metadata?: Record<string, unknown> }): Promise<ResumeToken> {
    const token = this.generateSecureToken();
    const createdAt = Date.now();
    const expiresAt = options?.expiresInMs ? createdAt + options.expiresInMs : null;

    await this.pool.query(
      `INSERT INTO fm_resume_tokens (token, execution_id, step_id, status, created_at, expires_at, metadata)
       VALUES ($1, $2, $3, 'active', $4, $5, $6::jsonb)`,
      [token, executionId, stepId, createdAt, expiresAt, options?.metadata ? JSON.stringify(options.metadata) : null]
    );

    const result = await this.pool.query('SELECT * FROM fm_resume_tokens WHERE token = $1', [token]);
    return this.rowToToken(result.rows[0]);
  }

  async get(token: string): Promise<ResumeToken | null> {
    const result = await this.pool.query('SELECT * FROM fm_resume_tokens WHERE token = $1', [token]);
    return result.rows.length > 0 ? this.rowToToken(result.rows[0]) : null;
  }

  async validate(token: string): Promise<{ valid: boolean; reason?: string }> {
    const t = await this.get(token);
    if (!t) return { valid: false, reason: 'Token not found' };
    if (t.status === 'used') return { valid: false, reason: 'Token already used' };
    if (t.status === 'revoked') return { valid: false, reason: 'Token revoked' };
    if (t.status === 'expired' || (t.expiresAt && Date.now() > t.expiresAt)) return { valid: false, reason: 'Token expired' };
    return { valid: true };
  }

  async markUsed(token: string): Promise<void> {
    await this.pool.query('UPDATE fm_resume_tokens SET status = $1, used_at = $2 WHERE token = $3', ['used', Date.now(), token]);
  }

  async revoke(token: string): Promise<void> {
    await this.pool.query('UPDATE fm_resume_tokens SET status = $1 WHERE token = $2', ['revoked', token]);
  }

  async listByExecution(executionId: string): Promise<ResumeToken[]> {
    const result = await this.pool.query('SELECT * FROM fm_resume_tokens WHERE execution_id = $1 ORDER BY created_at DESC', [executionId]);
    return result.rows.map((r: any) => this.rowToToken(r));
  }

  async cleanupExpired(): Promise<number> {
    const now = Date.now();
    const result = await this.pool.query(`UPDATE fm_resume_tokens SET status = 'expired' WHERE status = 'active' AND expires_at IS NOT NULL AND expires_at < $1`, [now]);
    return result.rowCount || 0;
  }
}
