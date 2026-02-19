/**
 * TableRegistry — manages table definitions (schema).
 * TableStore — CRUD operations on table rows.
 *
 * These are the primary interfaces for the DataStore system.
 * Memory implementations live in core/impl, Postgres in packages/postgres.
 */

import type { Flow } from '../types/flow';
import type { TableDef, ColumnDef, Row, RowQuery, HookupResult } from '../types/table';

// ── Table Registry ──────────────────────────────────────────────

/**
 * Registry for table definitions.
 * Manages table creation, schema evolution, and pipe validation.
 */
export interface TableRegistry {
  /** Create a new table — may trigger DDL (CREATE TABLE) */
  create(table: TableDef): Promise<void>;

  /** Get table definition by ID */
  get(id: string): Promise<TableDef | undefined>;

  /** List all table definitions */
  list(): Promise<TableDef[]>;

  /** Delete a table and all its data — may trigger DDL (DROP TABLE) */
  delete(id: string): Promise<boolean>;

  /** Add a column to an existing table */
  addColumn(tableId: string, column: ColumnDef): Promise<void>;

  /** Remove a column (soft delete: column hidden, data preserved) */
  removeColumn(tableId: string, columnId: string): Promise<void>;

  /** Validate all pipes in a flow against registered tables */
  validatePipes(flow: Flow): Promise<HookupResult>;
}

// ── Table Store ─────────────────────────────────────────────────

/**
 * Storage for table rows.
 * Handles CRUD operations with type validation.
 */
export interface TableStore {
  /** Insert a row — returns generated row ID */
  insert(tableId: string, row: Row, tenantId?: string): Promise<string>;

  /** Insert multiple rows — returns generated row IDs */
  insertBatch(tableId: string, rows: Row[], tenantId?: string): Promise<string[]>;

  /** Get a row by ID */
  get(tableId: string, rowId: string, tenantId?: string): Promise<Row | null>;

  /** Query rows with filters */
  query(query: RowQuery): Promise<{ rows: Row[]; total: number }>;

  /** Update a row by ID */
  update(tableId: string, rowId: string, changes: Partial<Row>, tenantId?: string): Promise<boolean>;

  /** Delete a row by ID */
  delete(tableId: string, rowId: string, tenantId?: string): Promise<boolean>;

  /** Count rows matching query */
  count(query: Omit<RowQuery, 'limit' | 'offset' | 'orderBy'>): Promise<number>;
}
