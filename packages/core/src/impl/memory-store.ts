import type { Execution, ExecutionStatus } from '../types/execution';
import type { StateStore } from '../interfaces/state-store';

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

  // Test helpers
  clear() { this.data.clear(); }
  count() { return this.data.size; }
}
