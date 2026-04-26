import { cookies } from "next/headers";

/**
 * Look up the currently signed-in user, if any.
 *
 * Reads the wb_session cookie and validates it against the platform auth
 * service. Returns null if there's no cookie, the cookie is invalid or
 * expired, or the auth service is unreachable.
 *
 * Use this in server components, route handlers, and middleware. For
 * client components, fetch /api/auth/me which calls this for you.
 *
 * Wired automatically when the project was provisioned with auth enabled
 * (PM agent set requiresAuth: true). No env vars to set yourself.
 */
export interface SessionUser {
  id: string;
  email: string;
}

export async function getSession(): Promise<SessionUser | null> {
  const authUrl = process.env.WB_AUTH_URL;
  if (!authUrl) return null;

  const c = await cookies();
  const token = c.get("wb_session")?.value;
  if (!token) return null;

  const res = await fetch(`${authUrl}/v1/session`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!res.ok) return null;
  const body = (await res.json()) as { user?: SessionUser };
  return body.user ?? null;
}
