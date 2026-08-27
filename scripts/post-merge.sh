#!/bin/bash
set -euo pipefail

pnpm install --frozen-lockfile
# The versioned rollout is the project's non-interactive schema reconciliation.
# drizzle-kit push can request destructive TTY confirmation and still exit 0,
# so it is not a trustworthy post-merge gate with stdin closed.
pnpm --filter @workspace/scripts run ensure:development-schema
pnpm run test:backend-standards:database
