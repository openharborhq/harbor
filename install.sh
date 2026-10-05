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
#   HARBOR_IMAGE_TAG  which release to run                        (default the current one)
#   HARBOR_PROJECT    the compose project name                     (default harbor)
#   HARBOR_CLI_DIR    where the `harbor` command goes              (default /usr/local/bin)
#
# Read docs/deploy.md for the parts a script cannot do for you: the encrypted volume, the tailnet,
# and the printed page that is the only way back from a dead disk.
set -eu

say() { printf '\n\033[1m%s\033[0m\n' "$1"; }
info() { printf '  %s\n' "$1"; }
warn() { printf '  \033[33m! %s\033[0m\n' "$1" >&2; }
die() { printf '\n\033[31mstopped: %s\033[0m\n' "$1" >&2; exit 1; }

RAW=https://raw.githubusercontent.com/openharborhq/harbor/main

# Defined up here, not with the compose files: the encrypted-volume step needs it first, and a
# shell function does not exist until the line that defines it has run. Defined lower down, saying
# yes to "Set up an encrypted volume now?" stopped the install with "fetch: not found".
fetch() {
  if [ -f "$HARBOR_DIR/$1" ] && [ -n "${HARBOR_KEEP_LOCAL:-}" ]; then
    info "$1 (keeping the local copy)"
    return
  fi
  curl -fsSL "$RAW/infra/$1" -o "$HARBOR_DIR/$1" || die "could not download $1 from $RAW/infra/$1"
  info "$1"
}

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
# A release, not `latest`. `latest` follows main, which is wherever development happens to be;
# an appliance should move between versions deliberately, when you choose to. `harbor config` to
# change it, then `harbor upgrade`.
HARBOR_IMAGE_TAG="${HARBOR_IMAGE_TAG:-v0.11.0}"
HARBOR_PROJECT="${HARBOR_PROJECT:-harbor}"
TS_AUTHKEY="${TS_AUTHKEY:-}"
HARBOR_DOMAIN="${HARBOR_DOMAIN:-}"
HARBOR_REACH="${HARBOR_REACH:-}"
# A re-run is also the upgrade, and has nobody to ask: how this vault is reached comes from the
# configuration it already has. Without this, a re-run without TS_AUTHKEY in the environment
# rewrote `harbor` with the tailnet overlay missing from its compose files.
if [ -f "$HARBOR_DATA_DIR/harbor.env" ]; then
  _env() { grep "^$1=" "$HARBOR_DATA_DIR/harbor.env" 2>/dev/null | cut -d= -f2- | head -1; }
  TS_AUTHKEY="${TS_AUTHKEY:-$(_env TS_AUTHKEY)}"
  HARBOR_DOMAIN="${HARBOR_DOMAIN:-$(_env HARBOR_DOMAIN)}"
  HARBOR_PROXY="${HARBOR_PROXY:-$(_env HARBOR_PROXY)}"
fi
# Tailscale on the host beats Tailscale in the stack: SSH over the tailnet then survives a Harbor
# that will not start, which is the moment you most need to reach the box. Installed only when the
# person says yes to it below — putting a VPN client on someone's machine is their decision.
HOST_TAILSCALE=0
USE_HOST_TS="${USE_HOST_TS:-0}"
if command -v tailscale >/dev/null 2>&1 && tailscale status >/dev/null 2>&1; then HOST_TAILSCALE=1; fi
HARBOR_BIND="${HARBOR_BIND:-127.0.0.1}"
HARBOR_WEB_PORT="${HARBOR_WEB_PORT:-3000}"
HARBOR_SHARE_PORT="${HARBOR_SHARE_PORT:-4010}"
# For a vault on the internet: `caddy` answers 80/443 itself with a Let's Encrypt certificate
# (compose.caddy.yml); `own` sits behind a reverse proxy already on this machine, which forwards
# to HARBOR_BIND:HARBOR_WEB_PORT.
HARBOR_PROXY="${HARBOR_PROXY:-caddy}"

