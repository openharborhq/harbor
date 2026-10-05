#!/usr/bin/env bash
# Prove install.sh itself, end to end, the way a person runs it: on a fresh Debian 12 with Docker,
# answering the interview at a terminal — and then checking that what it left behind is a working
# vault, on the kinds of machine it is meant for.
#
# fresh-test.sh starts the stack directly and never runs the installer; this is the other half.
# The "machine" is a privileged Debian container running its own Docker daemon, and the "spare
# disk" is a loop device backed by a file. It shares /dev with the Docker VM because a container's
# own /dev never gains the partition and mapper nodes that sgdisk and cryptsetup create.
#
#   scripts/install-test.sh                  a spare disk, encrypted; this Mac's architecture
#   scripts/install-test.sh --protectly      a mini-PC: amd64 (emulated here), booted with systemd,
#                                            and a power cut and a real boot before unlocking
#   scripts/install-test.sh --vps            one disk and nothing to encrypt: accepted, and it runs
#   scripts/install-test.sh --home-server    a box already running other containers, one of them
#                                            on port 3000, which the installer has to notice
#   scripts/install-test.sh --internet       reached directly at a domain, over HTTPS: Caddy, with a
#                                            local CA standing in for Let's Encrypt, and the setup gate
#   scripts/install-test.sh --tailscale      reached through Tailscale: installed on the host, and —
#                                            since nothing here can sign in — the fallback when it fails
#   scripts/install-test.sh desktop          install.sh on this Mac, under Docker Desktop, the
#                                            "just looking" path: no encryption, no tailnet
#
#   --amd64, --systemd, --no-spare-disk, --busy-host are the parts those are made of, and combine.
#
#   --keep                                   leave it up and say how to reach it from this Mac;
#                                            offers to fill it with test data once you have signed up
#   scripts/install-test.sh seed             fill a kept machine with the test data later
#   scripts/install-test.sh down             remove the machine and the desktop trial
#
#   SEED=y …       answer the test-data question up front
#   TS_ANSWER=n …  with --tailscale, decline installing it (the default under --systemd, where a
#                  running tailscaled waits ten minutes for a sign-in nobody here can do)
#   INSTALL_TEST_PORT=3004 …   if 3003 is taken on this Mac (desktop uses 3005)
#
# Not covered: a real Tailscale sign-in, TPM unlock, real NVMe/SATA hardware, and Windows.
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT=$(pwd)
NAME=harbor-install-test
PORT="${INSTALL_TEST_PORT:-3003}"
# The port the vault is told to publish on, and the one this Mac reaches it on. They are the same
# number on purpose: the vault checks the Origin of every sign-in against WEB_ORIGIN, so the
# address in the browser has to be the address the installer wrote down. 3000-3002 belong to the
# dev, stack-test and fresh-test stacks.

fail() { echo "FAIL: $*" >&2; exit 1; }
wait_for() { local tries=$1; shift; for _ in $(seq 1 "$tries"); do "$@" >/dev/null 2>&1 && return 0; sleep 2; done; echo "timed out: $*" >&2; return 1; }

# ---- options ------------------------------------------------------------------------------------

CMD=machine KEEP=0 ARCH="" SYSTEMD=0 SPARE_DISK=1 BUSY=0 REACH=local
for arg in "$@"; do
  case "$arg" in
    down|seed|desktop) CMD=$arg ;;
    --keep) KEEP=1 ;;
    --amd64) ARCH=amd64 ;;
    --systemd) SYSTEMD=1 ;;
    --no-spare-disk) SPARE_DISK=0 ;;
    --busy-host) BUSY=1 ;;
    --protectly) ARCH=amd64; SYSTEMD=1 ;;
    --vps) SPARE_DISK=0 ;;
    --home-server) BUSY=1 ;;
    --internet) REACH=internet ;;
    --tailscale) REACH=tailnet ;;
    *) fail "unknown option: $arg (see the top of $0)" ;;
  esac
done
if [ -z "$ARCH" ]; then
  case "$(docker version --format '{{.Server.Arch}}')" in arm64|aarch64) ARCH=arm64 ;; *) ARCH=amd64 ;; esac
fi
TS_ANSWER="${TS_ANSWER:-$([ "$SYSTEMD" = 1 ] && echo n || echo y)}"
# The answer to "How should you reach Harbor?", and the stand-in domain for --internet.
case "$REACH" in tailnet) REACH_ANSWER=1 ;; internet) REACH_ANSWER=2 ;; *) REACH_ANSWER=3 ;; esac
DOMAIN=harbor.test
IMAGE="harbor-install-test:debian12-$ARCH$([ "$SYSTEMD" = 1 ] && echo -systemd || true)"
# The inner daemon's images, kept between runs so the release is pulled once, not every time — one
# set per architecture, so an amd64 run never finds arm64 layers under the same tag.
CACHE="harbor-install-test-$ARCH"

# ---- the expect script: a person at the keyboard ------------------------------------------------

