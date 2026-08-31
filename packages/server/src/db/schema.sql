CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id),
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  data JSONB NOT NULL
);

CREATE INDEX IF NOT EXISTS projects_user_id_updated_at_idx
  ON projects (user_id, updated_at DESC);

-- Ownership became mandatory when accounts arrived, but rows may already exist
-- from the pre-auth deployment. Those rows are unreachable either way: every
-- project query filters on user_id, and NULL never matches. So the constraint
-- is added only when it is safe, and an install that still holds ownerless rows
-- keeps serving and says so, rather than refusing to boot or deleting data.
--
-- To finish the migration, assign those rows to an account and restart.
DO $$
DECLARE
  orphans BIGINT;
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'projects' AND column_name = 'user_id' AND is_nullable = 'NO'
  ) THEN
    RETURN;
  END IF;

  SELECT COUNT(*) INTO orphans FROM projects WHERE user_id IS NULL;
  IF orphans = 0 THEN
    ALTER TABLE projects ALTER COLUMN user_id SET NOT NULL;
  ELSE
    RAISE WARNING
      'projects.user_id left nullable: % row(s) have no owner. Assign them to a user, then restart to apply the constraint.',
      orphans;
  END IF;
END
$$;
