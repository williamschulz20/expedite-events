import { signIn, auth } from "@/auth";
import { redirect } from "next/navigation";

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string }>;
}) {
  const session = await auth();
  if (session) redirect("/");
  const { callbackUrl } = await searchParams;
  const domain = process.env.ALLOWED_EMAIL_DOMAIN;

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-sm rounded-2xl border border-gray-200 bg-white p-8 shadow-sm">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gray-900 text-sm font-bold text-white">
            ✳
          </div>
          <div>
            <p className="text-sm font-semibold text-gray-900">Expedite Events</p>
            <p className="text-xs text-gray-400">Founder pipeline</p>
          </div>
        </div>

        <h1 className="text-lg font-semibold text-gray-900">Sign in</h1>
        <p className="mt-1 text-sm text-gray-500">
          {domain
            ? `Use your @${domain} Google account.`
            : "Use your Google account to continue."}
        </p>

        <form
          className="mt-6"
          action={async () => {
            "use server";
            await signIn("google", { redirectTo: callbackUrl || "/" });
          }}
        >
          <button
            type="submit"
            className="flex w-full items-center justify-center gap-3 rounded-lg border border-gray-200 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 transition hover:border-gray-300 hover:bg-gray-50"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" aria-hidden="true">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1z" />
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.65l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0012 23z" />
              <path fill="#FBBC05" d="M5.84 14.11a6.6 6.6 0 010-4.22V7.05H2.18a11 11 0 000 9.9l3.66-2.84z" />
              <path fill="#EA4335" d="M12 4.75c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 1.46 14.97.5 12 .5A11 11 0 002.18 7.05l3.66 2.84c.87-2.6 3.3-4.14 6.16-4.14z" />
            </svg>
            Continue with Google
          </button>
        </form>
      </div>
    </div>
  );
}
