/**
 * EventEmittingWAL — decorator that wraps any WriteAheadLog
 * and emits lifecycle events on append, ack (replay), and compact.
 */

import type { WALEntry } from '../types/table';
import type { WriteAheadLog } from '../interfaces/write-ahead-log';
import type { EventBus } from '../interfaces/event-bus';

export class EventEmittingWAL implements WriteAheadLog {
  private ackedSinceLastCompact = 0;

  constructor(
    private readonly inner: WriteAheadLog,
    private readonly events: EventBus
  ) {}

  async append(entry: WALEntry): Promise<void> {
    await this.inner.append(entry);
    this.events.onWALAppended?.({
      entryId: entry.id,
      tableId: entry.tableId,
      executionId: entry.executionId,
      pipeId: entry.pipeId,
    });
  }

  async readPending(limit?: number): Promise<WALEntry[]> {
    return this.inner.readPending(limit);
  }

  async ack(id: string): Promise<void> {
    // Read entry before ack to get tableId for the event
    const pending = await this.inner.readPending();
    const entry = pending.find(e => e.id === id);

    await this.inner.ack(id);
    this.ackedSinceLastCompact++;
    this.events.onWALReplayed?.({
      entryId: id,
      tableId: entry?.tableId ?? 'unknown',
    });
  }

  async compact(): Promise<void> {
    const removedCount = this.ackedSinceLastCompact;
    await this.inner.compact();
    this.ackedSinceLastCompact = 0;

    if (removedCount > 0) {
      this.events.onWALCompacted?.({ removedCount });
    }
  }
}
