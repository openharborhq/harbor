#!/usr/bin/env sh
# Harbor installer — from a machine with Docker to a running vault.
#
#   curl -fsSLO https://raw.githubusercontent.com/openharborhq/harbor/main/install.sh
#   less install.sh          # read it before running anything as root
#   sudo sh install.sh
#
# Run on a terminal it asks three questions and does the rest: fetches the compose files, generates
# the secrets, writes the configuration, pulls the images, starts the stack and installs a `harbor`
# command for everything afterwards. Safe to re-run — it never overwrites a secret or a config file
# — so it is also the upgrade.
#
# Every answer can be given up front instead, which is what makes it scriptable:
#
#   HARBOR_DATA_DIR   where documents, database and secrets live   (default /data, or ./harbor-data)
#   HARBOR_DIR        where the compose files live                 (default /opt/harbor, or ./harbor)
#   TS_AUTHKEY        a Tailscale auth key — with it, the vault is reachable only on your tailnet
#   HARBOR_BIND       without Tailscale, the address to publish on (default 127.0.0.1)
#   HARBOR_WEB_PORT   without Tailscale, the port to publish on    (default 3000)
#   HARBOR_IMAGE_TAG  which images to run                          (default latest)
#   HARBOR_PROJECT    the compose project name                     (default harbor)
#
# Read docs/deploy.md for the parts a script cannot do for you: the encrypted volume, the tailnet,
# and the printed page that is the only way back from a dead disk.
set -eu

say() { printf '\n\033[1m%s\033[0m\n' "$1"; }
info() { printf '  %s\n' "$1"; }
warn() { printf '  \033[33m! %s\033[0m\n' "$1" >&2; }
die() { printf '\n\033[31mstopped: %s\033[0m\n' "$1" >&2; exit 1; }

RAW=https://raw.githubusercontent.com/openharborhq/harbor/main

# ---- 1. what we are working with ------------------------------------------------------------

command -v docker >/dev/null 2>&1 || die "Docker is not installed. See https://docs.docker.com/engine/install/"
docker compose version >/dev/null 2>&1 || die "This Docker has no 'compose' subcommand. Install Docker Compose v2."
docker info >/dev/null 2>&1 || die "Cannot talk to the Docker daemon. Start it, or run this as a user in the docker group."

OS=$(uname -s)
if [ "$OS" = "Linux" ]; then
  HARBOR_DIR="${HARBOR_DIR:-/opt/harbor}"
  HARBOR_DATA_DIR="${HARBOR_DATA_DIR:-/data}"
else
  # A Mac or similar: fine for a look, not where a household's paperwork should live.
  HARBOR_DIR="${HARBOR_DIR:-$PWD/harbor}"
  HARBOR_DATA_DIR="${HARBOR_DATA_DIR:-$PWD/harbor-data}"
  warn "$OS is not a deployment target — no encrypted volume, no tailnet. Good for trying it out."
fi
HARBOR_IMAGE_TAG="${HARBOR_IMAGE_TAG:-latest}"
HARBOR_PROJECT="${HARBOR_PROJECT:-harbor}"
TS_AUTHKEY="${TS_AUTHKEY:-}"
HARBOR_BIND="${HARBOR_BIND:-127.0.0.1}"
HARBOR_WEB_PORT="${HARBOR_WEB_PORT:-3000}"

# ---- 1b. ask, when there is somebody to ask -----------------------------------------------------

# n8n's DigitalOcean guide is the bar here: nothing should require you to have read the docs first.
# Anything already set in the environment is taken as the answer and not asked about, so a
# scripted install stays silent and a person gets a conversation.
# /dev/tty alone is not the test: it is readable inside a container with no terminal attached, so
# the interview announced itself and then answered its own questions from the defaults. A terminal
# on stdin or stdout is the real signal, and it still catches `curl … | sh`, where stdin is the
# script but stdout is the person.
INTERACTIVE=0
if { [ -t 0 ] || [ -t 1 ]; } && [ -r /dev/tty ] && [ -z "${HARBOR_NONINTERACTIVE:-}" ] && [ ! -f "$HARBOR_DATA_DIR/harbor.env" ]; then
  INTERACTIVE=1