# How the vault is reached, and the one question everything else about the network follows from.
#   tailnet   privately, on your Tailscale tailnet — optional, and only if you choose it
#   internet  directly, at a domain you own, over HTTPS
#   local     directly, on an address of this machine — your LAN, or a VPN you already run
# Given in the environment (HARBOR_REACH, or implied by TS_AUTHKEY, USE_HOST_TS or HARBOR_DOMAIN),
# it is not asked.
REACH_GIVEN=1
if [ -n "$HARBOR_REACH" ]; then :
elif [ -n "$TS_AUTHKEY" ] || [ "$USE_HOST_TS" = 1 ]; then HARBOR_REACH=tailnet
elif [ -n "$HARBOR_DOMAIN" ]; then HARBOR_REACH=internet
else HARBOR_REACH=local; REACH_GIVEN=0
fi

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

port_taken() { # port_taken <port>: something on this machine listens on it
  if command -v ss >/dev/null 2>&1; then
    ss -Hltn "sport = :$1" 2>/dev/null | grep -q .
  elif command -v lsof >/dev/null 2>&1; then
    lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1
  else
    return 1
  fi
}

# This machine's own address on its network: the source address of its default route, which is
# the LAN address on a home box and the private address on most cloud servers. Not 0.0.0.0, which
# would publish the vault on every network the machine is on, Docker's bridges included.
lan_address() {
  if command -v ip >/dev/null 2>&1; then
    ip -4 route get 1.1.1.1 2>/dev/null | sed -n 's/.* src \([0-9.]*\).*/\1/p' | head -1
  elif command -v route >/dev/null 2>&1 && command -v ipconfig >/dev/null 2>&1; then
    ipconfig getifaddr "$(route -n get default 2>/dev/null | awk '/interface:/{print $2}')" 2>/dev/null
  fi
}

# Installs and signs in the host's Tailscale, when asked to. Sets USE_HOST_TS=1 on success.
tailscale_on_host() {
  _ts_up=0
  if command -v tailscale >/dev/null 2>&1; then
    printf '\n  Tailscale is installed on this machine but not signed in.\n'
    case "$(ask "Sign this machine in to Tailscale now? [y/n]" "y")" in
      [yY]*) _ts_up=1 ;;
    esac
  else
    printf '\n  Tailscale is not installed here. I can install it with the official script\n'
    printf '  (tailscale.com/install.sh) and sign this machine in. You need a Tailscale account;\n'
    printf '  you can create one when you sign in.\n'
    case "$(ask "Install Tailscale on this machine? [y/n]" "y")" in
      [yY]*)
        say "Installing Tailscale"
        if curl -fsSL https://tailscale.com/install.sh | sh; then
          _ts_up=1
        else
          warn "The Tailscale install did not finish."
        fi
        ;;
    esac
  fi
  if [ "$_ts_up" = 1 ]; then
    say "Signing this machine in to Tailscale"
    info "Open the link it prints, on any device, and sign in. This waits up to ten minutes."
    if tailscale up --timeout=10m </dev/tty && tailscale status >/dev/null 2>&1; then
      HOST_TAILSCALE=1; USE_HOST_TS=1
      printf '\n  One more step in the Tailscale admin console, once per tailnet: DNS -> HTTPS\n'
      printf '  Certificates -> Enable. Without it there is no certificate to serve the vault with.\n'
      printf '  Press enter when that is done. ' >&2
      read -r _ </dev/tty || true
    else
      warn "Tailscale is not signed in."
    fi
  fi
}

