import { spawn } from "node:child_process";

export interface CommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** Run a program to completion, capturing both streams. Never a shell: arguments are passed as-is. */
export function run(cmd: string, args: string[], env: NodeJS.ProcessEnv, cwd?: string): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { env, cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c: Buffer) => (stdout += c.toString()));
    child.stderr.on("data", (c: Buffer) => (stderr += c.toString()));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code: code ?? -1, stdout, stderr }));
  });
}

export class CommandError extends Error {
  constructor(
    readonly cmd: string,
    readonly result: CommandResult,
  ) {
    super(`${cmd} exited ${result.code}: ${lastLines(result.stderr || result.stdout)}`);
  }
}

/** The tail of a tool's output is where the reason lives; the head is progress noise. */
export function lastLines(text: string, n = 3): string {
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  return lines.slice(-n).join(" · ");
}

export interface BackupSummary {
  snapshotId: string;
  bytes: number;
  filesNew: number;
  filesChanged: number;
  seconds: number;
}

/**
 * `restic backup --json` streams one JSON object per line; the last one is the summary. Anything
 * that is not JSON (a warning about an unreadable file) is skipped rather than fatal.
 */
export function parseBackupSummary(stdout: string): BackupSummary {
  let summary: Record<string, unknown> | null = null;
  for (const line of stdout.split("\n")) {
    if (!line.startsWith("{")) continue;
    try {
      const obj = JSON.parse(line) as Record<string, unknown>;
      if (obj.message_type === "summary") summary = obj;
    } catch {
      /* progress noise */
    }
  }
  if (!summary || typeof summary.snapshot_id !== "string") throw new Error("restic backup produced no summary");
  return {
    snapshotId: summary.snapshot_id,
    bytes: Number(summary.total_bytes_processed ?? 0),
    filesNew: Number(summary.files_new ?? 0),
    filesChanged: Number(summary.files_changed ?? 0),
    seconds: Math.round(Number(summary.total_duration ?? 0)),
  };
}

export interface SnapshotRef {
  id: string;
  time: string;
}

/** `restic snapshots --json --latest 1`: an array with at most one entry. */
export function parseLatestSnapshot(stdout: string): SnapshotRef | null {
  const list = JSON.parse(stdout.trim() || "[]") as { id?: string; short_id?: string; time?: string }[];
  const s = list.at(-1);
  if (!s?.id) return null;
  return { id: s.id, time: s.time ?? "" };
}
