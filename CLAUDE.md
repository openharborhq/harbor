# Harbor

Self-hosted family document vault. The design is written down before it is built: see
[`docs/spec/`](docs/spec/) — start at [§0](docs/spec/00-overview.md), which indexes the rest.

## Before writing anything a person reads

Read [`docs/writing.md`](docs/writing.md). It covers release notes and interface copy, and every
rule in it exists because something written the other way had to be rewritten.

## Where things are recorded

- **Open work** lives in [`docs/plan/todo.md`](docs/plan/todo.md), one file, kept current. Anything
  agreed in conversation lands there in the same breath, so a decision never exists only in a
  transcript.
- **Decisions** belong in the spec section they affect, dated, including the ones that reversed an
  earlier choice — §10 records both what was decided and what was tried and dropped.
- **Release notes** are written before a tag, not after: `scripts/release.sh` refuses to run
  without a matching `## vX.Y.Z — date` heading in `CHANGELOG.md`.

## Working on the web app

`apps/web` has its own `AGENTS.md`, written by `next dev`, warning that this Next version differs
from what a model is likely to remember. Read the relevant guide in `node_modules/next/dist/docs/`
before using a routing or rendering API rather than assuming.

The design system is locked: tokens live in `apps/web/src/app/globals.css`, taken verbatim from the
Paper file. Use them; do not invent a colour, a radius or a type size.
