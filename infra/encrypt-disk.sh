#!/usr/bin/env sh
# Turn a disk into Harbor's encrypted data volume (spec §3.3).
#
#   sudo sh encrypt-disk.sh                    # asks which disk, and how it should unlock
#   sudo sh encrypt-disk.sh /dev/nvme0n1       # names the disk, still asks how it unlocks
#
# This is the one destructive step in the whole install, so it is a separate script you can read
# on its own, it never runs without being asked for, and it makes you type the device name before
# it touches anything. install.sh offers to call it; it is equally fine to run by hand.
#
# What it does: one GPT partition across the disk, LUKS2 on that partition, ext4 inside, mounted
# at $HARBOR_DATA_DIR. The passphrase is generated here and written to a root-only file for you to
# copy onto the break-glass page — it is never printed to the terminal, where it would live on in
# scrollback and logs.
#
# Settings:
#   HARBOR_DATA_DIR   where to mount it            (default /data)
#   HARBOR_UNLOCK     manual | tpm | boot          (asks if unset)
set -eu

say()  { printf '\n\033[1m%s\033[0m\n' "$1"; }
info() { printf '  %s\n' "$1"; }
warn() { printf '  \033[33m! %s\033[0m\n' "$1" >&2; }
die()  { printf '\n\033[31mstopped: %s\033[0m\n' "$1" >&2; exit 1; }
ask() { _d=$2; printf '  %s [%s] ' "$1" "$_d" >&2; read -r _a </dev/tty || _a=""; [ -n "$_a" ] && printf '%s' "$_a" || printf '%s' "$_d"; }

[ "$(id -u)" = 0 ] || die "run this with sudo — it partitions a disk."
[ "$(uname -s)" = Linux ] || die "Linux only; LUKS is a Linux facility."
for t in cryptsetup sgdisk wipefs mkfs.ext4 lsblk findmnt blkid; do
  command -v "$t" >/dev/null 2>&1 || die "missing $t — apt install cryptsetup gdisk util-linux e2fsprogs"
done

HARBOR_DATA_DIR="${HARBOR_DATA_DIR:-/data}"
MAPPER=harbordata
TARGET="${1:-}"

# ---- 1. choose a disk, excluding the one the system is on ---------------------------------------

ROOT_SRC=$(findmnt -n -o SOURCE / | sed 's/\[.*\]//')
ROOT_DISK=$(lsblk -no PKNAME "$ROOT_SRC" 2>/dev/null || true)
[ -z "$ROOT_DISK" ] && ROOT_DISK=$(basename "$ROOT_SRC")

if [ -z "$TARGET" ]; then
  say "Disks on this machine"
  lsblk -dn -o NAME,SIZE,MODEL 2>/dev/null | grep -vE "^loop|^sr" | while read -r name size model; do
    note=""
    [ "$name" = "$ROOT_DISK" ] && note=" — the system disk, not available"
    used=$(lsblk -no MOUNTPOINT "/dev/$name" 2>/dev/null | grep -v '^$' | tr '\n' ' ')
    [ -n "$used" ] && note="$note (currently mounted at: $used)"
    printf '  /dev/%-10s %-8s %s%s\n' "$name" "$size" "$model" "$note"
  done
  printf '\n'
  TARGET=$(ask "Which disk should become the encrypted volume?" "")
fi
[ -n "$TARGET" ] || die "no disk chosen."
[ -b "$TARGET" ] || die "$TARGET is not a block device."
[ "$(basename "$TARGET")" = "$ROOT_DISK" ] && die "$TARGET is the disk this system boots from. Refusing."

# ---- 2. say exactly what will be destroyed, and make them type it -------------------------------

say "This will erase $TARGET completely"
lsblk "$TARGET" -o NAME,SIZE,TYPE,FSTYPE,MOUNTPOINT | sed 's/^/  /'
for mp in $(lsblk -no MOUNTPOINT "$TARGET" 2>/dev/null | grep -v '^$'); do
  warn "$mp is mounted from this disk and will be unmounted and erased"
  du -sh "$mp" 2>/dev/null | sed 's/^/    holding: /'
done
printf '\n'
CONFIRM=$(ask "Type the device name to confirm, or anything else to stop" "")
[ "$CONFIRM" = "$TARGET" ] || die "not confirmed — nothing was changed."

