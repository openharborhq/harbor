import type { SessionUser } from "@trustworthier/shared";
import type { ResolvedSession } from "../auth/auth.service";

declare global {
  namespace Express {
    interface Request {
      /** Present whenever a valid (possibly TOTP-pending) session cookie was sent. */
      session?: ResolvedSession | null;
      /** Present only after the guard admitted a fully verified session. */
      user?: SessionUser;
    }
  }
}
export {};