if [ "$INTERACTIVE" = 1 ]; then
  say "A few questions. Press enter to take the default."

  if [ -z "${HARBOR_DATA_DIR_SET:-}" ]; then
    printf '\n  Documents, database and secrets are written to one directory. On this box it should be\n'
    printf '  an encrypted volume — everything else is replaceable, this is not.\n'
    HARBOR_DATA_DIR=$(ask "Where should that live?" "$HARBOR_DATA_DIR")
  fi

  if [ "$REACH_GIVEN" = 0 ]; then
    printf '\n  How should you reach Harbor?\n'
    printf '    1) Privately, through Tailscale — only your own devices, over HTTPS, from anywhere.\n'
    printf '       Nothing on this machine is open to the internet. Needs a Tailscale account.\n'
    printf '    2) Directly, on the internet — at a domain you own, over HTTPS (Let'"'"'s Encrypt).\n'
    printf '       For a cloud server: the domain must point here, and ports 80 and 443 be open.\n'
    printf '    3) Directly, on your own network — http://<this machine>:<port>, no HTTPS.\n'
    printf '       The simplest at home; every device on the network can reach the sign-in page.\n'
    # Tailscale is the default only where it is already running: choosing it should never be what
    # pressing enter does to someone who has not got an account.
    _def=3; [ "$HOST_TAILSCALE" = 1 ] && _def=1
    case "$(ask "Which?" "$_def")" in
      1*) HARBOR_REACH=tailnet ;;
      2*) HARBOR_REACH=internet ;;
      *)  HARBOR_REACH=local ;;
    esac
  fi

  if [ "$HARBOR_REACH" = tailnet ] && [ -z "$TS_AUTHKEY" ] && [ "$USE_HOST_TS" = 0 ]; then
    if [ "$HOST_TAILSCALE" = 1 ]; then
      info "Tailscale is already running here: I will point it at the vault with 'tailscale serve'."
      USE_HOST_TS=1
    elif [ "$OS" = Linux ] && [ "$(id -u)" = 0 ]; then
      tailscale_on_host
    fi
    if [ "$USE_HOST_TS" = 0 ]; then
      printf '\n  Tailscale can also run as one of Harbor'"'"'s containers, with an auth key (admin\n'
      printf '  console -> Settings -> Keys; enable HTTPS Certificates under DNS first). It works,\n'
      printf '  but if an upgrade breaks the stack your way in goes with it.\n'
      TS_AUTHKEY=$(ask "Auth key (empty to reach it on your own network instead)" "")
      if [ -n "$TS_AUTHKEY" ]; then
        TAILSCALE_HOSTNAME=$(ask "Name it should take on your tailnet" "${TAILSCALE_HOSTNAME:-harbor}")
      else
        warn "No Tailscale — reaching it on your own network instead."
        HARBOR_REACH=local
      fi
    fi
  fi

  if [ "$HARBOR_REACH" = internet ]; then
    printf '\n  The domain needs a DNS record (A, or AAAA) pointing at this machine'"'"'s public address.\n'
    while [ -z "$HARBOR_DOMAIN" ]; do HARBOR_DOMAIN=$(ask "Domain for Harbor, e.g. harbor.example.com" ""); done
    if port_taken 80 || port_taken 443; then
      printf '\n  Something here already answers on port 80 or 443 — usually a reverse proxy (Nginx\n'
      printf '  Proxy Manager, Traefik, Caddy). Harbor will sit behind it instead of beside it.\n'
      HARBOR_PROXY=own
      HARBOR_WEB_PORT=$(ask "Port your proxy should forward to" "$HARBOR_WEB_PORT")
    fi
  fi

  if [ "$HARBOR_REACH" = local ]; then
    _lan=$(lan_address)
    printf '\n  This machine'"'"'s address on its network looks like %s. A VPN address works too.\n' "${_lan:-(not found)}"
    printf '  127.0.0.1 keeps it to this machine alone — reach it through an SSH tunnel.\n'
    HARBOR_BIND=$(ask "Address to publish on" "${_lan:-$HARBOR_BIND}")
    HARBOR_WEB_PORT=$(ask "Port" "$HARBOR_WEB_PORT")
  fi

  if [ -z "${RESTIC_REPOSITORY:-}" ]; then
    printf '\n  Backups run nightly, encrypted, with a restore test once a month. Somewhere off this\n'
    printf '  box: b2:bucket:/path, sftp:user@host:/path, s3:..., or a path on a second disk.\n'
    printf '  Leave it empty to decide later — Settings will keep saying it is not configured.\n'
    RESTIC_REPOSITORY=$(ask "Backup repository" "")
  fi
