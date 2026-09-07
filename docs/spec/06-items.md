# 6. Items — the people and things documents are about

A document answers two questions, and they are separate. *What kind of paper is this?*
is the **category**. *Who or what is it about?* is the **item**. Trustworthy.com only ever
asks the first, so a boiler invoice has to be filed as either a receipt or a house
document. Asking both keeps each answer honest.

## The model

One table, `items`, holds every subject. A `kind` distinguishes them; nothing else does.

| kind | examples | typical `details` |
| --- | --- | --- |
| `person` | Kai, Mara, Jonas | `relationship`, `dateOfBirth` |
| `property` | Musterstraße 7, the cabin | `address`, `acquiredOn` |
| `vehicle` | the Passat, the boat, the trailer | `plate`, `year` |
| `account` | joint current account, the pension | `institution`, `last4` |
| `policy`, `pet`, `business`, `other` | reserved; valid but not offered in the add menus yet | — |

Boats, ATVs and RVs are vehicles, not their own kinds — the *category* tree already
separates them (Transportation › Boat), and a second axis of the same distinction would
force the filer to make it twice.

Adding a kind is a row and a label, never a migration. `details` is free-form jsonb;
`ITEM_DETAIL_FIELDS` in `packages/shared` is only the form's opinion about what to ask.

### Nesting

`items.parent_id` is a self-reference, so a thing can live inside another thing: a boiler
inside a house, an engine inside a boat. Nesting is one level in practice, not enforced.

Two rules follow, and both exist so a document is filed once and found everywhere:

- **Naming a child names its parent.** Selecting the boiler in the FOR control also
  selects Musterstraße 7, and the suggester does the same when the model returns a child
  label. The filer sees both chips land — nothing happens invisibly.
- **A parent's page shows its children's documents.** The house page lists the boiler
  invoice under All records without the invoice being linked to the house twice.

## Key documents

`item_key_documents` gives each item a short list of slots — Passport, Deed, Title,
Latest Statement — seeded per kind on creation from `DEFAULT_KEY_DOCUMENTS`. A slot with
no document reads "Not on file", which is the point: absence is visible from day one.
Slots are editable; the defaults are a starting position, not a schema.

## The FOR control

One control, not two. A picker per kind would ask the filer to decide which box a boiler
warranty goes in before they can answer at all. Instead there is a single searchable list
grouped by kind, with things-inside-a-thing sorted last under their parent's name. You
never choose a picker first: type "vail" and the boiler comes up, type "lind" and the
house does.

Drawn in the Paper file as **Inbox — For people and things**.

## Where items surface

- **Home** — a Family row (`kind = person`) and a Property & things row (everything else,
  top level only; a boiler belongs on its property's page, not on Home).
- **Item page** — key documents, the things inside it, and every record about it.
- **Library** — the About rail filters by item, grouped by kind.
- **Inbox / Add / Document detail** — the FOR control above.
- **Search** — item labels are weight B in `document_search`, alongside tags.

## What the model may see

Item labels go to the suggester as `itemLabels`, with each item's kind and parent so the
model can tell "The Passat" from "Kai". This is PII about people who never consented, so
`SUGGEST_SEND_PEOPLE=false` withholds the whole list; suggestions then arrive without a
FOR prefill and everything else still works (§5).
