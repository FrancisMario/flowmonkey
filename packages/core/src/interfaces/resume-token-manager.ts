/**
 * Resume token manager interface for waiting handlers.
 */
export type TokenStatus = 'active' | 'used' | 'expired' | 'revoked';

export interface ResumeToken {
  token: string;
  executionId: string;
  stepId: string;
  status: TokenStatus;
  createdAt: number;
  expiresAt?: number | null;
  usedAt?: number | null;
  metadata?: Record<string, unknown>;
}

export interface ResumeTokenManager {
  generate(
    executionId: string,
    stepId: string,
    options?: { expiresInMs?: number; metadata?: Record<string, unknown> }
  ): Promise<ResumeToken>;

  get(token: string): Promise<ResumeToken | null>;

  validate(token: string): Promise<{ valid: boolean; reason?: string }>;

  markUsed(token: string): Promise<void>;

  revoke(token: string): Promise<void>;

  listByExecution(executionId: string): Promise<ResumeToken[]>;

  cleanupExpired(): Promise<number>;
}
