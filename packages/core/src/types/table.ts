/**
 * DataStore Types — Tables, Pipes, Rows
 *
 * Tables are dynamic, user-created data stores with typed columns.
 * Pipes are silent taps on step outputs that route data into tables.
 * Rows are the actual data stored in tables.
 *
 * @see DATASTORE_SPEC.md for full design documentation
 */

// ── Column & Table ──────────────────────────────────────────────

/** Supported column types mapped to Postgres native types */
export type ColumnType = 'string' | 'number' | 'boolean' | 'datetime' | 'json';

/** Column definition within a table */
export interface ColumnDef {
  /** UUID identifier */
  readonly id: string;
  /** Display label shown in UI (e.g., "Email", "Amount") */
  readonly name: string;
  /** Data type — validated on pipe hookup and insert */
  readonly type: ColumnType;
  /** Whether a value is required on insert */
  readonly required: boolean;
}

/** Table definition — dynamic, user-created */
export interface TableDef {
  /** UUID identifier */
  readonly id: string;
  /** Column definitions (ordered for display) */
  readonly columns: ColumnDef[];
  /** Creation timestamp (epoch ms) */
  readonly createdAt: number;
  /** Last modification timestamp (epoch ms) */
  readonly updatedAt: number;
}

// ── Pipe ────────────────────────────────────────────────────────

/** Maps one output field to one table column */
export interface PipeFieldMapping {
  /** Path in the step output (dot notation) */
  readonly sourcePath: string;
  /** Target column UUID in the table */
  readonly columnId: string;
}

/** A pipe taps a step's output and inserts into a table */
export interface PipeDef {
  /** UUID */
  readonly id: string;
  /** Which step's output to tap */
  readonly stepId: string;
  /** Which outcome to tap (default: 'success') */
  readonly on?: 'success' | 'failure' | 'any';
  /** Target table UUID */
  readonly tableId: string;
  /** Field-to-column mappings */
  readonly mappings: PipeFieldMapping[];
  /** Static values included in every row (column UUID → value) */
  readonly staticValues?: Record<string, unknown>;
  /** Enable/disable without removing (default: true) */
  readonly enabled?: boolean;
}

// ── Row ─────────────────────────────────────────────────────────

/** Row data: column UUID → value */
export type Row = Record<string, unknown>;

/** Filter operator for querying rows */
export interface RowFilter {
  /** Column UUID */
  column: string;
  /** Comparison operator */
  op: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'like' | 'in';
  /** Value to compare against */
  value: unknown;
}

/** Query parameters for row lookups */
export interface RowQuery {
  tableId: string;
  tenantId?: string;
  filters?: RowFilter[];
  orderBy?: { column: string; direction: 'asc' | 'desc' };
  limit?: number;
  offset?: number;
}

// ── Hookup Validation ───────────────────────────────────────────

/** Result of validating pipe hookups at flow registration */
export interface HookupResult {
  valid: boolean;
  errors: HookupError[];
}

/** Hookup validation error codes */
export type HookupErrorCode =
  | 'TABLE_NOT_FOUND'
  | 'COLUMN_NOT_FOUND'
  | 'TYPE_MISMATCH'
  | 'MISSING_REQUIRED';

/** A single hookup validation error */
export interface HookupError {
  pipeId: string;
  field: string;
  code: HookupErrorCode;
  message: string;
}

// ── WAL Entry ───────────────────────────────────────────────────

/** A failed pipe write awaiting retry */
export interface WALEntry {
  id: string;
  tableId: string;
  tenantId?: string;
  data: Row;
  pipeId: string;
  executionId: string;
  flowId: string;
  stepId: string;
  error: string;
  attempts: number;
  createdAt: number;
}

// ── DDL Operation ───────────────────────────────────────────────

/** DDL operation types for table management */
export type DDLOperationType = 'create-table' | 'drop-table' | 'add-column' | 'remove-column';

/** A DDL operation emitted to the DDL provider */
export interface DDLOperation {
  type: DDLOperationType;
  tableId: string;
  pgTableName: string;
  spec: unknown;
  sql: string;
  timestamp: number;
}
