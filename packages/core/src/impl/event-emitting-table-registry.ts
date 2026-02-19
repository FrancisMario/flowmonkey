/**
 * EventEmittingTableRegistry — decorator that wraps any TableRegistry
 * and emits lifecycle events on table schema changes.
 */

import type { Flow } from '../types/flow';
import type { TableDef, ColumnDef, HookupResult } from '../types/table';
import type { TableRegistry } from '../interfaces/table-store';
import type { EventBus } from '../interfaces/event-bus';

export class EventEmittingTableRegistry implements TableRegistry {
  constructor(
    private readonly inner: TableRegistry,
    private readonly events: EventBus
  ) {}

  async create(table: TableDef): Promise<void> {
    await this.inner.create(table);
    this.events.onTableCreated?.({
      tableId: table.id,
      columnCount: table.columns.length,
      tenantId: (table as any).tenantId,
    });
  }

  async get(id: string): Promise<TableDef | undefined> {
    return this.inner.get(id);
  }

  async list(): Promise<TableDef[]> {
    return this.inner.list();
  }

  async delete(id: string): Promise<boolean> {
    const ok = await this.inner.delete(id);
    if (ok) {
      this.events.onTableDeleted?.({ tableId: id });
    }
    return ok;
  }

  async addColumn(tableId: string, column: ColumnDef): Promise<void> {
    await this.inner.addColumn(tableId, column);
    this.events.onTableColumnAdded?.({
      tableId,
      columnId: column.id,
      columnType: column.type,
    });
  }

  async removeColumn(tableId: string, columnId: string): Promise<void> {
    await this.inner.removeColumn(tableId, columnId);
    this.events.onTableColumnRemoved?.({ tableId, columnId });
  }

  async validatePipes(flow: Flow): Promise<HookupResult> {
    return this.inner.validatePipes(flow);
  }
}
