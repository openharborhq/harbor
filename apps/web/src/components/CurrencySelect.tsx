"use client";

import { CURRENCY_SYMBOL, Currency } from "@harbor/shared";

/**
 * The currency beside an amount, as a symbol you can change.
 *
 * Offered wherever an amount is typed or accepted, because the one thing worse than no currency
 * is a confidently wrong one: a Vermont tax bill was carried as "€5,792.25" by a form that
 * hardcoded euros. `null` is a real state — the document did not say — and it shows as a
 * question mark in the warning colour rather than a quiet default, so it gets answered.
 */
export function CurrencySelect({
  value,
  onChange,
  disabled = false,
  className = "h-9 text-row",
}: {
  value: Currency | null;
  onChange: (currency: Currency | null) => void;
  disabled?: boolean;
  /** Height and type size, so the same control sits in a form row and inside a sentence. */
  className?: string;
}) {
  return (
    <select
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value ? (e.target.value as Currency) : null)}
      disabled={disabled}
      aria-label="Currency"
      title={value ? undefined : "Which currency? The document does not say."}
      className={`shrink-0 rounded-md border border-border-strong bg-ground px-1.5 ${value ? "" : "border-warn text-warn"} ${className}`}
    >
      <option value="">?</option>
      {Currency.options.map((c) => (
        <option key={c} value={c}>
          {CURRENCY_SYMBOL[c].trim() === c ? c : `${CURRENCY_SYMBOL[c].trim()} ${c}`}
        </option>
      ))}
    </select>
  );
}
