import { DocumentView } from "@/components/DocumentView";

/**
 * A document opened from a list, intercepted so the list stays underneath (spec §4).
 *
 * `(.)` because a slot is not a route segment: `@modal` and `documents` sit at the same level
 * despite being two folders apart, which is the convention the Next docs' own modal example uses.
 *
 * Reached only by client-side navigation. A refresh or a pasted link goes to the page beside this
 * one, which is the same view without a list behind it to preserve.
 */
export default async function InterceptedDocumentPage(props: PageProps<"/documents/[id]">) {
  const { id } = await props.params;
  return <DocumentView id={id} variant="modal" />;
}
