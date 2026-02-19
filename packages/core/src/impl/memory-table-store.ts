/**
 * In-memory TableStore — for testing and single-instance use.
 */

import type { Row, RowQuery, RowFilter } from '../types/table';
import type { TableStore } from '../interfaces/table-store';
import { generateId } from '../utils';

/** Internal row storage includes _id and _tenant_id */
interface StoredRow extends Row {
  _id: string;
  _tenant_id?: string;
}

/**
 * In-memory table store. Stores rows in nested Maps.
 */
export class MemoryTableStore implements TableStore {
  /** tableId → rowId → StoredRow */
  private data = new Map<string, Map<string, StoredRow>>();

  async insert(tableId: string, row: Row, tenantId?: string): Promise<string> {
    const rowId = generateId();
    const stored: StoredRow = { ...row, _id: rowId };
    if (tenantId) stored._tenant_id = tenantId;

    let table = this.data.get(tableId);
    if (!table) {
      table = new Map();
      this.data.set(tableId, table);
    }
    table.set(rowId, stored);
    return rowId;
  }

  async insertBatch(tableId: string, rows: Row[], tenantId?: string): Promise<string[]> {
    const ids: string[] = [];
    for (const row of rows) {
      ids.push(await this.insert(tableId, row, tenantId));
    }
    return ids;
  }

  async get(tableId: string, rowId: string, tenantId?: string): Promise<Row | null> {
    const table = this.data.get(tableId);
    if (!table) return null;
    const row = table.get(rowId);
    if (!row) return null;
    if (tenantId && row._tenant_id !== tenantId) return null;
    return this.stripInternal(row);
  }

  async query(query: RowQuery): Promise<{ rows: Row[]; total: number }> {
    const table = this.data.get(query.tableId);
    if (!table) return { rows: [], total: 0 };

    let rows = Array.from(table.values());

    // Tenant filter
    if (query.tenantId) {
      rows = rows.filter(r => r._tenant_id === query.tenantId);
    }

    // Apply filters
    if (query.filters?.length) {
      rows = rows.filter(r => query.filters!.every(f => this.matchFilter(r, f)));
    }

    const total = rows.length;

    // Sort
    if (query.orderBy) {
      const { column, direction } = query.orderBy;
      rows.sort((a, b) => {
        const va = a[column];
        const vb = b[column];
        if (va == null && vb == null) return 0;
        if (va == null) return direction === 'asc' ? -1 : 1;
        if (vb == null) return direction === 'asc' ? 1 : -1;
        if (va < vb) return direction === 'asc' ? -1 : 1;
        if (va > vb) return direction === 'asc' ? 1 : -1;
        return 0;
      });
    }

    // Pagination
    const offset = query.offset ?? 0;
    const limit = query.limit ?? rows.length;
    rows = rows.slice(offset, offset + limit);

    return { rows: rows.map(r => this.stripInternal(r)), total };
  }

  async update(tableId: string, rowId: string, changes: Partial<Row>, tenantId?: string): Promise<boolean> {
    const table = this.data.get(tableId);
    if (!table) return false;
    const row = table.get(rowId);
    if (!row) return false;
    if (tenantId && row._tenant_id !== tenantId) return false;

    Object.assign(row, changes);
    return true;
  }

  async delete(tableId: string, rowId: string, tenantId?: string): Promise<boolean> {
    const table = this.data.get(tableId);
    if (!table) return false;
    const row = table.get(rowId);
    if (!row) return false;
    if (tenantId && row._tenant_id !== tenantId) return false;
    return table.delete(rowId);
  }

  async count(query: Omit<RowQuery, 'limit' | 'offset' | 'orderBy'>): Promise<number> {
    const result = await this.query({ ...query, limit: undefined, offset: undefined, orderBy: undefined });
    return result.total;
  }

  /** Clear all data (for testing) */
  clear(): void {
    this.data.clear();
  }

  /** Delete all rows for a table (for testing) */
  clearTable(tableId: string): void {
    this.data.delete(tableId);
  }

  // --- Private ---

  private stripInternal(row: StoredRow): Row {
    const { _id, _tenant_id, ...data } = row;
    return { _id, ...data };
  }

  private matchFilter(row: StoredRow, filter: RowFilter): boolean {
    const value = row[filter.column];

    switch (filter.op) {
      case 'eq': return value === filter.value;
      case 'neq': return value !== filter.value;
      case 'gt': return value != null && filter.value != null && value > filter.value;
      case 'gte': return value != null && filter.value != null && value >= filter.value;
      case 'lt': return value != null && filter.value != null && value < filter.value;
      case 'lte': return value != null && filter.value != null && value <= filter.value;
      case 'like': return typeof value === 'string' && typeof filter.value === 'string'
        && value.toLowerCase().includes(filter.value.toLowerCase());
      case 'in': return Array.isArray(filter.value) && filter.value.includes(value);
      default: return false;
    }
  }
}
