/**
 * SharedPoolProvider — returns the same pool for all tenants.
 *
 * In shared mode, all tenants share one Postgres database.
 * Tenant isolation uses a `_tenant_id` column on each table.
 */

import type { PoolLike, PoolProvider } from '../interfaces/pool-provider';

/**
 * Wraps a single PoolLike instance for shared-mode multi-tenancy.
 */
export class SharedPoolProvider implements PoolProvider {
  constructor(private readonly pool: PoolLike) {}

  async acquire(_tenantId?: string): Promise<PoolLike> {
    return this.pool;
  }

  async release(_tenantId?: string): Promise<void> {
    // No-op for shared mode — pool lifecycle managed externally
  }
}
