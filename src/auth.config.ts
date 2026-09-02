import type { NextAuthConfig } from "next-auth";
import Google from "next-auth/providers/google";

// Edge-safe part of the auth setup: no database imports here. The middleware
// bundles this file; the full config with the DB allowlist lives in auth.ts.
const ALLOWED_DOMAIN = process.env.ALLOWED_EMAIL_DOMAIN?.trim().toLowerCase();

export const authConfig = {
  providers: [
    Google({
      authorization: ALLOWED_DOMAIN
        ? { params: { hd: ALLOWED_DOMAIN, prompt: "select_account" } }
        : { params: { prompt: "select_account" } },
    }),
  ],
  trustHost: true,
  pages: { signIn: "/signin" },
} satisfies NextAuthConfig;
