#!/usr/bin/env bash
# Prove a from-nothing install: an empty data directory, the production overlay from images, and
# the first run done the way an owner does it — through /setup in the browser, here driven over
# HTTP. Asserts what "starts fresh" means: no users, no documents, no mail connections after boot;
# the sign-in page sends you to /setup; the first owner can be created exactly once; and that
# owner can complete a real sign-in. Tears itself down unless asked to stay up.
#
#   scripts/fresh-test.sh            # needs harbor-{api,web,worker,backup}:latest
#   scripts/fresh-test.sh --keep     # leave it running at http://127.0.0.1:3002
#   scripts/fresh-test.sh down
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT=$(pwd)
TEST="$ROOT/data/fresh-test"
PROJECT=harbor-fresh
URL=http://127.0.0.1:3002

dc() { docker compose -p "$PROJECT" --env-file "$TEST/stack.env" -f infra/compose.yml -f infra/compose.prod.yml -f "$TEST/ports.yml" "$@"; }
teardown() {
  local ids; ids=$(docker ps -aq --filter "label=com.docker.compose.project=$PROJECT")
  [ -n "$ids" ] && docker rm -f $ids >/dev/null
  for n in $(docker network ls -q --filter "label=com.docker.compose.project=$PROJECT"); do docker network rm "$n" >/dev/null 2>&1 || true; done
}
wait_for() { local tries=$1; shift; for _ in $(seq 1 "$tries"); do "$@" && return 0; sleep 2; done; echo "timed out: $*" >&2; return 1; }
fail() { echo "FAIL: $*" >&2; exit 1; }
pg() { docker exec "${PROJECT}-postgres-1" psql -U harbor -d harbor -tAc "$1"; }

case "${1:-}" in
  down) teardown; rm -rf "$TEST"; echo "$PROJECT removed"; exit 0 ;;
esac
KEEP=0; [ "${1:-}" = "--keep" ] && KEEP=1

for img in harbor-api harbor-web harbor-worker harbor-backup; do
  docker image inspect "$img:latest" >/dev/null 2>&1 || fail "missing image $img:latest — run: docker compose --env-file .env -f infra/compose.yml build"
done

teardown
rm -rf "$TEST"
# Exactly what check-data-volume.sh does on the appliance, minus the LUKS check.
mkdir -p "$TEST"/{blobs,tmp,dumps,backup,postgres,redis,secrets}
(umask 077; head -c 32 /dev/urandom | base64 > "$TEST/secrets/kek"; head -c 32 /dev/urandom | base64 > "$TEST/secrets/restic-password")
cat > "$TEST/stack.env" <<EOF
HARBOR_DATA_DIR=$TEST
HARBOR_IMAGE_PREFIX=harbor
HARBOR_IMAGE_TAG=latest
HARBOR_BIND=127.0.0.1
WEB_ORIGIN=$URL
SESSION_COOKIE_SECURE=false
OCR_CONCURRENCY=1
SUGGEST_PROVIDER=none
EOF
printf 'services:\n  web:\n    ports: !override ["127.0.0.1:3002:3000"]\n' > "$TEST/ports.yml"

dc up -d >/dev/null
wait_for 45 sh -c "docker logs ${PROJECT}-api-1 2>&1 | grep -q 'API listening'"
wait_for 20 curl -sf -o /dev/null "$URL/api/health"

echo "── empty after boot"
[ "$(pg 'select count(*) from users')" = 0 ] || fail "users table is not empty"
[ "$(pg 'select count(*) from documents')" = 0 ] || fail "documents table is not empty"
[ "$(pg 'select count(*) from mail_connections')" = 0 ] || fail "mail_connections is not empty"
[ "$(pg 'select count(*) from categories')" -gt 0 ] || fail "the category vocabulary was not seeded"
echo "   users 0 · documents 0 · mail connections 0 · categories $(pg 'select count(*) from categories') (the built-in vocabulary)"

echo "── first run"
[ "$(curl -s "$URL/api/auth/setup")" = '{"needed":true}' ] || fail "GET /auth/setup should say needed"
loc=$(curl -s -o /dev/null -w '%{redirect_url}' "$URL/sign-in"); [[ "$loc" == */setup ]] || fail "/sign-in should redirect to /setup, got '$loc'"
EMAIL="first-owner@example.com"; PW="fresh-install-$(openssl rand -hex 4)"
setup=$(curl -s -H "Origin: $URL" -H 'Content-Type: application/json' -X POST "$URL/api/auth/setup" -d "{\"email\":\"$EMAIL\",\"displayName\":\"First Owner\",\"password\":\"$PW\"}")
secret=$(echo "$setup" | grep -o 'secret=[A-Z2-7]*' | cut -d= -f2); [ -n "$secret" ] || fail "setup did not return an authenticator key: $setup"
codes=$(echo "$setup" | grep -o '"recoveryCodes":\[[^]]*\]' | grep -o '[A-Z0-9]\{4\}-[A-Z0-9]\{4\}-[A-Z0-9]\{4\}' | wc -l | tr -d ' ')
echo "   owner created · authenticator key returned · $codes recovery codes"
again=$(curl -s -o /dev/null -w '%{http_code}' -H "Origin: $URL" -H 'Content-Type: application/json' -X POST "$URL/api/auth/setup" -d "{\"email\":\"second@example.com\",\"displayName\":\"x\",\"password\":\"twelve-characters\"}")
[ "$again" = 409 ] || fail "a second setup should be refused with 409, got $again"
[ "$(curl -s "$URL/api/auth/setup")" = '{"needed":false}' ] || fail "GET /auth/setup should now say not needed"
loc=$(curl -s -o /dev/null -w '%{redirect_url}' "$URL/setup"); [[ "$loc" == */sign-in ]] || fail "/setup should now redirect to /sign-in, got '$loc'"
echo "   second setup refused (409) · /setup now redirects to /sign-in"

echo "── the new owner signs in"
jar=$(mktemp)
step1=$(curl -s -c "$jar" -H "Origin: $URL" -H 'Content-Type: application/json' -X POST "$URL/api/auth/login" -d "{\"email\":\"$EMAIL\",\"password\":\"$PW\"}")
[ "$step1" = '{"next":"totp"}' ] || fail "password step: $step1"
code=$(docker exec "${PROJECT}-api-1" node -e 'const {authenticator}=require("otplib"); console.log(authenticator.generate(process.argv[1]))' "$secret")
step2=$(curl -s -b "$jar" -c "$jar" -o /dev/null -w '%{http_code}' -H "Origin: $URL" -H 'Content-Type: application/json' -X POST "$URL/api/auth/totp" -d "{\"code\":\"$code\"}")
[ "$step2" = 200 ] || fail "authenticator step returned $step2"
me=$(curl -s -b "$jar" "$URL/api/auth/me"); echo "$me" | grep -q "\"email\":\"$EMAIL\"" || fail "/auth/me after sign-in: $me"
rm -f "$jar"
echo "   password ✓ · authenticator code ✓ · /auth/me is the new owner"

if [ "$KEEP" = 1 ]; then
  echo "$PROJECT is up at $URL — owner $EMAIL / $PW, authenticator key $secret. Tear down with: scripts/fresh-test.sh down"
else
  teardown; rm -rf "$TEST"
  echo "fresh install verified and removed"
fi
