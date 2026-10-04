import type { Metadata } from "next";
import { getDocumentSettings } from "../data";
import { PageHead } from "../ui";
import { DocumentsForm } from "./DocumentsForm";

export const metadata: Metadata = { title: "Documents · Settings" };

/** What happens to a document as it arrives (spec §2 stage 1b). */
export default async function DocumentsPage() {
  const current = await getDocumentSettings();

  return (
    <>
      <PageHead title="Documents">What Harbor does with a document as it arrives, before you file it.</PageHead>
      <DocumentsForm current={current} />
    </>
  );
}
