#!/usr/bin/env bash
# Write a `harbor` command for THIS checkout, so the appliance CLI can be tried without an appliance.
#
#   scripts/harbor-local.sh        # writes ./harbor
#   ./harbor public enable         # brings up the doorman and its tailnet node
#   ./harbor public status
#   ./harbor public disable
#
# It is the same infra/harbor-cli.sh the installer writes out, pointed at this repo's compose
# project and .env instead of /opt/harbor and /data/harbor.env. That is the point: a subcommand
# tested here is the subcommand the box gets, rather than a local approximation of it.
#
# What this does NOT do is pretend to be the appliance. The dev stack runs Postgres and Redis in
# compose and everything else on the host, so `harbor status` shows two containers, and `upgrade`,
# `backup` and `break-glass` have nothing to talk to. `public` is the reason this exists.
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT=$(pwd)

[ -f .env ] || { echo "no .env — copy .env.example first" >&2; exit 1; }
DATA=$(grep '^HARBOR_DATA_DIR=' .env | cut -d= -f2- || true)
DATA=${DATA:-$ROOT/data}

sed -e "s|@HARBOR_DIR@|$ROOT/infra|g" \
    -e "s|@HARBOR_PROJECT@|harbor|g" \
    -e "s|@ENV_FILE@|$ROOT/.env|g" \
    -e "s|@FILES@|-f compose.yml|g" \
    -e "s|@HARBOR_DATA_DIR@|$DATA|g" \
    -e "s|@RAW@|https://raw.githubusercontent.com/openharborhq/harbor/main|g" \
    infra/harbor-cli.sh > "$ROOT/harbor"
chmod 755 "$ROOT/harbor"

echo "wrote ./harbor  (project: harbor · env: .env · data: $DATA)"
echo
echo "Before './harbor public enable':"
echo "  • stop anything already on :4010 — a doorman started by hand will hold the port"
echo "  • the share container reads $DATA/shares, which is where the dev API writes bundles"
echo "  • it joins your real tailnet as a second machine, and you approve it in the browser"
echo "  • './harbor public disable' stops it; remove the node in the Tailscale console to undo it fully"
