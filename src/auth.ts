import NextAuth from "next-auth";
import { authConfig } from "./auth.config";
import { supabase } from "@/lib/supabase";

// ---------------------------------------------------------------------------
// Google sign-in with a database allowlist.
//
// Access policy: a Google account gets in ONLY if its email is on the
// team_members table. The domain check is a first gate; the table is the
// source of truth. Adding a teammate = inserting their row (name + email);
// removing one = deleting it.
// ---------------------------------------------------------------------------
const ALLOWED_DOMAIN = process.env.ALLOWED_EMAIL_DOMAIN?.trim().toLowerCase();

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  callbacks: {
    async signIn({ profile }) {
      const email = (profile?.email ?? "").toLowerCase();
      if (!email || profile?.email_verified === false) return false;
      if (ALLOWED_DOMAIN && !email.endsWith(`@${ALLOWED_DOMAIN}`)) return false;

      // Allowlist: only emails present in team_members may sign in.
      const { data } = await supabase
        .from("team_members")
        .select("id")
        .eq("email", email)
        .single();
      return Boolean(data);
    },
    async session({ session }) {
      return session;
    },
  },
});