# One pattern per question the installer and encrypt-disk.sh can ask. Anything else it stops on is
# a question this test does not know about, and the timeout says so. Shared by the machine and the
# desktop runs; arguments: disk, tailscale answer, port, encrypt answer, take-the-default-port-first,
# backup answer, installer path, reach answer, domain.
drive_exp() {
  cat <<'EXP'
set disk      [lindex $argv 0]
set ts        [lindex $argv 1]
set port      [lindex $argv 2]
set encrypt   [lindex $argv 3]
set busy      [lindex $argv 4]
set backup    [lindex $argv 5]
set installer [lindex $argv 6]
set reach     [lindex $argv 7]
set domain    [lindex $argv 8]
set saw_taken 0
set timeout 1800
spawn sh $installer
expect {
  -ex {Where should that live?}                        { send "\r"; exp_continue }
  -ex {Install Tailscale on this machine?}             { send "$ts\r"; exp_continue }
  -ex {Sign this machine in to Tailscale now?}         { send "n\r"; exp_continue }
  -ex {Press enter when that is done.}                 { send "\r"; exp_continue }
  -re {on your own network.*?Which\? \[\d\] }          { send "$reach\r"; exp_continue }
  -ex {Auth key (empty to reach it}                    { send "\r"; exp_continue }
  -ex {Domain for Harbor}                              { send "$domain\r"; exp_continue }
  -ex {Address to publish on}                          { send "127.0.0.1\r"; exp_continue }
  -ex {Port [3000]}                                    { if {$busy} { send "\r" } else { send "$port\r" }; exp_continue }
  -ex {already listens on port}                        { set saw_taken 1; exp_continue }
  -ex {Port for Harbor instead}                        { send "$port\r"; exp_continue }
  -ex {Backup repository}                              { send "$backup\r"; exp_continue }
  -ex {Set up an encrypted volume now?}                { send "$encrypt\r"; exp_continue }
  -ex {Which disk should become the encrypted volume?} { send "$disk\r"; exp_continue }
  -ex {Type the device name to confirm}                { send "$disk\r"; exp_continue }
  -re {Ask at boot.*?Which\? \[1\] }                   { send "1\r"; exp_continue }
  -ex {Continue anyway?}                               { if {$encrypt eq "y"} { send "n\r" } else { send "y\r" }; exp_continue }
  timeout { puts "\nTIMEOUT: the installer is waiting on something this test does not answer"; exit 2 }
  eof
}
set rc [lindex [wait] 3]
if {$rc == 0 && $busy && !$saw_taken} { puts "\nFAIL: port 3000 was taken and the installer never said so"; exit 3 }
exit $rc
EXP
}

# ---- the machine: teardown, and the things a kept one offers --------------------------------------

# Run in a throwaway container that shares the VM's /dev. Nothing runs udev there, so closing a
# mapping leaves its /dev/mapper node behind, stale — and a stale node with the old minor number
# outlives the device and confuses the next cryptsetup open. Removed whenever the mapping is gone.
CLOSE_VOLUME='dmsetup info harbordata >/dev/null 2>&1 && dmsetup remove harbordata
  dmsetup info harbordata >/dev/null 2>&1 || rm -f /dev/mapper/harbordata'

# The mapper device and the loop device live in the Docker VM, not in the container, so removing
# the container alone would leave them behind — and the next run's cryptsetup would find the name
# taken. Closed from outside after the container is gone, because it may have died mid-test (or
# mid-"power cut") with no way to exec into it.
teardown() {
  docker inspect "$NAME" >/dev/null 2>&1 || return 0
  local loop image
  loop=$(docker cp "$NAME":/var/lib/harbor-test/loop - 2>/dev/null | tar -xO 2>/dev/null || true)
  image=$(docker inspect -f '{{.Config.Image}}' "$NAME")
  docker exec "$NAME" sh -c '
    ids=$(docker ps -aq 2>/dev/null); [ -n "$ids" ] && docker rm -f $ids >/dev/null 2>&1
    umount /data 2>/dev/null; cryptsetup close harbordata 2>/dev/null; chattr -i /data 2>/dev/null; true' >/dev/null 2>&1 || true
  docker rm -f "$NAME" >/dev/null 2>&1 || true
  docker run --rm --privileged -v /dev:/dev --entrypoint sh "$image" -c \
    "$CLOSE_VOLUME; [ -n '$loop' ] && losetup -d '$loop' 2>/dev/null; true" >/dev/null 2>&1 || true
}

has_owner() { [ "$(docker exec "$NAME" vault-curl /api/auth/setup 2>/dev/null)" = '{"needed":false}' ]; }
pg() { docker exec "$NAME" docker exec harbor-postgres-1 psql -U harbor -d harbor -tAc "$1"; }

# Printed when --keep leaves the machine up, whether the test passed or stopped partway: a failed
# run is exactly the one you want to walk into and look at.
#
# No owner is made: the first visit is the first run, exactly as a person meets it after a real
# install — create the account, add the authenticator, see the recovery codes.
access_note() {
  if [ "$REACH" = internet ]; then
    cat <<NOTE

── the machine is still up
   vault          https://$DOMAIN, inside the machine only: the browser on this Mac would need
                  $DOMAIN in /etc/hosts and port 443, so use  docker exec $NAME vault-curl /api/health
   setup link     $(docker exec "$NAME" sh -c 'echo "$(harbor url)/setup?token=$(grep ^HARBOR_SETUP_TOKEN= /data/harbor.env | cut -d= -f2-)"' 2>/dev/null)
   a shell on it  docker exec -it $NAME bash      (harbor logs caddy)
   remove it      scripts/install-test.sh down
NOTE
    return
  fi
  cat <<NOTE

── the machine is still up
   vault          http://127.0.0.1:$PORT   (open it in a browser on this Mac)
NOTE
  if has_owner; then
    echo "   sign in        with the account you created"
  else
    cat <<NOTE
   first run      it has no owner yet, so it asks you to create one: your email, a password,
                  and an authenticator. Scan the code with your phone's app, or paste the key
                  it shows into:  docker exec $NAME harbor-test-code <key>
NOTE
  fi
  cat <<NOTE
   test data      scripts/install-test.sh seed   (23 invented documents, once you have an account)
   a shell on it  docker exec -it $NAME bash
                    then: harbor status · harbor logs · harbor break-glass · harbor lock / unlock
                    the volume passphrase, if it has one, is in /root/harbor-luks-passphrase
   remove it      scripts/install-test.sh down
NOTE
}

# The seed belongs to the account that exists, and the first run is the person's to do — so this
# waits for them rather than making one.
wait_for_owner() {
  has_owner && return 0
  echo "   Create your account first: open http://127.0.0.1:$PORT in a browser. This waits until you have."
  [ "$REACH" != internet ] || fail "with --internet there is no browser on this Mac to sign up in; seed without --keep"
  until has_owner; do sleep 3; done
  echo "   account created"
}

# The demo seed from this checkout (apps/api/src/seed.ts), not the release's: compiled on its own
# and put over the release image's dist/seed.js, the same way the installer under test is this
# checkout's and not GitHub's. The api is compiled file by file to CommonJS, so one file swaps
# cleanly — as long as seed.ts uses nothing the release's services do not have.
seed_vault() {
  local js; js=$(mktemp)
  if command -v npx >/dev/null 2>&1; then
    npx -y esbuild@0.24.0 apps/api/src/seed.ts --format=cjs --platform=node --target=node20 --log-level=warning >"$js"
  else
    docker run --rm -v "$ROOT/apps/api/src:/src:ro" node:22-alpine \
      npx -y esbuild@0.24.0 /src/seed.ts --format=cjs --platform=node --target=node20 --log-level=warning >"$js"
  fi
  # mktemp makes it 0600 and docker cp keeps the mode, which the api (uid 1000) cannot read.
  chmod 644 "$js"
  docker cp "$js" "$NAME":/root/seed.js >/dev/null; rm -f "$js"
  docker exec "$NAME" docker cp /root/seed.js harbor-api-1:/app/dist/seed.js >/dev/null
  docker exec "$NAME" harbor seed 2>&1 | grep -v '^\[Nest\]' | sed 's/^/   /' || true
  # Status is per file, not per document: document_files holds one row per version.
  local total; total=$(pg "select count(*) from documents where deleted_at is null")
  [ "${total:-0}" -ge 20 ] || fail "the seed left $total documents, want at least 20"
  printf '   waiting for the worker to process them'
  local done=0
  for _ in $(seq 1 180); do
    done=$(pg "select count(*) from document_files where is_current and processing_status in ('ready','failed')")
    [ "$done" = "$total" ] && break
    printf '.'; sleep 2
  done
  echo
  [ "$done" = "$total" ] || fail "only $done of $total documents were processed after six minutes"
  local failed inbox
  failed=$(pg "select count(*) from document_files where is_current and processing_status = 'failed'")
  inbox=$(pg "select count(*) from documents where category_id is null and deleted_at is null")
  [ "$failed" = 0 ] || fail "$failed of $total seeded documents failed processing"
  echo "   ✓ $total test documents, all processed, $inbox waiting in the Inbox"
}

# The vault publishes on 127.0.0.1 inside the machine, as the installer told it to, and Docker's
# port mapping arrives on the machine's own address. socat joins the two, so this Mac reaches the
# vault on the same address the vault believes it has. Started again after a boot.
forward_port() {
  docker exec -d "$NAME" sh -c "exec socat TCP-LISTEN:$PORT,bind=\$(hostname -i | cut -d' ' -f1),fork,reuseaddr TCP:127.0.0.1:$PORT"
}

# ---- desktop: install.sh on this Mac ------------------------------------------------------------

DESKTOP_DIR="$ROOT/data/install-trial"
DESKTOP_PROJECT=harbor-trial
DESKTOP_PORT="${INSTALL_TEST_DESKTOP_PORT:-3005}"

desktop_teardown() {
  local ids; ids=$(docker ps -aq --filter "label=com.docker.compose.project=$DESKTOP_PROJECT")
  [ -n "$ids" ] && docker rm -f $ids >/dev/null
  for n in $(docker network ls -q --filter "label=com.docker.compose.project=$DESKTOP_PROJECT"); do docker network rm "$n" >/dev/null 2>&1 || true; done
  # compose.desktop.yml keeps Postgres and Redis in named volumes; a trial leaves none behind.
  docker volume rm "${DESKTOP_PROJECT}_postgres" "${DESKTOP_PROJECT}_redis" >/dev/null 2>&1 || true
  rm -rf "$DESKTOP_DIR"
}

# The installer's own non-Linux path: compose files and data under the current directory, no
# encryption check, no Tailscale offer. Its own compose project and its own `harbor`, so it sits
# beside a dev stack on this Mac without touching it.
desktop() {
  desktop_teardown
  [ "$(uname -s)" = Darwin ] || fail "desktop is the Docker Desktop on macOS path; this is $(uname -s)"
  mkdir -p "$DESKTOP_DIR/harbor" "$DESKTOP_DIR/bin"
  cp -R infra/. "$DESKTOP_DIR/harbor/"
  local exp busy=0; exp=$(mktemp); drive_exp >"$exp"
  # Whatever already has 3000 here — usually the dev server — makes this the real busy-host case.
  lsof -nP -iTCP:3000 -sTCP:LISTEN >/dev/null 2>&1 && busy=1
  echo "── install.sh on this Mac (Docker Desktop$([ $busy = 1 ] && echo ', with port 3000 already taken'))"
  [ "$KEEP" = 1 ] || trap desktop_teardown EXIT
  ( cd "$DESKTOP_DIR" && HARBOR_KEEP_LOCAL=1 HARBOR_PROJECT=$DESKTOP_PROJECT HARBOR_CLI_DIR="$DESKTOP_DIR/bin" \
      expect "$exp" "" n "$DESKTOP_PORT" n "$busy" "" "$ROOT/install.sh" 3 "" ) || { rm -f "$exp"; fail "install.sh did not finish"; }
  rm -f "$exp"

  echo
  echo "── what it left behind"
  local url="http://127.0.0.1:$DESKTOP_PORT" h="$DESKTOP_DIR/bin/harbor"
  [ -x "$h" ] || fail "no harbor command at $h"
  [ "$("$h" url)" = "$url" ] || fail "harbor url says $("$h" url), want $url"
  wait_for 60 curl -sf "$url/api/health" || fail "the vault does not answer at $url"
  [ "$(curl -s "$url/api/auth/setup")" = '{"needed":true}' ] || fail "a fresh vault should ask for its first owner"
  echo "   ✓ vault answering at $url and waiting for its first owner"
  [ -s "$DESKTOP_DIR/harbor-data/secrets/kek" ] || fail "no master key under harbor-data/secrets"
  echo "   ✓ data and secrets under $DESKTOP_DIR/harbor-data"
  "$h" status >/dev/null || fail "harbor status"
  echo "   ✓ its own harbor command, in $DESKTOP_DIR/bin — nothing put on your PATH"
  if [ "$KEEP" = 1 ]; then
    cat <<NOTE

── the trial is still up
   vault          $url   (first run: create your account there)
   its command    $h status · logs · break-glass
   remove it      scripts/install-test.sh down
NOTE
  else
    desktop_teardown
    echo "desktop install verified and removed"
  fi
}

# ---- commands that are not a run ----------------------------------------------------------------

case "$CMD" in
  down) teardown; desktop_teardown; echo "$NAME and the desktop trial removed"; exit 0 ;;
  desktop) desktop; exit 0 ;;
  seed)
    docker inspect "$NAME" >/dev/null 2>&1 || fail "no test machine is running — start one with: $0 --keep"
    echo "── test data"
    wait_for_owner
    seed_vault
    exit 0
    ;;
