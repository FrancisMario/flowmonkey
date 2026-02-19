import type { Pool } from 'pg';
import { PgExecutionStore } from './execution-store';
import { PgFlowStore } from './flow-store';
import { PgJobStore } from './job-store';
import { PgEventStore } from './event-store';
import { PgTableRegistry } from './table-registry';
import { PgTableStore } from './table-store';
import { PgWALStore } from './wal-store';

export interface PgStores {
  executions: PgExecutionStore;
  flows: PgFlowStore;
  jobs: PgJobStore;
  events: PgEventStore;
  tableRegistry: PgTableRegistry;
  tableStore: PgTableStore;
  wal: PgWALStore;
}

/**
 * Create all Postgres stores from a single pool.
 * Call flows.init() before using.
 */
export async function createPgStores(pool: Pool): Promise<PgStores> {
  const flows = new PgFlowStore(pool);
  await flows.init();

  return {
    executions: new PgExecutionStore(pool),
    flows,
    jobs: new PgJobStore(pool),
    events: new PgEventStore(pool),
    tableRegistry: new PgTableRegistry(pool),
    tableStore: new PgTableStore(pool),
    wal: new PgWALStore(pool),
  };
}
