#!/usr/bin/env bash
# Every process the appliance runs, on your machine, against the compose Postgres and Redis.
#
#   pnpm infra:up      # once: postgres + redis
#   pnpm dev:all
#
# `pnpm dev` starts only the API and the web app, which is enough for uploading and browsing but
# leaves a document stuck at "queued" — the worker is what does the OCR. This starts the four
# background processes too, and stops them all together on Ctrl-C.
#
# The API and web reload on a change; the background four do not — they run the built output, and
# the API's own watcher rebuilds it underneath them. Restart this after changing worker, suggester,
# mailfetch or backup code.
set -euo pipefail
# Job control, so each background job becomes its own process group: killing the group takes the
# whole tree with it. Without it the trap killed only the wrapper subshells and left six node
# processes holding :3000 and :4000 after Ctrl-C.
set -m
cd "$(dirname "$0")/.."
ROOT=$(pwd)
[ -f .env ] || { echo "no .env — copy .env.example first" >&2; exit 1; }

# One build, not five: `nest build` empties dist, so concurrent builds delete each other's output.
echo "building once…"
pnpm --filter @harbor/api... build > /dev/null

pids=()
stop() {
  trap - INT TERM EXIT
  echo
  echo "stopping…"
  for pid in "${pids[@]}"; do kill -TERM -- "-$pid" 2>/dev/null || kill -TERM "$pid" 2>/dev/null || true; done
  # Give them a moment to go quietly, then insist.
  sleep 2
  for pid in "${pids[@]}"; do kill -KILL -- "-$pid" 2>/dev/null || true; done
  wait 2>/dev/null || true
}
trap stop INT TERM EXIT

# awk with fflush, not sed: sed buffers by block when its output is not a terminal, so the quiet
# processes' logs sat unseen in the pipe while turbo's chatter flowed through.
start() {
  local name=$1; shift
  ( "$@" 2>&1 | awk -v tag="[$name]" '{ print tag, $0; fflush() }' ) &
  pids+=($!)
}

start worker    node --env-file="$ROOT/.env" "$ROOT/apps/api/dist/worker.js"
start suggester node --env-file="$ROOT/.env" "$ROOT/apps/api/dist/suggester.js"
start mailfetch node --env-file="$ROOT/.env" "$ROOT/apps/api/dist/mailfetch.js"
start backup    node --env-file="$ROOT/.env" "$ROOT/apps/api/dist/backup.js"
# Last, in the foreground's place: turbo prints the api and web urls.
start app       pnpm dev

echo "api :4000 · web :3000 · worker, suggester, mailfetch, backup attached — Ctrl-C stops all of them"
wait
