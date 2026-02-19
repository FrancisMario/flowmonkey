/**
 * PgTableRegistry — Postgres-backed table definitions.
 *
 * Stores table definitions (schema metadata) in fm_table_defs.
 * Column definitions are stored as JSONB within the table row.
 *
 * DDL operations (CREATE TABLE, ALTER TABLE) are NOT executed here —
 * that responsibility belongs to a separate DDL provider so that
 * the registry can be used in environments without DDL permissions.
 */

import type { Pool } from 'pg';
import type { Flow } from '@flowmonkey/core';
import type {
  TableDef,
  ColumnDef,
  HookupResult,
  HookupError,
} from '@flowmonkey/core';
import type { TableRegistry } from '@flowmonkey/core';

export class PgTableRegistry implements TableRegistry {
  constructor(private pool: Pool) {}

  async create(table: TableDef): Promise<void> {
    await this.pool.query(
      `INSERT INTO fm_table_defs (id, columns, created_at, updated_at)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (id) DO UPDATE SET
         columns = EXCLUDED.columns,
         updated_at = EXCLUDED.updated_at`,
      [
        table.id,
        JSON.stringify(table.columns),
        table.createdAt,
        table.updatedAt,
      ]
    );
  }

  async get(id: string): Promise<TableDef | undefined> {
    const { rows } = await this.pool.query(
      `SELECT * FROM fm_table_defs WHERE id = $1`,
      [id]
    );
    return rows[0] ? this.toTableDef(rows[0]) : undefined;
  }

  async list(): Promise<TableDef[]> {
    const { rows } = await this.pool.query(
      `SELECT * FROM fm_table_defs ORDER BY created_at ASC`
    );
    return rows.map((r: any) => this.toTableDef(r));
  }

  async delete(id: string): Promise<boolean> {
    const { rowCount } = await this.pool.query(
      `DELETE FROM fm_table_defs WHERE id = $1`,
      [id]
    );
    return (rowCount ?? 0) > 0;
  }

  async addColumn(tableId: string, column: ColumnDef): Promise<void> {
    const now = Date.now();
    // Atomic JSON append
    const { rowCount } = await this.pool.query(
      `UPDATE fm_table_defs
       SET columns = columns || $1::jsonb,
           updated_at = $2
       WHERE id = $3`,
      [JSON.stringify([column]), now, tableId]
    );
    if ((rowCount ?? 0) === 0) {
      throw new Error(`Table "${tableId}" not found`);
    }
  }

  async removeColumn(tableId: string, columnId: string): Promise<void> {
    // Read-modify-write — column array filtering can't be done atomically in JSONB
    const table = await this.get(tableId);
    if (!table) throw new Error(`Table "${tableId}" not found`);

    const updatedColumns = table.columns.filter(c => c.id !== columnId);
    const now = Date.now();

    await this.pool.query(
      `UPDATE fm_table_defs SET columns = $1, updated_at = $2 WHERE id = $3`,
      [JSON.stringify(updatedColumns), now, tableId]
    );
  }

  async validatePipes(flow: Flow): Promise<HookupResult> {
    const errors: HookupError[] = [];

    if (!flow.pipes?.length) {
      return { valid: true, errors: [] };
    }

    // Bulk-fetch all referenced tables
    const tableIds = [...new Set(flow.pipes.map(p => p.tableId))];
    const tableMap = new Map<string, TableDef>();

    if (tableIds.length > 0) {
      const { rows } = await this.pool.query(
        `SELECT * FROM fm_table_defs WHERE id = ANY($1)`,
        [tableIds]
      );
      for (const row of rows) {
        const def = this.toTableDef(row);
        tableMap.set(def.id, def);
      }
    }

    for (const pipe of flow.pipes) {
      const table = tableMap.get(pipe.tableId);

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

  // --- Private ---

  private toTableDef(row: any): TableDef {
    return {
      id: row.id,
      columns: typeof row.columns === 'string' ? JSON.parse(row.columns) : row.columns,
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at),
    };
  }
}
