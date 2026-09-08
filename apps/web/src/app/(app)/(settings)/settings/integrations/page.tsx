import type { Metadata } from "next";
import type { Item } from "@harbor/shared";
import { apiFetch } from "@/lib/api-server";
import { getSuggestions } from "../data";
import { SuggestionsForm } from "../SuggestionsForm";
import { PageHead } from "../ui";

export const metadata: Metadata = { title: "Integrations · Settings" };

export default async function IntegrationsPage() {
  const [suggestions, people] = await Promise.all([getSuggestions(), apiFetch<Item[]>("/items?kind=person").catch(() => [] as Item[])]);

  return (
    <>
      <PageHead title="Integrations">
        Where document text may be sent, and what comes back. A model reads each document and proposes a title, a summary, a
        category and dates — you accept or ignore what it proposes.
      </PageHead>

      {suggestions.fromEnvironment && (
        <p className="max-w-[620px] text-small text-muted">
          Currently taken from the configuration file on the appliance. Saving here takes over from it.
        </p>
      )}

      <SuggestionsForm current={suggestions} people={people.map((p) => firstName(p.label))} />
    </>
  );
}

/** Only what is actually sent: the first name, which is all the model needs to guess who. */
function firstName(label: string): string {
  return label.trim().split(/\s+/)[0] ?? label;
}
