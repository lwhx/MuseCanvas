-- Persisted owner-scoped canvas scenes. Asset/job/model refs inside JSON are
-- validated by the repository; deleted media can remain as placeholders.
CREATE TABLE IF NOT EXISTS canvas_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by uuid NOT NULL REFERENCES users(id),
  title text NOT NULL,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  scene jsonb NOT NULL DEFAULT '{"nodes":[],"edges":[]}'::jsonb,
  cover_asset_id uuid REFERENCES assets(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE INDEX IF NOT EXISTS canvas_documents_owner_updated_idx
  ON canvas_documents(created_by, updated_at DESC, id DESC)
  WHERE deleted_at IS NULL;
