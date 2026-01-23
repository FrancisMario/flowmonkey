import type { Execution, ExecutionStatus } from '../types/execution';

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
}
