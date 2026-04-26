import { cookies } from "next/headers";
import { put, head, del } from "@vercel/blob";
import { getSession } from "@/lib/auth";

export const runtime = "nodejs";

// Keys are sanitised so callers can't escape their per-user prefix with
// ".." or slashes. Result is lowercased a–z/0–9/_/-, clipped to 200 chars.
function sanitiseKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9_-]/g, "_").slice(0, 200);
}

/**
 * Returns the storage namespace prefix:
 *   "user/<authUserId>" if the visitor is signed in via the platform auth
 *   "anon/<wb_uid>"     if they only have the anonymous browser cookie
 *   null                if neither is present (rare — middleware sets wb_uid)
 *
 * Authenticated and anonymous data live in separate prefixes so that
 * signing out cleanly hides authed data without leaking it into the
 * anonymous namespace.
 */
async function getStorageNamespace(): Promise<string | null> {
  const session = await getSession();
  if (session) return `user/${session.id}`;

  const c = await cookies();
  const wbUid = c.get("wb_uid")?.value;
  if (wbUid) return `anon/${wbUid}`;

  return null;
}

function blobPath(ns: string, key: string): string {
  return `data/${ns}/${sanitiseKey(key)}.json`;
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ key: string }> }
) {
  const ns = await getStorageNamespace();
  if (!ns) return new Response("no session cookie", { status: 401 });
  const { key } = await params;
  const path = blobPath(ns, key);

  // head() throws if the blob doesn't exist.
  let url: string;
  try {
    const meta = await head(path);
    url = meta.url;
  } catch {
    return new Response(null, { status: 404 });
  }

  // Fetch the blob content server-side and return it. The blob URL itself
  // is never exposed to the client — treats stored data as "private by
  // obscurity" since Vercel Blob is public-by-URL.
  const r = await fetch(url, { cache: "no-store" });
  const body = await r.text();
  return new Response(body, {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ key: string }> }
) {
  const ns = await getStorageNamespace();
  if (!ns) return new Response("no session cookie", { status: 401 });
  const { key } = await params;
  const path = blobPath(ns, key);
  const body = await req.text();
  try {
    JSON.parse(body);
  } catch {
    return new Response("body must be valid JSON", { status: 400 });
  }
  if (body.length > 4 * 1024 * 1024) {
    return new Response("body too large (4MB limit)", { status: 413 });
  }

  await put(path, body, {
    access: "public",
    contentType: "application/json",
    allowOverwrite: true,
    addRandomSuffix: false,
  });
  return new Response(null, { status: 204 });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ key: string }> }
) {
  const ns = await getStorageNamespace();
  if (!ns) return new Response("no session cookie", { status: 401 });
  const { key } = await params;
  const path = blobPath(ns, key);
  try {
    await del(path);
  } catch {
    // del() throws on missing blobs; treat as idempotent success.
  }
  return new Response(null, { status: 204 });
}
