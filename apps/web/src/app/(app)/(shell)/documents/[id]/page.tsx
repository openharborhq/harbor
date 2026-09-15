import type { Metadata } from "next";
import { DocumentView } from "@/components/DocumentView";

export const metadata: Metadata = { title: "Document" };

/**
 * The document reached directly — a link, a bookmark, a refresh. There is no list behind it to
 * show through, so it takes the whole window; the intercepted route beside it is the modal.
 */
export default async function DocumentPage(props: PageProps<"/documents/[id]">) {
  const { id } = await props.params;
  return <DocumentView id={id} variant="page" />;
}
