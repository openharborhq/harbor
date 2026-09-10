#!/bin/bash
# Idempotent installer for the scanner station. Run as root on the Pi from this directory:
#   sudo ./install.sh
# Re-run after every git pull. Existing config in /etc/scanstation is never overwritten.
set -euo pipefail
cd "$(dirname "$0")"
[ "$(id -u)" -eq 0 ] || { echo "run as root"; exit 1; }
step() { echo; echo "== $*"; }

step "packages"
export DEBIAN_FRONTEND=noninteractive
apt-get install -y -q sane-utils libsane1 img2pdf imagemagick msmtp msmtp-mta curl jq unattended-upgrades usbutils
# scanbd was the first design; its saned handoff loses the S1300. See scanstation-watch.
if dpkg -s scanbd >/dev/null 2>&1; then systemctl disable --now scanbd scanbm.socket 2>/dev/null || true; apt-get purge -y -q scanbd; fi
systemctl disable --now inetd 2>/dev/null || true

step "directories"
# The station runs as saned, the user sane-utils creates for exactly this: unprivileged,
# in the scanner group, matched by the udev rules that make the USB device writable.
id saned >/dev/null
usermod -a -G scanner saned
mkdir -p /var/lib/scanstation/{jobs,outbox,sent,failed,state} /etc/scanstation /usr/local/lib/scanstation
chown -R saned:scanner /var/lib/scanstation
chmod 750 /var/lib/scanstation

step "scripts"
install -m 755 bin/scanstation-scan bin/scanstation-upload bin/scanstation-health bin/scanstation-watch /usr/local/bin/
install -m 644 bin/scanstation-common /usr/local/lib/scanstation/

step "configuration"
[ -f /etc/scanstation/scanstation.conf ] || install -m 640 -o root -g scanner config/scanstation.conf.example /etc/scanstation/scanstation.conf
[ -f /etc/scanstation/msmtprc ] || install -m 600 -o saned -g scanner config/msmtprc.example /etc/scanstation/msmtprc
chown saned:scanner /etc/scanstation/msmtprc; chmod 600 /etc/scanstation/msmtprc
[ -f /etc/scanstation/token ] && { chown saned:scanner /etc/scanstation/token; chmod 600 /etc/scanstation/token; }

step "sane: only the epjitsu backend, opened directly"
# One backend keeps every open fast (~80 ms) and stops the network/airscan backends from
# probing the LAN each time the watcher polls.
[ -f /etc/sane.d/dll.conf.orig ] || cp -a /etc/sane.d/dll.conf /etc/sane.d/dll.conf.orig
printf 'epjitsu\n' > /etc/sane.d/dll.conf
if [ -d /etc/sane.d/dll.d ] && [ -n "$(ls -A /etc/sane.d/dll.d 2>/dev/null)" ]; then
  mkdir -p /etc/sane.d/dll.d.disabled; mv /etc/sane.d/dll.d/* /etc/sane.d/dll.d.disabled/ 2>/dev/null || true
fi
rm -rf /etc/scanbd

step "systemd"
install -m 644 systemd/* /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now scanstation-upload.path scanstation-upload.timer scanstation-health.timer scanstation-reboot.timer
systemctl enable scanstation-watch
if ls /usr/share/sane/epjitsu/*.nal >/dev/null 2>&1; then
  systemctl restart scanstation-watch
else
  echo "note: no firmware in /usr/share/sane/epjitsu yet; the watcher stays stopped until it is there"
  systemctl stop scanstation-watch 2>/dev/null || true
fi

step "hardening"
cat > /etc/ssh/sshd_config.d/10-scanstation.conf <<'SSH'
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin no
SSH
systemctl reload ssh
cat > /etc/apt/apt.conf.d/20auto-upgrades <<'APT'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
APT

step "done"
systemctl --no-pager --no-legend list-units 'scanstation-*' || true
echo
echo "Next: firmware in /usr/share/sane/epjitsu/, password in /etc/scanstation/msmtprc,"
echo "addresses in /etc/scanstation/scanstation.conf, then: sudo systemctl restart scanstation-watch"
