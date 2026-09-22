-- lumera:migration-format 1
-- lumera:id 000004
-- lumera:mode transactional
-- lumera:description Add the original public visibility time to job listings
-- lumera:min-postgres 16
-- lumera:max-postgres 16
-- lumera:precondition-sql SELECT to_regclass('public.beauty_job_listings') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'beauty_job_listings' AND column_name = 'first_published_at')
-- lumera:postcondition-sql SELECT count(*) = 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'beauty_job_listings' AND column_name = 'first_published_at' AND udt_schema = 'pg_catalog' AND udt_name = 'timestamptz' AND is_nullable = 'YES' AND column_default IS NULL
-- lumera:recovery Transaction rollback leaves the database unchanged; resolve the failed precondition or postcondition before retrying
-- lumera:end-header

ALTER TABLE public.beauty_job_listings
  ADD COLUMN first_published_at TIMESTAMP WITH TIME ZONE;