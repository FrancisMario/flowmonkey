/**
 * DDLProvider — drop point for schema operations.
 *
 * DirectDDLProvider runs SQL immediately (default).
 * FileDDLProvider / WebhookDDLProvider emit to IaC systems (future).
 */

import type { DDLOperation } from '../types/table';

/**
 * Provider for DDL (schema change) operations.
 */
export interface DDLProvider {
  /** Emit a DDL operation. Returns when acknowledged. */
  emit(op: DDLOperation): Promise<void>;
}
