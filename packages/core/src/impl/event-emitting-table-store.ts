/**
 * EventEmittingTableStore — decorator that wraps any TableStore
 * and emits row-level events (insert, update, delete) on every mutation.
 *
 * Fires regardless of caller: pipes, API routes, handlers, direct calls.
 * This is the integration point for row-based triggers.
 *
 * Usage:
 * ```typescript
 * const raw = new MemoryTableStore();
 * const store = new EventEmittingTableStore(raw, eventBus);
 * // All mutations through `store` now emit onRowInserted/Updated/Deleted
 * ```
 */

import type { Row, RowQuery } from '../types/table';
import type { TableStore } from '../interfaces/table-store';
import type { EventBus } from '../interfaces/event-bus';

export class EventEmittingTableStore implements TableStore {
  constructor(
    private readonly inner: TableStore,
    private readonly events: EventBus
  ) {}

  async insert(tableId: string, row: Row, tenantId?: string): Promise<string> {
    const rowId = await this.inner.insert(tableId, row, tenantId);
    this.events.onRowInserted?.({ tableId, rowId, row, tenantId });
    return rowId;
  }

  async insertBatch(tableId: string, rows: Row[], tenantId?: string): Promise<string[]> {
    const ids = await this.inner.insertBatch(tableId, rows, tenantId);
    for (let i = 0; i < ids.length; i++) {
      this.events.onRowInserted?.({ tableId, rowId: ids[i], row: rows[i], tenantId });
    }
    return ids;
  }

  async get(tableId: string, rowId: string, tenantId?: string): Promise<Row | null> {
    return this.inner.get(tableId, rowId, tenantId);
  }

  async query(query: RowQuery): Promise<{ rows: Row[]; total: number }> {
    return this.inner.query(query);
  }

  async update(tableId: string, rowId: string, changes: Partial<Row>, tenantId?: string): Promise<boolean> {
    const ok = await this.inner.update(tableId, rowId, changes, tenantId);
    if (ok) {
      this.events.onRowUpdated?.({ tableId, rowId, changes, tenantId });
    }
    return ok;
  }

  async delete(tableId: string, rowId: string, tenantId?: string): Promise<boolean> {
    const ok = await this.inner.delete(tableId, rowId, tenantId);
    if (ok) {
      this.events.onRowDeleted?.({ tableId, rowId, tenantId });
    }
    return ok;
  }

  async count(query: Omit<RowQuery, 'limit' | 'offset' | 'orderBy'>): Promise<number> {
    return this.inner.count(query);
  }
}