# ---- 3. how it should unlock --------------------------------------------------------------------

if [ -z "${HARBOR_UNLOCK:-}" ]; then
  say "How should it unlock after a reboot?"
  printf '    1) I will unlock it — the box boots on its own, you ssh in and run `harbor unlock`\n'
  printf '       Nothing waits at boot, no monitor ever needed. One command after a power cut.\n'
  printf '    2) Automatically, using this machine TPM — the vault is up again with no passphrase\n'
  printf '       Convenient. A stolen box unlocks itself for whoever took it.\n'
  printf '    3) Ask at boot — the machine waits for the passphrase before it finishes starting\n'
  printf '       Needs a keyboard and monitor, or dropbear-initramfs to answer over ssh.\n'
  case "$(ask "Which?" "1")" in
    1*) HARBOR_UNLOCK=manual ;;
    2*) HARBOR_UNLOCK=tpm ;;
    3*) HARBOR_UNLOCK=boot ;;
    *)  HARBOR_UNLOCK=manual ;;
  esac
fi
if [ "$HARBOR_UNLOCK" = tpm ]; then
  command -v systemd-cryptenroll >/dev/null 2>&1 || die "systemd-cryptenroll is missing; TPM unlock needs systemd 248+."
  [ -e /dev/tpmrm0 ] || die "no TPM found at /dev/tpmrm0. Choose manual or boot unlock instead."
fi

# ---- 4. the passphrase ---------------------------------------------------------------------------

PASSFILE=/root/harbor-luks-passphrase
if [ -s "$PASSFILE" ]; then
  info "reusing the passphrase already at $PASSFILE"
else
  (umask 077; head -c 32 /dev/urandom | base64 | tr -d '\n' > "$PASSFILE")
  info "passphrase written to $PASSFILE (root only, never printed here)"
fi

# ---- 5. partition, encrypt, format ---------------------------------------------------------------

say "Preparing $TARGET"
for mp in $(lsblk -no MOUNTPOINT "$TARGET" 2>/dev/null | grep -v '^$'); do umount "$mp" && info "unmounted $mp"; done
# Any fstab line for this disk is about to become a boot failure; take it out first.
for u in $(lsblk -no UUID "$TARGET" 2>/dev/null | grep -v '^$'); do
  if grep -q "$u" /etc/fstab 2>/dev/null; then
    sed -i.harbor-bak "\|$u|d" /etc/fstab
    info "removed the old /etc/fstab entry for UUID $u (backup at /etc/fstab.harbor-bak)"
  fi
done

wipefs -a "$TARGET" >/dev/null
sgdisk --zap-all "$TARGET" >/dev/null 2>&1 || true
sgdisk --new=1:0:0 --typecode=1:8309 --change-name=1:harbor "$TARGET" >/dev/null
# The device node for a new partition is created asynchronously by udev, and how long that takes
# depends on the hardware. One second was a guess; waiting for it to actually appear is not.
partprobe "$TARGET" 2>/dev/null || true
# partx tells the kernel about the new partition on setups where partprobe alone does not stick.
command -v partx >/dev/null 2>&1 && partx -a "$TARGET" 2>/dev/null || true
command -v udevadm >/dev/null 2>&1 && udevadm settle --timeout=10 2>/dev/null || true
# An `if`, not `test && assign`: under `set -e` a failing && chain at the end of a loop body ends
# the script, silently and with no message. It did exactly that on the first run of this drill.
PART=""
i=0
while [ $i -lt 20 ] && [ -z "$PART" ]; do
  if [ -b "${TARGET}p1" ]; then
    PART="${TARGET}p1"
  elif [ -b "${TARGET}1" ]; then
    PART="${TARGET}1"
  else
    sleep 0.5
    i=$((i + 1))
  fi
done
[ -n "$PART" ] || die "the partition did not appear after partitioning $TARGET. If this is a loop device, set it up with 'losetup -P'."
info "one GPT partition: $PART"

cryptsetup luksFormat --type luks2 --batch-mode --key-file "$PASSFILE" "$PART"
info "LUKS2 formatted"
cryptsetup open --key-file "$PASSFILE" "$PART" "$MAPPER"
mkfs.ext4 -q -L harbordata "/dev/mapper/$MAPPER"
info "ext4 created inside it"
UUID=$(blkid -s UUID -o value "$PART")

