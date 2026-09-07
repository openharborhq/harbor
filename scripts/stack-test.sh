#!/usr/bin/env bash
# Run the full containerised stack in isolation, against a COPY of the live data.
#
# This is the production overlay exactly as the appliance runs it — every service from images, no
# host ports on Postgres or Redis, web on one address — pointed at a fresh Postgres restored from a
# dump of the live database and a copy of the blobs. It never touches the live data directory or
# the live database, and the copy has its mail connections disabled so it does not read your
# mailbox a second time. It is also spec §3.4's restore drill in miniature: dump, fresh database,
# restore, and the API must come up on it without re-running migrations.
#
#   scripts/stack-test.sh up      # needs harbor-{api,web,worker}:latest (docker compose … build)
#   scripts/stack-test.sh down    # tear down and delete the copy
#
# The copy lives at data/stack-test (gitignored) and the app at http://127.0.0.1:3001.
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT=$(pwd)
TEST="$ROOT/data/stack-test"
LIVE_PG="${LIVE_PG_CONTAINER:-harbor-postgres-1}"
PROJECT=harbor-stack

dc() { docker compose -p "$PROJECT" --env-file "$TEST/stack.env" -f infra/compose.yml -f infra/compose.prod.yml -f "$TEST/ports.yml" "$@"; }

# By project label, never by config file: the first version only tore down when its own env file
# existed, so a stack started any other way survived, and the rm below then deleted the data
# directory out from under its running Postgres. Teardown must be unconditional and come first.
teardown() {
  local ids; ids=$(docker ps -aq --filter "label=com.docker.compose.project=$PROJECT")
  [ -n "$ids" ] && docker rm -f $ids >/dev/null
  for n in $(docker network ls -q --filter "label=com.docker.compose.project=$PROJECT"); do docker network rm "$n" >/dev/null 2>&1 || true; done
}
wait_for() { local tries=$1; shift; for _ in $(seq 1 "$tries"); do "$@" && return 0; sleep 2; done; echo "timed out: $*" >&2; return 1; }

case "${1:-up}" in
  down) teardown; rm -rf "$TEST"; echo "$PROJECT removed"; exit 0 ;;
  up) ;;
  *) echo "usage: $0 up|down" >&2; exit 2 ;;
esac

for img in harbor-api harbor-web harbor-worker; do
  docker image inspect "$img:latest" >/dev/null 2>&1 || { echo "missing image $img:latest — run: docker compose --env-file .env -f infra/compose.yml build" >&2; exit 1; }
done
[ -f data/secrets/kek ] || { echo "no data/secrets/kek — nothing to decrypt the blobs with" >&2; exit 1; }
docker inspect "$LIVE_PG" >/dev/null 2>&1 || { echo "live postgres container $LIVE_PG is not running" >&2; exit 1; }

teardown
rm -rf "$TEST"
mkdir -p "$TEST/postgres" "$TEST/redis" "$TEST/tmp"
cp -a data/blobs "$TEST/blobs"
cp -a data/secrets "$TEST/secrets"
# The server's own pg_dump: the host client may be a different major version.
docker exec "$LIVE_PG" pg_dump -U harbor -Fc harbor > "$TEST/harbor.dump"

cat > "$TEST/stack.env" <<EOF
HARBOR_DATA_DIR=$TEST
HARBOR_IMAGE_PREFIX=harbor
HARBOR_IMAGE_TAG=latest
HARBOR_BIND=127.0.0.1
WEB_ORIGIN=http://127.0.0.1:3001
SESSION_COOKIE_SECURE=false
OCR_CONCURRENCY=1
SUGGEST_PROVIDER=none
EOF
# !override, not !reset — reset discards its payload (see compose.prod.yml).
printf 'services:\n  web:\n    ports: !override ["127.0.0.1:3001:3000"]\n' > "$TEST/ports.yml"

# Postgres first and alone: the restore has to land before the API boots and runs migrations.
dc up -d --force-recreate postgres >/dev/null
wait_for 30 sh -c "[ \"\$(docker inspect --format '{{.State.Health.Status}}' ${PROJECT}-postgres-1 2>/dev/null)\" = healthy ]"
docker exec -i "${PROJECT}-postgres-1" pg_restore -U harbor -d harbor --no-owner < "$TEST/harbor.dump"
docker exec "${PROJECT}-postgres-1" psql -U harbor -d harbor -q -c "update mail_connections set status = 'disabled'"

dc up -d >/dev/null
wait_for 45 sh -c "docker logs ${PROJECT}-api-1 2>&1 | grep -q 'API listening'"
wait_for 20 curl -sf -o /dev/null http://127.0.0.1:3001/api/health

docker exec "${PROJECT}-postgres-1" psql -U harbor -d harbor -tAc \
  "select 'restored '||(select count(*) from documents)||' documents, '||(select count(*) from drizzle.__drizzle_migrations)||' migrations; api booted without re-migrating'"
echo "$PROJECT is up at http://127.0.0.1:3001 — same accounts as live, mail connections disabled in the copy"
echo "tear down with: scripts/stack-test.sh down"