fi

ask() { # ask <prompt> <default>; answer on stdout
  _d=$2
  printf '  %s [%s] ' "$1" "$_d" >&2
  read -r _a </dev/tty || _a=""
  [ -n "$_a" ] && printf '%s' "$_a" || printf '%s' "$_d"
}

if [ "$INTERACTIVE" = 1 ]; then
  say "A few questions. Press enter to take the default."

  if [ -z "${HARBOR_DATA_DIR_SET:-}" ]; then
    printf '\n  Documents, database and secrets are written to one directory. On this box it should be\n'
    printf '  an encrypted volume — everything else is replaceable, this is not.\n'
    HARBOR_DATA_DIR=$(ask "Where should that live?" "$HARBOR_DATA_DIR")
  fi

  if [ -z "$TS_AUTHKEY" ]; then
    printf '\n  How will you reach it?\n'
    printf '    1) Over my tailnet, with HTTPS — nothing listens on this machine (recommended)\n'
    printf '    2) A port on this machine\n'
    case "$(ask "Which?" "1")" in
      1*)
        printf '\n  Paste a Tailscale auth key (admin console -> Settings -> Keys). Enable HTTPS\n'
        printf '  Certificates under DNS there first, or it has no certificate to serve.\n'
        TS_AUTHKEY=$(ask "Auth key" "")
        [ -n "$TS_AUTHKEY" ] && TAILSCALE_HOSTNAME=$(ask "Name it should take on your tailnet" "${TAILSCALE_HOSTNAME:-harbor}")
        [ -z "$TS_AUTHKEY" ] && warn "No key given — falling back to a local port."
        ;;
      *) ;;
    esac
    if [ -z "$TS_AUTHKEY" ]; then
      HARBOR_BIND=$(ask "Address to publish on (0.0.0.0 for the whole LAN)" "$HARBOR_BIND")
      HARBOR_WEB_PORT=$(ask "Port" "$HARBOR_WEB_PORT")
    fi
  fi

  if [ -z "${RESTIC_REPOSITORY:-}" ]; then
    printf '\n  Backups run nightly, encrypted, with a restore test once a month. Somewhere off this\n'
    printf '  box: b2:bucket:/path, sftp:user@host:/path, s3:..., or a path on a second disk.\n'
    printf '  Leave it empty to decide later — Settings will keep saying it is not configured.\n'
    RESTIC_REPOSITORY=$(ask "Backup repository" "")
  fi
fi

say "Harbor will be installed with:"
info "compose files   $HARBOR_DIR"
info "data + secrets  $HARBOR_DATA_DIR"
info "images          ghcr.io/openharborhq/harbor-*:$HARBOR_IMAGE_TAG"
[ -n "${RESTIC_REPOSITORY:-}" ] && info "backups to      $RESTIC_REPOSITORY" || info "backups         not configured yet"
if [ -n "$TS_AUTHKEY" ]; then
  info "reachable on    your tailnet, over HTTPS — nothing listens on this machine's interfaces"
else
  info "reachable on    http://$HARBOR_BIND:$HARBOR_WEB_PORT"
  [ "$HARBOR_BIND" = "0.0.0.0" ] && warn "HARBOR_BIND=0.0.0.0 publishes the vault to every network this machine is on."
fi

mkdir -p "$HARBOR_DIR" "$HARBOR_DATA_DIR"

# Create every bind-mount source before compose does. A path that does not exist when a container
# starts is created by Docker inside the VM, owned by root — and the app runs as uid 1000, so the
# first upload fails with EACCES and the vault looks broken for no visible reason. Found by
# installing from scratch and watching the seed fail to write its first file.
for sub in blobs tmp dumps backup postgres redis secrets tailscale; do
  mkdir -p "$HARBOR_DATA_DIR/$sub"
done
chmod 700 "$HARBOR_DATA_DIR/blobs" "$HARBOR_DATA_DIR/tmp" "$HARBOR_DATA_DIR/dumps" "$HARBOR_DATA_DIR/secrets"
# Postgres and Redis manage their own directories; the rest must belong to the app's user.
if [ "$(id -u)" = 0 ]; then
  chown 1000:1000 "$HARBOR_DATA_DIR/blobs" "$HARBOR_DATA_DIR/tmp" "$HARBOR_DATA_DIR/dumps" "$HARBOR_DATA_DIR/backup"
