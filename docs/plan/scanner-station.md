# Scanner station — paper in, catalogued in Harbor

**Definition of done:** a ScanSnap S1300i sits on a desk plugged into a Raspberry Pi. Put paper
in, press the scan button, walk away. Within a few minutes the document is in Harbor's Inbox
with OCR'd text and a suggestion. Nothing to click on the Pi, no screen, no app. If Harbor or the
network is down, the scan waits on the Pi and goes through later; nothing is ever lost.

Agreed 2026-09-10. The Pi side is this document. The Harbor side is one small feature (a device
token, §6) tracked in `todo.md`; until it lands the Pi uses email-in, which works today.

## 1. Hardware

| Part | Choice | Why |
|---|---|---|
| Scanner | Fujitsu ScanSnap S1300 / S1300i | Already owned. Both are supported by SANE's `epjitsu` backend. |
| Computer | Raspberry Pi 4 (2 GB is plenty) or Pi 5 | Needs enough CPU to convert a 20-page colour duplex job to PDF in seconds, not minutes. A Zero 2 W works but is slow; a Pi 3 is fine. |
| Storage | 32 GB A2 microSD, or a USB SSD | Scans spool locally and are kept after upload (§4). A 300 dpi colour page is 2–4 MB, so a card holds years of paper. |
| Scanner power | **The ScanSnap AC adapter, not USB bus power** | On USB power the S1300 wants two USB ports and still browns out mid-scan on a Pi. The adapter removes a whole class of "it stopped halfway" bugs. |
| Pi power | The official 27 W (Pi 5) / 15 W (Pi 4) supply | Under-powered Pis throttle and drop USB devices. |
| Network | Ethernet if the desk has it, otherwise Wi-Fi | Either is fine; uploads are small. |

No screen, no keyboard after setup. Everything is reachable over SSH on the tailnet.

## 2. Operating system and scanner driver

- Raspberry Pi OS Lite, 64-bit, Bookworm. Headless, SSH enabled at image time, a non-root
  `scan` user in the `scanner` and `lp` groups.
- Packages: `sane-utils libsane1 img2pdf imagemagick msmtp msmtp-mta curl jq`. Everything runs
  as `saned`, the unprivileged user `sane-utils` creates and its udev rules grant the scanner to.
- **Firmware.** `epjitsu` needs the scanner's firmware blob, which Fujitsu ships inside the
  Windows ScanSnap Manager installer and which cannot be redistributed. Extract
  `1300i_0D12.nal` (S1300i) or `1300_0C26.nal` (S1300) from the installer once, copy it to
  `/usr/share/sane/epjitsu/`, and make sure the matching `firmware` line in
  `/etc/sane.d/epjitsu.conf` points at it. This is the single manual step in the whole setup and
  the one most likely to trip a rebuild, so the blob is kept alongside the Pi's backup (§8), not
  only on the Pi.
- Verify with `scanimage -L` (device appears as `epjitsu:libusb:…`) and
  `scanimage -A -d epjitsu` (lists the options the scripts use: `--source ADF Duplex`,
  `--mode`, `--resolution`, and the `scan` button sensor).
- `/etc/sane.d/dll.conf` is reduced to `epjitsu`. The desktop image ships the `net`, `airscan`
  and HP backends too, and each of them probes the LAN or USB on every open, which the watcher
  does twice a second.
- USB permissions come from the udev rule `sane-utils` installs; the `scan` user's membership
  in the `scanner` group is what makes the device writable without root.

## 3. The scan button

**Built 2026-09-10, not the way this section was first written.** The first design used
`scanbd`, the usual Linux answer to scanner buttons. It polls the button, and when a script
wants to scan it hands the device over through `scanbm`/`saned` on port 6566 with a D-Bus
signal to pause polling. With the S1300 and the `epjitsu` backend that handoff failed twice
out of two: the scan ended in a device I/O error with the sheet pulled through unscanned, and
scanbd then lost the device for good because the S1300 re-enumerates on USB after some opens
and scanbd only rediscovers on a udev event that never came. scanbd is purged by the installer.

What replaced it is `scanstation-watch`, sixty lines of shell:

- Every 0.4 s it runs `scanimage -d epjitsu -A` and reads the hardware sensors the backend
  exposes: `scan` (the button), `page-loaded`, `top-edge`, `cover-open`, `power-save`. A read
  costs about 80 ms.
- The scanner is opened as plain `epjitsu`, never by its `libusb:001:NNN` address. The address
  from `scanimage -L` can be stale a second later; the backend name always resolves to the
  first device.
- The button reads `scan=yes` for roughly one second and then clears, hence the poll rate.
- After a press the watcher waits two seconds before scanning. Scanning inside that window
  reproduces the I/O error exactly; with the pause it works every time. `BUTTON_DELAY_SECONDS`.
- A failed read is a miss, five misses in a row mean the scanner is gone, and the watcher then
  retries every five seconds and logs once. Unplugging, sleeping and re-enumeration all
  resolve themselves.
