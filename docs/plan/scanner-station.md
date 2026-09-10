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
- Packages: `sane-utils libsane1 scanbd img2pdf imagemagick msmtp msmtp-mta curl jq`.
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
- USB permissions come from the udev rule `sane-utils` installs; the `scan` user's membership
  in the `scanner` group is what makes the device writable without root.

## 3. The scan button

`scanbd` polls the scanner's button sensor and runs a script when it is pressed. Two facts shape
the setup:

- **scanbd owns the device.** While it is running, nothing else may open the scanner directly.
  scanbd hands the device over by starting `saned` on demand, so the scan script talks to
  `net:localhost:epjitsu:…` rather than to the USB device. This is the well-known scanbd
  gotcha; the config in `tools/scanstation/` sets `SANE_CONFIG_DIR` and the `net` backend up
  the way scanbd expects so the script does not have to know.
- **One press is one job is one PDF.** Everything in the feeder when the button is pressed
  becomes a single document. Two letters that should be two documents need two presses. This
  is the right default for a desk scanner and matches how Harbor treats an upload; separator
  sheets and per-sheet splitting are deferred (§9).

Fallback if the button turns out to be flaky under `epjitsu`: a one-line systemd timer that
polls the ADF's paper-loaded sensor every two seconds and starts a job when paper appears.
Same script, different trigger. Decide after a week of real use, not in advance.

## 4. The scan job

`/usr/local/bin/scanstation-scan`, run by scanbd as the `scan` user. Steps, each idempotent so a
crash mid-job leaves a directory that can be finished or discarded, never a half-uploaded file:

1. Make `/var/lib/scanstation/jobs/<timestamp>/` and `cd` into it.
2. `scanimage --source "ADF Duplex" --mode Color --resolution 300 --batch=p%03d.pnm`.
   Colour at 300 dpi is the setting that makes Harbor's OCR reliable on receipts and
   handwritten notes; grey at 200 halves the size but costs accuracy on thin type. Start at
   colour/300 and only step down if size becomes a problem.
3. **Drop blank backs.** Duplex scanning produces a blank page for every single-sided sheet.
   `epjitsu` has no hardware blank detection, so for each page compute the mean brightness and
   standard deviation with ImageMagick and delete pages that are nearly white and nearly
   uniform. Threshold is a variable in the script, default tuned on real single-sided mail;
   a page with a single line of text must survive.
4. `img2pdf p*.pnm -o scan.pdf`. Lossless wrap, no resampling, no OCR. Harbor's worker does
   OCR, deskew and the searchable text layer; doing it twice would only slow the Pi down and
   fight the worker's settings.
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
- **Health.** A `scanstation-health` timer once an hour checks: scanner visible on USB, scanbd
  alive, nothing older than 24 h in `outbox/`, nothing in `failed/`, disk under 80 %. On a
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
4. `sudo systemctl start scanbd` and press the button. Done.

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
   Test on the M3 with the scanner plugged in where possible (SANE runs on macOS via Homebrew
   but scanbd does not, so the button path is Pi-only).
2. Build the Pi, extract the firmware, prove `scanimage` end to end.
3. Phase 1 live: button → PDF → email → Harbor Inbox. Run it for a week on real mail.
4. Harbor device token (the `todo.md` item). Switch the transport. Delete nothing.
5. Tune the blank-page threshold and the colour/dpi choice from that week's scans.
