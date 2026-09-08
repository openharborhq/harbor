/**
 * What an uploaded image really is, from its own leading bytes.
 *
 * The API deliberately has no image parsers (spec §3.6), so it cannot re-encode what it is given
 * and must not take the browser's word for the type either — the content-type on a multipart part
 * is a claim by the sender. Reading the magic bytes is the whole check: either the file starts the
 * way one of three formats must start, or it is refused.
 */
export type ImageType = "image/jpeg" | "image/png" | "image/webp";

export function sniffImage(head: Buffer): ImageType | null {
  if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return "image/jpeg";
  if (head.length >= 8 && head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (head.length >= 12 && head.subarray(0, 4).toString("latin1") === "RIFF" && head.subarray(8, 12).toString("latin1") === "WEBP") return "image/webp";
  return null;
}
