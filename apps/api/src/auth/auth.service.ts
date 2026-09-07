import { HttpException, HttpStatus, Injectable, Logger, UnauthorizedException } from "@nestjs/common";

class TooManyRequestsException extends HttpException {
  constructor(message: string) {
    super(message, HttpStatus.TOO_MANY_REQUESTS);
  }
}
import { ConfigService } from "@nestjs/config";
import argon2 from "argon2";
import { authenticator } from "otplib";
import { and, eq, isNull, sql } from "drizzle-orm";
import { sessions, users, type Db } from "@trustworthier/db";
import type { SessionUser } from "@trustworthier/shared";
import { AuditService } from "../audit/audit.service";
import type { Env } from "../config/env";
import { CryptoService } from "../crypto/crypto.service";
import { InjectDb } from "../db/db.module";
import { RateLimiter } from "./rate-limiter";
import { generateRecoveryCodes, hashRecoveryCode } from "./recovery-codes";

export const SESSION_COOKIE = "tw_session";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days, sliding
const SESSION_RENEW_AFTER_MS = 24 * 60 * 60 * 1000; // extend at most once a day
const PENDING_TTL_MS = 10 * 60 * 1000; // password accepted, TOTP not yet: 10 minutes
const TOTP_WINDOW = 1; // accept the previous/next 30s step
const ARGON2_OPTS = { type: argon2.argon2id, memoryCost: 64 * 1024, timeCost: 3, parallelism: 1 } as const;

export interface ResolvedSession {
  id: string;
  user: SessionUser;
  totpVerifiedAt: Date | null;
  expiresAt: Date;
}

export interface RequestMeta {
  ip?: string | null;
  userAgent?: string | null;
}

@Injectable()
export class AuthService {
  private readonly log = new Logger(AuthService.name);
  private readonly loginLimiter = new RateLimiter(10, 15 * 60 * 1000);
  private readonly totpLimiter = new RateLimiter(5, 10 * 60 * 1000);
  /** Verified against when the email is unknown, so timing doesn't reveal which emails exist. */
  private dummyHashPromise: Promise<string> | null = null;
  private readonly cookieSecure: boolean;

  constructor(
    @InjectDb() private readonly db: Db,
    private readonly crypto: CryptoService,
    private readonly audit: AuditService,
    config: ConfigService<Env, true>,
  ) {
    this.cookieSecure = config.get("SESSION_COOKIE_SECURE", { infer: true });
    authenticator.options = { window: TOTP_WINDOW };
  }

  cookieOptions() {
    return {
      httpOnly: true,
      secure: this.cookieSecure,
      sameSite: "lax" as const,
      path: "/",
      maxAge: SESSION_TTL_MS,
    };
  }

  // ---------- owner creation (setup CLI; invites arrive in M4) ----------

  async createOwner(input: { email: string; displayName: string; password: string }) {
    const email = input.email.trim().toLowerCase();
    const passwordHash = await argon2.hash(input.password, ARGON2_OPTS);
    const totpSecret = authenticator.generateSecret();
    const { codes, hashes } = generateRecoveryCodes();

    const [user] = await this.db
      .insert(users)
      .values({
        email,
        displayName: input.displayName.trim(),
        passwordHash,
        totpSecretEnc: this.crypto.sealString(totpSecret),
        totpEnabled: true,
        recoveryCodeHashes: hashes,
      })
      .returning({ id: users.id });

    await this.audit.record({ action: "auth.owner_created", actorUserId: user!.id, entityType: "user", entityId: user!.id });
    return {
      userId: user!.id,
      otpauthUri: authenticator.keyuri(email, "Trustworthier", totpSecret),
      recoveryCodes: codes,
    };
  }

  async ownerCount(): Promise<number> {
    const [row] = await this.db.select({ n: sql<number>`count(*)::int` }).from(users);
    return row?.n ?? 0;
  }

  // ---------- step 1: password ----------

  async login(email: string, password: string, meta: RequestMeta): Promise<{ token: string }> {
    const normalized = email.trim().toLowerCase();
    const key = `${meta.ip ?? "?"}|${normalized}`;
    if (!this.loginLimiter.allow(key)) {
      await this.audit.record({ action: "auth.login_rate_limited", metadata: { email: normalized }, ip: meta.ip });
      throw new TooManyRequestsException("Too many attempts. Try again in a few minutes.");
    }

    const user = await this.db.query.users.findFirst({ where: eq(users.email, normalized) });
    const hash = user?.passwordHash ?? (await this.dummyHash());
    const ok = await argon2.verify(hash, password);

    if (!user || !ok || user.status !== "active") {
      await this.audit.record({ action: "auth.login_failed", metadata: { email: normalized }, ip: meta.ip });
      throw new UnauthorizedException("Wrong email or password.");
    }

    const token = this.crypto.randomToken();
    await this.db.insert(sessions).values({
      userId: user.id,
      tokenHash: this.crypto.hashToken(token),
      expiresAt: new Date(Date.now() + PENDING_TTL_MS),
      ip: meta.ip ?? null,
      userAgent: meta.userAgent?.slice(0, 512) ?? null,
    });
    await this.audit.record({ action: "auth.password_ok", actorUserId: user.id, ip: meta.ip });
    return { token };
  }

