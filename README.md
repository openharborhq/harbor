# harbor

A self-hosted family document vault. Bulk-upload or email in your paperwork; it's OCR'd,
searchable by every word inside, organised by category, family member and tag, encrypted at
rest and backed up offsite with a tested restore path. Runs on a small Linux box at home,
reachable only over your tailnet.

**Status:** working v1 — upload, OCR, search, suggestions, items, categories, email-in with sender triage, and nightly encrypted backups with a monthly automated restore test. Tailscale-only networking is not built yet; see the spec in [`docs/spec`](docs/spec/00-overview.md).

License: AGPL-3.0.
