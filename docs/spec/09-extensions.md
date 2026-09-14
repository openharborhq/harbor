# 9. Extensions — evolving Harbor without touching core

Harbor's core is small and opinionated on purpose. That is also its limit: every household
wants one or two things nobody else wants — meter readings pulled out of the energy bills,
a table of the car's service history, a mailbox that speaks JMAP. Merging those as pull
requests would make core everyone's, and therefore nobody's. This section is the
alternative: a way for the people using an install to grow it, and for the platform to keep
changing underneath, **without the two colliding**.

## What was decided, and why not the usual thing

Three ways exist to let outsiders extend a self-hosted product, and 2026 has been a long
argument about them.

| Mechanism | Who does it | What happened |
| --- | --- | --- |
| In-process plugins: code loaded into the host | n8n community nodes, Open WebUI functions, OpenClaw skills, Home Assistant's HACS | n8n's January supply-chain attack stole OAuth tokens; roughly one in eight OpenClaw marketplace skills was malware; Open WebUI's docs say listings are unaudited |
| Sidecar containers behind a declared permission sheet | Home Assistant add-ons, Nextcloud ExApps | The model the mature projects moved *to*, not away from |
| Sandboxed modules with a manifest | Immich workflows, Navidrome plugins (both on Extism and WebAssembly, 2026) | Sound substrate; humans still write the modules |

The lesson is not "plugins are dangerous". It is that **code from strangers running with the
host's privileges** is dangerous, and that a marketplace at scale is where it goes wrong.
Harbor is one household with a dozen personal extensions. That is the regime where a
different arrangement works:

**A recipe is intent plus acceptance criteria, not code.** Someone writes what they want,
declares what it touches, and ships invented examples of the expected result. An agent on
each install compiles the recipe into artifacts against the platform *as it is on that
install*, runs the examples, shows a permission sheet, and installs on approval. When core
upgrades, the artifacts are disposable: the recipe is recompiled and the examples decide
whether it still works.

That last sentence is the whole non-collision mechanism. The durable object is the recipe;
the code is derived output that is allowed to be thrown away. The contribution unit that
replaces a pull request is a recipe in a public repo.

Prior art, by axis: Home Assistant blueprints and Goose recipes (shared intent, instantiated
per install, no acceptance tests); Tessl (spec as source of truth, code regenerated — for a
team's own codebase, and still mostly a thesis); A2UI and json-render (agent emits declarative
UI, host renders with its own components); Immich and Navidrome (the sandbox and the
manifest); Ink & Switch's *Malleable software* essay (the argument that AI coding alone is
not enough — the substrate has to be designed for modification). No project combines them,
and the piece with no prior art at all is **acceptance examples as the upgrade contract**.

### Decisions

- **In-process third-party code is out.** Not even as an opt-in. It would run inside the
  process that unseals mail passwords and can read the KEK, and it couples every extension to
  Nest internals on every release. The internal interfaces (`MailSource`,
  `SuggestionProvider`) stay, because they define the contracts below.
- **The agent is a contributor, not a privileged actor.** It produces a bundle; a person
  approves it; the bundle goes through the same install path as one a person wrote. The agent
  never holds a shell, a Docker socket, a database role or the KEK. Guardrails are structural
  — manifest, sandbox, tests, approval — never prompt-level. (Palo Alto's Unit 42 write-up on
  OpenClaw: malicious skills hijack the model's own instruction-following, so prompt guardrails
  do not hold.)
- **Compiling a recipe never sends vault documents to a model.** Inputs are the recipe, the
  surface documentation, the catalog, and the recipe's invented examples. That keeps the
  compiler inside §5's knowing exception, and the operator who chose `SUGGEST_PROVIDER=none`
  can still install a recipe that ships a reference implementation — the tests and manifest
  do the work without a model.
- **Core upgrades first and unconditionally.** Extensions never block, patch, or migrate
  core. Their failure mode is "switched off, with the reason on the Version page".
- **An external-facing MCP server is deferred**, not rejected. See *Deferred*.

## The surface

Everything an extension can touch is a versioned public contract — *surface 1* — and every
touch point has its own substrate. Nothing is loaded into core; core exposes these and
nothing else.

