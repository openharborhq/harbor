import { NextResponse, type NextRequest } from "next/server";

const SESSION_COOKIE = "tw_session";
const PUBLIC = ["/sign-in"];

/**
 * Cheap gate: no session cookie at all -> straight to sign-in. Whether the cookie is *valid*
 * is decided by the API on every request (the app layout calls /auth/me and redirects too).
 */
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const hasCookie = request.cookies.has(SESSION_COOKIE);
  const isPublic = PUBLIC.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  if (!hasCookie && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/sign-in";
    url.search = pathname !== "/" ? `?next=${encodeURIComponent(pathname)}` : "";
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  // Everything except the API proxy, Next internals and static assets.
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|ico)$).*)"],
};