- **One press is one job is one PDF.** Everything in the feeder when the button is pressed
  becomes a single document. Two letters that should be two documents need two presses.
- **Feed direction does not matter.** The S1300 takes paper face down, top edge first, and a
  stack fed the other way comes out rotated 180°. The first real job went in that way and
  OCR'd to garbage: ocrmypdf's `--rotate-pages` detected the rotation but at confidence 2.8,
  under its default 14, and left it. Harbor's worker now rotates from confidence 2, so the
  station has no orientation rule to remember, which is the point of the station.

`TRIGGER=paper` is also implemented: a sheet sitting in the feeder for three seconds starts a
scan with no button at all. It is off by default until a week of button use says whether the
extra magic is wanted.

## 4. The scan job

`/usr/local/bin/scanstation-scan`, run by the watcher as `saned`. Steps, each idempotent so a
crash mid-job leaves a directory that can be finished or discarded, never a half-uploaded file:

1. Make `/var/lib/scanstation/jobs/<timestamp>/` and `cd` into it.
2. `scanimage --source "ADF Duplex" --mode Gray --resolution 300 --batch=p%03d.pnm`.
   Greyscale at 300 dpi, decided 2026-09-10 after the first colour scans came out at 2.2 MB a
   page: paperwork is black on white, OCR works on luminance anyway, and grey is a third of
   the size. Not Lineart, which throws away the faint print OCR needs. `MODE=Color` in the
   config brings colour back for a station that scans photographs.
3. **Drop blank backs.** Duplex scanning produces a blank page for every single-sided sheet.
   `epjitsu` has no hardware blank detection, so for each page trim the border, threshold to
   ink or no ink, and measure the ink fraction with ImageMagick. Below `BLANK_INK` (0.2 %)
   the page is dropped. Brightness was the first test and let a blank back through on the
   first real multi-page job, because greyscale scans have grey paper, not white; ink
   coverage measured on that job was 0.02 % for the blank page and 4 % and up for every
   real one, so the margin is wide in both directions.
4. Convert each kept page to JPEG (quality 70, dpi tag preserved) and wrap them with
   `img2pdf`, which embeds the JPEGs as they are. No resampling, no OCR. Lossless would be
   nicer in principle, but a 300 dpi page is several MB lossless against about 1 MB at
   quality 70, and the email transport caps a job at 17 MB of PDF (Gmail's 25 MB is measured
   after base64). Quality 88 was tried first and came out at 2 MB a page in grey. Harbor's worker does OCR,
   deskew and the searchable text layer; doing any of it twice would only slow the Pi down
   and fight the worker's settings.
5. Write `meta.json` next to it: timestamp, page count, dpi, mode, sha256 of the PDF, scanner
   model, and the station's name. Harbor ignores this today; it is there so a future version
   can show "scanned on the hall table, 2026-09-10 14:02" instead of nothing.
6. Atomically move `scan.pdf` to `/var/lib/scanstation/outbox/<timestamp>.pdf`. The `mv` is the
   commit point. Anything still in `jobs/` after a reboot is a failed job and gets swept to
   `failed/` for a human to look at.

The job takes about a second per page on a Pi 4 after the scanner finishes. No feedback to the
person beyond the scanner's own LED going quiet; the document showing up in Harbor's Inbox is
the confirmation. A buzzer or LED on a GPIO pin is a cheap later addition if silence turns out
to be unnerving (§9).

## 5. The uploader

A separate systemd service, `scanstation-upload`, triggered by a `.path` unit whenever a file
lands in `outbox/`, plus a timer every five minutes as a backstop. It never runs two copies
at once (`flock`). For each PDF in `outbox/`, oldest first:

1. Deliver it to Harbor by whichever transport is configured (§6).
2. On success, move the PDF and its `meta.json` to `sent/<yyyy>/<mm>/`. Harbor is the system
   of record from that moment; `sent/` is a local convenience that a monthly timer prunes to
   the last 90 days. Set `KEEP_SENT_DAYS=0` to delete on success instead.
3. On failure, leave it in `outbox/` and back off (1 min, 5, 15, 60, then hourly). A network
   outage or a Harbor upgrade never loses a scan, it just delays it. After 24 hours of failure
   the service logs at error level, which is what the health check (§7) watches.

The uploader is the only process on the Pi that holds a credential.

## 6. Transport to Harbor

Two transports, a config switch between them. Phase 1 is email-in because it needs no Harbor
change. Phase 2 is the proper path and the phase 1 code stays as the fallback.

### Phase 1 — email-in (works today)

`msmtp` sends each PDF as an attachment to the vault's forwarding mailbox. Harbor's mail
fetcher files any real attachment (spec §2, §7), so the station's sender address needs no
special treatment. Constraints:

- The Pi needs an outbound SMTP credential. Use the forwarding mailbox's own account with an
  app password; it is already the vault's, so no new account is involved.
