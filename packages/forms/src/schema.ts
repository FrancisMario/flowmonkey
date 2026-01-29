/**
 * @flowmonkey/forms - Database Schema
 *
 * PostgreSQL schema for form definitions, submissions, rate limiting, and deduplication.
 */

export const FORM_SCHEMA_VERSION = '1.0.0';

export const formSchema = `
-- ============================================
-- FlowMonkey Forms Schema v${FORM_SCHEMA_VERSION}
-- ============================================

-- Form Definitions
CREATE TABLE IF NOT EXISTS fm_forms (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  description     TEXT,
  tenant_id       TEXT,
  flow_id         TEXT NOT NULL,
  context_key     TEXT NOT NULL,
  
  -- Form configuration
  fields          JSONB NOT NULL,
  security        JSONB,
  enabled         BOOLEAN NOT NULL DEFAULT true,
  
  -- UI settings
  success_redirect TEXT,
  success_message  TEXT,
  css_class        TEXT,
  submit_label     TEXT,
  
  -- Metadata
  created_at      BIGINT NOT NULL,
  updated_at      BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_fm_forms_tenant ON fm_forms(tenant_id) WHERE tenant_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_fm_forms_flow ON fm_forms(flow_id);
CREATE INDEX IF NOT EXISTS idx_fm_forms_enabled ON fm_forms(enabled) WHERE enabled = true;

-- Form Submissions
CREATE TABLE IF NOT EXISTS fm_form_submissions (
  id              TEXT PRIMARY KEY,
  form_id         TEXT NOT NULL,
  tenant_id       TEXT,
  execution_id    TEXT,
  
  status          TEXT NOT NULL CHECK (status IN (
    'pending', 'validated', 'processing', 'completed', 'failed',
    'duplicate', 'rate_limited', 'captcha_failed', 'validation_failed'
  )),
  
  -- Submitted data
  data            JSONB NOT NULL,
  validation_errors JSONB,
  
  -- Client metadata
  meta            JSONB NOT NULL,
  
  -- Timing
  duration_ms     INTEGER,
  submitted_at    BIGINT NOT NULL,
  completed_at    BIGINT,
  
  CONSTRAINT fk_form FOREIGN KEY (form_id) 
    REFERENCES fm_forms(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_fm_submissions_form ON fm_form_submissions(form_id);
CREATE INDEX IF NOT EXISTS idx_fm_submissions_tenant ON fm_form_submissions(tenant_id) WHERE tenant_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_fm_submissions_status ON fm_form_submissions(status);
CREATE INDEX IF NOT EXISTS idx_fm_submissions_exec ON fm_form_submissions(execution_id) WHERE execution_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_fm_submissions_time ON fm_form_submissions(submitted_at);

-- Rate Limiting
CREATE TABLE IF NOT EXISTS fm_form_rate_limits (
  key             TEXT PRIMARY KEY,
  count           INTEGER NOT NULL DEFAULT 0,
  window_start    BIGINT NOT NULL,
  window_end      BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_fm_rate_limits_window ON fm_form_rate_limits(window_end);

-- Submission Deduplication (hash-based)
CREATE TABLE IF NOT EXISTS fm_form_dedup (
  form_id         TEXT NOT NULL,
  hash            TEXT NOT NULL,
  submission_id   TEXT NOT NULL,
  created_at      BIGINT NOT NULL,
  
  PRIMARY KEY (form_id, hash),
  CONSTRAINT fk_dedup_form FOREIGN KEY (form_id) 
    REFERENCES fm_forms(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_fm_dedup_created ON fm_form_dedup(created_at);

-- Cleanup function for expired rate limits and dedup entries
CREATE OR REPLACE FUNCTION fm_cleanup_form_data(older_than_seconds INTEGER DEFAULT 86400)
RETURNS void AS $$
BEGIN
  -- Clean expired rate limits
  DELETE FROM fm_form_rate_limits 
  WHERE window_end < (EXTRACT(EPOCH FROM NOW()) * 1000 - older_than_seconds * 1000);
  
  -- Clean expired dedup entries
  DELETE FROM fm_form_dedup 
  WHERE created_at < (EXTRACT(EPOCH FROM NOW()) * 1000 - older_than_seconds * 1000);
END;
$$ LANGUAGE plpgsql;
`;

/**
 * Apply form schema to database.
 * @param pool - PostgreSQL pool (from 'pg' package)
 */
export async function applyFormSchema(pool: { query: (sql: string) => Promise<unknown> }): Promise<void> {
  await pool.query(formSchema);
}

/**
 * Clean up expired rate limits and deduplication entries.
 * @param pool - PostgreSQL pool
 * @param olderThanSeconds - Clean entries older than this (default: 24 hours)
 */
export async function cleanupFormData(
  pool: { query: (sql: string, params?: unknown[]) => Promise<unknown> },
  olderThanSeconds = 86400
): Promise<void> {
  await pool.query('SELECT fm_cleanup_form_data($1)', [olderThanSeconds]);
}
