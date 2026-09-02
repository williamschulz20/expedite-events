import NextAuth from "next-auth";
import Google from "next-auth/providers/google";

// ---------------------------------------------------------------------------
// Google sign-in.
//
// Replaces the "Who are you?" profile picker, which was not authentication:
// anyone could claim to be anyone, and the deployed URL would be wide open.
//
// ALLOWED_EMAIL_DOMAIN (e.g. "expedite.now") restricts sign-in to the company
// Google Workspace. Leave it unset to allow any Google account.
// ---------------------------------------------------------------------------
const ALLOWED_DOMAIN = process.env.ALLOWED_EMAIL_DOMAIN?.trim().toLowerCase();

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    Google({
      // Nudges Google's account chooser toward the right workspace. This is a
      // hint only; the real check is in signIn below.
      authorization: ALLOWED_DOMAIN
        ? { params: { hd: ALLOWED_DOMAIN, prompt: "select_account" } }
        : { params: { prompt: "select_account" } },
    }),
  ],
  trustHost: true,
  callbacks: {
    async signIn({ profile }) {
      if (!ALLOWED_DOMAIN) return true;
      const email = (profile?.email ?? "").toLowerCase();
      // Verify the domain ourselves; the hd param alone is not a security control.
      return email.endsWith(`@${ALLOWED_DOMAIN}`) && profile?.email_verified !== false;
    },
    async session({ session }) {
      return session;
    },
  },
  pages: { signIn: "/signin" },
});
