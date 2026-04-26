import { NextResponse, type NextRequest } from "next/server";

// Assign a stable, opaque per-browser ID the first time a visitor hits the
// site. The /api/store endpoints use this to namespace saved data so each
// browser sees only its own writes. Cookie is httpOnly so client JS can't
// read or spoof it.
export function middleware(req: NextRequest) {
  const res = NextResponse.next();
  if (!req.cookies.get("wb_uid")) {
    res.cookies.set({
      name: "wb_uid",
      value: crypto.randomUUID(),
      httpOnly: true,
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 365,
      path: "/",
    });
  }
  return res;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