# ---- 6. mountpoint, crypttab, fstab ---------------------------------------------------------------

mkdir -p "$HARBOR_DATA_DIR"
chattr -i "$HARBOR_DATA_DIR" 2>/dev/null || true
mount "/dev/mapper/$MAPPER" "$HARBOR_DATA_DIR"
info "mounted at $HARBOR_DATA_DIR"

sed -i.harbor-bak "\|^$MAPPER[[:space:]]|d" /etc/crypttab 2>/dev/null || touch /etc/crypttab
case "$HARBOR_UNLOCK" in
  manual) echo "$MAPPER UUID=$UUID none luks,noauto" >> /etc/crypttab ;;
  boot)   echo "$MAPPER UUID=$UUID none luks" >> /etc/crypttab ;;
  tpm)
    systemd-cryptenroll --tpm2-device=auto --tpm2-pcrs=7 --unlock-key-file="$PASSFILE" "$PART" \
      || die "TPM enrolment failed. The volume exists and the passphrase still works; re-run with HARBOR_UNLOCK=manual."
    echo "$MAPPER UUID=$UUID none luks,tpm2-device=auto" >> /etc/crypttab
    info "TPM enrolled — it will unlock itself at boot"
    ;;
esac

sed -i.harbor-bak "\|[[:space:]]$HARBOR_DATA_DIR[[:space:]]|d" /etc/fstab
if [ "$HARBOR_UNLOCK" = manual ]; then
  echo "/dev/mapper/$MAPPER $HARBOR_DATA_DIR ext4 defaults,noauto 0 2" >> /etc/fstab
else
  echo "/dev/mapper/$MAPPER $HARBOR_DATA_DIR ext4 defaults 0 2" >> /etc/fstab
fi
info "/etc/crypttab and /etc/fstab updated for '$HARBOR_UNLOCK' unlocking"

# Docker restarts the stack at boot with its own restart policies, before anyone has unlocked
# anything, and with the volume closed Postgres initialises a second, empty database on the system
# disk while the real one sits sealed — the vault comes up looking empty.
#
# The marker below tells install.sh to give the containers a "no" restart policy, so nothing comes
# back by itself and `harbor unlock` is what starts the vault. That is the fix. The immutable
# mountpoint after it is a backstop for the case where something starts anyway: it stops a *new*
# stale directory being created, though it cannot help once one exists, which is how this was
# found in the first place.
if [ "$HARBOR_UNLOCK" = manual ]; then
  mkdir -p /etc/harbor
  echo "manual" > /etc/harbor/unlock-mode
  info "recorded manual unlocking; the vault will not start itself at boot"
fi
if [ "$HARBOR_UNLOCK" = manual ] && command -v chattr >/dev/null 2>&1; then
  cat > /etc/systemd/system/harbor-mountpoint-guard.service <<UNIT
[Unit]
Description=Write-protect the Harbor mountpoint while the encrypted volume is closed
Before=docker.service
After=local-fs.target

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=/bin/sh -c "mountpoint -q $HARBOR_DATA_DIR || chattr +i $HARBOR_DATA_DIR"

[Install]
WantedBy=multi-user.target
UNIT
  systemctl daemon-reload 2>/dev/null || true
  systemctl enable harbor-mountpoint-guard.service >/dev/null 2>&1 || true
  info "installed the boot-time guard on $HARBOR_DATA_DIR"
fi

say "Done"
info "$TARGET is now an encrypted volume mounted at $HARBOR_DATA_DIR"
cat <<NEXT

  Before anything else, put the passphrase on the break-glass page. It is the only way into
  this disk, and it is written in exactly one place:

    sudo cat $PASSFILE

  Once it is on paper, delete that file — 'harbor break-glass' will not show it, because
  Harbor never sees it.

NEXT
if [ "$HARBOR_UNLOCK" = manual ]; then
  cat <<MANUAL
  This volume does not mount at boot, on purpose: the machine comes back on its own after a
  power cut, with ssh working, and you unlock it when you are ready:

    harbor unlock          # asks for the passphrase, mounts, starts the vault
    harbor lock            # the reverse

  Until then $HARBOR_DATA_DIR is empty and write-protected, so nothing can quietly write a
  second, empty database there while the real one is locked away.

MANUAL
fi