fi

# A compose project is identified by name alone. Running this a second time with a different data
# directory would quietly repoint the existing containers at it — the old vault's Postgres stops,
# the new empty one starts under the same names, and nothing says so. Found by doing exactly that
# to a development stack on the machine this was written on.
EXISTING=$(docker inspect "${HARBOR_PROJECT}-postgres-1" \
  --format '{{range .Mounts}}{{if eq .Destination "/var/lib/postgresql/data"}}{{.Source}}{{end}}{{end}}' 2>/dev/null || echo "")
if [ -n "$EXISTING" ] && [ "$EXISTING" != "$HARBOR_DATA_DIR/postgres" ]; then
  warn "A Harbor called '$HARBOR_PROJECT' already exists here, holding its data in:"
  warn "  $EXISTING"
  warn "You asked for $HARBOR_DATA_DIR/postgres, which is a different vault."
  die "Set HARBOR_DATA_DIR to the existing one to upgrade it, or HARBOR_PROJECT to something else for a second vault."
fi

# ---- 2. the encrypted volume ------------------------------------------------------------------

# Postgres holds the OCR text of every document in the clear, so "the blobs are encrypted" is not
# enough — the whole data directory belongs on an encrypted volume (docs/deploy.md, step 2).
if [ "$OS" = "Linux" ]; then
  if command -v findmnt >/dev/null 2>&1 && command -v lsblk >/dev/null 2>&1; then
    DEV=$(findmnt -n -o SOURCE --target "$HARBOR_DATA_DIR" 2>/dev/null || echo "")
    if [ -n "$DEV" ] && ! lsblk -n -s -o TYPE "$DEV" 2>/dev/null | grep -q "^crypt$"; then
      warn "$HARBOR_DATA_DIR is on $DEV, which is not an encrypted volume."
      warn "A stolen disk is then a readable copy of every document. See docs/deploy.md, step 2."
      if [ -z "${HARBOR_ALLOW_UNENCRYPTED_DATA:-}" ]; then
        # There is not always a terminal to ask on — piped, in CI, from a provisioning tool. An
        # unanswerable question must not become a crash, and the safe answer when nobody is there
        # to say otherwise is no.
        if [ -r /dev/tty ]; then
          printf '  Continue anyway? [y/N] '
          read -r reply </dev/tty || reply=n
        else
          reply=n
          warn "No terminal to ask on, so taking that as a no."
        fi
        case "$reply" in
          [yY]*) ;;
          *) die "Put $HARBOR_DATA_DIR on an encrypted volume (docs/deploy.md, step 2), or re-run with HARBOR_ALLOW_UNENCRYPTED_DATA=yes to accept the risk." ;;
        esac
      fi
    fi
  else
    warn "Cannot tell whether $HARBOR_DATA_DIR is encrypted (findmnt/lsblk missing)."
  fi
fi

# ---- 3. compose files -------------------------------------------------------------------------

say "Fetching compose files"
fetch() {
  if [ -f "$HARBOR_DIR/$1" ] && [ -n "${HARBOR_KEEP_LOCAL:-}" ]; then
    info "$1 (keeping the local copy)"
    return
  fi
  curl -fsSL "$RAW/infra/$1" -o "$HARBOR_DIR/$1" || die "could not download $1 from $RAW/infra/$1"
  info "$1"
}
fetch compose.yml
fetch compose.prod.yml
fetch check-data-volume.sh
FILES="-f compose.yml -f compose.prod.yml"
if [ -n "$TS_AUTHKEY" ]; then
  fetch compose.tailscale.yml
  fetch tailscale-serve.json
  FILES="$FILES -f compose.tailscale.yml"
fi

# ---- 4. secrets -------------------------------------------------------------------------------

