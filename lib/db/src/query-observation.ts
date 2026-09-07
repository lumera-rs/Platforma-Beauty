/**
 * The query-observation header name, kept out of the package index on purpose.
 *
 * `index.ts` throws when DATABASE_URL is unset, which is right for anything
 * that actually talks to PostgreSQL. But the internal-request-control
 * inventory is a *static* check: it enumerates the controls the API exposes
 * and never opens a connection, and it runs in the database-free CI job. Left
 * in the index, this one string constant dragged a connection requirement into
 * that job and failed it.
 *
 * `index.ts` re-exports the constant, so every existing importer is unaffected.
 */
export const databaseQueryObservationHeader = "x-database-query-observation";
