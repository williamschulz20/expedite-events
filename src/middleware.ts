import { auth } from "@/auth";
import type { NextRequest } from "next/server";

// Auth only engages once Google credentials exist. Without them (local dev
// before setup) the app stays usable instead of locking everyone out.
const AUTH_ENABLED = Boolean(
  process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.AUTH_SECRET
);

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
