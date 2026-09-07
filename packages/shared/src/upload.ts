import { z } from "zod/v4";

/**
 * Text fields sent alongside the multipart `file`. Batch defaults from the Add documents design:
 * a file uploaded with a category skips the Inbox; people and tags are linked on arrival.
 * `versionOf` turns "Add as new version" into a real version of the existing document.
 */
export const UploadFields = z.object({
  categoryId: z.string().uuid().optional(),
  personIds: z.array(z.string().uuid()).max(20).default([]),
  tags: z.array(z.string().trim().min(1).max(40)).max(10).default([]),
  versionOf: z.string().uuid().optional(),
});
export type UploadFields = z.infer<typeof UploadFields>;

/** Multipart text fields arrive as strings; arrays are sent JSON-encoded. */
export function parseUploadFields(raw: Record<string, unknown>): UploadFields {
  const pick = (k: string) => {
    const v = raw[k];
    if (typeof v !== "string" || v === "") return undefined;
    if (k === "personIds" || k === "tags") {
      try {
        return JSON.parse(v) as unknown;
      } catch {
        return v.split(",").map((s) => s.trim()).filter(Boolean);
      }
    }
    return v;
  };
  return UploadFields.parse({ categoryId: pick("categoryId"), personIds: pick("personIds") ?? [], tags: pick("tags") ?? [], versionOf: pick("versionOf") });
}
