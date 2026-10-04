/**
 * The photo-to-scan step (spec §2 stage 1b): what scan_cleanup.py reports about the scan it made.
 * The script prints one line of JSON; anything else — a crash, a warning on stdout, a result this
 * code does not understand — means the photo is OCR'd as it was taken.
 */
export type ScanOutline = "page" | "partial" | "none";

export interface ScanResult {
  outline: ScanOutline;
  folds: number;
  /** What prints the scan at the paper's real size; passed to ocrmypdf as --image-dpi. */
  dpi: number;
}

const OUTLINES: readonly string[] = ["page", "partial", "none"] satisfies ScanOutline[];

export function parseScanResult(stdout: string): ScanResult | null {
  const line = stdout.trim().split("\n").pop() ?? "";
  let r: unknown;
  try {
    r = JSON.parse(line);
  } catch {
    return null;
  }
  if (typeof r !== "object" || r === null) return null;
  const { cleaned, outline, folds, dpi } = r as Record<string, unknown>;
  if (cleaned !== true || typeof outline !== "string" || !OUTLINES.includes(outline)) return null;
  if (!Number.isInteger(dpi) || (dpi as number) < 50 || (dpi as number) > 1200) return null;
  return { outline: outline as ScanOutline, folds: Number.isInteger(folds) ? (folds as number) : 0, dpi: dpi as number };
}
