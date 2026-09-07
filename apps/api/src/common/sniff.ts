/** Content-type by magic bytes, never by extension or the client's claim (spec §2 stage 1). */
export type FileKind = "pdf" | "jpeg" | "png" | "heic" | "unknown";

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const HEIC_BRANDS = ["heic", "heix", "hevc", "mif1", "msf1", "heim", "heis", "hevm", "hevs"];

export function sniffKind(head: Buffer): FileKind {
  if (head.length >= 5 && head.subarray(0, 5).toString("latin1") === "%PDF-") return "pdf";
  if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return "jpeg";
  if (head.length >= 8 && head.subarray(0, 8).equals(PNG_MAGIC)) return "png";
  if (head.length >= 12 && head.subarray(4, 8).toString("latin1") === "ftyp") {
    if (HEIC_BRANDS.includes(head.subarray(8, 12).toString("latin1"))) return "heic";
  }
  return "unknown";
}

export const MIME_BY_KIND: Record<FileKind, string> = {
  pdf: "application/pdf",
  jpeg: "image/jpeg",
  png: "image/png",
  heic: "image/heic",
  unknown: "application/octet-stream",
};