| Touch point | What a recipe produces | Substrate core provides | Starts from |
| --- | --- | --- | --- |
| Identity | — | **Integration tokens**: scoped, hashed, shown once, revocable, `last_used_at`, audited. `SessionGuard` accepts `Authorization: Bearer` on routes that carry a scope | the device-token item in the to-do |
| Data out | an event subscriber, a notification route | **Event outbox**: a table plus Redis stream — `document.received`, `document.filed`, `task.due`, `backup.finished`, `mail.connection.ailing` — with payload schemas in `@harbor/shared`, and **one signed outbound webhook** as the first sink | nothing; `QueueModule` is the pattern |
| Storage | records the extension owns; custom fields | **`ext_records`**: `(extension_id, collection, id, data jsonb)` validated against the manifest's schema; a typed **custom-fields bag** on `documents` and `items`. Core migrations never touch either | nothing |
| Processing | a transform: document or event in, structured result out | **Extension runner**: a sixth process executing WebAssembly through Extism. No network unless the manifest names hosts; memory, fuel and time limits; host functions for key-value, log, and the scoped API | copies the worker's isolation (§3.6); Navidrome's manifest is the model |
| UI | a page or section as a spec, never React | **Slots** — Home widget, document tab, item section, settings page, sidebar entry — rendering a spec against the **Harbor catalog** (below) | design tokens and components exist; slots do not |
| Data in | a connector sidecar, or a declarative ingest rule | the `MailSource` shape over HTTP, the upload API, per-sidecar egress declaration | `MailSource`; Phase 4 |
| Compilation | — | **The compiler**: the internal agent. Reads recipe, surface docs and catalog; writes into a scratch bundle; runs the examples in the runner; returns the bundle and a provenance record | the suggestion provider and its egress allow-list |
| Upgrade | — | **Verify**: after `migrate`, run every extension's examples; recompile on failure when a model is configured; otherwise disable with a notice | the upgrade path in `install.sh` |

Notifications deliberately get no plugin system. One signed webhook, and ntfy, Apprise or
n8n fan out to a hundred services. Backups likewise: restic already speaks B2, S3, SFTP and
rclone, so "another backup provider" is configuration — the compose file forwarding more
credential variables and the egress allow-list following the repository host.

The surface is semver'd. Additive changes are free. A removal or rename is a surface bump,
listed under its own heading in `CHANGELOG.md`, and the validator turns it into a disabled
extension with a reason rather than a broken page.

## The recipe

A folder anyone can share in a git repo.

```yaml
# recipe.yaml
name: utility-meter-readings
surface: 1
touchpoints:
  reads: [documents.text, documents.metadata]
  stores:
    readings: { document_id: string, read_at: date, kwh: number, amount: money }
  ui:
    - slot: item.section
      binding: readings
  writes: [tasks.create]
  egress: []            # this recipe never talks to the outside
intent: ./INTENT.md     # prose, for the agent and the person installing it
examples: ./examples/   # invented sample bills and the rows expected from them
reference: ./impl/      # optional: a working implementation the agent adapts
```

- **Manifest** — the platform enforces it, not the model. It is rendered as the permission
  sheet at install, in the same words Settings uses for the suggestion provider, and it is
  what lets someone install a stranger's recipe without reading it.
- **Intent** — written for two readers.
- **Examples** — invented data only, which keeps them inside the no-real-data rule. They are
  what make recompilation trustworthy and what the upgrade check runs.
- **Reference implementation** — the hedge against the least-proven idea here (regenerate on
  upgrade). Most recipes will ship one; the agent adapts rather than authors, which also
  answers "two installs compile the same recipe differently".

A **provenance record** accompanies every compiled bundle: recipe hash, surface version,
model and prompt version, test results, who approved. Same inputs regenerate the same thing.

## The user interface layer

An extension's UI is a **spec**: a flat map of elements, each naming a component from the
Harbor catalog with props, children, an optional `repeat` over an array in the spec's state,
an optional `visible` condition, and actions by name. Core renders it with its own components
and tokens, so a section from an extension looks native and follows every design change in
core without being touched.

```json
{
  "root": "section",
  "state": { "readings": [] },
  "elements": {
    "section": { "type": "Section", "props": { "title": "Meter readings" }, "children": ["table"] },
    "table":   { "type": "Table", "props": { "columns": [
                   { "key": "read_at", "label": "Date", "format": "date" },
                   { "key": "kwh", "label": "kWh", "format": "number" },
                   { "key": "amount", "label": "Amount", "format": "money" } ] },
                 "repeat": { "statePath": "/readings", "key": "id" }, "children": ["row"] },
    "row":     { "type": "TableRow", "props": { "cells": { "$item": "." },
                   "link": { "kind": "document", "id": { "$item": "document_id" } } },
                 "children": ["flag"] },
    "flag":    { "type": "Button", "props": { "label": "Add to-do", "action": "flag_reading",
                   "actionParams": { "id": { "$item": "id" } } } }
  }
}
```

- **The catalog** is roughly a dozen components that mirror what the app already has —
  Section, KeyValue, Table and TableRow, Stat, Chips, DocumentLink, ItemLink, Text, Button, a
  few form inputs — each declared once as a Zod schema in `@harbor/shared` and implemented
  once in `apps/web`. The catalog's schema is the UI half of the surface contract and doubles
  as the documentation the compiler reads.
- **The format is json-render's, the code is ours.** Two candidates were read closely.
  Google's A2UI is a multi-vendor protocol with a message stream and surface lifecycle built
  for chat; its docs concede catalogs are not portable across clients, which removes the
  main argument for it. Vercel's json-render has the better fit — one spec document, a Zod
  catalog, `repeat` and `visible`, a validate-and-repair loop — but it is a Vercel Labs
  project with one maintainer for 177 of ~210 commits, no documented use inside Vercel's own
  products, and a release cadence that slowed to quarterly by spring. The parts Harbor needs
  are a few hundred lines. So: adopt the element-map format and expression forms because they
  are well designed, implement the renderer and validator in-house, and never let a recipe
  learn which library, if any, is underneath.
