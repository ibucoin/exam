#!/bin/sh
set -eu

database_path="${DATABASE_PATH:-/data/questions.sqlite3}"
seed_path="${SEED_DATABASE_PATH:-/app/questions.seed.sqlite3}"
database_dir=$(dirname "$database_path")

mkdir -p "$database_dir"

if [ ! -f "$database_path" ]; then
  cp "$seed_path" "$database_path"
fi

exec "$@"