# Generated once, never regenerated: the master key is the only thing that can decrypt the
# documents, and replacing it would orphan every one of them.
say "Secrets"
new_secret() {
  if [ -s "$HARBOR_DATA_DIR/secrets/$1" ]; then
    info "$1 (already exists — left alone)"
  else
    (umask 077; head -c 32 /dev/urandom | base64 > "$HARBOR_DATA_DIR/secrets/$1")
    info "$1 (created)"
  fi
}
new_secret kek
new_secret restic-password

# ---- 5. configuration -------------------------------------------------------------------------

ENV_FILE="$HARBOR_DATA_DIR/harbor.env"
if [ -f "$ENV_FILE" ]; then
  say "Configuration"
  info "$ENV_FILE already exists — left alone"
else
  say "Writing $ENV_FILE"
  {
    echo "HARBOR_DATA_DIR=$HARBOR_DATA_DIR"
    echo "HARBOR_IMAGE_TAG=$HARBOR_IMAGE_TAG"
    echo "OCR_LANGUAGES=${OCR_LANGUAGES:-eng+deu}"
    echo "OCR_CONCURRENCY=${OCR_CONCURRENCY:-2}"
    echo "TZ=${TZ:-UTC}"
    echo
    echo "# Suggestions (spec §5): none = nothing leaves the box. See .env.example for the alternatives."
    echo "SUGGEST_PROVIDER=${SUGGEST_PROVIDER:-none}"
    echo
    echo "# Backups (spec §3.4). Unset means no backups, and Settings will say so."
    echo "RESTIC_REPOSITORY=${RESTIC_REPOSITORY:-}"
    echo
    if [ -n "$TS_AUTHKEY" ]; then
      echo "TS_AUTHKEY=$TS_AUTHKEY"
      echo "TAILSCALE_HOSTNAME=${TAILSCALE_HOSTNAME:-harbor}"
      echo "WEB_ORIGIN=${WEB_ORIGIN:-https://${TAILSCALE_HOSTNAME:-harbor}.your-tailnet.ts.net}"
      echo "SESSION_COOKIE_SECURE=true"
    else
      echo "HARBOR_BIND=$HARBOR_BIND"
      echo "HARBOR_WEB_PORT=$HARBOR_WEB_PORT"
      echo "WEB_ORIGIN=${WEB_ORIGIN:-http://$HARBOR_BIND:$HARBOR_WEB_PORT}"
      echo "SESSION_COOKIE_SECURE=false"
    fi
  } > "$ENV_FILE"
  chmod 600 "$ENV_FILE"
  info "written — edit it and re-run this script to change anything"
fi

# ---- 6. start ---------------------------------------------------------------------------------

cd "$HARBOR_DIR"
dc() { docker compose -p "$HARBOR_PROJECT" --env-file "$ENV_FILE" $FILES "$@"; }

say "Pulling images (a few hundred MB the first time)"
dc pull --quiet || die "could not pull the images. If they are private, 'docker login ghcr.io' first."

say "Starting"
dc up -d || die "the stack did not start. 'docker compose -p $HARBOR_PROJECT --env-file $ENV_FILE $FILES logs' will say why."

printf '  waiting for the api'
i=0
while [ $i -lt 60 ]; do
  if dc logs api 2>/dev/null | grep -q "API listening"; then printf ' ready\n'; break; fi
  printf '.'; sleep 2; i=$((i + 1))
done
[ $i -lt 60 ] || { printf '\n'; die "the api did not come up. Check 'docker compose -p $HARBOR_PROJECT --env-file $ENV_FILE $FILES logs api'."; }

# ---- 6b. the harbor command ---------------------------------------------------------------------

# Everything after the install used to be a three-flag compose line nobody wants to remember or
# type twice. The wrapper holds the paths so the operator holds none of them.
CLI_DIR=/usr/local/bin
[ -w "$CLI_DIR" ] 2>/dev/null || CLI_DIR="$HARBOR_DIR"
cat > "$CLI_DIR/harbor" <<CLI
#!/usr/bin/env sh
# Harbor, on this machine. Written by install.sh — the paths below are this install's.
set -eu
cd "$HARBOR_DIR"
dc() { docker compose -p "$HARBOR_PROJECT" --env-file "$ENV_FILE" $FILES "\$@"; }