fi
[ "$USE_HOST_TS" = 1 ] && HARBOR_BIND=127.0.0.1
[ "$HARBOR_REACH" = internet ] && HARBOR_BIND=127.0.0.1
[ "$HARBOR_REACH" = internet ] && [ -z "$HARBOR_DOMAIN" ] && die "HARBOR_REACH=internet needs HARBOR_DOMAIN, the domain to serve the vault at."
CADDY=0; [ "$HARBOR_REACH" = internet ] && [ "$HARBOR_PROXY" = caddy ] && CADDY=1

# ---- 1c. ports nobody else is using -----------------------------------------------------------------

# A box that already runs other things — a home server, a VPS with a dashboard on it — often has
# something on 3000 already. Compose only found out at `up`, and the install stopped with "port is
# already allocated" after the images were pulled. Asked again here instead, or refused up front
# when there is nobody to ask. Only on a fresh install: on a re-run the ports are Harbor's own.
if [ ! -f "$HARBOR_DATA_DIR/harbor.env" ]; then
  if [ "$CADDY" = 1 ]; then
    for _p in 80 443; do
      port_taken "$_p" && die "Port $_p is taken — by a reverse proxy, most likely. Run again with HARBOR_PROXY=own to sit behind it."
    done
  elif [ -z "$TS_AUTHKEY" ]; then
    while port_taken "$HARBOR_WEB_PORT"; do
      _free=$((HARBOR_WEB_PORT + 1))
      while port_taken "$_free"; do _free=$((_free + 1)); done
      warn "Something on this machine already listens on port $HARBOR_WEB_PORT."
      [ "$INTERACTIVE" = 1 ] || die "Set HARBOR_WEB_PORT to a free port ($_free is) and run this again."
      HARBOR_WEB_PORT=$(ask "Port for Harbor instead" "$_free")
    done
  fi
  # The share doorman publishes a loopback port too, and a second Harbor on the machine — a trial
  # beside a real one — already holds 4010: the install stopped at `up` with "port is already
  # allocated", the failure the check above exists to prevent. Nobody types this port, so it
  # moves to a free one without asking.
  while port_taken "$HARBOR_SHARE_PORT" || [ "$HARBOR_SHARE_PORT" = "$HARBOR_WEB_PORT" ]; do
    HARBOR_SHARE_PORT=$((HARBOR_SHARE_PORT + 1))
  done
fi

# Whoever reaches /setup first becomes the owner. On the open internet that cannot be left to a
# race, so the vault accepts its first owner only from a browser that came through a link with
# this token in it — enforced by Caddy (Caddyfile), in front of everything, before an account
# exists. Printed once at the end, kept in harbor.env.
HARBOR_SETUP_TOKEN="${HARBOR_SETUP_TOKEN:-}"
if [ "$CADDY" = 1 ] && [ -z "$HARBOR_SETUP_TOKEN" ]; then
  HARBOR_SETUP_TOKEN=$(head -c 48 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 32)
fi
if [ "$HARBOR_REACH" = internet ] && command -v getent >/dev/null 2>&1 && ! getent hosts "$HARBOR_DOMAIN" >/dev/null 2>&1; then
  warn "$HARBOR_DOMAIN does not resolve yet. Point its DNS record at this machine; the certificate is issued once it does."
fi

