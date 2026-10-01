-- credential_test_requests
-- Credential connectivity tests run in apps/worker, the only process that may
-- execute plugin code (uploaded plugins included). The API records a request on
-- the credential row and waits briefly for the outcome; workers claim pending
-- requests with FOR UPDATE SKIP LOCKED and settle them.
--
-- last_test_status gains the transient value 'pending' while a request is open.
-- test_requested_at doubles as the request's identity: a worker only settles the
-- request it claimed, so a newer click is never overwritten by an older probe.
-- A claim older than the worker's stale window is re-claimable, so a worker that
-- died mid-probe never wedges a credential in 'pending'.

ALTER TABLE provider_credentials ADD COLUMN IF NOT EXISTS test_requested_at timestamptz;
ALTER TABLE provider_credentials ADD COLUMN IF NOT EXISTS test_requested_by uuid REFERENCES users(id);
ALTER TABLE provider_credentials ADD COLUMN IF NOT EXISTS test_claimed_at timestamptz;

CREATE INDEX IF NOT EXISTS provider_credentials_test_requested_idx
  ON provider_credentials(test_requested_at)
  WHERE test_requested_at IS NOT NULL AND deleted_at IS NULL;
