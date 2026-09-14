import type { Metadata } from "next";
import { getShareBucket, getShareDelivery } from "../data";
import { PageHead } from "../ui";
import { SharingForm } from "./SharingForm";

export const metadata: Metadata = { title: "Sharing · Settings" };

/**
 * How documents leave the house (spec §10.10).
 *
 * This page exists because the choice it holds is a **setup decision, not a send-time one**. It
 * was briefly a radio button on the review screen; that put an architecture — and a prerequisite
 * the person might not have met — in front of someone who was trying to send four documents.
 */
export default async function SharingPage() {
  const [delivery, bucket] = await Promise.all([getShareDelivery(), getShareBucket()]);

  return (
    <>
      <PageHead title="Sharing">
        Documents you hand to an accountant, an insurer or a landlord leave as one sealed archive, encrypted under a key made
        for that share alone. What you choose here is who serves it to them.
      </PageHead>

      {bucket.fromEnvironment && bucket.endpoint && (
        <p className="max-w-[620px] text-small text-muted">
          Currently taken from the configuration file on the appliance. Saving here takes over from it.
        </p>
      )}

      <SharingForm delivery={delivery} bucket={bucket} />
    </>
  );
}
