/**
 * In-memory WriteAheadLog — for testing.
 * Entries lost on process restart.
 */

import type { WALEntry } from '../types/table';
import type { WriteAheadLog } from '../interfaces/write-ahead-log';

export class MemoryWAL implements WriteAheadLog {
  private entries = new Map<string, WALEntry & { acked: boolean }>();

  async append(entry: WALEntry): Promise<void> {
    this.entries.set(entry.id, { ...structuredClone(entry), acked: false });
  }

  async readPending(limit = 100): Promise<WALEntry[]> {
    const pending: WALEntry[] = [];
    for (const entry of this.entries.values()) {
      if (!entry.acked) {
        const { acked, ...walEntry } = entry;
        pending.push(structuredClone(walEntry));
        if (pending.length >= limit) break;
      }
    }
    return pending;
  }

  async ack(id: string): Promise<void> {
    const entry = this.entries.get(id);
    if (entry) entry.acked = true;
  }

  async compact(): Promise<void> {
    for (const [id, entry] of this.entries) {
      if (entry.acked) this.entries.delete(id);
    }
  }

  /** Clear all entries (for testing) */
  clear(): void {
    this.entries.clear();
  }

  /** Count pending entries (for testing/assertions) */
  pendingCount(): number {
    let count = 0;
    for (const entry of this.entries.values()) {
      if (!entry.acked) count++;
    }
    return count;
  }
}
