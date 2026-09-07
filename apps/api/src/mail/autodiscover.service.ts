import { Injectable, Logger } from "@nestjs/common";
import { resolveSrv } from "node:dns/promises";

/**
 * Turn an email address into IMAP settings so the connect form asks for an address and a password
 * and nothing else (spec §7.3). Three sources, most-informed first:
 *
 *   1. A built-in table for the providers §7.2 names. Only this one knows where each provider
 *      hides its app-password page, which is the part people actually get stuck on.
 *   2. Mozilla's ISPDB — the database every Thunderbird install has used for twenty years.
 *      Free, unauthenticated, and it covers essentially every consumer provider.
 *   3. The `_imaps._tcp` SRV record, for self-hosted domains that publish one.
 *
 * All three can miss, and that is fine: the form falls back to manual entry. What it must never do
 * is guess wrong silently, so `source` travels with the answer.
 */
@Injectable()
export class AutodiscoverService {
  private readonly log = new Logger(AutodiscoverService.name);

  async discover(emailAddress: string): Promise<MailAutoconfig | UnsupportedProvider | null> {
    const domain = emailAddress.split("@")[1]?.toLowerCase().trim();
    if (!domain) return null;

    const known = BUILTIN[domain];
    if (known) return known.unsupported ? known : { ...known, username: applyUsername(known.usernameForm, emailAddress), source: "builtin" };

    return (await this.fromIspdb(domain, emailAddress)) ?? (await this.fromSrv(domain, emailAddress));
  }

  private async fromIspdb(domain: string, emailAddress: string): Promise<MailAutoconfig | null> {
    try {
      const response = await fetch(`https://autoconfig.thunderbird.net/v1.1/${encodeURIComponent(domain)}`, {
        signal: AbortSignal.timeout(5_000),
        headers: { accept: "application/xml" },
      });
      if (!response.ok) return null;
      const parsed = parseIspdb(await response.text());
      if (!parsed) return null;
      return { ...parsed, username: applyUsername(parsed.usernameForm, emailAddress), providerHint: domain, source: "ispdb" };
    } catch (err) {
      // Setup runs on a box that may have no route out at all; that is not an error worth raising.
      this.log.debug(`ISPDB lookup for ${domain} failed: ${(err as Error).message}`);
      return null;
    }
  }

  private async fromSrv(domain: string, emailAddress: string): Promise<MailAutoconfig | null> {
    try {
      const records = await resolveSrv(`_imaps._tcp.${domain}`);
      const best = records.filter((r) => r.name && r.name !== ".").sort((a, b) => a.priority - b.priority || b.weight - a.weight)[0];
      if (!best) return null;
      return {
        host: best.name,
        port: best.port || 993,
        username: emailAddress,
        usernameForm: "%EMAILADDRESS%",
        providerHint: domain,
        appPasswordUrl: null,
        appPasswordNote: null,
        source: "srv",
      };
    } catch {
      return null;
    }
  }
}

export interface MailAutoconfig {
  host: string;
  port: number;
  username: string;
  /** The provider's own template, kept so the UI can explain why the username looks like it does. */
  usernameForm: string;
  providerHint: string | null;
  /** Deep link to where this provider issues app passwords (§7.3 step 2). */
  appPasswordUrl: string | null;
  /** The one sentence that saves a support round-trip, e.g. Gmail's 2-Step prerequisite. */
  appPasswordNote: string | null;
  source: "builtin" | "ispdb" | "srv";
  unsupported?: never;
}

/**
 * Microsoft, and only Microsoft. Detected at the address so setup can explain (§7.2) instead of
 * failing later with an authentication error nobody can act on.
 */
export interface UnsupportedProvider {
  unsupported: true;
  providerHint: string;
  reason: string;
  alternative: string;
}

type BuiltinEntry = (Omit<MailAutoconfig, "username" | "source"> & { unsupported?: undefined }) | UnsupportedProvider;

const MICROSOFT: UnsupportedProvider = {
  unsupported: true,
  providerHint: "microsoft",
  reason: "Microsoft retired app passwords for IMAP, so a mailbox there cannot be connected directly.",
  alternative: "Forward the mail you want filed to the vault's own address instead — a rule in Outlook does it, and nothing about your account changes.",
};

const gmail = (hint: string): BuiltinEntry => ({
  host: "imap.gmail.com",
  port: 993,
  usernameForm: "%EMAILADDRESS%",
  providerHint: hint,
  appPasswordUrl: "https://myaccount.google.com/apppasswords",
  appPasswordNote: "App passwords only appear once 2-Step Verification is switched on for the account.",
});

