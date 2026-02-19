/**
 * PoolProvider — abstracts database pool resolution.
 *
 * In shared mode (SharedPoolProvider), returns the same pool for all tenants.
 * In per-tenant mode (TenantPoolProvider), returns a tenant-specific pool.
 *
 * The rest of the system (TableRegistry, TableStore) uses PoolProvider
 * and doesn't know which mode is active.
 */

/**
 * Minimal Postgres pool interface (avoids hard dependency on 'pg').
 */
export interface PoolLike {
  query<R = any>(text: string, values?: any[]): Promise<{ rows: R[]; rowCount: number | null }>;
}

/**
 * Resolves a database pool for table operations.
 */
export interface PoolProvider {
  /** Get a pool for table operations. Shared mode ignores tenantId. */
  acquire(tenantId?: string): Promise<PoolLike>;

  /** Release pool resources (no-op for shared mode) */
  release(tenantId?: string): Promise<void>;
}
