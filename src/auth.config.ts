import type { NextAuthConfig } from "next-auth";
import Google from "next-auth/providers/google";

// Edge-safe part of the auth setup: no database imports here. The middleware
// bundles this file; the full config with the DB allowlist lives in auth.ts.
const ALLOWED_DOMAIN = process.env.ALLOWED_EMAIL_DOMAIN?.trim().toLowerCase();

export const authConfig = {
  providers: [
    Google({
      // next-auth v5 only auto-reads AUTH_GOOGLE_ID/AUTH_GOOGLE_SECRET; our env
      // uses explicit names, so pass them explicitly.
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      authorization: ALLOWED_DOMAIN
        ? { params: { hd: ALLOWED_DOMAIN, prompt: "select_account" } }
        : { params: { prompt: "select_account" } },
    }),
  ],
  trustHost: true,
  pages: { signIn: "/signin" },
} satisfies NextAuthConfig;