const BUILTIN: Record<string, BuiltinEntry> = {
  "gmail.com": gmail("gmail"),
  "googlemail.com": gmail("gmail"),
  "icloud.com": {
    host: "imap.mail.me.com",
    port: 993,
    usernameForm: "%EMAILADDRESS%",
    providerHint: "icloud",
    appPasswordUrl: "https://account.apple.com/account/manage",
    appPasswordNote: "Sign in, then App-Specific Passwords. Two-factor authentication must be on.",
  },
  "me.com": { host: "imap.mail.me.com", port: 993, usernameForm: "%EMAILADDRESS%", providerHint: "icloud", appPasswordUrl: "https://account.apple.com/account/manage", appPasswordNote: "Sign in, then App-Specific Passwords." },
  "fastmail.com": {
    host: "imap.fastmail.com",
    port: 993,
    usernameForm: "%EMAILADDRESS%",
    providerHint: "fastmail",
    appPasswordUrl: "https://app.fastmail.com/settings/security/apppassword",
    appPasswordNote: "Create one scoped to IMAP — Fastmail lets you limit what it can do.",
  },
  "yahoo.com": { host: "imap.mail.yahoo.com", port: 993, usernameForm: "%EMAILADDRESS%", providerHint: "yahoo", appPasswordUrl: "https://login.yahoo.com/account/security", appPasswordNote: "Under Generate app password." },
  "zoho.com": { host: "imap.zoho.com", port: 993, usernameForm: "%EMAILADDRESS%", providerHint: "zoho", appPasswordUrl: "https://accounts.zoho.com/home#security/apppasswords", appPasswordNote: null },
  "posteo.de": { host: "posteo.de", port: 993, usernameForm: "%EMAILADDRESS%", providerHint: "posteo", appPasswordUrl: null, appPasswordNote: "Posteo uses your normal password; there is no separate app password." },
  "posteo.net": { host: "posteo.de", port: 993, usernameForm: "%EMAILADDRESS%", providerHint: "posteo", appPasswordUrl: null, appPasswordNote: "Posteo uses your normal password; there is no separate app password." },
  "mailbox.org": { host: "imap.mailbox.org", port: 993, usernameForm: "%EMAILADDRESS%", providerHint: "mailbox.org", appPasswordUrl: "https://office.mailbox.org", appPasswordNote: "Settings › Security › App passwords." },
  "proton.me": {
    host: "127.0.0.1",
    port: 1143,
    usernameForm: "%EMAILADDRESS%",
    providerHint: "proton",
    appPasswordUrl: null,
    appPasswordNote: "Proton needs Bridge running on the same network; use the password Bridge shows you. Bridge's certificate is self-signed, so point NODE_EXTRA_CA_CERTS at it on the mailfetch container.",
  },
  "protonmail.com": { host: "127.0.0.1", port: 1143, usernameForm: "%EMAILADDRESS%", providerHint: "proton", appPasswordUrl: null, appPasswordNote: "Requires Proton Bridge on the same network." },
  "outlook.com": MICROSOFT,
  "hotmail.com": MICROSOFT,
  "hotmail.co.uk": MICROSOFT,
  "live.com": MICROSOFT,
  "msn.com": MICROSOFT,
  "outlook.de": MICROSOFT,
};

export function applyUsername(form: string, emailAddress: string): string {
  const [local = "", domain = ""] = emailAddress.split("@");
  return form.replace(/%EMAILADDRESS%/gi, emailAddress).replace(/%EMAILLOCALPART%/gi, local).replace(/%EMAILDOMAIN%/gi, domain);
}

/**
 * ISPDB returns a small, stable XML document. Pulling four fields out of it with regexes beats
 * carrying an XML parser into the image for one endpoint — and a malformed reply just misses,
 * which is the same as the endpoint being unreachable.
 */
export function parseIspdb(xml: string): Omit<MailAutoconfig, "username" | "providerHint" | "source"> | null {
  for (const block of xml.match(/<incomingServer\b[^>]*type=["']imap["'][^>]*>[\s\S]*?<\/incomingServer>/gi) ?? []) {
    const socket = tag(block, "socketType")?.toUpperCase();
    // Anything else is cleartext or a plain upgradeless connection, which §7.2 refuses outright.
    if (socket !== "SSL" && socket !== "STARTTLS") continue;

    const host = tag(block, "hostname");
    if (!host) continue;
    const port = Number(tag(block, "port")) || (socket === "SSL" ? 993 : 143);

    return {
      host,
      port,
      usernameForm: tag(block, "username") ?? "%EMAILADDRESS%",
      appPasswordUrl: null,
      appPasswordNote: null,
    };
  }
  return null;
}

function tag(xml: string, name: string): string | null {
  return new RegExp(`<${name}>([^<]*)</${name}>`, "i").exec(xml)?.[1]?.trim() || null;
}
