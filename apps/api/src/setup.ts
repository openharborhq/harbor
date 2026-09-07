import "reflect-metadata";
import { mkdirSync, existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline";
import { NestFactory } from "@nestjs/core";
import { closeDb, createDb, runMigrations } from "@harbor/db";
import { AppModule } from "./app.module";
import { AuthService } from "./auth/auth.service";
import { CryptoService } from "./crypto/crypto.service";

/**
 * First-run setup (milestone 1 form; the wizard UI in Paper replaces the prompts later):
 *   1. create the master key file if it doesn't exist (0600, base64, 32 bytes), and the restic
 *      repository password next to it
 *   2. apply migrations
 *   3. create the first owner with TOTP + recovery codes, print what must go on paper
 *
 * Usage: pnpm --filter @harbor/api setup -- --email you@example.com --name "Kai"
 * Password is prompted (hidden), or read from HARBOR_SETUP_PASSWORD for non-interactive use.
 */
async function main() {
  const args = parseArgs(process.argv.slice(2));
  const kekFile = process.env.HARBOR_KEK_FILE;
  if (!kekFile) fail("HARBOR_KEK_FILE is not set (see .env.example).");

  if (!existsSync(kekFile)) {
    mkdirSync(path.dirname(kekFile), { recursive: true, mode: 0o700 });
    writeFileSync(kekFile, CryptoService.generateKek() + "\n", { mode: 0o600 });
    console.log(`Created master key at ${kekFile} — this goes in the break-glass envelope.`);
  } else {
    console.log(`Using existing master key at ${kekFile}.`);
  }

  // The restic repository password lives next to the KEK and goes in the same envelope (spec §3.4).
  // Inside a container the KEK is a read-only Docker secret under /run/secrets, and the password
  // is the appliance's to create (check-data-volume.sh does), so a refusal to write there is fine.
  const resticFile = path.join(path.dirname(kekFile), "restic-password");
  if (!existsSync(resticFile)) {
    try {
      writeFileSync(resticFile, CryptoService.generateKek() + "\n", { mode: 0o600 });
      console.log(`Created backup repository password at ${resticFile} — this goes in the break-glass envelope too.`);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== "EACCES" && code !== "EROFS" && code !== "EPERM") throw err;
      console.log(`No backup repository password next to the master key (${path.dirname(kekFile)} is read-only here); the appliance creates it in the data volume.`);
    }
  }

  {
    // Migrate before the Nest context exists: module init hooks (category seeding) need the tables.
    const db = createDb(process.env.DATABASE_URL ?? "");
    try {
      await runMigrations(db);
    } finally {
      await closeDb(db);
    }
    console.log("Migrations applied.");
  }
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ["error", "warn"] });
  try {

    const auth = app.get(AuthService);
    if ((await auth.ownerCount()) > 0 && !args.force) {
      fail("An owner already exists. Invites come in a later milestone; pass --force to add another owner now.");
    }
    const email = args.email ?? fail("--email is required");
    const name = args.name ?? fail("--name is required");
    const password = process.env.HARBOR_SETUP_PASSWORD ?? (await promptHidden("Password (min 12 chars): "));
    if (password.length < 12) fail("Password must be at least 12 characters.");

    const result = await auth.createOwner({ email, displayName: name, password });

    console.log("\nOwner created.\n");
    console.log("Scan this in your authenticator app (or paste the secret):");
    console.log(`  ${result.otpauthUri}\n`);
    console.log("Recovery codes — print these, keep them with the break-glass envelope, then clear your terminal:");
    for (const c of result.recoveryCodes) console.log(`  ${c}`);
    console.log("\nEach code works once. There is no email password reset; these are the way back in.");
  } finally {
    await app.close();
  }
}

function parseArgs(argv: string[]) {
  const out: { email?: string; name?: string; force?: boolean } = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--email") out.email = argv[++i];
    else if (a === "--name") out.name = argv[++i];
    else if (a === "--force") out.force = true;
  }
  return out;
}

function promptHidden(question: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const stdout = process.stdout as NodeJS.WriteStream & { muted?: boolean };
    const origWrite = stdout.write.bind(stdout);
    let muted = false;
    // Echo the prompt, then swallow keystrokes until Enter.
    (stdout as unknown as { write: typeof origWrite }).write = ((chunk: string | Uint8Array, ...rest: unknown[]) =>
      muted ? true : (origWrite as (...a: unknown[]) => boolean)(chunk, ...rest)) as typeof origWrite;
    rl.question(question, (answer) => {
      muted = false;
      (stdout as unknown as { write: typeof origWrite }).write = origWrite;
      origWrite("\n");
      rl.close();
      resolve(answer);
    });
    muted = true;
  });
}

function fail(msg: string): never {
  console.error(`setup: ${msg}`);
  process.exit(1);
}

void main();
