#!/bin/bash
set -euo pipefail

pnpm install --frozen-lockfile
# Development schema preparation first performs a read-only, fail-closed
# eligibility check and then applies only the immutable migration frontier.
# It refuses an existing schema without a valid ledger and never adopts a
# baseline automatically. Do not put drizzle-kit push before this boundary:
# an unknown target must remain unchanged.
pnpm --filter @workspace/scripts run ensure:development-schema
pnpm run test:backend-standards:database
