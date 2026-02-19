/**
 * In-memory TableRegistry — for testing and single-instance use.
 */

import type { Flow } from '../types/flow';
import type { TableDef, ColumnDef, HookupResult, HookupError } from '../types/table';
import type { TableRegistry } from '../interfaces/table-store';
import { now } from '../utils';

/**
 * In-memory table registry. Stores table definitions in a Map.
 * No DDL operations — tables are purely metadata.
 */
export class MemoryTableRegistry implements TableRegistry {
  private tables = new Map<string, TableDef>();

  async create(table: TableDef): Promise<void> {
    this.tables.set(table.id, structuredClone(table));
  }

  async get(id: string): Promise<TableDef | undefined> {
    const t = this.tables.get(id);
    return t ? structuredClone(t) : undefined;
  }

  async list(): Promise<TableDef[]> {
    return Array.from(this.tables.values()).map(t => structuredClone(t));
  }

  async delete(id: string): Promise<boolean> {
    return this.tables.delete(id);
  }

  async addColumn(tableId: string, column: ColumnDef): Promise<void> {
    const table = this.tables.get(tableId);
    if (!table) throw new Error(`Table "${tableId}" not found`);

    // Clone and mutate
    const updated: TableDef = {
      ...table,
      columns: [...table.columns, column],
      updatedAt: now(),
    };
    this.tables.set(tableId, updated);
  }

  async removeColumn(tableId: string, columnId: string): Promise<void> {
    const table = this.tables.get(tableId);
    if (!table) throw new Error(`Table "${tableId}" not found`);

    const updated: TableDef = {
      ...table,
      columns: table.columns.filter(c => c.id !== columnId),
      updatedAt: now(),
    };
    this.tables.set(tableId, updated);
  }

  async validatePipes(flow: Flow): Promise<HookupResult> {
    const errors: HookupError[] = [];

    if (!flow.pipes?.length) {
      return { valid: true, errors: [] };
    }

    for (const pipe of flow.pipes) {
      const table = this.tables.get(pipe.tableId);

      if (!table) {
        errors.push({
          pipeId: pipe.id,
          field: 'tableId',
          code: 'TABLE_NOT_FOUND',
          message: `Table "${pipe.tableId}" not found`,
        });
        continue;
      }

      const columnMap = new Map(table.columns.map(c => [c.id, c]));
      const mappedColumnIds = new Set<string>();

      // Validate each mapping
      for (const mapping of pipe.mappings) {
        const col = columnMap.get(mapping.columnId);
        if (!col) {
          errors.push({
            pipeId: pipe.id,
            field: mapping.columnId,
            code: 'COLUMN_NOT_FOUND',
            message: `Column "${mapping.columnId}" not found in table "${pipe.tableId}"`,
          });
        } else {
          mappedColumnIds.add(mapping.columnId);
        }
      }

      // Check static values reference valid columns
      if (pipe.staticValues) {
        for (const colId of Object.keys(pipe.staticValues)) {
          const col = columnMap.get(colId);
          if (!col) {
            errors.push({
              pipeId: pipe.id,
              field: colId,
              code: 'COLUMN_NOT_FOUND',
              message: `Static value column "${colId}" not found in table "${pipe.tableId}"`,
            });
          } else {
            mappedColumnIds.add(colId);
          }
        }
      }

      // Check required columns are covered
      for (const col of table.columns) {
        if (col.required && !mappedColumnIds.has(col.id)) {
          errors.push({
            pipeId: pipe.id,
            field: col.id,
            code: 'MISSING_REQUIRED',
            message: `Required column "${col.name}" (${col.id}) not mapped in pipe`,
          });
        }
      }
    }

    return { valid: errors.length === 0, errors };
  }

  /** Clear all tables (for testing) */
  clear(): void {
    this.tables.clear();
  }
}
