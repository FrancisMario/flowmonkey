import type { Pool } from 'pg';
import { PgExecutionStore } from './execution-store';
import { PgFlowStore } from './flow-store';
import { PgJobStore } from './job-store';
import { PgEventStore } from './event-store';

export interface PgStores {
  executions: PgExecutionStore;
  flows: PgFlowStore;
  jobs: PgJobStore;
  events: PgEventStore;
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
  };
}
