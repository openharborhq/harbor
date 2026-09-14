#!/usr/bin/env sh
# Harbor, on this machine.
#
# This file is a TEMPLATE. `install.sh` and `harbor upgrade` both write it out with the
# placeholders below filled in for this install:
#
#   @HARBOR_DIR@       where the compose files live
#   @HARBOR_PROJECT@   the compose project name
#   @ENV_FILE@         the environment file compose reads
#   @FILES@            the -f flags for this install's overlays
#   @HARBOR_DATA_DIR@  the data volume
#   @RAW@              where to fetch infra files from
#
# It used to be a heredoc inside install.sh, which meant a new subcommand could only ever reach a
# box by reinstalling it: `harbor upgrade` pulls images and has never rewritten this file. Pulling
# it out is what lets an upgrade deliver a change to the stack, not just to the code inside it.
set -eu
cd "@HARBOR_DIR@"
dc() { docker compose -p "@HARBOR_PROJECT@" --env-file "@ENV_FILE@" @FILES@ "$@"; }

case "${1:-help}" in
  status)  dc ps ;;
  logs)    shift; dc logs -f --tail=100 "$@" ;;
  start)   dc up -d ;;
  stop)    dc stop ;;
  # "${2:-}" expands to an empty argument when no service is named, and compose answers
  # "no such service: ". No argument at all is what means "all of them".
  restart) shift; if [ $# -gt 0 ]; then dc restart "$@"; else dc restart; fi ;;
  url)     grep '^WEB_ORIGIN=' "@ENV_FILE@" | cut -d= -f2- ;;
  version)
    echo "configured tag: $(grep '^HARBOR_IMAGE_TAG=' "@ENV_FILE@" | cut -d= -f2-)"
    echo "running:        $(dc exec -T api sh -c 'echo $HARBOR_VERSION' 2>/dev/null || echo 'not running')"
    ;;
  config)  ${EDITOR:-nano} "@ENV_FILE@"; echo "run 'harbor upgrade' to apply"; ;;
  backup)      dc exec -T backup node dist/backup.js run backup ;;
  restore-test) dc exec -T backup node dist/backup.js run restore_test ;;
  seed)    shift; dc exec -T api node dist/seed.js "$@" ;;
  invite)  echo "Invites are made in Settings -> Who can sign in." ;;
  upgrade)
    # `harbor upgrade` goes to the newest release; `harbor upgrade v0.1.9` goes exactly there.
    # Nobody should have to hand-edit a tag in a config file to take an update.
    _want="${2:-}"
    if [ -z "$_want" ]; then
      printf 'Looking up the newest release... '
      _want=$(curl -fsS --max-time 10 -H 'accept: application/vnd.github+json' \
        https://api.github.com/repos/openharborhq/harbor/tags 2>/dev/null \
        | grep -o '"name": *"v[0-9]*\.[0-9]*\.[0-9]*"' | sed 's/.*"\(v[^"]*\)"/\1/' \
        | sort -t. -k1.2,1n -k2,2n -k3,3n | tail -1)
      if [ -z "$_want" ]; then
        echo "could not reach GitHub."
        echo "Name the version instead: harbor upgrade v0.2.0"
        exit 1
      fi
      echo "$_want"
    fi
    _have=$(grep '^HARBOR_IMAGE_TAG=' "@ENV_FILE@" | cut -d= -f2-)
    if [ "$_want" = "$_have" ]; then
      echo "already on $_have — nothing to do"
      exit 0
    fi
    echo "$_have -> $_want"
    echo "Backing up first..."
    if grep -q '^RESTIC_REPOSITORY=.\+' "@ENV_FILE@"; then
      dc exec -T backup node dist/backup.js run backup || { echo "backup failed — not upgrading"; exit 1; }
    else
      echo "  no backup repository configured; upgrading without one"
    fi
    _before=$(dc exec -T api sh -c 'echo $HARBOR_VERSION' 2>/dev/null || echo unknown)
    # Pull first, write the tag second. The shell variable outranks the env file for compose, so
    # the pull already uses the wanted tag; a pull that fails — a release whose images CI has not
    # published yet — must not leave the configuration claiming a version that never arrived,
    # or the next 'harbor upgrade' says "already on it" and does nothing (2026-09-12).
    HARBOR_IMAGE_TAG="$_want" dc pull || { echo "could not pull $_want — are its images published yet? Nothing was changed."; exit 1; }

    # Images are only half of a release. A change to the stack — a new service, a new overlay, a
    # new subcommand here — used to be undeliverable to an installed box, because an upgrade
    # rewrote neither the compose files nor this script. Both are refreshed for the tag being
    # moved to, before anything is restarted.
    #
    # HARBOR_KEEP_LOCAL is honoured: a box whose compose has been edited by hand keeps its edits
    # and is told which files were skipped, rather than having them silently replaced.
    _raw="@RAW@"
    case "$_want" in v*) _raw=$(echo "@RAW@" | sed "s|/main$|/$_want|") ;; esac
    _kept=""
    for _f in compose.yml compose.prod.yml compose.tailscale.yml tailscale-serve.json tailscale-share-serve.json harbor-cli.sh check-data-volume.sh; do
      if [ -f "@HARBOR_DIR@/$_f" ] && [ -n "${HARBOR_KEEP_LOCAL:-}" ]; then _kept="$_kept $_f"; continue; fi
      # A file this install never had is not an error: overlays depend on how it was set up.
      curl -fsSL "$_raw/infra/$_f" -o "@HARBOR_DIR@/$_f.new" 2>/dev/null || continue
      sudo mv "@HARBOR_DIR@/$_f.new" "@HARBOR_DIR@/$_f" 2>/dev/null || mv "@HARBOR_DIR@/$_f.new" "@HARBOR_DIR@/$_f"
    done
    [ -n "$_kept" ] && echo "kept your local copies of:$_kept"
    if [ -f "@HARBOR_DIR@/harbor-cli.sh" ]; then
      _self=$(command -v harbor || echo "@HARBOR_DIR@/harbor")
      # The placeholder token is assembled at runtime on purpose. Written literally, install.sh's
      # own substitution pass would replace it when this file was first written out, and the
      # rewrite below would then be a no-op that shipped a template full of @PLACEHOLDERS@.
      _a='@'
      sed -e "s|${_a}HARBOR_DIR${_a}|@HARBOR_DIR@|g" \
          -e "s|${_a}HARBOR_PROJECT${_a}|@HARBOR_PROJECT@|g" \
          -e "s|${_a}ENV_FILE${_a}|@ENV_FILE@|g" \
          -e "s|${_a}FILES${_a}|@FILES@|g" \
          -e "s|${_a}HARBOR_DATA_DIR${_a}|@HARBOR_DATA_DIR@|g" \
          -e "s|${_a}RAW${_a}|@RAW@|g" \
          "@HARBOR_DIR@/harbor-cli.sh" > "@HARBOR_DIR@/.harbor.new"
      chmod 755 "@HARBOR_DIR@/.harbor.new"
      sudo mv "@HARBOR_DIR@/.harbor.new" "$_self" 2>/dev/null || mv "@HARBOR_DIR@/.harbor.new" "$_self"
    fi
    sudo sed -i "s|^HARBOR_IMAGE_TAG=.*|HARBOR_IMAGE_TAG=$_want|" "@ENV_FILE@"
    dc up -d
    sleep 3
    _after=$(dc exec -T api sh -c 'echo $HARBOR_VERSION' 2>/dev/null || echo unknown)
    # Recreating containers resets their restart policy to what compose declares, which would
    # undo the "nothing starts itself" rule and bring back the empty-vault-after-reboot fault.
    if [ -f /etc/harbor/unlock-mode ]; then
      ids=$(dc ps -q 2>/dev/null || true)
      [ -n "$ids" ] && sudo docker update --restart=no $ids >/dev/null 2>&1 || true
    fi
    echo "upgraded: $_before -> $_after"
    echo "'harbor status' to see it, 'harbor logs api' if anything looks wrong."
    echo "To go back: restore the backup this took first (docs/restore.md). Migrations do not reverse."
    ;;
  public)
    # The share node lives in its own overlay, added only for this subcommand — an install that
    # never publishes never has the service at all.
    dcp() { docker compose -p "@HARBOR_PROJECT@" --env-file "@ENV_FILE@" @FILES@ -f compose.share-funnel.yml "$@"; }
    # Spec §10.6. Turning Funnel on is the one deliberate step that puts anything on the public
    # internet, so it is a command with a confirmation rather than a setting — and the checking is
    # the command's job, not the operator's. Funnel needs no firewall change and no forwarded
    # port; what it does need is two things in the Tailscale admin console, once per tailnet.
    case "${2:-status}" in
      enable|on)
        echo "This publishes ONE path — the share doorman — on its own tailnet name."
        echo "The vault itself stays private: its node never gets Funnel."
        echo
        printf 'Continue? [y/N] '
        read -r _ok
        case "$_ok" in y|Y|yes|YES) ;; *) echo "nothing changed"; exit 0 ;; esac

        echo "Starting the share node..."
        dcp up -d share tailscale-share >/dev/null

        # Step 1: the node has to join the tailnet. It prints a login URL exactly as `tailscale up`
        # did the first time, so no auth key has to be made, pasted or stored anywhere.
        _tries=0
        while [ $_tries -lt 60 ]; do
          _state=$(dcp exec -T tailscale-share tailscale status --json 2>/dev/null | grep -o '"BackendState": *"[^"]*"' | sed 's/.*"\([^"]*\)"$/\1/')
          case "$_state" in
            Running) break ;;
            NeedsLogin|NoState|"")
              _url=$(dcp exec -T tailscale-share tailscale status --json 2>/dev/null | grep -o '"AuthURL": *"[^"]*"' | sed 's/.*"\(http[^"]*\)"$/\1/')
              if [ -n "$_url" ]; then
                echo
                echo "  Open this to add the share node to your tailnet:"
                echo "    $_url"
                echo "  Waiting for you to approve it..."
              fi
              ;;
          esac
          _tries=$((_tries + 1))
          sleep 3
        done
        if [ "$_state" != "Running" ]; then
          echo "The share node did not come up (state: ${_state:-unknown})."
          echo "If your tailnet requires device approval, approve 'harbor-share' in the admin console and run this again."
          echo "'harbor logs tailscale-share' has the details."
          exit 1
        fi

        # A name collision makes Tailscale append a suffix, so the hostname is NOT necessarily the
        # one asked for. Read what the node actually got; links are built from this, never from
        # the configured name.
        _domain=$(dcp exec -T tailscale-share tailscale status --json 2>/dev/null | grep -o '"CertDomains": *\[ *"[^"]*"' | sed 's/.*"\([^"]*\)"$/\1/')
        echo "Share node is on the tailnet as: ${_domain:-unknown}"

        # Step 2: Funnel is off by default for a tailnet. When it is not permitted, the CLI
        # refuses and prints an admin-console URL that pre-fills the policy change. Show that URL
        # verbatim rather than leaving anyone to find the ACL editor.
        if ! dcp exec -T tailscale-share tailscale funnel status >/dev/null 2>&1; then
          echo
          echo "Funnel is not enabled for this tailnet yet. Tailscale says:"
          dcp exec -T tailscale-share tailscale funnel 443 on 2>&1 | sed 's/^/    /'
          echo
          echo "  Follow the link above, approve it, then run 'harbor public enable' again."
          echo "  (HTTPS certificates must also be on: admin console -> DNS -> HTTPS Certificates.)"
          exit 1
        fi

        if [ -n "$_domain" ]; then
          sudo sed -i "s|^SHARE_ORIGIN=.*|SHARE_ORIGIN=https://$_domain|" "@ENV_FILE@" 2>/dev/null \
            || printf 'SHARE_ORIGIN=https://%s\n' "$_domain" | sudo tee -a "@ENV_FILE@" >/dev/null
          dc up -d api >/dev/null
        fi

        echo
        echo "Share links are live at https://${_domain:-?}/s/..."
        echo "They work only while this box is awake and unlocked — a link clicked during a reboot"
        echo "or while the volume is waiting on 'harbor unlock' is simply dead until it is back."
        echo "'harbor public disable' takes it down again."
        ;;
      disable|off)
        dcp stop tailscale-share >/dev/null 2>&1 || true
        dcp rm -f tailscale-share >/dev/null 2>&1 || true
        echo "Share links no longer resolve."
        echo "Nothing was revoked and no bundle was deleted — 'harbor public enable' brings the same"
        echo "links back. The node stays in your tailnet; remove it there if you want it gone."
        ;;
      status)
        if dcp ps --services --filter status=running 2>/dev/null | grep -q '^tailscale-share$'; then
          _domain=$(dcp exec -T tailscale-share tailscale status --json 2>/dev/null | grep -o '"CertDomains": *\[ *"[^"]*"' | sed 's/.*"\([^"]*\)"$/\1/')
          echo "public: on  (https://${_domain:-unknown})"
        else
          echo "public: off — share links are not reachable from outside this machine"
          echo "'harbor public enable' to turn it on."
        fi
        ;;
      *) echo "usage: harbor public [enable|disable|status]"; exit 1 ;;
    esac
    ;;
  unlock)
    if mountpoint -q "@HARBOR_DATA_DIR@"; then echo "already unlocked"; else
      sudo cryptsetup status harbordata >/dev/null 2>&1 || sudo cryptsetup open "$(sudo blkid -t TYPE=crypto_LUKS -o device | head -1)" harbordata
      sudo chattr -i "@HARBOR_DATA_DIR@" 2>/dev/null || true
      sudo mount "@HARBOR_DATA_DIR@"
      echo "unlocked @HARBOR_DATA_DIR@"
    fi
    # --force-recreate, not plain `up -d`: a container that Docker restarted at boot resolved its
    # bind mounts while the volume was still closed, and keeps pointing at the empty directory
    # underneath the mount. Starting it does not fix that; only replacing it does. Without this the
    # vault comes up looking empty after every reboot while the real data sits on the volume.
    dc up -d --force-recreate
    if [ -f /etc/harbor/unlock-mode ]; then
      ids=$(dc ps -q 2>/dev/null || true)
      [ -n "$ids" ] && sudo docker update --restart=no $ids >/dev/null 2>&1 || true
    fi
    ;;
  lock)
    dc down --remove-orphans 2>/dev/null || dc stop
    sudo umount "@HARBOR_DATA_DIR@" 2>/dev/null || true
    sudo cryptsetup close harbordata 2>/dev/null || true
    # Write-protect the bare mountpoint so nothing can populate it while the real volume is away.
    sudo chattr +i "@HARBOR_DATA_DIR@" 2>/dev/null || true
    echo "locked — @HARBOR_DATA_DIR@ is closed and write-protected"
    ;;
  break-glass)
    echo "Print this and keep it somewhere physical. There is no other copy."
    echo
    echo "  master key       $(cat @HARBOR_DATA_DIR@/secrets/kek)"
    echo "  backup password  $(cat @HARBOR_DATA_DIR@/secrets/restic-password)"
    _repo=$(grep '^RESTIC_REPOSITORY=' "@ENV_FILE@" | cut -d= -f2-)
    echo "  backups at       ${_repo:-NOT CONFIGURED — nothing is being backed up}"
    echo "  vault at         $(grep '^WEB_ORIGIN=' "@ENV_FILE@" | cut -d= -f2-)"
    echo "  restore guide    https://github.com/openharborhq/harbor/blob/main/docs/restore.md"
    ;;
  *)
    cat <<HELP
harbor — this vault, on this machine

  harbor status          what is running
  harbor logs [service]  follow the logs
  harbor url             where the vault is
  harbor version         what is deployed
  harbor upgrade [ver]   back up, move to the newest release (or the one named), restart
  harbor backup          back up now
  harbor restore-test    prove the backup can be read back
  harbor break-glass     print the keys for the envelope
  harbor config          edit the configuration
  harbor public [on|off] publish share links on their own tailnet name (off by default)
  harbor unlock          unlock the encrypted volume and start the vault
  harbor lock            stop it and close the volume
  harbor start | stop | restart [service]
  harbor seed            fill an empty vault with demo records
HELP
    ;;
esac
