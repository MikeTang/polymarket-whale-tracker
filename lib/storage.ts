// Persistent per-browser storage for Work Buddies apps.
//
// Each browser is assigned an httpOnly cookie (`wb_uid`) on first visit by
// middleware.ts. These helpers read/write JSON under that ID via /api/store.
// Data survives across reloads, tabs, and deploys; it does NOT sync across
// devices (no login — only the cookie knows who "you" are).
//
// Use this INSTEAD of localStorage whenever you need persistence. localStorage
// is fine for truly ephemeral UI state (current tab, last-viewed screen);
// for game progress, saved drawings, todo lists, settings, use these.
//
// Size limit per key: 4MB. Don't store secrets — the data is pseudonymous
// (cookie-keyed), not authenticated.

export async function loadData<T = unknown>(key: string): Promise<T | null> {
  const res = await fetch(`/api/store/${encodeURIComponent(key)}`, {
    cache: "no-store",
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`loadData(${key}): ${res.status}`);
  return (await res.json()) as T;
}

export async function saveData<T>(key: string, value: T): Promise<void> {
  const res = await fetch(`/api/store/${encodeURIComponent(key)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(value),
  });
  if (!res.ok) throw new Error(`saveData(${key}): ${res.status}`);
}

export async function deleteData(key: string): Promise<void> {
  const res = await fetch(`/api/store/${encodeURIComponent(key)}`, {
    method: "DELETE",
  });
  if (!res.ok && res.status !== 404) {
    throw new Error(`deleteData(${key}): ${res.status}`);
  }
}
