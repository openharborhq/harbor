"use client";

import { useState } from "react";
import {
  SHARE_BUCKET_PRESETS,
  type ShareBucketSettings,
  type ShareBucketTestResult,
  type ShareDelivery,
  type ShareDeliverySettings,
} from "@harbor/shared";
import { api } from "@/lib/api-client";
import { Badge, Field, Note } from "../ui";

/**
 * Choosing how shares are delivered, and setting up the storage that one of the choices needs.
 *
 * The pattern is the one Integrations already uses and that Kai asked for: each option states its
 * own consequence, and **only the selected one opens its fields**. Nobody should read a bucket
 * form while deciding whether they want a bucket.
 */
export function SharingForm({ delivery, bucket }: { delivery: ShareDeliverySettings; bucket: ShareBucketSettings }) {
  const [choice, setChoice] = useState<ShareDelivery>(delivery.delivery);
  const [form, setForm] = useState({
    endpoint: bucket.endpoint ?? "",
    bucket: bucket.bucket ?? "",
    region: bucket.region,
    keyId: bucket.keyId ?? "",
    secret: "",
    prefix: bucket.prefix,
  });
  const [secretSet, setSecretSet] = useState(bucket.secretSet);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<ShareBucketTestResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  function change(key: keyof typeof form, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
    setSaved(false);
    setResult(null);
  }

  async function save() {
    setSaving(true);
    setError(null);
    setResult(null);
    try {
      if (choice === "bucket") {
        const next = await api<ShareBucketSettings>("/settings/share-bucket", {
          method: "PATCH",
          body: JSON.stringify({
            endpoint: form.endpoint.trim(),
            bucket: form.bucket.trim(),
            region: form.region.trim(),
            keyId: form.keyId.trim(),
            // An untouched field keeps the stored secret; this only sends a real change.
            ...(form.secret ? { secret: form.secret } : {}),
            prefix: form.prefix.trim(),
          }),
        });
        setSecretSet(next.secretSet);
        setForm((f) => ({ ...f, secret: "" }));
      }
      await api<ShareDeliverySettings>("/settings/share-delivery", { method: "PATCH", body: JSON.stringify({ delivery: choice }) });
      setSaved(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function test() {
    setTesting(true);
    setResult(null);
    setError(null);
    try {
      setResult(await api<ShareBucketTestResult>("/settings/share-bucket/test", { method: "POST" }));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="flex flex-col gap-7">
      <Field label="Who serves your share links" hint="Every share goes the same way. Changing this does not affect links already sent.">
        <div className="flex flex-col gap-2">
          <Option
            selected={choice === "doorman"}
            onSelect={() => setChoice("doorman")}
            title="Harbor itself"
            needs="Nothing to set up"
            consequence="Every control works, including a one-download limit and links that last 30 days. A link is dead while your Harbor is asleep, restarting, or waiting to be unlocked — and it only reaches the outside world once you run harbor public enable."
          />
          <Option
            selected={choice === "bucket"}
            onSelect={() => setChoice("bucket")}
            title="Your own storage"
            needs="Needs a bucket"
            consequence="Links keep working when Harbor is off, and nothing on your box is reachable from outside. In exchange there is no one-download limit, and a link lasts at most 7 days. Your recipient's browser does the decrypting; the storage only ever holds bytes it cannot read."
          >
            <div className="mt-4 flex flex-col gap-4 border-t border-border pt-4">
              <div>
                <label htmlFor="preset" className="label mb-1.5 block">
                  Where it is
                </label>
                <select
                  id="preset"
                  className="h-9 rounded-md border border-border bg-ground px-3 text-row"
                  onChange={(e) => {
                    const preset = SHARE_BUCKET_PRESETS.find((p) => p.id === e.target.value);
                    if (preset) {
                      change("endpoint", preset.endpoint);
                      change("region", preset.regionHint);
                    }
                  }}
                  defaultValue=""
                >
                  <option value="" disabled>
                    Pick your provider…
                  </option>
                  {SHARE_BUCKET_PRESETS.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </select>
                <p className="mt-1.5 text-small text-muted">Fills in the address and region below; both are still yours to correct.</p>
              </div>

              <Text id="endpoint" label="Address" value={form.endpoint} onChange={(v) => change("endpoint", v)} placeholder="https://s3.eu-central-003.backblazeb2.com" />
              <Text id="bucket" label="Bucket" value={form.bucket} onChange={(v) => change("bucket", v)} placeholder="harbor-shares" />
              <Text id="region" label="Region" value={form.region} onChange={(v) => change("region", v)} placeholder="eu-central-003" />
              <Text id="keyId" label="Key id" value={form.keyId} onChange={(v) => change("keyId", v)} />
              <Text
                id="secret"
                label="Secret"
                type="password"
                value={form.secret}
                onChange={(v) => change("secret", v)}
                placeholder={secretSet ? "•••••••• — leave blank to keep it" : ""}
                hint="Sealed with the vault's master key, like a mailbox password. It never leaves the box."
              />
              <Text id="prefix" label="Folder inside the bucket" value={form.prefix} onChange={(v) => change("prefix", v)} />

              <Note title="Use a bucket of its own, and keep it private">
                Not the one your backups go to: a deletion rule that suits shares would be wrong for backup data, and nothing
                anonymous should be able to reach into the bucket holding your last line of defence. It needs no public access
                and no CORS rules — Harbor signs each link itself.
              </Note>
            </div>
          </Option>
        </div>
      </Field>

      {error && <p className="max-w-[620px] text-small text-danger">{error}</p>}
      {result && (
        <p className={`max-w-[620px] text-small ${result.ok ? "text-label" : "text-danger"}`}>{result.message}</p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => void save()}
          disabled={saving}
          className="h-9 rounded-md bg-accent px-4 text-row font-semibold text-white disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save"}
        </button>
        {choice === "bucket" && (
          <button
            type="button"
            onClick={() => void test()}
            disabled={testing}
            className="h-9 rounded-md border border-border bg-ground px-4 text-row font-semibold disabled:opacity-50"
          >
            {testing ? "Testing…" : "Test"}
          </button>
        )}
        {saved && !result && <span className="text-small text-muted">Saved.</span>}
        {choice === "bucket" && (
          <span className="text-small text-muted">Test writes a small file, reads it back through a link, and deletes it.</span>
        )}
      </div>
    </div>
  );
}

function Option({
  selected,
  onSelect,
  title,
  needs,
  consequence,
  children,
}: {
  selected: boolean;
  onSelect: () => void;
  title: string;
  needs: string;
  consequence: string;
  children?: React.ReactNode;
}) {
  return (
    <label className={`cursor-pointer rounded-md border p-4 ${selected ? "border-accent bg-accent-soft/40" : "border-border"}`}>
      <div className="flex items-start gap-3">
        <input type="radio" name="share-delivery" checked={selected} onChange={onSelect} className="mt-1.5" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-row font-semibold">{title}</span>
            <Badge tone={selected ? "accent" : "muted"}>{needs}</Badge>
          </div>
          <p className="mt-1 text-small leading-[19px] text-muted">{consequence}</p>
        </div>
      </div>
      {selected && children}
    </label>
  );
}

function Text({
  id,
  label,
  value,
  onChange,
  placeholder,
  hint,
  type = "text",
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  hint?: string;
  type?: string;
}) {
  return (
    <div>
      <label htmlFor={id} className="label mb-1.5 block">
        {label}
      </label>
      <input
        id={id}
        type={type}
        value={value}
        placeholder={placeholder}
        autoComplete="off"
        onChange={(e) => onChange(e.target.value)}
        className="h-9 w-full rounded-md border border-border bg-ground px-3 text-row"
      />
      {hint && <p className="mt-1.5 text-small text-muted">{hint}</p>}
    </div>
  );
}
