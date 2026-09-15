# Writing

How Harbor talks, in release notes and on screen. Each rule is here because something written the
other way had to be rewritten.

## Release notes

**The headline states the change, not the reader's experience.**

> New feature: document sharing.
> ~~You can hand documents to someone outside the house.~~

**Third person. The software is the subject, not the reader.** "You" makes a changelog read like a
brochure, and the same fact is shorter without it.

> Documents ticked in any list collect behind a Share button.
> ~~You tick documents in any list and they collect behind a Share button.~~

> Data, keys and configuration are kept.
> ~~It keeps your data, your keys and your configuration.~~

Possessive "your" survives where the thing is genuinely the reader's and no other word fits — *your
own storage*, *the box* — but reach for the system as subject first.

**Prefix the kind of change**: `New feature:`, `Added:`, `Changed:`, `Fixed:`. A reader scanning for
what broke should not have to parse a sentence to find out.

**What earns an entry, and how much**, is in [`plan/todo.md`](plan/todo.md) under the release-notes
item: called out, named, or summed up. One question settles it — *would someone on another install
do anything differently because of this?*

**A manual step or a changed default goes under "Worth knowing"**, never buried in a paragraph.

## On screen

**Name a control for what it does to the thing it names.** "Once only" beside a password field
reads as a single-use password; it limits downloads.

> One download only
> ~~Once only~~

**Do not explain what the interface already shows.** Every sentence removed from the share dialog
was describing something visible: that the list is a snapshot, that a row can be clicked, that a
name is for your own reference. A caveat read once and skipped thereafter is furniture, not
honesty — if a fact matters, put it where the person meets it once, not on every use.

**Placeholders are neutral examples**, not one household's paperwork.

> 2025 tax documents · Accountant
> ~~2025 taxes for the Steuerberater · Herr Brand, Steuerberater~~

**Errors name the step that failed and what to do about it.** "Could not write to the bucket (403)
— the key is valid but not allowed to do this" beats "Upload failed".

**A link or button that does nothing to what it sits under does not belong there.** A *Recently
deleted* link at the foot of a document's activity navigated away from the document it was under.

## Both

**A number beats an adjective.** "364px of tabs in 312px of pane" says what "too narrow" does not.

**No exclamation marks, no superlatives, no reassurance that has not been earned.** The vault holds
passports and bank statements; it should sound like it knows that.
