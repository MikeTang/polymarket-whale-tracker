# wb-template

Minimal Next.js 16 + Tailwind v4 scaffold used as the starting point for every
Work Buddies project.

## Why this is minimal

When a user asks Work Buddies to build an app, the platform provisions a new
repo from this template via the GitHub API ("Create repository from template"),
then the Developer agent (Dex) edits the code to match what the user wants.

Keeping the template bare means:

- Fewer moving parts to break on the first deploy
- Dex can add only what's needed (state, libraries, UI components) per project
- No env vars, no DB, no auth required to hit "Deploy" on Vercel

For apps that need to persist data, Dex should use the built-in storage
helpers in `lib/storage.ts` (`loadData` / `saveData` / `deleteData`). They
back onto Vercel Blob via the `/api/store/[key]` route, scoped to the
browser's `wb_uid` cookie set by `middleware.ts`. Data survives reloads
and deploys. For truly ephemeral UI state, `localStorage` / `sessionStorage`
are still fine.

For apps that need real accounts (sign-up + sign-in), the platform
provisions auth automatically when the project's `requiresAuth` flag is
set during planning. The template ships with:

- `lib/auth.ts::getSession()` — server helper, returns `{id, email}` or `null`
- `app/sign-in/page.tsx` — email form (magic-link UX)
- `app/api/auth/sign-in/route.ts` — POST `{email}` → emails the link
- `app/api/auth/callback/route.ts` — receives `?ott=...`, sets the
  `wb_session` httpOnly cookie
- `app/api/auth/sign-out/route.ts` — POST → clears the cookie + revokes

`/api/store` automatically uses the authenticated user's id as its blob
namespace when a session cookie is present, falling back to the anonymous
`wb_uid` namespace for non-auth apps or signed-out users.

Required env vars (injected by the platform at provision time, no setup
needed in the generated app): `WB_AUTH_URL`, `WB_AUTH_APP_ID`,
`WB_AUTH_APP_SECRET`, `BLOB_READ_WRITE_TOKEN`.

## Local dev

```sh
pnpm install
pnpm dev
```

## Deployment

Designed to deploy on Vercel with zero config. On `git push`, Vercel detects
Next.js and builds. No environment variables required.
