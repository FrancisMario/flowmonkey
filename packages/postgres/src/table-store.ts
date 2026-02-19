/**
 * PgTableStore — Postgres-backed row storage.
 *
 * Stores all table rows in a single fm_table_rows table,
 * partitioned by table_id. Row data stored as JSONB.
 *
 * This is the "shared table" approach — simple, good for moderate scale.
 * For high volume, a DDL provider can create per-table Postgres tables.
 */

import type { Pool } from 'pg';
import type { Row, RowQuery, RowFilter } from '@flowmonkey/core';
import type { TableStore } from '@flowmonkey/core';

export class PgTableStore implements TableStore {
  constructor(private pool: Pool) {}

  async insert(tableId: string, row: Row, tenantId?: string): Promise<string> {
    const rowId = crypto.randomUUID();
    await this.pool.query(
      `INSERT INTO fm_table_rows (id, table_id, tenant_id, data, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $5)`,
      [rowId, tableId, tenantId ?? null, JSON.stringify(row), Date.now()]
    );
    return rowId;
  }

  async insertBatch(tableId: string, rows: Row[], tenantId?: string): Promise<string[]> {
    if (rows.length === 0) return [];

    const ids: string[] = [];
    const now = Date.now();
    const values: any[] = [];
    const placeholders: string[] = [];
    let idx = 1;

    for (const row of rows) {
      const id = crypto.randomUUID();
      ids.push(id);
      placeholders.push(`($${idx}, $${idx + 1}, $${idx + 2}, $${idx + 3}, $${idx + 4}, $${idx + 4})`);
      values.push(id, tableId, tenantId ?? null, JSON.stringify(row), now);
      idx += 5;
    }

    await this.pool.query(
      `INSERT INTO fm_table_rows (id, table_id, tenant_id, data, created_at, updated_at)
       VALUES ${placeholders.join(', ')}`,
      values
    );

    return ids;
  }

  async get(tableId: string, rowId: string, tenantId?: string): Promise<Row | null> {
    const params: any[] = [tableId, rowId];
    let sql = `SELECT * FROM fm_table_rows WHERE table_id = $1 AND id = $2`;

    if (tenantId) {
      sql += ` AND tenant_id = $3`;
      params.push(tenantId);
    }

    const { rows } = await this.pool.query(sql, params);
    if (!rows[0]) return null;

    return this.toRow(rows[0]);
  }

  async query(query: RowQuery): Promise<{ rows: Row[]; total: number }> {
    const params: any[] = [query.tableId];
    let whereClause = `table_id = $1`;
    let paramIdx = 2;

    if (query.tenantId) {
      whereClause += ` AND tenant_id = $${paramIdx}`;
      params.push(query.tenantId);
      paramIdx++;
    }

    // Apply filters on JSONB data
    if (query.filters?.length) {
      for (const filter of query.filters) {
        const { clause, newParams } = this.buildFilter(filter, paramIdx);
        whereClause += ` AND ${clause}`;
        params.push(...newParams);
        paramIdx += newParams.length;
      }
    }

    // Count
    const countResult = await this.pool.query(
      `SELECT count(*)::int AS total FROM fm_table_rows WHERE ${whereClause}`,
      params
    );
    const total = countResult.rows[0]?.total ?? 0;

    // Sort
    let orderClause = 'created_at DESC';
    if (query.orderBy) {
      const dir = query.orderBy.direction === 'asc' ? 'ASC' : 'DESC';
      // Sort by JSONB field
      orderClause = `data->>'${this.sanitizeColumn(query.orderBy.column)}' ${dir}`;
    }

    // Pagination
    let limitClause = '';
    if (query.limit != null) {
      limitClause += ` LIMIT $${paramIdx}`;
      params.push(query.limit);
      paramIdx++;
    }
    if (query.offset != null) {
      limitClause += ` OFFSET $${paramIdx}`;
      params.push(query.offset);
      paramIdx++;
    }

    const { rows } = await this.pool.query(
      `SELECT * FROM fm_table_rows WHERE ${whereClause} ORDER BY ${orderClause}${limitClause}`,
      params
    );

    return { rows: rows.map((r: any) => this.toRow(r)), total };
  }

  async update(tableId: string, rowId: string, changes: Partial<Row>, tenantId?: string): Promise<boolean> {
    const params: any[] = [JSON.stringify(changes), Date.now(), tableId, rowId];
    let sql = `UPDATE fm_table_rows
      SET data = data || $1::jsonb, updated_at = $2
      WHERE table_id = $3 AND id = $4`;

    if (tenantId) {
      sql += ` AND tenant_id = $5`;
      params.push(tenantId);
    }

    const { rowCount } = await this.pool.query(sql, params);
    return (rowCount ?? 0) > 0;
  }

  async delete(tableId: string, rowId: string, tenantId?: string): Promise<boolean> {
    const params: any[] = [tableId, rowId];
    let sql = `DELETE FROM fm_table_rows WHERE table_id = $1 AND id = $2`;

    if (tenantId) {
      sql += ` AND tenant_id = $3`;
      params.push(tenantId);
    }

    const { rowCount } = await this.pool.query(sql, params);
    return (rowCount ?? 0) > 0;
  }

  async count(query: Omit<RowQuery, 'limit' | 'offset' | 'orderBy'>): Promise<number> {
    const result = await this.query({ ...query } as RowQuery);
    return result.total;
  }

  // --- Private ---

  /** Convert DB row to Row (merge _id from DB id, spread JSONB data) */
  private toRow(dbRow: any): Row {
    const data = typeof dbRow.data === 'string' ? JSON.parse(dbRow.data) : dbRow.data;
    return { _id: dbRow.id, ...data };
  }

  /** Build a WHERE clause fragment for a single filter */
  private buildFilter(filter: RowFilter, paramIdx: number): { clause: string; newParams: any[] } {
    const col = this.sanitizeColumn(filter.column);

    switch (filter.op) {
      case 'eq':
        return { clause: `data->>$${paramIdx} = $${paramIdx + 1}`, newParams: [col, String(filter.value)] };
      case 'neq':
        return { clause: `data->>$${paramIdx} != $${paramIdx + 1}`, newParams: [col, String(filter.value)] };
      case 'gt':
        return { clause: `(data->>$${paramIdx})::numeric > $${paramIdx + 1}`, newParams: [col, filter.value] };
      case 'gte':
        return { clause: `(data->>$${paramIdx})::numeric >= $${paramIdx + 1}`, newParams: [col, filter.value] };
      case 'lt':
        return { clause: `(data->>$${paramIdx})::numeric < $${paramIdx + 1}`, newParams: [col, filter.value] };
      case 'lte':
        return { clause: `(data->>$${paramIdx})::numeric <= $${paramIdx + 1}`, newParams: [col, filter.value] };
      case 'like':
        return {
          clause: `data->>$${paramIdx} ILIKE $${paramIdx + 1}`,
          newParams: [col, `%${filter.value}%`],
        };
      case 'in': {
        const arr = Array.isArray(filter.value) ? filter.value : [filter.value];
        return {
          clause: `data->>$${paramIdx} = ANY($${paramIdx + 1})`,
          newParams: [col, arr.map(String)],
        };
      }
      default:
        return { clause: 'TRUE', newParams: [] };
    }
  }

  /** Sanitize column name to prevent injection (belt + suspenders with parameterized queries) */
  private sanitizeColumn(col: string): string {
    return col.replace(/[^a-zA-Z0-9_-]/g, '');
  }
}
