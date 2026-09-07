import { spawn } from "node:child_process";

export interface ExecOptions {
  signal?: AbortSignal;
  cwd?: string;
  /** Called per stderr line as it arrives; used to derive OCR page progress. */
  onStderrLine?: (line: string) => void;
  env?: NodeJS.ProcessEnv;
}

export class ExecError extends Error {
  constructor(
    readonly cmd: string,
    readonly code: number | null,
    readonly signal: NodeJS.Signals | null,
    readonly stderrTail: string,
  ) {
    super(`${cmd} exited with ${signal ? `signal ${signal}` : `code ${code}`}: ${stderrTail.trim().slice(-400)}`);
  }
}

/** Run a tool with no shell, capturing stdout and streaming stderr lines. Aborts kill the child. */
export function run(cmd: string, args: string[], opts: ExecOptions = {}): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd: opts.cwd, env: opts.env ?? process.env, signal: opts.signal, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let pending = "";
    child.stdout.setEncoding("utf8").on("data", (d: string) => (stdout += d));
    child.stderr.setEncoding("utf8").on("data", (d: string) => {
      stderr += d;
      if (!opts.onStderrLine) return;
      pending += d;
      const lines = pending.split(/\r?\n|\r/);
      pending = lines.pop() ?? "";
      for (const l of lines) opts.onStderrLine(l);
    });
    child.on("error", reject);
    child.on("close", (code, signal) => {
      if (pending && opts.onStderrLine) opts.onStderrLine(pending);
      if (code === 0) resolve({ stdout, stderr });
      else reject(new ExecError(cmd, code, signal, stderr));
    });
  });
}