esac

# ---- the machine --------------------------------------------------------------------------------

teardown
if (exec 3<>"/dev/tcp/127.0.0.1/$PORT") 2>/dev/null; then
  fail "port $PORT is already in use on this Mac. Free it, or pick another: INSTALL_TEST_PORT=3004 $0 $*"
fi

describe="Debian 12, $ARCH$([ "$ARCH" != "$(docker version --format '{{.Server.Arch}}' | sed 's/aarch64/arm64/')" ] && echo ' (emulated)' || true)"
[ "$SYSTEMD" = 1 ] && describe="$describe, booted with systemd"
[ "$SPARE_DISK" = 1 ] && describe="$describe, a spare disk" || describe="$describe, one disk only"
[ "$BUSY" = 1 ] && describe="$describe, other services already running"
case "$REACH" in internet) describe="$describe, reached at https://$DOMAIN" ;; tailnet) describe="$describe, reached through Tailscale" ;; esac
echo "── a fresh machine: $describe"

# What the prerequisites page asks for, and nothing more: no cryptsetup, no gdisk, no Tailscale.
# e2fsprogs, iproute2, dmsetup and sudo are on any real minimal install; expect is the person at the
# keyboard, socat the way in from this Mac. The systemd variant boots like a box does.
{
  echo "FROM debian:12"
  echo "RUN apt-get update \\"
  echo " && apt-get install -y --no-install-recommends ca-certificates curl e2fsprogs iproute2 dmsetup sudo expect socat \\"
  [ "$SYSTEMD" = 1 ] && echo "    systemd systemd-sysv dbus \\"
  echo " && curl -fsSL https://get.docker.com | sh \\"
  echo " && rm -rf /var/lib/apt/lists/*"
  if [ "$SYSTEMD" = 1 ]; then echo "STOPSIGNAL SIGRTMIN+3"; echo 'CMD ["/sbin/init"]'; fi
} | docker build -q --platform "linux/$ARCH" -t "$IMAGE" - >/dev/null