say "Harbor will be installed with:"
info "compose files   $HARBOR_DIR"
info "data + secrets  $HARBOR_DATA_DIR"
info "images          ghcr.io/openharborhq/harbor-*:$HARBOR_IMAGE_TAG"
# A repository on this machine is a path here, but the backup container only ever sees it as
# /backup: compose mounts HARBOR_BACKUP_DIR there (docs/deploy.md, step 5). Nothing used to make
# that translation, so a path answer reached restic as a directory that did not exist inside the
# container, and HARBOR_BACKUP_DIR fell back to compose's dev default — ../data/backup from
# /opt/harbor, which Docker created as root on the system disk. The first backup failed with
# "permission denied". Found by scripts/install-test.sh. Given explicitly, both are taken as they are.
if [ -z "${HARBOR_BACKUP_DIR:-}" ]; then
  case "${RESTIC_REPOSITORY:-}" in
    /*) HARBOR_BACKUP_DIR=$RESTIC_REPOSITORY; RESTIC_REPOSITORY=/backup ;;
    *)  HARBOR_BACKUP_DIR=$HARBOR_DATA_DIR/backup ;;
  esac
fi
if [ "${RESTIC_REPOSITORY:-}" = /backup ]; then
  info "backups to      $HARBOR_BACKUP_DIR, on this machine"
elif [ -n "${RESTIC_REPOSITORY:-}" ]; then
  info "backups to      $RESTIC_REPOSITORY"
else
  info "backups         not configured yet"
fi
if [ "$USE_HOST_TS" = 1 ]; then
  info "reachable on    your tailnet, served by the Tailscale already on this host"
elif [ "$CADDY" = 1 ]; then
  info "reachable on    https://$HARBOR_DOMAIN — on the internet, certificate from Let's Encrypt"
elif [ "$HARBOR_REACH" = internet ]; then
  info "reachable on    https://$HARBOR_DOMAIN, through your reverse proxy → http://127.0.0.1:$HARBOR_WEB_PORT"
elif [ -n "$TS_AUTHKEY" ]; then
  info "reachable on    your tailnet, over HTTPS — nothing listens on this machine's interfaces"
else
  info "reachable on    http://$HARBOR_BIND:$HARBOR_WEB_PORT"
  [ "$HARBOR_BIND" = "0.0.0.0" ] && warn "HARBOR_BIND=0.0.0.0 publishes the vault to every network this machine is on."
fi

mkdir -p "$HARBOR_DIR" "$HARBOR_DATA_DIR"

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
      if [ "$INTERACTIVE" = 1 ] && [ "$(id -u)" = 0 ]; then
        printf '  I can set one up: one disk becomes an encrypted volume mounted at %s.\n' "$HARBOR_DATA_DIR"
        printf '  It erases that disk, asks which one, and asks how it should unlock afterwards.\n'
        case "$(ask "Set up an encrypted volume now?" "y")" in
          [yY]*)
            # A minimal Debian has neither; encrypt-disk.sh would stop and name them. They were
            # asked for just now, so install them rather than send the person off to do it.
            if ! command -v cryptsetup >/dev/null 2>&1 || ! command -v sgdisk >/dev/null 2>&1; then
              if command -v apt-get >/dev/null 2>&1; then
                info "installing cryptsetup and gdisk"
                { apt-get update -qq && apt-get install -y -qq cryptsetup gdisk; } >/dev/null \
                  || die "could not install cryptsetup and gdisk."
              fi
            fi
            fetch encrypt-disk.sh
            HARBOR_DATA_DIR="$HARBOR_DATA_DIR" sh "$HARBOR_DIR/encrypt-disk.sh" || die "the encrypted volume was not created."
            # It is mounted now; the check below should pass on the second look.
            DEV=$(findmnt -n -o SOURCE --target "$HARBOR_DATA_DIR" 2>/dev/null || echo "")
            ;;
        esac
      fi
      if lsblk -n -s -o TYPE "$DEV" 2>/dev/null | grep -q "^crypt$"; then
        info "$HARBOR_DATA_DIR is on an encrypted volume"
      elif [ -z "${HARBOR_ALLOW_UNENCRYPTED_DATA:-}" ]; then
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

# Create every bind-mount source before compose does. A path that does not exist when a container
# starts is created by Docker inside the VM, owned by root — and the app runs as uid 1000, so the
# first upload fails with EACCES and the vault looks broken for no visible reason. Found by
# installing from scratch and watching the seed fail to write its first file.
#
# After the encrypted volume, never before it. Made first, these landed on the system disk and the
# new volume was mounted over them: secrets/ vanished from under the next step, and a stale
# postgres/ was left beneath the mountpoint for a locked-volume boot to initialise into.
for sub in blobs tmp dumps backup postgres redis secrets tailscale caddy; do
  mkdir -p "$HARBOR_DATA_DIR/$sub"
done
chmod 700 "$HARBOR_DATA_DIR/blobs" "$HARBOR_DATA_DIR/tmp" "$HARBOR_DATA_DIR/dumps" "$HARBOR_DATA_DIR/secrets"
# Postgres and Redis manage their own directories; the rest must belong to the app's user.
mkdir -p "$HARBOR_BACKUP_DIR"
if [ "$(id -u)" = 0 ]; then
  chown 1000:1000 "$HARBOR_DATA_DIR/blobs" "$HARBOR_DATA_DIR/tmp" "$HARBOR_DATA_DIR/dumps" "$HARBOR_DATA_DIR/backup" "$HARBOR_BACKUP_DIR"
fi
# Allowed, because it still catches a deleted folder or a bad upgrade — but it is not what the
# question was asking for, and a dead disk takes the vault and its backups together.
if [ "${RESTIC_REPOSITORY:-}" = /backup ] && command -v findmnt >/dev/null 2>&1 \
  && [ "$(findmnt -n -o SOURCE --target "$HARBOR_BACKUP_DIR")" = "$(findmnt -n -o SOURCE --target "$HARBOR_DATA_DIR")" ]; then
  warn "Backups to $HARBOR_BACKUP_DIR are on the same disk as the vault: they will not survive that disk failing."
fi

# ---- 3. compose files -------------------------------------------------------------------------

say "Fetching compose files"
fetch compose.yml
fetch compose.prod.yml
fetch check-data-volume.sh
# Not added to FILES: the share node is only ever brought up by `harbor public enable`, which adds
# this overlay itself. Fetched by every install all the same, and not only the ones that run
# Tailscale in the stack — the share node brings its own, and asks for a login URL rather than an
# auth key, so it works just as well beside a Tailscale on the host. Gated on TS_AUTHKEY it was
# missing on exactly the installs the docs recommend, and `harbor public enable` failed on a file
# that had never been downloaded (2026-09-15).
fetch compose.share-funnel.yml
fetch tailscale-share-serve.json
FILES="-f compose.yml -f compose.prod.yml"
if [ -n "$TS_AUTHKEY" ]; then
  fetch compose.tailscale.yml
  fetch tailscale-serve.json
  FILES="$FILES -f compose.tailscale.yml"
fi
if [ "$OS" != Linux ]; then
  fetch compose.desktop.yml
  FILES="$FILES -f compose.desktop.yml"
fi
if [ "$CADDY" = 1 ]; then
  fetch compose.caddy.yml
  fetch Caddyfile
  FILES="$FILES -f compose.caddy.yml"
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
# Compose bind-mounts these into /run/secrets with the host's ownership, and the containers run as
# uid 1000 — so root-owned 0600 secrets mean the api cannot read the master key and every service
# crash-loops on "Cannot read the master key file". Docker Desktop maps ownership away and hides
# this; the first install on real Linux found it immediately. Readable by that uid and nobody else.
if [ "$(id -u)" = 0 ]; then
  chown 1000:1000 "$HARBOR_DATA_DIR/secrets/kek" "$HARBOR_DATA_DIR/secrets/restic-password"
  chmod 400 "$HARBOR_DATA_DIR/secrets/kek" "$HARBOR_DATA_DIR/secrets/restic-password"
fi

# ---- 5. configuration -------------------------------------------------------------------------

ENV_FILE="$HARBOR_DATA_DIR/harbor.env"
if [ -f "$ENV_FILE" ]; then
  say "Configuration"
  info "$ENV_FILE already exists — left alone"
  # Switching to the internet later is `harbor config` (HARBOR_DOMAIN) and a re-run of this. The
  # file is otherwise never touched, but Caddy will not start without a setup token, so that one
  # line is added when it is missing.
  if [ "$CADDY" = 1 ] && ! grep -q '^HARBOR_SETUP_TOKEN=.' "$ENV_FILE"; then
    printf '\n# Only a browser that came through the setup link may create the first owner (Caddyfile).\nHARBOR_SETUP_TOKEN=%s\n' "$HARBOR_SETUP_TOKEN" >> "$ENV_FILE"
    info "added a setup token for the first owner"
  fi
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
    echo "# Mounted into the backup container as /backup — used when RESTIC_REPOSITORY=/backup."
    echo "HARBOR_BACKUP_DIR=$HARBOR_BACKUP_DIR"
    echo
    if [ "$HARBOR_SHARE_PORT" != 4010 ]; then
      echo "# 4010 was taken on this machine; share links point at the doorman's port instead."
      echo "HARBOR_SHARE_PORT=$HARBOR_SHARE_PORT"
      echo "SHARE_ORIGIN=${SHARE_ORIGIN:-http://localhost:$HARBOR_SHARE_PORT}"
      echo
    fi
    if [ "$USE_HOST_TS" = 1 ]; then
      echo "HARBOR_BIND=127.0.0.1"
      echo "HARBOR_WEB_PORT=$HARBOR_WEB_PORT"
      echo "WEB_ORIGIN=${WEB_ORIGIN:-https://$(tailscale status --json 2>/dev/null | sed -n 's/.*"DNSName":"\([^".]*\.[^"]*\)\.".*/\1/p' | head -1)}"
      echo "SESSION_COOKIE_SECURE=true"
    elif [ -n "$TS_AUTHKEY" ]; then
      echo "TS_AUTHKEY=$TS_AUTHKEY"
      echo "TAILSCALE_HOSTNAME=${TAILSCALE_HOSTNAME:-harbor}"
      echo "WEB_ORIGIN=${WEB_ORIGIN:-https://${TAILSCALE_HOSTNAME:-harbor}.your-tailnet.ts.net}"
      echo "SESSION_COOKIE_SECURE=true"
    elif [ "$HARBOR_REACH" = internet ]; then
      echo "HARBOR_DOMAIN=$HARBOR_DOMAIN"
      echo "# caddy: Harbor answers 80/443 itself. own: your reverse proxy forwards to the port below."
      echo "HARBOR_PROXY=$HARBOR_PROXY"
      echo "HARBOR_BIND=127.0.0.1"
      echo "HARBOR_WEB_PORT=$HARBOR_WEB_PORT"
      echo "WEB_ORIGIN=${WEB_ORIGIN:-https://$HARBOR_DOMAIN}"
      echo "SESSION_COOKIE_SECURE=true"
      if [ "$CADDY" = 1 ]; then
        echo "# Only a browser that came through the setup link may create the first owner (Caddyfile)."
        echo "HARBOR_SETUP_TOKEN=$HARBOR_SETUP_TOKEN"
        [ -n "${HARBOR_CADDY_GLOBAL:-}" ] && echo "HARBOR_CADDY_GLOBAL=$HARBOR_CADDY_GLOBAL"
      fi
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

