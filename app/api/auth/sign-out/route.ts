/**
 * POST /api/auth/sign-out
 *
 * Revokes the current session server-side and clears the wb_session cookie.
 * Idempotent — succeeds even if there's no cookie or the token's invalid.
 */

import { cookies } from "next/headers";

export const runtime = "nodejs";

export async function POST() {
  const c = await cookies();
  const token = c.get("wb_session")?.value;

  if (token && process.env.WB_AUTH_URL) {
    // Best-effort upstream revoke — don't block the cookie clear if the
    // auth service is briefly unreachable.
    await fetch(`${process.env.WB_AUTH_URL}/v1/sign-out`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionToken: token }),
    }).catch(() => undefined);
  }

  c.delete("wb_session");
  return Response.json({ ok: true });
}
