import type { Pool } from 'pg';

export const SCHEMA_VERSION = '0.0.1';

export const schema = `
-- ============================================
-- FlowMonkey Postgres Schema v${SCHEMA_VERSION}
-- ============================================

-- Executions
CREATE TABLE IF NOT EXISTS fm_executions (
  id              TEXT PRIMARY KEY,
  flow_id         TEXT NOT NULL,
  flow_version    TEXT NOT NULL,
  current_step    TEXT NOT NULL,
  status          TEXT NOT NULL CHECK (status IN ('pending', 'running', 'waiting', 'completed', 'failed')),
  context         JSONB NOT NULL DEFAULT '{}',
  wake_at         BIGINT,
  wait_reason     TEXT,
  error           JSONB,
  step_count      INTEGER NOT NULL DEFAULT 0,
  history         JSONB,
  tenant_id       TEXT,
  metadata        JSONB,
  created_at      BIGINT NOT NULL,
  updated_at      BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_fm_exec_status ON fm_executions(status);
CREATE INDEX IF NOT EXISTS idx_fm_exec_wake ON fm_executions(wake_at) WHERE status = 'waiting';
CREATE INDEX IF NOT EXISTS idx_fm_exec_tenant ON fm_executions(tenant_id) WHERE tenant_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_fm_exec_flow ON fm_executions(flow_id);
CREATE INDEX IF NOT EXISTS idx_fm_exec_updated ON fm_executions(updated_at);

-- Flows
CREATE TABLE IF NOT EXISTS fm_flows (
  id              TEXT NOT NULL,
  version         TEXT NOT NULL,
  name            TEXT,
  definition      JSONB NOT NULL,
  created_at      BIGINT NOT NULL,
  PRIMARY KEY (id, version)
);

CREATE INDEX IF NOT EXISTS idx_fm_flows_id ON fm_flows(id);

-- Jobs (stateful handlers)
CREATE TABLE IF NOT EXISTS fm_jobs (
  id              TEXT PRIMARY KEY,
  execution_id    TEXT NOT NULL,
  step_id         TEXT NOT NULL,
  handler         TEXT NOT NULL,
  status          TEXT NOT NULL CHECK (status IN ('pending', 'running', 'completed', 'failed')),
  input           JSONB NOT NULL,
  result          JSONB,
  error           JSONB,
  runner_id       TEXT,
  heartbeat_at    BIGINT,
  heartbeat_ms    INTEGER NOT NULL DEFAULT 30000,
  attempts        INTEGER NOT NULL DEFAULT 0,
  max_attempts    INTEGER NOT NULL DEFAULT 3,
  created_at      BIGINT NOT NULL,
  updated_at      BIGINT NOT NULL,
  
  CONSTRAINT fk_job_execution FOREIGN KEY (execution_id) 
    REFERENCES fm_executions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_fm_jobs_exec ON fm_jobs(execution_id);
CREATE INDEX IF NOT EXISTS idx_fm_jobs_status ON fm_jobs(status);
CREATE INDEX IF NOT EXISTS idx_fm_jobs_stalled ON fm_jobs(heartbeat_at) WHERE status = 'running';
CREATE INDEX IF NOT EXISTS idx_fm_jobs_step ON fm_jobs(execution_id, step_id);

-- Events (audit log / observability)
CREATE TABLE IF NOT EXISTS fm_events (
  id              BIGSERIAL PRIMARY KEY,
  execution_id    TEXT NOT NULL,
  type            TEXT NOT NULL,
  step_id         TEXT,
  payload         JSONB NOT NULL DEFAULT '{}',
  timestamp       BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_fm_events_exec ON fm_events(execution_id);
CREATE INDEX IF NOT EXISTS idx_fm_events_type ON fm_events(type);
CREATE INDEX IF NOT EXISTS idx_fm_events_ts ON fm_events(timestamp);

-- Locks (advisory locks alternative - optional)
CREATE TABLE IF NOT EXISTS fm_locks (
  key             TEXT PRIMARY KEY,
  owner           TEXT NOT NULL,
  expires_at      BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_fm_locks_expires ON fm_locks(expires_at);
`;

/**
 * Apply schema to database.
 */
export async function applySchema(pool: Pool): Promise<void> {
  await pool.query(schema);
}
