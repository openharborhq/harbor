import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { dueLabel, formatAmount, isPressing, nextDueOn, normaliseCurrency, taskBucket } from "@harbor/shared";

const TODAY = "2026-09-10";

describe("task buckets", () => {
  it("separates overdue from due-today", () => {
    assert.equal(taskBucket("2026-09-02", TODAY), "overdue");
    assert.equal(taskBucket(TODAY, TODAY), "today");
    assert.equal(taskBucket("2026-09-14", TODAY), "week");
    assert.equal(taskBucket("2026-11-30", TODAY), "later");
    assert.equal(taskBucket(null, TODAY), "someday");
  });

  it("counts only overdue and today as pressing", () => {
    // The badge rule. A renewal eleven weeks out must not keep it lit, or it never reaches zero
    // and stops being read at all.
    assert.equal(isPressing("2026-09-02", TODAY), true);
    assert.equal(isPressing(TODAY, TODAY), true);
    assert.equal(isPressing("2026-09-11", TODAY), false);
    assert.equal(isPressing("2026-11-30", TODAY), false);
    assert.equal(isPressing(null, TODAY), false);
  });
});

describe("due labels", () => {
  it("says how late, in days, and only shouts when it is", () => {
    assert.deepEqual(dueLabel("2026-09-02", TODAY), { text: "8 days overdue", tone: "danger" });
    assert.deepEqual(dueLabel("2026-09-09", TODAY), { text: "1 day overdue", tone: "danger" });
    assert.deepEqual(dueLabel(TODAY, TODAY), { text: "Due today", tone: "danger" });
    assert.deepEqual(dueLabel("2026-09-11", TODAY), { text: "Due tomorrow", tone: "warn" });
    assert.equal(dueLabel("2026-09-14", TODAY).tone, "warn");
    // Not yet due is never red: red that shows up early stops meaning anything.
    assert.equal(dueLabel("2026-10-28", TODAY).tone, "plain");
    assert.equal(dueLabel(null, TODAY).tone, "muted");
  });
});

describe("repeating tasks", () => {
  it("counts from the occurrence just closed, not from today", () => {
    // A bill paid three days late must not drag the whole series three days later.
    assert.equal(nextDueOn("2026-09-02", "monthly"), "2026-10-02");
    assert.equal(nextDueOn("2026-09-02", "quarterly"), "2026-12-02");
    assert.equal(nextDueOn("2026-09-02", "yearly"), "2027-09-02");
    assert.equal(nextDueOn("2026-11-30", "two_yearly"), "2028-11-30");
  });

  it("clamps a day that the next month does not have", () => {
    assert.equal(nextDueOn("2026-01-31", "monthly"), "2026-02-28");
    assert.equal(nextDueOn("2026-03-31", "monthly"), "2026-04-30");
    // A leap February still gets its 29th.
    assert.equal(nextDueOn("2028-01-31", "monthly"), "2028-02-29");
  });
});

describe("amounts", () => {
  it("shows the currency the document stated, and no symbol when it stated none", () => {
    assert.equal(formatAmount(24810, "EUR"), "€248.10");
    assert.equal(formatAmount(579225, "USD"), "$5,792.25");
    assert.equal(formatAmount(1000, "GBP"), "£10.00");
    assert.equal(formatAmount(1000, "CHF"), "CHF 10.00");
    // A missing currency is a fact about the document, not a euro. The Vermont tax bill that
    // started this was shown as €5,792.25 for exactly that assumption.
    assert.equal(formatAmount(579225, null), "5,792.25");
    assert.equal(formatAmount(579225, ""), "5,792.25");
    assert.equal(formatAmount(null, "EUR"), null);
  });

  it("reads what a model or a person wrote as one of ours, or as nothing", () => {
    assert.equal(normaliseCurrency("eur"), "EUR");
    assert.equal(normaliseCurrency("€"), "EUR");
    assert.equal(normaliseCurrency("Euro"), "EUR");
    assert.equal(normaliseCurrency("US$"), "USD");
    assert.equal(normaliseCurrency("Dollars"), "USD");
    assert.equal(normaliseCurrency(" chf "), "CHF");
    assert.equal(normaliseCurrency(""), null);
    assert.equal(normaliseCurrency(null), null);
    assert.equal(normaliseCurrency("XBT"), null, "an unknown code is not guessed at");
  });
});