# A live mapping is a real leftover (or another run in progress) and is not ours to close; a stale
# node with no mapping behind it is just litter, cleared on the way.
if docker run --rm --platform "linux/$ARCH" --privileged -v /dev:/dev --entrypoint sh "$IMAGE" -c \
  'dmsetup info harbordata >/dev/null 2>&1 || { rm -f /dev/mapper/harbordata; exit 1; }'; then
  fail "harbordata is open in the Docker VM — another run, or one that died. scripts/install-test.sh down, or restart Docker Desktop."
fi

run_args=(-d --name "$NAME" --hostname harbor-box --platform "linux/$ARCH" --privileged --cgroupns=private
  -p "127.0.0.1:$PORT:$PORT" -v /dev:/dev
  -v "$CACHE-docker:/var/lib/docker" -v "$CACHE-containerd:/var/lib/containerd")
if [ "$SYSTEMD" = 1 ]; then
  # systemd puts itself in init.scope and delegates the rest, which is what lets Docker inside it
  # run containers with limits — the cgroup dance below is what stands in for that without it.
  docker run "${run_args[@]}" --tmpfs /run --tmpfs /run/lock "$IMAGE" >/dev/null
else
  # The cgroup dance is the one docker:dind does in its entrypoint. Under cgroup v2 the container's
  # own processes sit in the root of its cgroup, which then cannot hand controllers down to the
  # inner daemon's — and any service with a resource limit fails with "cannot enter cgroupv2 … in
  # threaded mode". Moving them into a child first frees the root to delegate.
  docker run "${run_args[@]}" "$IMAGE" sh -c '
    if [ -f /sys/fs/cgroup/cgroup.controllers ]; then
      mkdir -p /sys/fs/cgroup/init
      xargs -rn1 </sys/fs/cgroup/cgroup.procs >/sys/fs/cgroup/init/cgroup.procs 2>/dev/null || :
      sed -e "s/ / +/g" -e "s/^/+/" </sys/fs/cgroup/cgroup.controllers >/sys/fs/cgroup/cgroup.subtree_control
      # dockerd turns on controllers in its own cgroup lazily, while compose is already creating
      # containers in parallel; one of them then finds no memory.max and fails to start (seen on
      # the third run of this test). Done up front there is nothing to race.
      mkdir -p /sys/fs/cgroup/docker
      sed -e "s/ / +/g" -e "s/^/+/" </sys/fs/cgroup/docker/cgroup.controllers >/sys/fs/cgroup/docker/cgroup.subtree_control
    fi
    dockerd >/var/log/dockerd.log 2>&1 &
    exec sleep infinity' >/dev/null
