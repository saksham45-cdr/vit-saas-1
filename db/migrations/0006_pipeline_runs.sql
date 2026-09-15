-- Migration: 0006 – admin pipeline run tracking
-- Run in Supabase SQL editor. Idempotent (IF NOT EXISTS throughout).
--
-- Tracks manual ingestion runs initiated from the admin operations panel.
-- Each row is one operator-triggered run. The orchestrator updates it as
-- phases progress; the admin status endpoint reads it for live display.

CREATE TABLE IF NOT EXISTS pipeline_runs (
  id               uuid        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,

  -- Lifecycle
  status           text        NOT NULL DEFAULT 'running',
  -- 'running' | 'completed' | 'partial' | 'quota_halted' | 'failed'
  phase            text        NOT NULL DEFAULT 'enqueue',
  -- 'enqueue' | 'worker' | 'done'

  -- Counters
  requested_count  integer     NOT NULL CHECK (requested_count > 0 AND requested_count <= 10000),
  enqueued_count   integer     NOT NULL DEFAULT 0,
  claimed_count    integer     NOT NULL DEFAULT 0,
  succeeded_count  integer     NOT NULL DEFAULT 0,
  failed_count     integer     NOT NULL DEFAULT 0,

  -- Stop information
  halted_by        text,        -- provider alias when quota-halted, e.g. 'dataforseo'
  error_message    text,        -- operator-visible reason for non-success stop

  -- Phase 1 pagination state
  cursor           text,        -- null = not yet started or already exhausted

  -- Timestamps
  started_at       timestamptz  NOT NULL DEFAULT now(),
  last_activity_at timestamptz  NOT NULL DEFAULT now(),
  finished_at      timestamptz
);

-- Fast lookup: "is there an active run right now?"
CREATE INDEX IF NOT EXISTS idx_pipeline_runs_active
  ON pipeline_runs (status, last_activity_at DESC);

-- Fast lookup: most recent run for status display
CREATE INDEX IF NOT EXISTS idx_pipeline_runs_started
  ON pipeline_runs (started_at DESC);