# ---- 6a. host tailscale, pointed at the vault ---------------------------------------------------

if [ "$USE_HOST_TS" = 1 ]; then
  say "Serving it on your tailnet"
  if tailscale serve --bg --https=443 "http://127.0.0.1:$HARBOR_WEB_PORT" >/dev/null 2>&1; then
    info "tailscale serve → 127.0.0.1:$HARBOR_WEB_PORT"
    info "$(tailscale serve status 2>/dev/null | head -3 | tr '\n' ' ')"
  else
    warn "Could not configure 'tailscale serve'. Enable HTTPS Certificates in the Tailscale admin"
    warn "console (DNS -> HTTPS Certificates), then run:"
    warn "  sudo tailscale serve --bg --https=443 http://127.0.0.1:$HARBOR_WEB_PORT"
  fi
fi

# With a manually unlocked volume, nothing may come back on its own: a container Docker restarts
# at boot resolves its bind mounts while the volume is still closed, and either writes to the
# empty mountpoint or serves an empty vault. `harbor unlock` is the only thing that should start
# it. Found by rebooting a working appliance and watching Postgres create a second database.
if [ -f /etc/harbor/unlock-mode ] && [ "$(cat /etc/harbor/unlock-mode)" = manual ]; then
  ids=$(dc ps -q 2>/dev/null || true)
  if [ -n "$ids" ]; then
    docker update --restart=no $ids >/dev/null 2>&1 || true
    say "This vault does not start itself"
    info "the volume is unlocked by hand, so 'harbor unlock' is what brings it up after a reboot"
  fi
