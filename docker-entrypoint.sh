#!/bin/sh
set -eu

# Hugging Face Spaces routes to 7860; Fly/Render/Railway inject PORT.
if [ -n "${SPACE_ID:-}" ]; then
  PORT="${PORT:-7860}"
else
  PORT="${PORT:-8080}"
fi
export PORT
export HOSTNAME="${HOSTNAME:-0.0.0.0}"
export HRDF_DB="${HRDF_DB:-/data/hrdf.sqlite}"
export HRDF_ZIP="${HRDF_ZIP:-/data/hrdf.zip}"

data_dir="$(dirname "$HRDF_DB")"
if ! mkdir -p "$data_dir" 2>/dev/null || ! touch "$data_dir/.writable" 2>/dev/null; then
  echo "Cannot write $data_dir; using /tmp for the HRDF database."
  export HRDF_DB="/tmp/hrdf.sqlite"
  export HRDF_ZIP="/tmp/hrdf.zip"
  data_dir="/tmp"
  mkdir -p "$data_dir"
fi
rm -f "$data_dir/.writable"

if [ ! -f "$HRDF_DB" ]; then
  echo "No SQLite database at $HRDF_DB — fetching 2027 HRDF and building (~3 min, ~3.3 GB)…"
  npm run data:fetch
  npm run data:build
  rm -f "$HRDF_ZIP"
  echo "Database ready at $HRDF_DB"
fi

exec npx next start -H "$HOSTNAME" -p "$PORT"