- **Compile-time, not runtime.** In chat products the model emits UI live. Here the spec is
  part of the compiled bundle, validated against the catalog at install, served unchanged
  after that. No model on the hot path, no drift between visits. Only `state` changes at
  runtime, filled from the extension's records.
- **Three edits to the defaults.** Text goes through the sanitiser notes already use. Nothing
  in the catalog takes a URL except the two link components, which take a kind and an id.
  Every extension surface renders inside a frame that names the extension — the mitigation
  A2UI's own README gives for a spoofed form.

## The compiler — the internal agent

Runs where the suggester runs, because that process already has the one allow-listed model
egress and nothing else. It uses the configured `SuggestionProvider`; with `none` it can only
adapt a reference implementation, and says so.

What it sees: the recipe folder, the surface documentation, the catalog schema, the manifest
schema. What it can do: write into a scratch bundle directory, ask the runner to execute the
bundle against the examples, read the results. What it cannot do: reach the vault's
documents, the database, the network, a shell, Docker, or any secret. Its output is a
bundle and a provenance record; **installation is a click in Settings by a person**, after
the permission sheet, and never an action the agent takes.

The declarative tier comes first — ingest rules, notification routes, UI specs, autodiscover
entries — because the agent emits data validated by a schema and nothing executes. Transforms
come second, because the runner can prove them against the examples. Connectors (Phase 4)
the agent can *draft*, but they deploy as sidecars through the same sheet as a human-written
one.

## Threat model additions

Extends §3.1.

| Adversary | Gets | Why it's useless |
| --- | --- | --- |
| A malicious shared recipe | Whatever the manifest grants | The sheet is enforced by the platform; the runner has no network or filesystem; storage is namespaced; nothing installs without a person; a recipe cannot ask for a scope the surface does not define |
| Prompt injection into the compiler (a recipe's intent file is untrusted text) | A bad bundle | Same as above: the bundle is inert until approved, and the examples must pass |
| A compromised extension at runtime | Its own records, the events and API scopes it was granted | Fuel, memory and time limits; no egress unless declared; revoking the token switches it off |

**Explicit non-goals:** an extension the owner approved with a broad manifest — the sheet is
the decision, and Harbor makes it legible rather than making it for them.

## Build order

Every project that got this right built the substrate before the agent. Same here.

| Phase | Delivers | Proves |
| --- | --- | --- |
| 0 | Integration tokens with scopes; event outbox; one signed webhook | Notifications through ntfy or Apprise with no plugin system; the scanner station on a proper token |
| 1 | `ext_records`, custom fields, the item-section slot, the runner with one **hand-written** WebAssembly transform, the catalog and in-house renderer | The surface works, on the meter-reading case as the first real extension |
| 2 | Recipe format, the Extensions settings page, provenance, verify-on-upgrade | An extension survives a real core upgrade, tested with a fake upgrade first |
| 3 | The compiler: declarative tier, then transforms | A person installs a recipe they did not write and did not read |
| 4 | Connector sidecars behind the `MailSource`-over-HTTP contract; a public recipes repo | A JMAP or Microsoft Graph connector maintained outside core — every reason §7.2 kept Graph out of core (client ID in the repo, refresh loop, egress hole) vanishes when it is someone else's sidecar |

Phase 1 holds the real design decisions: the WebAssembly toolchain for TypeScript, the exact
catalog, and how much memory a Protectli can give the runner. Phase 2 validates the thesis
and needs no agent at all.

## Deferred

- **An external-facing MCP server.** Consistent with the philosophy under conditions, and
  worth doing after the internal agent has mileage. Two servers were distinguished: a *use*
  server (search, read, list obligations, create a task — what Home Assistant ships behind a
  long-lived token and an exposure page) and an *evolve* server (the compiler's tools —
  validate, compile, run examples, propose — offered to the user's own agent). The evolve
  tools are low risk because they never touch vault documents and install still needs the
  click. The use tools are where the philosophy bends: document text goes to whatever model
  the client uses, over whatever route it has, which is a bigger exception than §5's. Simon
  Willison's *lethal trifecta* names the shape — Harbor's documents are the private data,
  email-ingested text is the untrusted content, the user's client is the channel Harbor
  cannot see. Conditions recorded for when it is picked up: opt-in and off by default;
  tailnet-only under the existing web origin; scoped integration tokens (OAuth later if a
  client insists); `documents:read` separate from `documents:text`; email-derived text
  returned with a marker saying so; every call audited and visible in Settings; the same
  runner and the same approval step as the internal path; never a shell, Docker socket or
  the KEK.
- **Connector sidecars** — Phase 4, above.
- **The `documents:text` scope** for any external agent, until labelling and audit exist.

## Resolved

Decided 2026-09-12: recipes compiled per install, not plugins installed (§9) · no in-process
third-party code, ever · the agent produces, a person installs · compile never sees vault
documents · core upgrades first, extensions verify after · json-render's format with an
in-house renderer, A2UI not adopted · notifications are one webhook, backups are
configuration · external MCP server deferred with its conditions written down · build order
0 → 4 with the agent in Phase 3.