fi
if [ "$KEEP" = 1 ]; then trap access_note EXIT; else trap teardown EXIT; fi
wait_for 90 docker exec "$NAME" docker info || fail "the inner Docker daemon did not start"
echo "   Debian $(docker exec "$NAME" cat /etc/debian_version) · $(docker exec "$NAME" uname -m) · Docker $(docker exec "$NAME" docker version --format '{{.Server.Version}}')"

# This checkout's installer, and its infra/ in place of the copies on GitHub (HARBOR_KEEP_LOCAL),
# so what is tested is what is about to be committed.
docker exec "$NAME" mkdir -p /opt/harbor /var/lib/harbor-test
docker cp install.sh "$NAME":/root/install.sh >/dev/null
docker cp infra/. "$NAME":/opt/harbor/ >/dev/null

LOOP=""
if [ "$SPARE_DISK" = 1 ]; then
  LOOP=$(docker exec "$NAME" sh -c 'truncate -s 4G /var/lib/harbor-test/disk.img && losetup -fP --show /var/lib/harbor-test/disk.img | tee /var/lib/harbor-test/loop')
  echo "   spare disk: $LOOP (4 GB, empty)"
fi
if [ "$BUSY" = 1 ]; then
  # What a home server already has: something on 3000 (Grafana, a dashboard, a dev server), set to
  # come back on its own after a reboot. Harbor has to work around it and leave it alone.
  docker exec "$NAME" docker run -d --name other-service --restart unless-stopped -p 127.0.0.1:3000:80 \
    busybox httpd -f -p 80 >/dev/null
  echo "   already running: other-service on port 3000, restart unless-stopped"
fi

echo "── install.sh, answered at a terminal"
drive_exp | docker exec -i "$NAME" sh -c 'cat > /root/drive.exp'
encrypt=$([ "$SPARE_DISK" = 1 ] && echo y || echo n)
# local_certs: Caddy's own CA instead of Let's Encrypt, which cannot reach a machine in here.
docker exec -e HARBOR_KEEP_LOCAL=1 -e HARBOR_CADDY_GLOBAL=local_certs "$NAME" \
  expect /root/drive.exp "$LOOP" "$TS_ANSWER" "$PORT" "$encrypt" "$BUSY" /srv/harbor-backup /root/install.sh \
    "$REACH_ANSWER" "$DOMAIN" \
  || fail "install.sh did not finish"