fi

# ---- 6b. the harbor command ---------------------------------------------------------------------

# Everything after the install used to be a three-flag compose line nobody wants to remember or
# type twice. The wrapper holds the paths so the operator holds none of them.
#
# Where it goes: somewhere already on the PATH, so `harbor status` works as typed. /usr/local/bin
# as root on Linux. On a Mac that directory usually does not exist, and the command used to end up
# inside the install folder, where `harbor status` answered "command not found" (2026-10-05) — so
# a user's own bin directory comes next, but only one the PATH already includes: putting it
# somewhere the shell does not look would be the same failure with extra steps.
# HARBOR_CLI_DIR for a trial install that must not replace the `harbor` a real one put on the PATH.
on_path() { case ":$PATH:" in *":$1:"*) return 0 ;; esac; return 1; }
pick_cli_dir() {
  if [ -n "${HARBOR_CLI_DIR:-}" ]; then
    mkdir -p "$HARBOR_CLI_DIR" 2>/dev/null || true
    [ -w "$HARBOR_CLI_DIR" ] && { echo "$HARBOR_CLI_DIR"; return; }
  else
    [ -d /usr/local/bin ] && [ -w /usr/local/bin ] && { echo /usr/local/bin; return; }
    for _d in "$HOME/.local/bin" "$HOME/bin"; do
      on_path "$_d" || continue
      mkdir -p "$_d" 2>/dev/null || continue
      [ -w "$_d" ] && { echo "$_d"; return; }
    done
  fi
  echo "$HARBOR_DIR"
}
CLI_DIR=$(pick_cli_dir)
fetch harbor-cli.sh
write_cli() {
  # One substitution pass over infra/harbor-cli.sh. The paths belong to this install; the script
  # does not, which is what lets `harbor upgrade` rewrite it later with a newer one.
  sed -e "s|@HARBOR_DIR@|$HARBOR_DIR|g" \
      -e "s|@HARBOR_PROJECT@|$HARBOR_PROJECT|g" \
      -e "s|@ENV_FILE@|$ENV_FILE|g" \
      -e "s|@FILES@|$FILES|g" \
      -e "s|@HARBOR_DATA_DIR@|$HARBOR_DATA_DIR|g" \
      -e "s|@RAW@|$RAW|g" \
      "$HARBOR_DIR/harbor-cli.sh" > "$1"
}
write_cli "$CLI_DIR/harbor"
chmod 755 "$CLI_DIR/harbor"
say "Installed the 'harbor' command"
if on_path "$CLI_DIR"; then
  info "harbor status · harbor logs · harbor upgrade · harbor break-glass"
  [ "$CLI_DIR" = /usr/local/bin ] || info "(in $CLI_DIR)"
