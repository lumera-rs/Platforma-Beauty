# Environment inventory

## Repository findings

| Item | Repository finding | Status | Production boundary |
|---|---|---|---|
| Intended hosting | `.replit` declares Replit application routing and `deploymentTarget = "autoscale"` | VERIFIED (repository) | Intended configuration only; deployed topology is UNKNOWN |
| Runtime/toolchain | `.replit` declares Node 24 and PostgreSQL 16 modules | VERIFIED (repository) | Does not prove the production server/database version |
| Publish path | `.replit` declares `pnpm run validate:publish` | VERIFIED (repository) | Does not prove what revision is published |
| Environment distinction | `.replit` has separate development and production user-environment sections; source also checks runtime markers | VERIFIED (repository) | Marker values and live environment were not read |
| Production database | Application requires `DATABASE_URL` and constructs the shared PostgreSQL pool in `lib/db/src/index.ts` | VERIFIED (repository) | URL/value, database identity, owner, region and revision are UNKNOWN |
| Development/staging/production | Development and production are named; test/disposable database variables exist in scripts | DOCUMENTED_ONLY | No independently identified staging target was found; actual separation is UNKNOWN |

Repository configuration is not production identity evidence. A fresh,
non-secret, owner/control-plane attestation must identify target alias,
environment, database/schema identity, deployed revision, window, collector,
retention and digest before access.

## Configuration names

Names were inspected; values were not read.

| Purpose | Names |
|---|---|
| Database/pool | `DATABASE_URL`, `DB_POOL_MAX`, `DB_POOL_MIN`, `DB_IDLE_TIMEOUT_MS`, `DB_CONN_TIMEOUT_MS`, `DB_QUERY_TIMEOUT_MS`, `DB_STMT_TIMEOUT_MS` |
| Runtime identity | `NODE_ENV`, `REPL_DEPLOYMENT`, `REPLIT_DEPLOYMENT`, `REPLIT_ENVIRONMENT`, `PAYMENT_RUNTIME_ENV`, `CI` |
| Service | `PORT`, `APP_BASE_URL`, `SESSION_SECRET`, `LOG_LEVEL`, `SLOW_API_THRESHOLD_MS`, `TZ` |
| Storage/safe mode | `PRIVATE_OBJECT_DIR`, `DEFAULT_OBJECT_STORAGE_BUCKET_ID`, `SAFE_MODE_NO_EXTERNAL_CALLS` |

Secret-bearing names are listed only to identify dependencies. No value,
connection string, credential or secret was opened or copied.

## Database-dependent services

The API server imports the shared DB library. Source also contains automation,
retail subscription, aftercare, product-waitlist, communication archive, web
push and startup-DDL workers/services. This verifies code dependencies only.
Whether any service is deployed, running, duplicated or reachable in production
is `UNKNOWN`.

## Required missing identity evidence

- system-owner attestation of the exact target and environment;
- control-plane evidence of active revision(s), instance count and overlap;
- non-secret DB identity fingerprint tied to the approved window;
- confirmation that test/disposable targets cannot be selected;
- complete dependency inventory for the deployed revision.

Until these are independently supplied, environment identity is `BLOCKED`.