[ "$REACH" = internet ] || forward_port
# curl against the vault from inside the machine, however it is reached: plain HTTP on its port,
# or HTTPS at its domain through Caddy, resolved to this machine and trusting Caddy's local CA.
docker exec -i "$NAME" sh -c 'cat > /usr/local/bin/vault-curl && chmod 755 /usr/local/bin/vault-curl' <<'VC'
#!/bin/sh
# vault-curl <path> [curl options…]
url=$(harbor url); path=$1; shift
case "$url" in
  https://*) host=${url#https://}; host=${host%%/*}; exec curl -sk --resolve "$host:443:127.0.0.1" "$@" "$url$path" ;;
  *) exec curl -s "$@" "$url$path" ;;
esac
VC
# The current authenticator code for a key, for whoever runs the first run without a phone to hand.
docker exec -i "$NAME" sh -c 'cat > /usr/local/bin/harbor-test-code && chmod 755 /usr/local/bin/harbor-test-code' <<'CODE'
#!/bin/sh
[ -n "${1:-}" ] || { echo "usage: harbor-test-code <the authenticator key the vault showed you>" >&2; exit 1; }
docker exec harbor-api-1 node -e 'const {authenticator}=require("otplib"); console.log(authenticator.generate(process.argv[1]))' "$(echo "$1" | tr -d ' ')"
CODE

echo
echo "── what it left behind"
# Written to a file and run from there, not piped to `bash -s`: `harbor backup` runs `docker compose
# exec`, which reads stdin — piped, it swallowed the rest of these checks, bash hit EOF, and the
# test passed without running the backup, restore or unlock checks at all.
docker exec -i "$NAME" sh -c 'cat > /root/checks.sh' <<'CHECKS'
set -euo pipefail
fail() { echo "FAIL: $*" >&2; exit 1; }
ok() { echo "   ✓ $*"; }
healthy() { for _ in $(seq 1 150); do vault-curl /api/health -f >/dev/null && return 0; sleep 2; done; return 1; }
# Harbor's containers only: on a busy host the others keep whatever policy their owner gave them.
restart_policies_are_no() {
  for id in $(docker ps -q --filter label=com.docker.compose.project=harbor); do
    p=$(docker inspect -f '{{.Name}} {{.HostConfig.RestartPolicy.Name}}' "$id")
    [ "${p##* }" = no ] || fail "$p — a container that restarts itself comes back before the volume is unlocked"
  done
}
other_service_untouched() {
  [ "$BUSY" = 1 ] || return 0
  [ "$(docker inspect -f '{{.State.Running}} {{.HostConfig.RestartPolicy.Name}}' other-service)" = "true unless-stopped" ] \
    || fail "other-service was stopped or had its restart policy changed"
}
cluster() { docker exec harbor-postgres-1 psql -U harbor -d harbor -tAc 'select system_identifier from pg_control_system()'; }

if [ "$ENCRYPTED" = 1 ]; then
  src=$(findmnt -n -o SOURCE --target /data)
  [ "$src" = /dev/mapper/harbordata ] || fail "/data is on $src, not the encrypted volume"
  lsblk -n -s -o TYPE "$src" | grep -qx crypt || fail "no dm-crypt layer under $src"
  ok "/data is the encrypted volume ($src)"
  grep -q '^harbordata UUID=[^ ]* none luks,noauto$' /etc/crypttab || fail "crypttab: $(cat /etc/crypttab)"
  grep -q '^/dev/mapper/harbordata /data ext4 defaults,noauto ' /etc/fstab || fail "fstab: $(grep data /etc/fstab)"
  [ "$(cat /etc/harbor/unlock-mode)" = manual ] || fail "unlock mode is not manual"
  ok "crypttab, fstab and unlock mode set for manual unlocking"
  [ "$(stat -c %a /root/harbor-luks-passphrase)" = 600 ] || fail "the passphrase file is missing or readable by others"
  ok "volume passphrase in /root/harbor-luks-passphrase, root only"
else
  [ ! -e /etc/harbor/unlock-mode ] || fail "no volume was made, yet the unlock mode is set"
  ok "no spare disk: the risk was accepted and /data is on the system disk, as asked"
fi

for s in kek restic-password; do
  [ "$(stat -c '%u %a' /data/secrets/$s)" = "1000 400" ] || fail "/data/secrets/$s is $(stat -c '%u %a' /data/secrets/$s), want 1000 400"
done
for d in blobs tmp dumps backup; do
  [ "$(stat -c %u /data/$d)" = 1000 ] || fail "/data/$d is not owned by the app user"
done
ok "secrets and data directories in /data, owned by uid 1000"