  // ---------- step 2: TOTP or recovery code ----------

  async verifySecondFactor(session: ResolvedSession, code: string, meta: RequestMeta): Promise<SessionUser> {
    if (session.totpVerifiedAt) return session.user;
    if (!this.totpLimiter.allow(session.id)) {
      await this.revoke(session.id);
      await this.audit.record({ action: "auth.totp_rate_limited", actorUserId: session.user.id, ip: meta.ip });
      throw new TooManyRequestsException("Too many codes. Sign in again.");
    }

    const user = await this.db.query.users.findFirst({ where: eq(users.id, session.user.id) });
    if (!user?.totpEnabled || !user.totpSecretEnc) throw new UnauthorizedException("Two-factor is not set up.");

    const trimmed = code.trim();
    let method: "totp" | "recovery" | null = null;

    if (/^\d{6}$/.test(trimmed)) {
      const secret = this.crypto.openString(user.totpSecretEnc);
      if (authenticator.check(trimmed, secret)) method = "totp";
    } else {
      const h = hashRecoveryCode(trimmed);
      const idx = user.recoveryCodeHashes.findIndex((stored) => this.crypto.constantTimeEqual(stored, h));
      if (idx >= 0) {
        method = "recovery";
        const remaining = user.recoveryCodeHashes.filter((_, i) => i !== idx);
        await this.db.update(users).set({ recoveryCodeHashes: remaining }).where(eq(users.id, user.id));
        this.log.warn(`recovery code used by ${user.email}; ${remaining.length} left`);
      }
    }

    if (!method) {
      await this.audit.record({ action: "auth.totp_failed", actorUserId: user.id, ip: meta.ip });
      throw new UnauthorizedException("That code didn't work.");
    }

    const now = new Date();
    await this.db
      .update(sessions)
      .set({ totpVerifiedAt: now, expiresAt: new Date(now.getTime() + SESSION_TTL_MS) })
      .where(eq(sessions.id, session.id));
    await this.db.update(users).set({ lastLoginAt: now }).where(eq(users.id, user.id));
    this.totpLimiter.reset(session.id);
    await this.audit.record({ action: "auth.login", actorUserId: user.id, metadata: { method }, ip: meta.ip });
    return session.user;
  }

  // ---------- sessions ----------

  async resolveSession(token: string): Promise<ResolvedSession | null> {
    const row = await this.db
      .select({
        id: sessions.id,
        totpVerifiedAt: sessions.totpVerifiedAt,
        expiresAt: sessions.expiresAt,
        createdAt: sessions.createdAt,
        userId: users.id,
        email: users.email,
        displayName: users.displayName,
        status: users.status,
      })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .where(and(eq(sessions.tokenHash, this.crypto.hashToken(token)), isNull(sessions.revokedAt)))
      .limit(1)
      .then((r) => r[0]);

    if (!row || row.status !== "active") return null;
    const now = Date.now();
    if (row.expiresAt.getTime() <= now) return null;

    // Sliding renewal, throttled to one write per day per session.
    if (row.totpVerifiedAt && row.expiresAt.getTime() - now < SESSION_TTL_MS - SESSION_RENEW_AFTER_MS) {
      await this.db.update(sessions).set({ expiresAt: new Date(now + SESSION_TTL_MS) }).where(eq(sessions.id, row.id));
    }

    return {
      id: row.id,
      totpVerifiedAt: row.totpVerifiedAt,
      expiresAt: row.expiresAt,
      user: { id: row.userId, email: row.email, displayName: row.displayName },
    };
  }

  async revoke(sessionId: string): Promise<void> {
    await this.db.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.id, sessionId));
  }

  async logout(session: ResolvedSession, meta: RequestMeta): Promise<void> {
    await this.revoke(session.id);
    await this.audit.record({ action: "auth.logout", actorUserId: session.user.id, ip: meta.ip });
  }

  private dummyHash(): Promise<string> {
    this.dummyHashPromise ??= argon2.hash("not-a-real-password", ARGON2_OPTS);
    return this.dummyHashPromise;
  }
}
