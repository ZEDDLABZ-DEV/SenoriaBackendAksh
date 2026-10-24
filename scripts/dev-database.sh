#!/bin/sh
# Starts a project-local PostgreSQL cluster on 127.0.0.1:54329.
# It does not touch any other PostgreSQL data directory.
set -eu

ROOT="$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"
DATA="$ROOT/.local/pgdata"
# The socket path cannot contain spaces. The repository path may.
SOCK="/tmp/senoria-pg-sock"
LOG="$ROOT/.local/pg.log"
PORT=54329

if ! command -v initdb >/dev/null 2>&1; then
  echo "initdb was not found. Install PostgreSQL 16 and ensure its bin directory is on PATH." >&2
  exit 1
fi

PG_BIN="$(dirname "$(command -v initdb)")"
mkdir -p "$SOCK"

if [ ! -d "$DATA/base" ]; then
  echo "Initializing a local database cluster in .local/pgdata"
  initdb -D "$DATA" --username=senoria --auth-local=trust --auth-host=trust --encoding=UTF8 --locale=C >/dev/null
fi

if ! "$PG_BIN/pg_isready" -h 127.0.0.1 -p "$PORT" >/dev/null 2>&1; then
  "$PG_BIN/pg_ctl" -D "$DATA" -l "$LOG" -o "-p $PORT -k $SOCK -c listen_addresses=127.0.0.1" start
fi

"$PG_BIN/psql" -h 127.0.0.1 -p "$PORT" -U senoria -d postgres -v ON_ERROR_STOP=1 <<'SQL'
SELECT 'CREATE DATABASE senoria' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'senoria')\gexec
SELECT 'CREATE DATABASE senoria_test' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'senoria_test')\gexec
SQL

echo "Local databases are ready."
echo "DATABASE_URL=postgresql://senoria@127.0.0.1:${PORT}/senoria"
echo "TEST_DATABASE_URL=postgresql://senoria@127.0.0.1:${PORT}/senoria_test"