command -v harbor >/dev/null || fail "the harbor command was not installed"
URL=$(harbor url)
healthy || fail "$URL/api/health does not answer"
[ "$(vault-curl /api/auth/setup)" = '{"needed":true}' ] || fail "a fresh vault should ask for its first owner"
ok "vault answering at $URL and waiting for its first owner"
if [ "$REACH" = internet ]; then
  token=$(grep '^HARBOR_SETUP_TOKEN=' /data/harbor.env | cut -d= -f2-)
  [ -n "$token" ] || fail "no setup token in harbor.env"
  web=$(docker ps -q --filter label=com.docker.compose.project=harbor --filter label=com.docker.compose.service=web)
  [ -n "$web" ] && [ -z "$(docker port "$web")" ] || fail "web publishes a port, though Caddy is the way in: $(docker port "$web")"
  ok "only Caddy listens: 80 and 443, web publishes nothing"
  code=$(vault-curl /api/auth/setup -o /tmp/gate.json -w '%{http_code}' -X POST -H "Origin: $URL" -H 'Content-Type: application/json' \
    -d '{"email":"intruder@example.com","displayName":"x","password":"twelve-characters"}')
  [ "$code" = 403 ] && grep -q 'setup link' /tmp/gate.json || fail "setup without the link was not refused: $code $(cat /tmp/gate.json)"
  vault-curl "/setup?token=wrong" -D - -o /dev/null | grep -qi '^set-cookie: harbor_setup' && fail "a wrong token was given the setup cookie"
  vault-curl "/setup?token=$token" -D - -o /dev/null | grep -qi "^set-cookie: harbor_setup=$token" || fail "the setup link did not set the cookie"
  [ "$(vault-curl /api/auth/setup)" = '{"needed":true}' ] || fail "the refused attempt created an owner anyway"
  ok "setup refused without the link (403, with the reason), and the link opens the way"
fi
if [ "$ENCRYPTED" = 1 ]; then
  restart_policies_are_no
  ok "none of Harbor's containers restarts itself"
fi
if [ "$BUSY" = 1 ]; then
  other_service_untouched
  ok "other-service still running on 3000, its restart policy untouched"
fi

echo "── backups"
harbor backup >/tmp/backup.log 2>&1 || { cat /tmp/backup.log; fail "harbor backup"; }
harbor restore-test >/tmp/restore.log 2>&1 || { cat /tmp/restore.log; fail "harbor restore-test"; }
ok "harbor backup and harbor restore-test both succeed"
[ -f /srv/harbor-backup/config ] || fail "the restic repository is not at /srv/harbor-backup, the path that was given"
# Captured, then matched: piped, grep -q exits at the first match, break-glass dies of SIGPIPE on
# the lines after it, and pipefail calls the whole check a failure.
bg=$(harbor break-glass)
grep -q 'backups at *\/srv\/harbor-backup (on this machine)' <<<"$bg" || fail "break-glass does not say where the backups are: $bg"
ok "the repository is at /srv/harbor-backup, and break-glass says so"

[ "$ENCRYPTED" = 1 ] || exit 0
echo "── lock, then unlock"
# The database cluster's system identifier is minted once, by initdb. The same one after unlock
# means Postgres came back on the real database; a new one means it initialised an empty one on the
# bare mountpoint, which is the failure lock/unlock exists to prevent. No owner is created to prove
# it, so the first run is still there for a person to do in the browser.
before=$(cluster)
[ -n "$before" ] || fail "could not read the database's system identifier"
echo "$before" >/var/lib/harbor-test/cluster
kek=$(sha256sum /data/secrets/kek)
harbor lock >/dev/null
mountpoint -q /data && fail "/data is still mounted after harbor lock"
vault-curl /api/health -f >/dev/null 2>&1 && fail "the vault still answers while locked"
ok "locked: /data unmounted, nothing answering"
harbor unlock </root/harbor-luks-passphrase >/dev/null 2>&1 || fail "harbor unlock"
healthy || fail "the vault did not come back after harbor unlock"
[ "$(cluster)" = "$before" ] || fail "a different database after unlock ($(cluster), was $before) — it came back on an empty one"
[ "$(sha256sum /data/secrets/kek)" = "$kek" ] || fail "the master key changed across lock and unlock"
restart_policies_are_no
other_service_untouched
ok "unlocked with the passphrase: same database, same master key, still no self-restarts"
CHECKS
encrypted=$([ "$SPARE_DISK" = 1 ] && echo 1 || echo 0)
docker exec -e ENCRYPTED="$encrypted" -e BUSY="$BUSY" -e REACH="$REACH" "$NAME" bash /root/checks.sh || fail "the installed vault is not right"

# ---- a power cut, and a boot (systemd only) ------------------------------------------------------

