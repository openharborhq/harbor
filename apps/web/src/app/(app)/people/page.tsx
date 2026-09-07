import type { Metadata } from "next";
import type { Person } from "@trustworthier/shared";
import { TopBar } from "@/components/shell/TopBar";
import { apiFetch } from "@/lib/api-server";
import { formatDate } from "@/lib/format";
import { PersonForm } from "./PersonForm";

export const metadata: Metadata = { title: "People" };

export default async function PeoplePage() {
  const people = await apiFetch<Person[]>("/people");
  return (
    <>
      <TopBar />
      <main className="flex max-w-[1192px] flex-col gap-10 px-14 py-14">
        <div>
          <h1 className="text-title font-bold tracking-snug">People</h1>
          <p className="mt-1.5 text-body text-muted">
            The family members documents are <em>about</em> — not who signs in. Suggestions can only pick from this list.
          </p>
        </div>

        <div className="grid grid-cols-4 gap-4">
          {people.map((p) => (
            <div key={p.id} className="flex flex-col items-center gap-1 rounded-card border border-border px-4 py-7 text-center">
              <div className="mb-3 flex size-[76px] items-center justify-center rounded-pill bg-surface text-[26px] font-semibold text-muted">{p.displayName.slice(0, 1)}</div>
              <div className="text-section font-semibold tracking-snug">{p.displayName}</div>
              <div className="text-small text-muted">
                {p.relationship ?? "—"}
                {p.dateOfBirth ? ` · born ${formatDate(p.dateOfBirth)}` : ""}
              </div>
              <div className="mt-1 text-row text-muted">
                {p.documentCount} record{p.documentCount === 1 ? "" : "s"}
              </div>
            </div>
          ))}
          <PersonForm />
        </div>
      </main>
    </>
  );
}
