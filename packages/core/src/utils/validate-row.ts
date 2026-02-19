/**
 * Row validation utility — type enforcement on insert.
 *
 * Validates that a row conforms to the table's column definitions.
 * Called by TableStore implementations before writing.
 */

import type { TableDef, Row, ColumnType } from '../types/table';

/**
 * Validate a row against a table definition.
 * Throws on type mismatch or missing required fields.
 */
export function validateRow(table: TableDef, row: Row): void {
  for (const col of table.columns) {
    const value = row[col.id];

    if (value === undefined || value === null) {
      if (col.required) {
        throw new Error(`Column "${col.name}" (${col.id}) is required`);
      }
      continue;
    }

    validateColumnType(col.name, col.id, col.type, value);
  }
}

/**
 * Validate a single value against its expected column type.
 */
function validateColumnType(name: string, id: string, type: ColumnType, value: unknown): void {
  switch (type) {
    case 'string':
      if (typeof value !== 'string')
        throw new TypeError(`${name} (${id}): expected string, got ${typeof value}`);
      break;

    case 'number':
      if (typeof value !== 'number')
        throw new TypeError(`${name} (${id}): expected number, got ${typeof value}`);
      break;

    case 'boolean':
      if (typeof value !== 'boolean')
        throw new TypeError(`${name} (${id}): expected boolean, got ${typeof value}`);
      break;

    case 'datetime':
      if (typeof value !== 'number')
        throw new TypeError(`${name} (${id}): expected epoch ms (number), got ${typeof value}`);
      break;

    case 'json':
      // Any JSON-serializable value is valid
      break;
  }
}