if [ "$SYSTEMD" = 1 ]; then
  echo "── power cut, then a real boot"
  # SIGKILL to systemd is the plug pulled: nothing shuts down, nothing unmounts cleanly. The open
  # LUKS mapping lives in the VM's kernel and would survive the container, which a real power cut
  # does not allow — so it is closed from outside, as losing RAM would close it.
  docker kill -s KILL "$NAME" >/dev/null
  for _ in $(seq 1 10); do
    docker run --rm --platform "linux/$ARCH" --privileged -v /dev:/dev --entrypoint sh "$IMAGE" -c \
      "$CLOSE_VOLUME; [ ! -e /dev/mapper/harbordata ]" >/dev/null 2>&1 && break
    sleep 1
  done
  docker start "$NAME" >/dev/null
  wait_for 90 docker exec "$NAME" docker info || fail "the inner Docker daemon did not come back after the boot"
  docker exec "$NAME" sh -c 'for _ in $(seq 1 60); do s=$(systemctl is-system-running 2>/dev/null); case $s in running|degraded) exit 0;; esac; sleep 1; done; exit 1' \
    || fail "systemd did not finish booting"
  docker exec -i -e ENCRYPTED="$encrypted" -e BUSY="$BUSY" "$NAME" bash -s <<'BOOT'
set -euo pipefail
fail() { echo "FAIL: $*" >&2; exit 1; }
ok() { echo "   ✓ $*"; }
running=$(docker ps -q --filter label=com.docker.compose.project=harbor | wc -l)
if [ "$ENCRYPTED" = 1 ]; then
  [ "$running" = 0 ] || fail "$running of Harbor's containers started on their own, before the volume was unlocked"
  mountpoint -q /data && fail "/data is mounted after boot, though the volume unlocks by hand"
  lsattr -d /data | grep -q '^....i' || fail "the boot-time guard did not write-protect /data: $(lsattr -d /data)"
  mkdir /data/postgres 2>/dev/null && fail "something could write to the bare /data mountpoint"
  ok "booted with the vault closed: nothing started, /data empty and write-protected"
else
  [ "$running" -gt 0 ] || fail "nothing of Harbor came back after the boot"
  ok "booted, and the vault came back on its own (no volume to unlock)"
fi
if [ "$BUSY" = 1 ]; then
  [ "$(docker inspect -f '{{.State.Running}}' other-service)" = true ] || fail "other-service did not come back after the boot"
  ok "other-service came back on its own, as its owner set it to"
fi
BOOT
  if [ "$encrypted" = 1 ]; then
    docker exec "$NAME" sh -c 'harbor unlock </root/harbor-luks-passphrase >/dev/null 2>&1' || fail "harbor unlock after the boot"
  fi
  [ "$REACH" = internet ] || forward_port
  docker exec "$NAME" sh -c 'for _ in $(seq 1 150); do vault-curl /api/health -f >/dev/null && exit 0; sleep 2; done; exit 1' \
    || fail "the vault did not come back after the boot"
  if [ "$encrypted" = 1 ]; then
    after=$(pg 'select system_identifier from pg_control_system()')
    [ "$after" = "$(docker exec "$NAME" cat /var/lib/harbor-test/cluster)" ] || fail "a different database after the boot — the real one was not reattached"
    echo "   ✓ harbor unlock after the boot: same database, vault answering"
  else
    echo "   ✓ vault answering after the boot"
  fi
fi

if [ "$REACH" != internet ]; then
echo "── from this Mac"
wait_for 30 curl -sf "http://127.0.0.1:$PORT/api/health" || fail "the vault does not answer at http://127.0.0.1:$PORT from outside the machine"
[ "$(curl -s "http://127.0.0.1:$PORT/api/auth/setup")" = '{"needed":true}' ] || fail "the vault should still be waiting for its first owner"
code=$(docker exec "$NAME" harbor-test-code JBSWY3DPEHPK3PXP) && [[ "$code" =~ ^[0-9]{6}$ ]] || fail "harbor-test-code did not produce a code: $code"
echo "   ✓ the vault answers at http://127.0.0.1:$PORT with its first run waiting, and harbor-test-code works"
fi

echo "── test data"
if [ "$KEEP" = 1 ]; then
  # Asked, not assumed: an empty vault is what a real install leaves, and walking through that is
  # half of why anyone keeps the machine up.
  answer="${SEED:-}"
  if [ -z "$answer" ] && [ -t 0 ]; then
    read -r -p "   Fill the vault with test data — 23 invented documents, filed and in the Inbox? [y/N] " answer
  fi
  case "$answer" in
    [yY]*) wait_for_owner; seed_vault ;;
    *) echo "   none — the vault stays empty" ;;
  esac
  echo "install verified"
else
  # Nobody to sign up, so a throwaway owner — the machine is about to be removed anyway. Seeding
  # here is what keeps the test data working for the runs where someone does ask for it.
  # Through the setup cookie when Caddy guards setup — which is also the gate letting the right
  # browser through, the half of it the checks above could not prove without making an owner.
  docker exec "$NAME" sh -c "vault-curl /api/auth/setup -f -X POST -H \"Origin: \$(harbor url)\" -H 'Content-Type: application/json' \
    -b \"harbor_setup=\$(grep ^HARBOR_SETUP_TOKEN= /data/harbor.env | cut -d= -f2-)\" \
    -d '{\"email\":\"seed@example.com\",\"displayName\":\"Seed\",\"password\":\"install-test-password\"}'" >/dev/null \
    || fail "could not create an owner to seed for"
  seed_vault
  echo "install verified and removed"
fi
