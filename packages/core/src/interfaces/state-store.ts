import type { Execution, ExecutionStatus } from '../types/execution';

export interface Lock {
  /** Release the lock. Safe to call multiple times. */
  release(): Promise<void>;
  /** Extend the lock TTL. Returns false if lock was lost. */
  extend(ttlMs: number): Promise<boolean>;
}

/**
 * Persistence layer for executions.
 * Implement this for Redis, Postgres, etc.
 */
export interface StateStore {
  /** Load an execution by ID */
  load(id: string): Promise<Execution | null>;

  /** Save an execution (create or update) */
  save(execution: Execution): Promise<void>;

  /** Delete an execution */
  delete(id: string): Promise<boolean>;

  /** Find executions ready to wake */
  listWakeReady(now: number, limit?: number): Promise<string[]>;

  /** Find executions by status */
  listByStatus(status: ExecutionStatus, limit?: number): Promise<Execution[]>;

  /**
   * Acquire a lock on an execution (optional).
   * For distributed deployments with multiple workers.
   * Single-instance deployments can skip this.
   *
   * @returns Lock if acquired, null if already locked
   */
  acquireLock?(id: string, ttlMs: number): Promise<Lock | null>;

  // === V1 Gap Fixes ===

  /**
   * Find execution by idempotency key within window.
   * Returns null if not found or if the key has expired.
   */
  findByIdempotencyKey?(
    flowId: string,
    key: string,
    windowMs: number
  ): Promise<Execution | null>;

  /**
   * Find child executions (sub-flows) of a parent.
   */
  findChildren?(parentId: string): Promise<Execution[]>;

  /**
   * Find executions that have exceeded their execution timeout.
   */
  findTimedOutExecutions?(now: number): Promise<Execution[]>;

  /**
   * Find executions in waiting status that have exceeded their wait timeout.
   */
  findTimedOutWaits?(now: number): Promise<Execution[]>;
}