case "\${1:-help}" in
  status)  dc ps ;;
  logs)    shift; dc logs -f --tail=100 "\$@" ;;
  start)   dc up -d ;;
  stop)    dc stop ;;
  restart) dc restart "\${2:-}" ;;
  url)     grep '^WEB_ORIGIN=' "$ENV_FILE" | cut -d= -f2- ;;
  config)  \${EDITOR:-nano} "$ENV_FILE"; echo "run 'harbor upgrade' to apply"; ;;
  backup)      dc exec -T backup node dist/backup.js run backup ;;
  restore-test) dc exec -T backup node dist/backup.js run restore_test ;;
  seed)    dc exec -T api node dist/seed.js "\${2:-}" ;;
  invite)  echo "Invites are made in Settings -> Who can sign in." ;;
  upgrade)
    echo "Backing up first..."
    if grep -q '^RESTIC_REPOSITORY=.\+' "$ENV_FILE"; then
      dc exec -T backup node dist/backup.js run backup || { echo "backup failed — not upgrading"; exit 1; }
    else
      echo "  no backup repository configured; upgrading without one"
    fi
    dc pull && dc up -d
    echo "upgraded. 'harbor status' to see it, 'harbor logs api' if anything looks wrong."
    ;;
  break-glass)
    echo "Print this and keep it somewhere physical. There is no other copy."
    echo
    echo "  master key       \$(cat $HARBOR_DATA_DIR/secrets/kek)"
    echo "  backup password  \$(cat $HARBOR_DATA_DIR/secrets/restic-password)"
    _repo=\$(grep '^RESTIC_REPOSITORY=' "$ENV_FILE" | cut -d= -f2-)
    echo "  backups at       \${_repo:-NOT CONFIGURED — nothing is being backed up}"
    echo "  vault at         \$(grep '^WEB_ORIGIN=' "$ENV_FILE" | cut -d= -f2-)"
    echo "  restore guide    https://github.com/openharborhq/harbor/blob/main/docs/restore.md"
    ;;
  *)
    cat <<HELP
harbor — this vault, on this machine

  harbor status          what is running
  harbor logs [service]  follow the logs
  harbor url             where the vault is
  harbor upgrade         back up, pull the current images, restart
  harbor backup          back up now
  harbor restore-test    prove the backup can be read back
  harbor break-glass     print the keys for the envelope
  harbor config          edit the configuration
  harbor start | stop | restart [service]
  harbor seed            fill an empty vault with demo records
HELP
    ;;
esac
CLI
chmod 755 "$CLI_DIR/harbor"
say "Installed the 'harbor' command"
if [ "$CLI_DIR" = /usr/local/bin ]; then
  info "harbor status · harbor logs · harbor upgrade · harbor break-glass"
else
  info "$CLI_DIR/harbor (not on your PATH — /usr/local/bin was not writable)"
fi

# ---- 7. what to do next -----------------------------------------------------------------------

if [ -n "$TS_AUTHKEY" ]; then
  URL=$(grep '^WEB_ORIGIN=' "$ENV_FILE" | cut -d= -f2-)
  say "Harbor is running at $URL"
  info "If that name is wrong, 'docker compose -p $HARBOR_PROJECT --env-file $ENV_FILE $FILES exec tailscale tailscale status'"
  info "will tell you the real one — then fix WEB_ORIGIN in $ENV_FILE and run this again."
else
  say "Harbor is running at $(grep '^WEB_ORIGIN=' "$ENV_FILE" | cut -d= -f2-)"
fi

cat <<NEXT

  Next, in this order:

  1. Open it. The vault has no owner, so it asks you to create the first account, and
     shows an authenticator key and ten recovery codes once. Print the codes.

  2. Run 'harbor break-glass', print what it shows, and put it somewhere physical.
     Without it a dead disk means the documents are gone — that is the design, not
     an oversight.

  3. Prove the backups. 'harbor backup' then 'harbor restore-test' — both must say ok
     before you trust this box with anything. If you skipped the repository question,
     'harbor config' is where to add one.

  Day to day:

    harbor status          what is running
    harbor logs            follow everything, or 'harbor logs worker' for one
    harbor break-glass     print the keys for step 2
    harbor upgrade         back up, pull the current images, restart

NEXT
