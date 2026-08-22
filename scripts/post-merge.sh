#!/bin/bash
set -euo pipefail

pnpm install --frozen-lockfile
pnpm --filter @workspace/db run push-force
pnpm run test:backend-standards:database
