-- credentials_converge
-- Converges provider_credentials on the payload shape every reader already
-- prefers, without dropping anything: the legacy api_key_encrypted,
-- api_key_fingerprint and adapter columns stop being written by the API in the
-- same release and are retired by a later migration once no deployed code reads
-- them.
--
-- A credential is a provider account (provider_id + schema_id + payload). The
-- plugin a credential was created from survives only as a display hint in
-- configured_fields.pluginId/pluginVersion; binding is decided by the plugin
-- manifest's declared credential contract.

-- 1. Every secret lives in payload_encrypted. Rows from before the payload
--    column carried only the single-key column; 0013 copied most of them, this
--    catches any written since by code that set the legacy column alone.
UPDATE provider_credentials
SET payload_encrypted = api_key_encrypted
WHERE (payload_encrypted IS NULL OR payload_encrypted = '')
  AND api_key_encrypted IS NOT NULL AND api_key_encrypted <> '';

-- 2. Provider account and schema are always known. Seedream's Ark account lives
--    under 'volcengine', shared with Seedance (same mapping as 0013).
UPDATE provider_credentials
SET provider_id = CASE adapter::text WHEN 'seedream' THEN 'volcengine' ELSE adapter::text END
WHERE provider_id IS NULL AND adapter IS NOT NULL;

UPDATE provider_credentials SET schema_id = 'legacy-api-key-v1' WHERE schema_id IS NULL;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM provider_credentials WHERE provider_id IS NULL) THEN
    RAISE EXCEPTION 'provider_credentials has rows with neither provider_id nor adapter; assign a provider_id before migrating';
  END IF;
END $$;

ALTER TABLE provider_credentials ALTER COLUMN provider_id SET NOT NULL;
ALTER TABLE provider_credentials ALTER COLUMN schema_id SET NOT NULL;

-- 3. configured_fields holds display metadata and the template hint only. The
--    fingerprint moves in from its legacy column; the endpoint already has a
--    column of its own and legacyFormat described a storage shape now gone.
UPDATE provider_credentials
SET configured_fields = configured_fields || jsonb_build_object('apiKeyFingerprint', api_key_fingerprint)
WHERE api_key_fingerprint IS NOT NULL AND NOT (configured_fields ? 'apiKeyFingerprint');

UPDATE provider_credentials
SET configured_fields = configured_fields - 'baseUrl' - 'legacyFormat'
WHERE configured_fields ?| ARRAY['baseUrl', 'legacyFormat'];
