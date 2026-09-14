import type { Metadata } from "next";
import { BackLink } from "@/components/BackLink";
import { TopBar } from "@/components/shell/TopBar";
import { ReviewShare } from "./ReviewShare";

export const metadata: Metadata = { title: "Review share" };

/**
 * The step between a basket and a live link (spec §10.5). Deliberately a page of its own rather
 * than a dialog: it is the last place the contents can be edited, and the only place the links
 * are ever readable.
 */
export default function NewSharePage() {
  return (
    <>
      <TopBar />
      <main className="flex flex-col gap-6 px-4 py-8 lg:px-14">
        <div>
          <BackLink href="/library">Back</BackLink>
          <h1 className="mt-2 text-title font-bold tracking-tight">Review share</h1>
          <p className="mt-1 max-w-[64ch] text-body text-muted">
            Everything below is sealed into one archive, encrypted under a key made for this share alone, and handed over
            only through the links you copy.
          </p>
        </div>
        <ReviewShare />
      </main>
    </>
  );
}
