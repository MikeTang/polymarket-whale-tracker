/**
 * POST /api/auth/sign-in   { email }
 *
 * Calls the platform auth service to email a one-tap magic link to the
 * given address. The link points back at /api/auth/callback?ott=... in
 * this app, where the OTT is exchanged for a session cookie.
 *
 * Caller-facing response is intentionally vague — we always return ok if
 * the upstream service accepted the request, regardless of whether the
 * email exists. This prevents enumeration of registered emails.
 */

export const runtime = "nodejs";

export async function POST(req: Request) {
  const authUrl = process.env.WB_AUTH_URL;
  const appId = process.env.WB_AUTH_APP_ID;
  const appSecret = process.env.WB_AUTH_APP_SECRET;
  if (!authUrl || !appId || !appSecret) {
    return Response.json(
      { error: "auth_not_configured" },
      { status: 503 }
    );
  }

  let email = "";
  try {
    const body = (await req.json()) as { email?: string };
    email = (body.email ?? "").trim();
  } catch {
    return Response.json({ error: "invalid_body" }, { status: 400 });
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return Response.json({ error: "invalid_email" }, { status: 400 });
  }

  const res = await fetch(`${authUrl}/v1/sign-in/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ appId, appSecret, email }),
  });

  if (!res.ok) {
    const text = await res.text();
    console.error("[sign-in] upstream error", res.status, text.slice(0, 200));
    return Response.json({ error: "send_failed" }, { status: 502 });
  }

  return Response.json({ ok: true });
}
