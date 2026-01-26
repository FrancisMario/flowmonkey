import type { Execution, ExecutionStatus } from '../types/execution';
import type { StateStore } from '../interfaces/state-store';

/** Default timeout values */
const DEFAULT_EXECUTION_TIMEOUT_MS = 24 * 60 * 60 * 1000; // 24 hours
const DEFAULT_WAIT_TIMEOUT_MS = 7 * 24 * 60 * 60 * 1000;   // 7 days

/**
 * In-memory store. For testing and single-instance use.
 */
export class MemoryStore implements StateStore {
  private data = new Map<string, Execution>();

  async load(id: string): Promise<Execution | null> {
    const e = this.data.get(id);
    return e ? structuredClone(e) : null;
  }

  async save(execution: Execution): Promise<void> {
    this.data.set(execution.id, structuredClone(execution));
  }

  async delete(id: string): Promise<boolean> {
    return this.data.delete(id);
  }

  async listWakeReady(now: number, limit = 100): Promise<string[]> {
    const ids: string[] = [];
    for (const e of this.data.values()) {
      if (e.status === 'waiting' && e.wakeAt && e.wakeAt <= now) {
        ids.push(e.id);
        if (ids.length >= limit) break;
      }
    }
    return ids;
  }

  async listByStatus(status: ExecutionStatus, limit = 100): Promise<Execution[]> {
    const results: Execution[] = [];
    for (const e of this.data.values()) {
      if (e.status === status) {
        results.push(structuredClone(e));
        if (results.length >= limit) break;
      }
    }
    return results;
  }

  // === V1 Gap Fixes ===

  async findByIdempotencyKey(
    flowId: string,
    key: string,
    _windowMs: number
  ): Promise<Execution | null> {
    // Note: windowMs is ignored in memory store because we check idempotencyExpiresAt
    // which was calculated at creation time. For Postgres, windowMs would be used in the query.
    const now = Date.now();
    for (const e of this.data.values()) {
      if (
        e.flowId === flowId &&
        e.idempotencyKey === key &&
        e.idempotencyExpiresAt &&
        e.idempotencyExpiresAt > now
      ) {
        return structuredClone(e);
      }
    }
    return null;
  }

  async findChildren(parentId: string): Promise<Execution[]> {
    const results: Execution[] = [];
    for (const e of this.data.values()) {
      if (e.parentExecutionId === parentId) {
        results.push(structuredClone(e));
      }
    }
    return results;
  }

  async findTimedOutExecutions(now: number): Promise<Execution[]> {
    const results: Execution[] = [];
    for (const e of this.data.values()) {
      // Skip terminal statuses
      if (e.status === 'completed' || e.status === 'failed' || e.status === 'cancelled') {
        continue;
      }

      const timeout = e.timeoutConfig?.executionTimeoutMs ?? DEFAULT_EXECUTION_TIMEOUT_MS;
      if (now - e.createdAt > timeout) {
        results.push(structuredClone(e));
      }
    }
    return results;
  }

  async findTimedOutWaits(now: number): Promise<Execution[]> {
    const results: Execution[] = [];
    for (const e of this.data.values()) {
      if (e.status !== 'waiting' || !e.waitStartedAt) continue;

      const timeout = e.timeoutConfig?.waitTimeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS;
      if (now - e.waitStartedAt > timeout) {
        results.push(structuredClone(e));
      }
    }
    return results;
  }

  // Test helpers
  clear() { this.data.clear(); }
  count() { return this.data.size; }
}
