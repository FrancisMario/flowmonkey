import type { Pool } from 'pg';

export const SCHEMA_VERSION = '0.1.0';

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
  status          TEXT NOT NULL CHECK (status IN ('pending', 'running', 'waiting', 'cancelling', 'cancelled', 'completed', 'failed')),
  context         JSONB NOT NULL DEFAULT '{}',
  wake_at         BIGINT,
  wait_reason     TEXT,
  error           JSONB,
  step_count      INTEGER NOT NULL DEFAULT 0,
  history         JSONB,
  tenant_id       TEXT,
  metadata        JSONB,
  created_at      BIGINT NOT NULL,
  updated_at      BIGINT NOT NULL,
  -- V1 Gap Fixes
  idempotency_key       TEXT,
  idempotency_expires_at BIGINT,
  cancellation          JSONB,
  parent_execution_id   TEXT,
  wait_started_at       BIGINT,
  timeout_config        JSONB
);

CREATE INDEX IF NOT EXISTS idx_fm_exec_status ON fm_executions(status);
CREATE INDEX IF NOT EXISTS idx_fm_exec_wake ON fm_executions(wake_at) WHERE status = 'waiting';
CREATE INDEX IF NOT EXISTS idx_fm_exec_tenant ON fm_executions(tenant_id) WHERE tenant_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_fm_exec_flow ON fm_executions(flow_id);
CREATE INDEX IF NOT EXISTS idx_fm_exec_updated ON fm_executions(updated_at);
-- V1 Gap Fixes indexes
CREATE INDEX IF NOT EXISTS idx_fm_exec_idempotency ON fm_executions(flow_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_fm_exec_parent ON fm_executions(parent_execution_id) WHERE parent_execution_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_fm_exec_wait_started ON fm_executions(wait_started_at) WHERE status = 'waiting';

-- Flows
CREATE TABLE IF NOT EXISTS fm_flows (
  id              TEXT NOT NULL,
  version         TEXT NOT NULL,
  name            TEXT,
  description     TEXT,
  status          TEXT DEFAULT 'published' CHECK (status IN ('draft', 'published', 'archived')),
  tags            JSONB,
  visual          JSONB,
  definition      JSONB NOT NULL,
  created_at      BIGINT NOT NULL,
  PRIMARY KEY (id, version)
);

CREATE INDEX IF NOT EXISTS idx_fm_flows_id ON fm_flows(id);
CREATE INDEX IF NOT EXISTS idx_fm_flows_status ON fm_flows(status);

-- Flow versions (for version pinning)
CREATE TABLE IF NOT EXISTS fm_flow_versions (
  id          TEXT PRIMARY KEY,
  flow_id     TEXT NOT NULL,
  version     TEXT NOT NULL,
  definition  JSONB NOT NULL,
  created_at  BIGINT NOT NULL,
  UNIQUE(flow_id, version)
);

CREATE INDEX IF NOT EXISTS idx_fm_flow_versions_flow ON fm_flow_versions(flow_id);

-- Jobs (stateful handlers)
CREATE TABLE IF NOT EXISTS fm_jobs (
  id              TEXT PRIMARY KEY,
  execution_id    TEXT NOT NULL,
  step_id         TEXT NOT NULL,
  handler         TEXT NOT NULL,
  status          TEXT NOT NULL CHECK (status IN ('pending', 'running', 'completed', 'failed', 'cancelled')),
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
  -- Checkpoint and progress support (v0.2.0)
  instance_id     TEXT,           -- Unique ID for the current execution attempt
  checkpoint      JSONB,          -- Handler checkpoint data
  progress        JSONB,          -- Progress info { percent: number, message?: string }
  
  CONSTRAINT fk_job_execution FOREIGN KEY (execution_id) 
    REFERENCES fm_executions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_fm_jobs_exec ON fm_jobs(execution_id);
CREATE INDEX IF NOT EXISTS idx_fm_jobs_status ON fm_jobs(status);
CREATE INDEX IF NOT EXISTS idx_fm_jobs_stalled ON fm_jobs(heartbeat_at) WHERE status = 'running';
CREATE INDEX IF NOT EXISTS idx_fm_jobs_step ON fm_jobs(execution_id, step_id);
CREATE INDEX IF NOT EXISTS idx_fm_jobs_instance ON fm_jobs(instance_id) WHERE instance_id IS NOT NULL;

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

-- Context storage for large data
CREATE TABLE IF NOT EXISTS fm_context_storage (
  execution_id TEXT NOT NULL,
  key          TEXT NOT NULL,
  data         JSONB NOT NULL,
  size_bytes   INTEGER NOT NULL,
  created_at   BIGINT NOT NULL,
  PRIMARY KEY (execution_id, key),
  CONSTRAINT fk_execution_ctx FOREIGN KEY (execution_id)
    REFERENCES fm_executions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_fm_ctx_storage_exec ON fm_context_storage(execution_id);
CREATE INDEX IF NOT EXISTS idx_fm_ctx_storage_size ON fm_context_storage(size_bytes) WHERE size_bytes > 10000;

-- Resume tokens for waiting handlers
CREATE TABLE IF NOT EXISTS fm_resume_tokens (
  token         TEXT PRIMARY KEY,
  execution_id  TEXT NOT NULL,
  step_id       TEXT NOT NULL,
  status        TEXT NOT NULL CHECK (status IN ('active', 'used', 'expired', 'revoked')),
  created_at    BIGINT NOT NULL,
  expires_at    BIGINT,
  used_at       BIGINT,
  metadata      JSONB,
  consumption_reason TEXT,
  CONSTRAINT fk_execution_token FOREIGN KEY (execution_id)
    REFERENCES fm_executions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_fm_tokens_exec ON fm_resume_tokens(execution_id);
CREATE INDEX IF NOT EXISTS idx_fm_tokens_status ON fm_resume_tokens(status) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_fm_tokens_expires ON fm_resume_tokens(expires_at) WHERE status = 'active' AND expires_at IS NOT NULL;

-- ============================================
-- Cleanup Functions
-- ============================================

-- Cleanup expired idempotency keys
CREATE OR REPLACE FUNCTION fm_cleanup_idempotency_keys()
RETURNS INTEGER AS $$
DECLARE
  affected INTEGER;
BEGIN
  UPDATE fm_executions
  SET idempotency_key = NULL, idempotency_expires_at = NULL
  WHERE idempotency_expires_at IS NOT NULL 
  AND idempotency_expires_at < EXTRACT(EPOCH FROM NOW()) * 1000;
  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected;
END;
$$ LANGUAGE plpgsql;

-- Cleanup expired resume tokens
CREATE OR REPLACE FUNCTION fm_cleanup_expired_tokens()
RETURNS INTEGER AS $$
DECLARE
  affected INTEGER;
BEGIN
  UPDATE fm_resume_tokens
  SET status = 'expired', used_at = EXTRACT(EPOCH FROM NOW()) * 1000, consumption_reason = 'expired'
  WHERE status = 'active' AND expires_at IS NOT NULL AND expires_at < EXTRACT(EPOCH FROM NOW()) * 1000;
  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected;
END;
$$ LANGUAGE plpgsql;
`;

/**
 * Migration script for existing databases (v0.0.1 -> v0.1.0)
 */
export const migrationV010 = `
-- Add new columns to fm_executions
ALTER TABLE fm_executions ADD COLUMN IF NOT EXISTS idempotency_key TEXT;
ALTER TABLE fm_executions ADD COLUMN IF NOT EXISTS idempotency_expires_at BIGINT;
ALTER TABLE fm_executions ADD COLUMN IF NOT EXISTS cancellation JSONB;
ALTER TABLE fm_executions ADD COLUMN IF NOT EXISTS parent_execution_id TEXT;
ALTER TABLE fm_executions ADD COLUMN IF NOT EXISTS wait_started_at BIGINT;
ALTER TABLE fm_executions ADD COLUMN IF NOT EXISTS timeout_config JSONB;

-- Update status constraint to include new statuses
ALTER TABLE fm_executions DROP CONSTRAINT IF EXISTS fm_executions_status_check;
ALTER TABLE fm_executions ADD CONSTRAINT fm_executions_status_check 
  CHECK (status IN ('pending', 'running', 'waiting', 'cancelling', 'cancelled', 'completed', 'failed'));

-- Add new indexes
CREATE INDEX IF NOT EXISTS idx_fm_exec_idempotency ON fm_executions(flow_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_fm_exec_parent ON fm_executions(parent_execution_id) WHERE parent_execution_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_fm_exec_wait_started ON fm_executions(wait_started_at) WHERE status = 'waiting';

-- Add cancelled status to jobs
ALTER TABLE fm_jobs DROP CONSTRAINT IF EXISTS fm_jobs_status_check;
ALTER TABLE fm_jobs ADD CONSTRAINT fm_jobs_status_check 
  CHECK (status IN ('pending', 'running', 'completed', 'failed', 'cancelled'));

-- Add consumption_reason to resume tokens
ALTER TABLE fm_resume_tokens ADD COLUMN IF NOT EXISTS consumption_reason TEXT;

-- Flow versions table
CREATE TABLE IF NOT EXISTS fm_flow_versions (
  id          TEXT PRIMARY KEY,
  flow_id     TEXT NOT NULL,
  version     TEXT NOT NULL,
  definition  JSONB NOT NULL,
  created_at  BIGINT NOT NULL,
  UNIQUE(flow_id, version)
);
CREATE INDEX IF NOT EXISTS idx_fm_flow_versions_flow ON fm_flow_versions(flow_id);

-- Cleanup functions
CREATE OR REPLACE FUNCTION fm_cleanup_idempotency_keys()
RETURNS INTEGER AS $$
DECLARE
  affected INTEGER;
BEGIN
  UPDATE fm_executions
  SET idempotency_key = NULL, idempotency_expires_at = NULL
  WHERE idempotency_expires_at IS NOT NULL 
  AND idempotency_expires_at < EXTRACT(EPOCH FROM NOW()) * 1000;
  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION fm_cleanup_expired_tokens()
RETURNS INTEGER AS $$
DECLARE
  affected INTEGER;
BEGIN
  UPDATE fm_resume_tokens
  SET status = 'expired', used_at = EXTRACT(EPOCH FROM NOW()) * 1000, consumption_reason = 'expired'
  WHERE status = 'active' AND expires_at IS NOT NULL AND expires_at < EXTRACT(EPOCH FROM NOW()) * 1000;
  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected;
END;
$$ LANGUAGE plpgsql;
`;

/**
 * Migration script for v0.2.0 - Add checkpoint and progress support to jobs
 */
export const migrationV020 = `
-- Add checkpoint and progress columns to fm_jobs
ALTER TABLE fm_jobs ADD COLUMN IF NOT EXISTS instance_id TEXT;
ALTER TABLE fm_jobs ADD COLUMN IF NOT EXISTS checkpoint JSONB;
ALTER TABLE fm_jobs ADD COLUMN IF NOT EXISTS progress JSONB;

-- Add index for instance_id
CREATE INDEX IF NOT EXISTS idx_fm_jobs_instance ON fm_jobs(instance_id) WHERE instance_id IS NOT NULL;
`;

/**
 * Migration script for v0.3.0 - Add visual editor support to flows
 */
export const migrationV030 = `
-- Add visual editor columns to fm_flows
ALTER TABLE fm_flows ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE fm_flows ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'published';
ALTER TABLE fm_flows ADD COLUMN IF NOT EXISTS tags JSONB;
ALTER TABLE fm_flows ADD COLUMN IF NOT EXISTS visual JSONB;

-- Add status constraint (do it in two steps to avoid issues)
-- Note: status check constraint should be added manually if needed
CREATE INDEX IF NOT EXISTS idx_fm_flows_status ON fm_flows(status);
`;

/**
 * Apply schema to database.
 */
export async function applySchema(pool: Pool): Promise<void> {
  await pool.query(schema);
}

/**
 * Apply migration for v0.1.0
 */
export async function applyMigrationV010(pool: Pool): Promise<void> {
  await pool.query(migrationV010);
}

/**
 * Apply migration for v0.2.0 (checkpoint/progress support)
 */
export async function applyMigrationV020(pool: Pool): Promise<void> {
  await pool.query(migrationV020);
}

/**
 * Apply migration for v0.3.0 (visual editor support for flows)
 */
export async function applyMigrationV030(pool: Pool): Promise<void> {
  await pool.query(migrationV030);
}
