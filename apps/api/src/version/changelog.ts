import { readFileSync } from "node:fs";
import path from "node:path";

export interface ChangelogEntry {
  version: string;
  date: string | null;
  body: string;
}

const HEADING = /^## (v\d+\.\d+\.\d+)(?:\s*[—–-]\s*(\d{4}-\d{2}-\d{2}))?\s*$/;

/**
 * The release notes that shipped in this image, from CHANGELOG.md.
 *
 * A vault with no route out is an ordinary deployment, and it should still be able to tell you
 * what changed in the version it is running. That file is written by hand for every release and
 * is the same text `scripts/release.sh` publishes to GitHub, so there is one set of notes, not two.
 */
export function parseChangelog(markdown: string): ChangelogEntry[] {
  const out: ChangelogEntry[] = [];
  let entry: ChangelogEntry | null = null;
  let body: string[] = [];

  const flush = () => {
    if (entry) out.push({ ...entry, body: body.join("\n").trim() });
    body = [];
  };

  for (const line of markdown.split("\n")) {
    const heading = HEADING.exec(line);
    if (heading) {
      flush();
      entry = { version: heading[1], date: heading[2] ?? null, body: "" };
    } else if (entry) {
      body.push(line);
    }
  }
  flush();
  return out;
}

/**
 * Where CHANGELOG.md sits: beside the deployed app in the image, two levels up in the workspace
 * when running from source. Missing is not an error — it means an image built without it, and the
 * notes then come from GitHub or not at all.
 */
export function readBundledChangelog(cwd = process.cwd()): ChangelogEntry[] {
  for (const candidate of [path.join(cwd, "CHANGELOG.md"), path.join(cwd, "..", "..", "CHANGELOG.md")]) {
    try {
      return parseChangelog(readFileSync(candidate, "utf8"));
    } catch {
      /* try the next one */
    }
  }
  return [];
}
