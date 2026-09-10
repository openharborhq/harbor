# Scanner station

A ScanSnap S1300i on a Raspberry Pi. Press the button, the document ends up in Harbor. The
design and the reasoning are in `docs/plan/scanner-station.md`; this is the operator's card.

## Rebuild from a blank card

1. Flash Raspberry Pi OS Lite (64-bit, Bookworm) with ssh enabled and your user set.
2. `ssh-copy-id` your key, then on the Pi:
   ```
   git clone <harbor repo> harbor && cd harbor/tools/scanstation
   sudo ./install.sh
   ```
3. Put the scanner firmware in place. It comes from the Windows ScanSnap Manager installer
   and cannot be redistributed, so it is kept next to the station credentials in the
   password manager:
   ```
   sudo install -m 644 1300i_0D12.nal /usr/share/sane/epjitsu/    # or 1300_0C26.nal
   ```
4. Fill in `/etc/scanstation/scanstation.conf` (addresses, station name) and the `password`
   line in `/etc/scanstation/msmtprc`. For the token transport, put the device token in
   `/etc/scanstation/token` (one line, mode 0600, owned by `saned`).
5. `sudo systemctl restart scanstation-watch`, load paper, press the button.

`sudo ./install.sh` again after every `git pull`. It never touches existing config files.

## Where things are

| | |
|---|---|
| Scripts | `/usr/local/bin/scanstation-{watch,scan,upload,health}` |
| Config | `/etc/scanstation/` |
| Spool | `/var/lib/scanstation/{jobs,outbox,sent,failed,state}` |
| Logs | `journalctl -t scanstation-watch -t scanstation-scan -t scanstation-upload -t scanstation-health` |

## What happens on a press

`scanstation-watch` polls the scanner's sensors and sees the button → two-second pause →
`scanstation-scan` scans the feeder duplex, drops blank backs,
makes one JPEG-in-PDF, writes it and a `meta.json` to `outbox/` → the path unit fires
`scanstation-upload`, which mails it (phase 1) or POSTs it with the device token (phase 2),
then moves it to `sent/<yyyy>/<mm>/`. Failures back off and retry; nothing is dropped.

## When something is wrong

- `outbox/` has old files: the uploader is failing. `journalctl -t scanstation-upload`.
- `failed/` has something: a job crashed or a file was over the mail cap. Look, then delete
  or upload by hand: `sudo -u saned scanstation-upload` after moving it back.
- Nothing happens on the button: `journalctl -t scanstation-watch -n 20`. It logs every
  sensor change, so a press that is not seen and a scanner that is not readable look different.
- Scan by hand, no button: `sudo systemctl stop scanstation-watch`, then
  `sudo -u saned scanstation-scan`, then start the watcher again. Two processes must never
  open the scanner at once.

The health timer mails once per day per problem to `ALERT_TO`. Silence means it is fine.
