# 8. Tasks — the documents that still need doing

A vault that only remembers is half a vault. Most paperwork arrives asking for something:
a bill wants paying, a form wants returning, an assessment can be objected to until the
28th. Harbor could file all of it perfectly and still let the electricity lapse.

## What was actually missing

Not a date. `documents.expires_at` existed from §1 and the model has been filling it in
since prompt version 1. The missing primitive was **done** — an act, by a person, at a
time, that the vault cannot observe for itself.

The two lifecycles look alike and behave in opposite ways:

| | a passport | a bill |
| --- | --- | --- |
| what the date means | it stops being valid | someone must act before it |
| how it resolves | a new document is filed | an act in the world, invisible to Harbor |
| can it be ticked off? | no | yes |
| what happens after | the new document carries the new date | the row is closed, and kept |

With only a date, an obligation can nag forever or vanish silently. Before this section
Harbor offered exactly those two options — and the numbers say which one it picked. Of 54
documents carrying `expires_at` in the development vault, **one** was a real expiry (a
passport). The other 53 were payment due dates, put there deliberately by the prompt
("Payment due dates on bills count"), and 48 had already lapsed unseen. Home's *Expiring
soon* panel was 98% wrong, and had been since the day it shipped.

## The model

A `tasks` table, not columns on `documents`. Three reasons, in the order they mattered:

1. **One document can carry two deadlines.** A tax assessment says pay by the 14th and
   object by the 28th. Columns cap you at one.
2. **Some obligations have no document.** The portal notification that says a statement
   is ready — §4's deferred *fetch reminder* — is an obligation whose whole point is that
   the paperwork is somewhere else. A separate table absorbs that feature instead of
   colliding with it.
3. **A completion has an actor and a time.** That is a row. It is also what makes *"did we
   ever pay that?"* answerable a year later, which is the question a vault exists for.

```
tasks   id, title, kind (pay|file|renew|fetch|review), due_on (nullable)
        amount_cents, currency          -- payments only
        document_id → documents (nullable, cascade)
        item_id     → items (nullable, set null)
        status (open|done|dismissed), closed_at, closed_by, closed_reason
        repeat (monthly|quarterly|yearly|two_yearly)
        source (manual|suggested), notes, created_by, created_at, updated_at

index (due_on) where status = 'open'
```

### Decisions

- **Three states, not two.** `dismissed` means the obligation was never ours — settled by
  the landlord, paid by someone else. A list that showed it as *done* would be lying in the
  one place people go to check.
- **Nothing is deleted when it is finished.** `close` keeps the row, its actor and its
  time; `DELETE` exists only for a to-do that should never have existed.
- **`due_on` is nullable.** "Ask the Hausverwaltung about the meter reading" is a real
  task. It sorts last, under *No date*.
- **Money is minor units in a `bigint`**, like `byte_size`. No float touches an amount.
- **Repetition is a named cadence, not an interval.** Completing a repeating task inserts
  its successor, dated from the occurrence just closed rather than from today — so a bill
  paid three days late does not drag the series three days later. No scheduler, no rrule,
  no catching up on occurrences nobody was there for. Dismissing ends the series.
- **The document FK cascades, but every read still excludes soft-deleted documents.**
  `deleted_at` is the delete that actually happens; the constraint only fires on a hard
  one. A task whose document is in Recently deleted must not appear, and a task with no
  document at all must survive the same predicate.
- **`expires_at` keeps its original meaning** and the prompt now says so: a date on which
  the document stops being valid, never a deadline for doing something.

This also retires `documents.status`, which §1 has listed since the beginning and nobody
ever built.

## Where they come from

The model proposes; a person accepts. `SuggestionPayload.obligations` is a list of at most
three, each with a kind, a title, a due date and an amount — subject to the same rule as
every other suggested field: **nothing is created until someone accepts the suggestion.**

The field carries `.default([])`. This is not stylistic. `SuggestionPayload` validates rows
already in the database as well as fresh model output, and the read path drops what it
cannot parse; the last time a required field was added, 273 stored suggestions failed
`safeParse` and their summaries vanished from the UI at once. Any field added here later
must carry a default for the same reason.

Prompt version 5 introduces the field and rewrites the `expires_at` rule. Re-running it
over an existing vault re-judges every document — budget accordingly.

## Surfaces

| Surface | What it shows |
| --- | --- |
| Sidebar | A **To do** item, badged with *overdue + due today only* |
| `/todo` | Grouped Overdue / Today / This week / Later / No date, with Done kept below |
| Home | *Needs attention* replaces *Expiring soon* — tasks and expiries in one list |
| Document detail | A strip above the summary, with settled ones underneath for context |
| Inbox card | The proposed reminder, as a ticked clause on "Accept & file" |

Two rules run through all of them:

**The badge counts overdue and due today, and nothing else.** A badge that counts a
renewal eleven weeks out can never reach zero, and a badge that never reaches zero is
wallpaper. Same reasoning that keeps held-back leaflets out of the Inbox badge (§5).
`isPressing()` in `@harbor/shared` is the single definition, used by the API's count and
the page's grouping alike, so the sidebar and the list cannot disagree.

**Overdue is the only red.** A date that has not passed is amber at most. Red that shows
up early stops meaning anything by the third time you see it.

**A reminder is never a second decision.** Filing a document and noticing it needs paying
are the same moment, so the Inbox card carries the to-do as a clause you can untick — "…and
remind me to pay €248.10 by 14 Oct" — rather than a second button. This is the same "one
control, not two" move as the FOR picker in §6.

**An expiry is not a to-do.** Both sit in Home's one panel; only the task gets a checkbox.
That difference is the whole feature, and it is drawn as such.

## Deferred

- **Reminders stay in-app**, as §1 already committed. An email digest is v1.1 and will need
  SMTP egress: `worker` is on the internal network by design, so a digest belongs on an
  edge container such as `mailfetch` (§3.6).
- **No calendar or ICS feed**, no bank-feed reconciliation, no automatic marking-as-paid.
  Harbor cannot observe the act, and pretending otherwise is how a to-do list starts lying.
- **Task titles are not indexed** in `document_search`. If that changes it goes through
  `SearchIndexService` like everything else, under the §2 rule that anything altering
  weight-A/B text reindexes.