- Attachment size is capped by the provider (25 MB on Gmail) and by Harbor's own attachment
  cap. A 300 dpi colour job over roughly 40 pages will exceed it. The uploader checks the size
  first and, over the cap, parks the file in `failed/` with a clear log line rather than
  bouncing. Phase 2 removes this limit (Harbor's direct upload ceiling is 200 MB).
- Latency is the mail fetch interval, a few minutes.

### Phase 2 — device token (needs the Harbor feature)

Harbor grows a **device token**: created in Settings, shown once, stored hashed, scoped to
upload only, revocable, with a "last used" timestamp so a forgotten one is visible. The
session guard accepts `Authorization: Bearer <token>` as an alternative to the cookie for
routes marked upload-capable. That work is in `todo.md`; it is roughly one table, one settings
form, one branch in `SessionGuard`, and an audit-log entry.

The uploader then does exactly what the browser does:

```
sha=$(sha256sum "$f" | cut -c1-64)
curl -fsS -H "Authorization: Bearer $TOKEN" "$HARBOR/api/documents/duplicates?sha256=$sha"
# if duplicateOf is null:
curl -fsS -H "Authorization: Bearer $TOKEN" -F "file=@$f" "$HARBOR/api/documents"
```

The duplicate check first means a sheet scanned twice, or an uploader retry after a timeout
that actually succeeded, never produces a second document. The token lives in
`/etc/scanstation/token`, mode 0600, owned by `scan`.

**Reaching Harbor.** On the same LAN as the Protectli the Pi uses the LAN address. Anywhere
else it joins the tailnet, which Tailscale supports on the Pi natively and which is the
recommended setup even at home: the address is then stable across networks and the Pi never
needs an exception in the appliance's firewall. This also sidesteps the household-access
question, because the scanner is a device, not a person, and has no login.

## 7. Operations

- **Logs** go to the journal. `journalctl -u scanstation-scan -u scanstation-upload` tells the
  whole story of any scan.
- **Health.** A `scanstation-health` timer once an hour checks: scanner visible on USB, the
  watcher alive, nothing older than 24 h in `outbox/`, nothing in `failed/`, disk under 80 %. On a
  failure it sends one email to Kai through the same `msmtp` (never more than one per day per
  condition). This is deliberately not a dashboard; the station has no UI and should not need
  looking at.
- **Updates.** Unattended-upgrades for security patches, weekly reboot at 04:00 on Sundays.
  The scripts and units are versioned in this repo under `tools/scanstation/`; deploying a
  change is `git pull` on the Pi and `./install.sh`, which is idempotent.
- **No inbound ports** besides SSH on the tailnet interface. The Pi holds one mail credential
  (phase 1) or one upload-only token (phase 2), and the scanner firmware. Nothing else worth
  stealing; a lost Pi means revoking one token.

## 8. Rebuild from nothing

The whole station must come back from a blank SD card in under thirty minutes without
remembering anything. The recipe, kept as `tools/scanstation/README.md`:

1. Flash Pi OS Lite with SSH and the `scan` user set in the imager.
2. `git clone` this repo, `cd tools/scanstation`, `./install.sh`. Installs packages, units,
   udev rules, scanbd config, directories, permissions.
3. Copy the firmware blob and the credential file from the backup location (Kai's password
   manager for the token; the firmware next to it as an attachment).
4. `sudo systemctl restart scanstation-watch` and press the button. Done.

Nothing on the station is state worth backing up except `outbox/` and `failed/`, which are by
definition things not yet in Harbor; the health check makes sure those stay empty.

## 9. Deferred, on purpose

- **Separator sheets / one document per sheet.** Wait for real use. Two button presses is
  cheap; a barcode-separator pipeline is not.
- **Feedback on the desk.** A GPIO buzzer for "job left the Pi" and a red LED for "outbox
  stuck". Only if silence turns out to be a problem.
- **Metadata to Harbor.** Sending `meta.json` (station name, scan time) as upload fields.
  Needs Harbor to accept them; do it together with the device token if it is cheap, otherwise
  later.
- **A second station.** The design is per-station already (name in `meta.json`, one token
  each); nothing to do until there is a second desk.
- **Scan presets.** A second button does not exist on the S1300, so grey/colour or simplex
  /duplex switching would need a different trigger. Colour duplex 300 dpi is the only mode.

## 10. Order of work

1. `tools/scanstation/`: `install.sh`, `scanstation-scan`, `scanstation-upload` (both
   transports), `scanstation-health`, the systemd units, `scanbd` config, `README.md`.
   Built 2026-09-10; the Pi (a 4 GB Pi 4 at 192.168.2.134 on the LAN, not the tailnet) was
   provisioned the same day over ssh.
2. Build the Pi, extract the firmware, prove `scanimage` end to end.
3. Phase 1 live: button → PDF → email → Harbor Inbox. **Done 2026-09-10**, two-page test
   document delivered both by hand and by button. Run it for a week on real mail.
4. Harbor device token (the `todo.md` item). Switch the transport. Delete nothing.
5. Tune the blank-page threshold and the dpi choice from that week's scans. First data
   point: a colour page at 300 dpi and JPEG quality 88 was about 2.2 MB, which is why the
   station went to greyscale the same day; the device token removes the mail ceiling anyway.
