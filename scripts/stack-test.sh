#!/usr/bin/env bash
# Run the full containerised stack in isolation, against a COPY of the live data.
#
# This is the production overlay exactly as the appliance runs it — every service from images, no
# host ports on Postgres or Redis, web on one address — pointed at a fresh Postgres restored from a
# dump of the live database and a copy of the blobs. It never touches the live data directory or
# the live database, and the copy has its mail connections disabled so it does not read your
# mailbox a second time. It is also spec §3.4's restore drill: dump, fresh database, restore, the
# API must come up on it without re-running migrations — and then the backup container takes a
# real backup into a local restic repository and runs the restore test against it.
#
#   scripts/stack-test.sh up      # needs harbor-{api,web,worker,backup}:latest (docker compose … build)
#   scripts/stack-test.sh down    # tear down and delete the copy
#
# The copy lives at data/stack-test (gitignored) and the app at http://127.0.0.1:3001.
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT=$(pwd)
TEST="$ROOT/data/stack-test"
LIVE_PG="${LIVE_PG_CONTAINER:-harbor-postgres-1}"
PROJECT=harbor-stack

# On a Mac the backup container reads its sources from named volumes instead (see below).
DARWIN_OVERRIDE=""; [ "$(uname -s)" = Darwin ] && DARWIN_OVERRIDE="-f $TEST/darwin.yml"
dc() { docker compose -p "$PROJECT" --env-file "$TEST/stack.env" -f infra/compose.yml -f infra/compose.prod.yml -f "$TEST/ports.yml" $DARWIN_OVERRIDE "$@"; }

# By project label, never by config file: the first version only tore down when its own env file
# existed, so a stack started any other way survived, and the rm below then deleted the data
# directory out from under its running Postgres. Teardown must be unconditional and come first.
teardown() {
  local ids; ids=$(docker ps -aq --filter "label=com.docker.compose.project=$PROJECT")
  [ -n "$ids" ] && docker rm -f $ids >/dev/null
  for n in $(docker network ls -q --filter "label=com.docker.compose.project=$PROJECT"); do docker network rm "$n" >/dev/null 2>&1 || true; done
  docker volume rm "${PROJECT}_blobs" "${PROJECT}_dumps" >/dev/null 2>&1 || true
}
wait_for() { local tries=$1; shift; for _ in $(seq 1 "$tries"); do "$@" && return 0; sleep 2; done; echo "timed out: $*" >&2; return 1; }

case "${1:-up}" in
  down) teardown; rm -rf "$TEST"; echo "$PROJECT removed"; exit 0 ;;
  up) ;;
  *) echo "usage: $0 up|down" >&2; exit 2 ;;
esac

for img in harbor-api harbor-web harbor-worker harbor-backup; do
  docker image inspect "$img:latest" >/dev/null 2>&1 || { echo "missing image $img:latest — run: docker compose --env-file .env -f infra/compose.yml build" >&2; exit 1; }
done
[ -f data/secrets/kek ] || { echo "no data/secrets/kek — nothing to decrypt the blobs with" >&2; exit 1; }
docker inspect "$LIVE_PG" >/dev/null 2>&1 || { echo "live postgres container $LIVE_PG is not running" >&2; exit 1; }

teardown
rm -rf "$TEST"
mkdir -p "$TEST/postgres" "$TEST/redis" "$TEST/tmp"
cp -a data/blobs "$TEST/blobs"
cp -a data/secrets "$TEST/secrets"
# The copy gets its own repository password; a dev checkout may not have one yet.
[ -s "$TEST/secrets/restic-password" ] || (umask 077; head -c 32 /dev/urandom | base64 > "$TEST/secrets/restic-password")
mkdir -p "$TEST/backup" "$TEST/dumps"
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
RESTIC_REPOSITORY=/backup
HARBOR_BACKUP_DIR=$TEST/backup
EOF
# !override, not !reset — reset discards its payload (see compose.prod.yml).
printf 'services:\n  web:\n    ports: !override ["127.0.0.1:3001:3000"]\n' > "$TEST/ports.yml"

# macOS only. Docker Desktop shares host directories through a FUSE layer ("fakeowner") that
# answers restic's read() with EIO on a nondeterministic handful of files — while dd, sha256sum,
# node and pg_dump read the same bytes without complaint, under every open flag restic uses.
# Reproduced with restic 0.14 and 0.17, single-threaded, single file. It is the Mac's file
# sharing, not the appliance's: there the data directory is ext4 on LUKS and no FUSE is involved.
# So on a Mac the backup container gets its *sources* — the blobs and the dump directory — on
# named volumes inside the VM (ext4), populated from the copy. Everything it writes (the
# repository, the restore scratch) stays on the bind mounts, which never misbehaved.
if [ -n "$DARWIN_OVERRIDE" ]; then
  cat > "$TEST/darwin.yml" <<EOF
services:
  backup:
    volumes: !override
      - "${PROJECT}_blobs:/data/blobs:ro"
      - "${PROJECT}_dumps:/data/dumps"
      - "$TEST/tmp:/data/tmp"
      - "$TEST/backup:/backup"
volumes:
  ${PROJECT}_blobs: { external: true }
  ${PROJECT}_dumps: { external: true }
EOF
  docker volume create "${PROJECT}_blobs" >/dev/null
  docker volume create "${PROJECT}_dumps" >/dev/null
  docker run --rm -v "${PROJECT}_blobs:/dst" -v "${PROJECT}_dumps:/dumps" -v "$TEST/blobs:/src:ro" alpine:3 \
    sh -c 'cp -a /src/. /dst/ && chown -R 1000:1000 /dst /dumps' >/dev/null
fi

# Postgres first and alone: the restore has to land before the API boots and runs migrations.
dc up -d --force-recreate postgres >/dev/null
wait_for 30 sh -c "[ \"\$(docker inspect --format '{{.State.Health.Status}}' ${PROJECT}-postgres-1 2>/dev/null)\" = healthy ]"
docker exec -i "${PROJECT}-postgres-1" pg_restore -U harbor -d harbor --no-owner < "$TEST/harbor.dump"
docker exec "${PROJECT}-postgres-1" psql -U harbor -d harbor -q -c "update mail_connections set status = 'disabled'"

dc up -d >/dev/null
wait_for 45 sh -c "docker logs ${PROJECT}-api-1 2>&1 | grep -q 'API listening'"
wait_for 20 curl -sf -o /dev/null http://127.0.0.1:3001/api/health

docker exec "${PROJECT}-postgres-1" psql -U harbor -d harbor -tAc \
  "select 'restored '||(select count(*) from documents)||' documents; '||(select count(*) from drizzle.__drizzle_migrations)||' migrations in place after the api booted'"

# Spec §3.4 for real: a backup into the copy's own repository, then the restore test on it. The
# one-shot form exits non-zero on failure, and so, under set -e, does this script.
dc exec -T backup node dist/backup.js run backup 2>&1 | grep -E "^(backup|restore_test) "
dc exec -T backup node dist/backup.js run restore_test 2>&1 | grep -E "^(backup|restore_test) "
echo "$PROJECT is up at http://127.0.0.1:3001 — same accounts as live, mail connections disabled in the copy"
echo "tear down with: scripts/stack-test.sh down"