else
  info "$CLI_DIR/harbor — not on your PATH, so type it in full: $CLI_DIR/harbor status"
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
if [ "$CADDY" = 1 ]; then
  _token=$(grep '^HARBOR_SETUP_TOKEN=' "$ENV_FILE" | cut -d= -f2-)
  info "Create your account through this link — the vault takes its first owner from nowhere else:"
  info ""
  info "  https://$HARBOR_DOMAIN/setup?token=$_token"
  info ""
  info "The certificate is issued on the first visit, once $HARBOR_DOMAIN points here and ports 80"
  info "and 443 are open. 'harbor logs caddy' says why, if it is not."
elif [ "$HARBOR_REACH" = internet ]; then
  info "Point your reverse proxy at http://127.0.0.1:$HARBOR_WEB_PORT for https://$HARBOR_DOMAIN."
  warn "Until your account exists, whoever opens https://$HARBOR_DOMAIN first can create it. Do it now."
elif [ "$HARBOR_BIND" != 127.0.0.1 ] && [ -z "$TS_AUTHKEY" ] && [ "$USE_HOST_TS" = 0 ]; then
  info "Create your account now: until it exists, whoever on this network opens it first can."
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
    harbor upgrade [ver]   back up, move to the newest release (or the one named), restart

NEXT
