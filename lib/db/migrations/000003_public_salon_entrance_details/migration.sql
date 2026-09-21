-- lumera:migration-format 1
-- lumera:id 000003
-- lumera:mode transactional
-- lumera:description Add optional public salon entrance details
-- lumera:min-postgres 16
-- lumera:max-postgres 16
-- lumera:precondition-sql SELECT to_regclass('public.salons') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'salons' AND column_name IN ('entrance_directions', 'intercom', 'floor', 'apartment'))
-- lumera:postcondition-sql SELECT count(*) = 4 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'salons' AND column_name IN ('entrance_directions', 'intercom', 'floor', 'apartment') AND udt_schema = 'pg_catalog' AND udt_name = 'text' AND is_nullable = 'YES' AND column_default IS NULL
-- lumera:recovery Transaction rollback leaves the database unchanged; resolve the failed precondition or postcondition before retrying
-- lumera:end-header

ALTER TABLE public.salons
  ADD COLUMN entrance_directions TEXT,
  ADD COLUMN intercom TEXT,
  ADD COLUMN floor TEXT,
  ADD COLUMN apartment TEXT;