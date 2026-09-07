/**
 * The file that makes `folder` mode a one-click setup (spec §7.3 step 4).
 *
 * Gmail imports filters as an Atom document — Settings › Filters and Blocked Addresses › Import
 * filters. Serving one means the user never has to translate our search terms into Gmail's query
 * language by hand, and the result is a connection that holds a broad credential but only ever
 * opens one label. That is the whole privacy argument of §7.10, delivered as a download.
 *
 * The label is applied and the mail is **not** archived: nothing about the user's inbox changes,
 * which is the only version of this a person should be asked to accept.
 */

/** Both languages, because the household reads one and the post arrives in the other (§5). */
export const PAPERWORK_TERMS = [
  "Rechnung",
  "Beleg",
  "Quittung",
  "Zahlungsbestätigung",
  "Mahnung",
  "Kontoauszug",
  "invoice",
  "receipt",
  "statement",
  "bill",
] as const;

export interface GmailFilterOptions {
  /** The Gmail label to create. Must match the connection's `folders` entry exactly. */
  label?: string;
  terms?: readonly string[];
}

export function gmailFilterXml(opts: GmailFilterOptions = {}): string {
  const label = opts.label ?? "Vault";
  const terms = opts.terms ?? PAPERWORK_TERMS;
  const updated = new Date().toISOString();

  // Two filters rather than one: an invoice with no attachment is still paperwork, and a scan
  // attached with a bare filename is too. Gmail ORs nothing across filters, so each stands alone.
  const filters = [
    { id: "attachments", query: `has:attachment (${terms.join(" OR ")})` },
    { id: "subjects", query: `subject:(${terms.join(" OR ")})` },
  ];

  const entries = filters
    .map(
      ({ id, query }) => `  <entry>
    <category term='filter'></category>
    <title>Mail Filter</title>
    <id>tag:mail.google.com,2008:filter:harbor-${id}</id>
    <updated>${updated}</updated>
    <content></content>
    <apps:property name='hasTheWord' value='${escapeXml(query)}'/>
    <apps:property name='label' value='${escapeXml(label)}'/>
    <apps:property name='shouldNeverSpam' value='true'/>
    <apps:property name='sizeOperator' value='s_sl'/>
    <apps:property name='sizeUnit' value='s_smb'/>
  </entry>`,
    )
    .join("\n");

  return `<?xml version='1.0' encoding='UTF-8'?>
<feed xmlns='http://www.w3.org/2005/Atom' xmlns:apps='http://schemas.google.com/apps/2006'>
  <title>Mail Filters</title>
  <id>tag:mail.google.com,2008:filters:harbor</id>
  <updated>${updated}</updated>
  <author><name>harbor</name></author>
${entries}
</feed>
`;
}

function escapeXml(value: string): string {
  return value.replace(/[&<>'"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&apos;", '"': "&quot;" })[c] ?? c);
}
