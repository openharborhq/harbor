import { HttpException, HttpStatus, Injectable, Logger, NotFoundException, UnauthorizedException, ConflictException } from "@nestjs/common";

class TooManyRequestsException extends HttpException {
  constructor(message: string) {
    super(message, HttpStatus.TOO_MANY_REQUESTS);
  }
}
import { ConfigService } from "@nestjs/config";
import argon2 from "argon2";
import { authenticator } from "otplib";
import { and, eq, isNull, sql } from "drizzle-orm";
import { invites, sessions, users, type Db } from "@harbor/db";
import type { AcceptInviteResult, InviteInfo, OwnerInfo, SessionInfo, SessionUser } from "@harbor/shared";
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
const INVITE_TTL_MS = 48 * 60 * 60 * 1000;
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
    this.webOrigin = config.get("WEB_ORIGIN", { infer: true });
    authenticator.options = { window: TOTP_WINDOW };
  }
  private readonly webOrigin: string;

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
      otpauthUri: authenticator.keyuri(email, "Harbor", totpSecret),
      recoveryCodes: codes,
    };
  }

  /**
   * The browser-side first run (spec §3.7): works exactly once, while the vault has no owner.
   * Serialised in-process so two people opening the page on the same first minute cannot both
   * become the first owner; after that, accounts only come from invitations.
   */
  async setupFirstOwner(input: { email: string; displayName: string; password: string }): Promise<AcceptInviteResult> {
    const run = async () => {
      if ((await this.ownerCount()) > 0) throw new ConflictException("This vault already has an owner. Sign in, or ask an owner to invite you.");
      const result = await this.createOwner(input);
      this.log.log("first owner created through the setup page");
      return { email: input.email.trim().toLowerCase(), otpauthUri: result.otpauthUri, recoveryCodes: result.recoveryCodes };
    };
    const next = this.setupChain.then(run, run);
    this.setupChain = next.catch(() => undefined);
    return next;
  }
  private setupChain: Promise<unknown> = Promise.resolve();

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

  // ---------- settings: account (spec §3.5, re-auth with the password) ----------

  private async reauth(userId: string, password: string): Promise<typeof users.$inferSelect> {
    const user = await this.db.query.users.findFirst({ where: eq(users.id, userId) });
    if (!user || !(await argon2.verify(user.passwordHash, password))) throw new UnauthorizedException("Wrong password.");
    return user;
  }

  /** Changing your own name needs no re-auth: it reveals nothing and grants nothing. */
  async updateProfile(userId: string, displayName: string, meta: RequestMeta): Promise<SessionUser> {
    const name = displayName.trim();
    const [row] = await this.db.update(users).set({ displayName: name }).where(eq(users.id, userId)).returning({
      id: users.id,
      email: users.email,
      displayName: users.displayName,
    });
    if (!row) throw new NotFoundException("User not found");
    await this.audit.record({ action: "auth.profile_updated", actorUserId: userId, metadata: { displayName: name }, ip: meta.ip });
    return row;
  }

  async changePassword(userId: string, currentPassword: string, newPassword: string, meta: RequestMeta): Promise<void> {
    await this.reauth(userId, currentPassword);
    await this.db.update(users).set({ passwordHash: await argon2.hash(newPassword, ARGON2_OPTS) }).where(eq(users.id, userId));
    await this.audit.record({ action: "auth.password_changed", actorUserId: userId, ip: meta.ip });
  }

  async regenerateRecoveryCodes(userId: string, password: string, meta: RequestMeta): Promise<string[]> {
    await this.reauth(userId, password);
    const { codes, hashes } = generateRecoveryCodes();
    await this.db.update(users).set({ recoveryCodeHashes: hashes }).where(eq(users.id, userId));
    await this.audit.record({ action: "auth.recovery_codes_regenerated", actorUserId: userId, ip: meta.ip });
    return codes;
  }

  async listSessions(userId: string, currentSessionId: string): Promise<SessionInfo[]> {
    const rows = await this.db
      .select()
      .from(sessions)
      .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt), sql`${sessions.totpVerifiedAt} is not null`, sql`${sessions.expiresAt} > now()`))
      .orderBy(sql`${sessions.createdAt} desc`);
    return rows.map((s) => ({ id: s.id, ip: s.ip, userAgent: s.userAgent, createdAt: s.createdAt.toISOString(), expiresAt: s.expiresAt.toISOString(), current: s.id === currentSessionId }));
  }

  async revokeSession(userId: string, sessionId: string, meta: RequestMeta): Promise<void> {
    await this.db.update(sessions).set({ revokedAt: new Date() }).where(and(eq(sessions.id, sessionId), eq(sessions.userId, userId)));
    await this.audit.record({ action: "auth.session_revoked", actorUserId: userId, metadata: { sessionId }, ip: meta.ip });
  }

  // ---------- settings: household ----------

  async listOwners(currentUserId: string): Promise<OwnerInfo[]> {
    const rows = await this.db.select().from(users).orderBy(sql`${users.createdAt} asc`);
    return rows.map((u) => ({
      id: u.id,
      email: u.email,
      displayName: u.displayName,
      totpEnabled: u.totpEnabled,
      lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
      status: u.status,
      isYou: u.id === currentUserId,
      recoveryCodesLeft: u.recoveryCodeHashes.length,
    }));
  }

  /** Single-use, 48 h (spec §3.5). The URL is returned once and never stored in clear. */
  async createInvite(email: string, createdBy: string, password: string, meta: RequestMeta): Promise<InviteInfo> {
    await this.reauth(createdBy, password);
    const normalized = email.trim().toLowerCase();
    if (await this.db.query.users.findFirst({ where: eq(users.email, normalized) })) throw new UnauthorizedException("That email already has an account.");
    const token = this.crypto.randomToken(24);
    const [row] = await this.db
      .insert(invites)
      .values({ email: normalized, tokenHash: this.crypto.hashToken(token), expiresAt: new Date(Date.now() + INVITE_TTL_MS), createdBy })
      .returning();
    await this.audit.record({ action: "auth.invite_created", actorUserId: createdBy, metadata: { email: normalized }, ip: meta.ip });
    return { id: row!.id, email: normalized, createdBy, expiresAt: row!.expiresAt.toISOString(), acceptedAt: null, url: `${this.webOrigin}/join?token=${token}` };
  }

  async listInvites(): Promise<InviteInfo[]> {
    const rows = await this.db
      .select({ inv: invites, by: users.displayName })
      .from(invites)
      .leftJoin(users, eq(users.id, invites.createdBy))
      .orderBy(sql`${invites.createdAt} desc`)
      .limit(50);
    return rows.map(({ inv, by }) => ({ id: inv.id, email: inv.email, createdBy: by, expiresAt: inv.expiresAt.toISOString(), acceptedAt: inv.acceptedAt?.toISOString() ?? null }));
  }

  async checkInvite(token: string): Promise<{ email: string } | null> {
    const inv = await this.db.query.invites.findFirst({ where: eq(invites.tokenHash, this.crypto.hashToken(token)) });
    if (!inv || inv.acceptedAt || inv.expiresAt.getTime() < Date.now()) return null;
    return { email: inv.email };
  }

  async acceptInvite(token: string, displayName: string, password: string, meta: RequestMeta): Promise<AcceptInviteResult> {
    const inv = await this.db.query.invites.findFirst({ where: eq(invites.tokenHash, this.crypto.hashToken(token)) });
    if (!inv || inv.acceptedAt || inv.expiresAt.getTime() < Date.now()) throw new UnauthorizedException("This invitation is no longer valid.");
    const result = await this.createOwner({ email: inv.email, displayName, password });
    await this.db.update(invites).set({ acceptedAt: new Date() }).where(eq(invites.id, inv.id));
    await this.audit.record({ action: "auth.invite_accepted", actorUserId: result.userId, metadata: { inviteId: inv.id }, ip: meta.ip });
    return { email: inv.email, otpauthUri: result.otpauthUri, recoveryCodes: result.recoveryCodes };
  }

  private dummyHash(): Promise<string> {
    this.dummyHashPromise ??= argon2.hash("not-a-real-password", ARGON2_OPTS);
    return this.dummyHashPromise;
  }
}
