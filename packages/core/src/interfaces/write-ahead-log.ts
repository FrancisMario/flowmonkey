/**
 * WriteAheadLog — DLQ for failed pipe writes.
 *
 * Lives on local disk (not in the database that just failed).
 * Failed pipe rows are appended here and retried by a background job.
 */

import type { WALEntry } from '../types/table';

/**
 * Write-ahead log for failed pipe writes.
 */
export interface WriteAheadLog {
  /** Append a failed row — single write, minimal failure modes */
  append(entry: WALEntry): Promise<void>;

  /** Read entries ready for retry */
  readPending(limit?: number): Promise<WALEntry[]>;

  /** Mark entry as successfully replayed */
  ack(id: string): Promise<void>;

  /** Compact — remove acked entries, reclaim disk space */
  compact(): Promise<void>;
}
