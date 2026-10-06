-- M2 storage. Requires 0030_canvas_documents.sql. No external calls belong in a DB transaction.
CREATE TABLE IF NOT EXISTS canvas_agent_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  canvas_id uuid NOT NULL UNIQUE REFERENCES canvas_documents(id),
  created_by uuid NOT NULL REFERENCES users(id),
  require_confirmation boolean NOT NULL DEFAULT true,
  next_seq integer NOT NULL DEFAULT 1 CHECK(next_seq > 0),
  auto_continuation_count integer NOT NULL DEFAULT 0 CHECK(auto_continuation_count >= 0),
  running_turn_id uuid,
  running_lease_token uuid,
  running_lease_expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(id, canvas_id, created_by),
  CHECK ((running_turn_id IS NULL AND running_lease_token IS NULL AND running_lease_expires_at IS NULL)
      OR (running_turn_id IS NOT NULL AND running_lease_token IS NOT NULL AND running_lease_expires_at IS NOT NULL))
);
CREATE TABLE IF NOT EXISTS canvas_agent_turns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES canvas_agent_sessions(id),
  message_id uuid NOT NULL,
  request_digest text NOT NULL CHECK(request_digest ~ '^[0-9a-f]{64}$'),
  status text NOT NULL CHECK(status IN ('running','completed','failed','canceled','expired')),
  lease_token uuid NOT NULL,
  lease_expires_at timestamptz NOT NULL,
  timeout_ms integer NOT NULL CHECK(timeout_ms BETWEEN 1000 AND 300000),
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  error_code text,
  UNIQUE(session_id, message_id),
  UNIQUE(id, session_id),
  CHECK(lease_expires_at <= started_at + timeout_ms * interval '1 millisecond')
);
CREATE TABLE IF NOT EXISTS canvas_agent_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES canvas_agent_sessions(id),
  turn_id uuid,
  seq integer NOT NULL CHECK(seq > 0),
  role text NOT NULL CHECK(role IN ('user','assistant','tool')),
  content text NOT NULL DEFAULT '',
  tool_calls jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(tool_calls) = 'array'),
  content_blocks jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(content_blocks) = 'array'),
  ops jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(ops) = 'array'),
  input_tokens integer CHECK(input_tokens >= 0),
  output_tokens integer CHECK(output_tokens >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(session_id, seq),
  FOREIGN KEY(turn_id, session_id) REFERENCES canvas_agent_turns(id, session_id),
  CHECK((input_tokens IS NULL) = (output_tokens IS NULL))
);
CREATE TABLE IF NOT EXISTS canvas_agent_pending_jobs (
  id uuid PRIMARY KEY,
  session_id uuid NOT NULL,
  canvas_id uuid NOT NULL,
  created_by uuid NOT NULL,
  turn_id uuid NOT NULL,
  tool_call_id text NOT NULL CHECK(length(tool_call_id) BETWEEN 1 AND 512),
  kind text NOT NULL CHECK(kind IN ('image','video')),
  prompt text NOT NULL,
  model_id uuid NOT NULL REFERENCES model_configs(id),
  parameters jsonb NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(parameters) = 'object'),
  source_node_id uuid,
  source_asset_id uuid REFERENCES assets(id),
  base_revision integer NOT NULL CHECK(base_revision > 0),
  model_config_digest text NOT NULL CHECK(model_config_digest ~ '^[0-9a-f]{64}$'),
  node_id uuid NOT NULL UNIQUE,
  edge_id uuid NOT NULL UNIQUE,
  idempotency_key text NOT NULL UNIQUE,
  request_digest text NOT NULL CHECK(request_digest ~ '^[0-9a-f]{64}$'),
  status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','submitting','submitted','rejected','expired')),
  expires_at timestamptz NOT NULL,
  lease_token uuid,
  lease_expires_at timestamptz,
  job_id uuid REFERENCES generation_jobs(id),
  ops jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(ops) = 'array'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(session_id, canvas_id, created_by) REFERENCES canvas_agent_sessions(id, canvas_id, created_by),
  FOREIGN KEY(turn_id, session_id) REFERENCES canvas_agent_turns(id, session_id),
  UNIQUE(canvas_id, tool_call_id),
  CHECK((kind = 'image' AND source_node_id IS NULL AND source_asset_id IS NULL)
     OR (kind = 'video' AND source_node_id IS NOT NULL AND source_asset_id IS NOT NULL)),
  CHECK((status = 'submitted') = (job_id IS NOT NULL)),
  CHECK((status = 'submitting' AND lease_token IS NOT NULL AND lease_expires_at IS NOT NULL)
     OR (status <> 'submitting' AND lease_token IS NULL AND lease_expires_at IS NULL)),
  CHECK(expires_at > created_at),
  CHECK(idempotency_key = 'canvas:' || canvas_id::text || ':' || tool_call_id)
);
CREATE INDEX IF NOT EXISTS canvas_agent_pending_session_idx ON canvas_agent_pending_jobs(session_id, created_at, id);
CREATE TABLE IF NOT EXISTS canvas_agent_terminal_events (
  session_id uuid NOT NULL REFERENCES canvas_agent_sessions(id),
  job_id uuid NOT NULL REFERENCES generation_jobs(id),
  turn_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(session_id, job_id),
  FOREIGN KEY(turn_id, session_id) REFERENCES canvas_agent_turns(id, session_id)
);
CREATE TABLE IF NOT EXISTS canvas_agent_settings (
  singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
  enabled boolean NOT NULL DEFAULT false,
  language_model_config_id uuid REFERENCES model_configs(id),
  max_tool_calls_per_turn integer NOT NULL DEFAULT 12 CHECK(max_tool_calls_per_turn BETWEEN 1 AND 32),
  max_jobs_per_turn integer NOT NULL DEFAULT 4 CHECK(max_jobs_per_turn BETWEEN 1 AND 8),
  timeout_ms integer NOT NULL DEFAULT 120000 CHECK(timeout_ms BETWEEN 1000 AND 300000),
  max_auto_continuations integer NOT NULL DEFAULT 3 CHECK(max_auto_continuations BETWEEN 0 AND 10),
  updated_by uuid REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO canvas_agent_settings(singleton) VALUES(true) ON CONFLICT DO NOTHING;
-- Immutable snapshots remain immutable even if a future caller accidentally uses a broad UPDATE.
CREATE OR REPLACE FUNCTION canvas_agent_guard_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME = 'canvas_agent_turns' THEN
    IF (to_jsonb(NEW) - ARRAY['status','lease_token','lease_expires_at','timeout_ms','started_at','completed_at','error_code'])
       IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['status','lease_token','lease_expires_at','timeout_ms','started_at','completed_at','error_code']) THEN
      RAISE EXCEPTION 'immutable canvas agent turn';
    END IF;
  ELSE
    IF (to_jsonb(NEW) - ARRAY['status','lease_token','lease_expires_at','job_id','ops','updated_at'])
       IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['status','lease_token','lease_expires_at','job_id','ops','updated_at']) THEN
      RAISE EXCEPTION 'immutable canvas agent pending snapshot';
    END IF;
  END IF;
  RETURN NEW;
END $$;
DO $$ BEGIN
  CREATE TRIGGER canvas_agent_turn_immutable BEFORE UPDATE ON canvas_agent_turns
    FOR EACH ROW EXECUTE FUNCTION canvas_agent_guard_immutable();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TRIGGER canvas_agent_pending_immutable BEFORE UPDATE ON canvas_agent_pending_jobs
    FOR EACH ROW EXECUTE FUNCTION canvas_agent_guard_immutable();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
