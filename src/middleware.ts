import NextAuth from "next-auth";
import { authConfig } from "./auth.config";
import type { NextRequest } from "next/server";

// Session gate only; runs on the edge, so it uses the DB-free config. The
// allowlist itself is enforced at sign-in time in auth.ts.
const AUTH_ENABLED = Boolean(
  process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.AUTH_SECRET
);

const { auth } = NextAuth(authConfig);

function isPublic(pathname: string) {
  return (
    pathname.startsWith("/signin") ||
    pathname.startsWith("/api/auth") ||
    pathname.startsWith("/api/calendar")
  );
}

const protectedHandler = auth((req) => {
  if (!req.auth && !isPublic(req.nextUrl.pathname)) {
    const url = new URL("/signin", req.nextUrl.origin);
    url.searchParams.set("callbackUrl", req.nextUrl.pathname);
    return Response.redirect(url);
  }
});

export default function middleware(req: NextRequest, ctx: unknown) {
  if (!AUTH_ENABLED) return;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (protectedHandler as any)(req, ctx);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|ico|webp)$).*)"],
};
