"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";

const ERR_COPY: Record<string, string> = {
  not_configured: "Sign-in isn't set up for this app yet.",
  missing_ott: "That sign-in link looked incomplete. Try again from the email.",
  verify_failed: "That link has expired or already been used. Request a new one.",
};

// Wrapping in Suspense lets Next.js prerender the static shell at build time
// without bailing on useSearchParams. Without this, `next build` fails with
// "Error occurred prerendering page /sign-in".
export default function SignInPage() {
  return (
    <Suspense fallback={<SignInShell />}>
      <SignInForm />
    </Suspense>
  );
}

function SignInShell() {
  // Static markup that's safe to prerender. Matches SignInForm's chrome so
  // the swap on hydration is invisible.
  return (
    <main className="flex min-h-screen items-center justify-center bg-neutral-50 px-4">
      <div className="w-full max-w-sm rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm">
        <h1 className="mb-1 text-xl font-bold text-neutral-900">Sign in</h1>
        <p className="mb-5 text-sm text-neutral-600">
          We&apos;ll email you a one-tap link. No password needed.
        </p>
      </div>
    </main>
  );
}

function SignInForm() {
  const params = useSearchParams();
  const initialError = params.get("err");
  const [email, setEmail] = useState("");
  const [pending, setPending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(
    initialError ? ERR_COPY[initialError] ?? "Something went wrong." : null
  );

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      const res = await fetch("/api/auth/sign-in", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      if (res.ok) {
        setSent(true);
      } else {
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        setError(
          body.error === "invalid_email"
            ? "That email doesn't look right."
            : "Couldn't send the link. Please try again."
        );
      }
    } catch {
      setError("Couldn't reach the sign-in service. Please try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-neutral-50 px-4">
      <div className="w-full max-w-sm rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm">
        <h1 className="mb-1 text-xl font-bold text-neutral-900">Sign in</h1>
        <p className="mb-5 text-sm text-neutral-600">
          We&apos;ll email you a one-tap link. No password needed.
        </p>

        {sent ? (
          <div className="rounded-lg bg-emerald-50 p-4 text-sm text-emerald-800">
            <strong className="block font-semibold">Check your email.</strong>
            We sent a sign-in link to <span className="font-mono">{email}</span>.
            The link expires in 15 minutes.
          </div>
        ) : (
          <form onSubmit={onSubmit} className="flex flex-col gap-3">
            <label className="flex flex-col gap-1.5 text-sm font-medium text-neutral-800">
              Email
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoFocus
                placeholder="you@example.com"
                className="rounded-lg border border-neutral-300 px-3 py-2 text-base outline-none focus:border-neutral-900"
              />
            </label>
            <button
              type="submit"
              disabled={pending || !email}
              className="rounded-lg bg-neutral-900 px-4 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {pending ? "Sending…" : "Email me a link"}
            </button>
            {error && (
              <p className="text-sm text-rose-600" role="alert">
                {error}
              </p>
            )}
          </form>
        )}
      </div>
    </main>
  );
}
