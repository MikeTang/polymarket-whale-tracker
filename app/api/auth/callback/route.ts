/**
 * GET /api/auth/callback?ott=...
 *
 * Landing page for the magic link. The platform auth service redirects the
 * user here after they click their email link, with a one-time token in
 * the query string. We exchange it for a session token (server-to-server,
 * with our app secret), set an httpOnly wb_session cookie, and redirect
 * to the home page.
 *
 * Errors are surfaced as ?err= on /sign-in so the user sees a useful
 * message instead of a blank page.
 */

import { cookies } from "next/headers";

export const runtime = "nodejs";

const SESSION_COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // 30 days, matches server-side TTL

export async function GET(req: Request) {
  const authUrl = process.env.WB_AUTH_URL;
  const appId = process.env.WB_AUTH_APP_ID;
  const appSecret = process.env.WB_AUTH_APP_SECRET;
  if (!authUrl || !appId || !appSecret) {
    return Response.redirect(new URL("/sign-in?err=not_configured", req.url), 302);
  }

  const url = new URL(req.url);
  const ott = url.searchParams.get("ott");
  if (!ott) {
    return Response.redirect(new URL("/sign-in?err=missing_ott", req.url), 302);
  }

  const res = await fetch(`${authUrl}/v1/sign-in/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ appId, appSecret, ott }),
  });
  if (!res.ok) {
    return Response.redirect(new URL("/sign-in?err=verify_failed", req.url), 302);
  }

  const body = (await res.json()) as { sessionToken: string };
  const c = await cookies();
  c.set({
    name: "wb_session",
    value: body.sessionToken,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: SESSION_COOKIE_MAX_AGE,
    path: "/",
  });

  return Response.redirect(new URL("/", req.url), 302);
}
