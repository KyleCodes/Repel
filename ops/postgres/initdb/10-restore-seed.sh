#!/usr/bin/env bash
set -euo pipefail

# Postgres init hook (REP-69). The postgres image runs everything in
# /docker-entrypoint-initdb.d/ exactly once, when the data directory is empty —
# i.e. the first time a worktree's stack boots. On resume (existing data/pg) the
# whole init phase is skipped, so this never re-runs and never clobbers data.
#
# It restores the persisted worktree seed (./data/seed.dump, mounted read-only at
# /seed/seed.dump) into the freshly-created database. A worktree with no seed
# (missing or zero-byte file) starts with an empty schema — migrations bring it up.
#
# Runs inside the container, so pg_restore is always available regardless of the
# host toolchain.

SEED=/seed/seed.dump

if [ -s "$SEED" ]; then
  echo "init: restoring seed from $SEED into ${POSTGRES_DB}"
  pg_restore --clean --if-exists --no-owner --no-privileges \
    -U "$POSTGRES_USER" -d "$POSTGRES_DB" "$SEED"
  echo "init: seed restore complete"
else
  echo "init: no seed at $SEED (or empty) — starting with an empty database"
fi
