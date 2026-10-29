-- Cloudflare Preview *test D1 only*.
-- NEVER run against production. An actual Preview DB must contain this row.
-- Insert the real Preview D1 UUID manually after verifying the dashboard binding.
CREATE TABLE IF NOT EXISTS environment_identity (
 name TEXT PRIMARY KEY,
 value TEXT NOT NULL
);
-- Intentionally NO INSERT: do not stamp a production DB as Preview.
-- Use D1 console after verification:
-- INSERT INTO environment_identity (name,value) VALUES
-- ('database_id','<ACTUAL_DEDICATED_PREVIEW_D1_UUID>');
