export const TRIGGER_SCHEMA_VERSION = '0.0.1';

export const triggerSchema = `
-- ============================================
-- FlowMonkey Triggers Schema v${TRIGGER_SCHEMA_VERSION}
-- ============================================

-- Triggers
CREATE TABLE IF NOT EXISTS fm_triggers (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  description     TEXT,
  flow_id         TEXT NOT NULL,
  type            TEXT NOT NULL CHECK (type IN ('http', 'schedule')),
  enabled         BOOLEAN NOT NULL DEFAULT true,
  
  -- HTTP triggers
  input_schema    JSONB,
  context_key     TEXT,
  
  -- Schedule triggers
  schedule        TEXT,
  timezone        TEXT DEFAULT 'UTC',
  static_context  JSONB,
  
  -- Schedule state
  last_run_at     BIGINT,
  next_run_at     BIGINT,
  
  -- Metadata
  created_at      BIGINT NOT NULL,
  updated_at      BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_fm_triggers_flow ON fm_triggers(flow_id);
CREATE INDEX IF NOT EXISTS idx_fm_triggers_type ON fm_triggers(type);
CREATE INDEX IF NOT EXISTS idx_fm_triggers_enabled ON fm_triggers(enabled) WHERE enabled = true;
CREATE INDEX IF NOT EXISTS idx_fm_triggers_next_run ON fm_triggers(next_run_at) 
  WHERE type = 'schedule' AND enabled = true;

-- Trigger History
CREATE TABLE IF NOT EXISTS fm_trigger_history (
  id              BIGSERIAL PRIMARY KEY,
  trigger_id      TEXT NOT NULL,
  execution_id    TEXT,
  
  status          TEXT NOT NULL CHECK (status IN ('success', 'validation_failed', 'flow_not_found', 'error')),
  
  -- Request details (HTTP only)
  request_body    JSONB,
  request_headers JSONB,
  request_ip      TEXT,
  
  -- Validation errors (if any)
  validation_errors JSONB,
  
  -- Error details (if status = 'error')
  error_code      TEXT,
  error_message   TEXT,
  
  -- Timing
  duration_ms     INTEGER,
  timestamp       BIGINT NOT NULL,
  
  CONSTRAINT fk_trigger FOREIGN KEY (trigger_id) 
    REFERENCES fm_triggers(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_fm_trigger_history_trigger ON fm_trigger_history(trigger_id);
CREATE INDEX IF NOT EXISTS idx_fm_trigger_history_status ON fm_trigger_history(status);
CREATE INDEX IF NOT EXISTS idx_fm_trigger_history_ts ON fm_trigger_history(timestamp);
CREATE INDEX IF NOT EXISTS idx_fm_trigger_history_exec ON fm_trigger_history(execution_id) 
  WHERE execution_id IS NOT NULL;
`;

/**
 * Apply trigger schema to database.
 * @param pool - PostgreSQL pool (from 'pg' package)
 */
export async function applyTriggerSchema(pool: { query: (sql: string) => Promise<unknown> }): Promise<void> {
  await pool.query(triggerSchema);
}
