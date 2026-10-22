-- Operational transaction coordination only. All model facts/results remain on-chain.
CREATE TABLE s0ul_analysis_worker_signers (
  scope TEXT PRIMARY KEY,
  lease_holder TEXT,
  lease_until TIMESTAMPTZ NOT NULL DEFAULT '-infinity',
  fence BIGINT NOT NULL DEFAULT 0,
  pending JSONB,
  spent_wei NUMERIC(78,0) NOT NULL DEFAULT 0 CHECK (spent_wei >= 0)
);
CREATE TABLE s0ul_analysis_worker_jobs (
  scope TEXT NOT NULL,
  job_id NUMERIC(78,0) NOT NULL CHECK (job_id > 0),
  status TEXT NOT NULL DEFAULT 'queued',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (scope, job_id)
);
CREATE INDEX s0ul_analysis_worker_jobs_queue
  ON s0ul_analysis_worker_jobs (scope, status, updated_at);
