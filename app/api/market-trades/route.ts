/**
 * GET /api/market-trades?url=<polymarket_market_url>
 *
 * 1. Extracts the market slug from the Polymarket URL.
 * 2. Calls the Gamma API to resolve market metadata (title, conditionId).
 * 3. Calls the Polymarket CLOB API to fetch recent trades for that market.
 * 4. Filters to trades ≥ $1,000 (size × price = USD notional).
 * 5. Returns a JSON array of whale trades.
 *
 * All external calls are server-side — no API keys required (public endpoints).
 *
 * Edge cases handled:
 *  - Malformed / non-Polymarket URLs → 400
 *  - Market not found on Gamma → 404
 *  - CLOB returns no trades at all → empty array (not an error)
 *  - Unexpected upstream shape → graceful skip of malformed rows
 */

import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

// ---------------------------------------------------------------------------
// Public types (consumed by the UI)
// ---------------------------------------------------------------------------

export interface WhaleTrade {
  /** Unique trade ID from the CLOB (used as React key & persistence key) */
  id: string;
  /** Human-readable market title from Gamma */
  marketTitle: string;
  /** Notional USD value of the trade (size × price, rounded to 2dp) */
  usdSize: number;
  /** Price per share in USD (0–1 range) */
  price: number;
  /** Which side the taker was buying */
  side: "YES" | "NO";
  /** ISO-8601 timestamp */
  timestamp: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extract the market slug from a Polymarket URL.
 *
 * Supported formats:
 *   https://polymarket.com/event/<event-slug>/<market-slug>
 *   https://polymarket.com/market/<market-slug>
 *
 * Returns the last non-empty path segment, which is the market-specific slug
 * used as `slug` in the Gamma API.
 */
function extractSlug(rawUrl: string): string | null {
  let u: URL;
  try {
    u = new URL(rawUrl.trim());
  } catch {
    return null;
  }

  if (!u.hostname.includes("polymarket.com")) return null;

  // Remove leading/trailing slashes then take the last segment.
  const segments = u.pathname.split("/").filter(Boolean);
  // Must have at least one meaningful segment after the type prefix
  // e.g. ["event", "<event-slug>", "<market-slug>"] or ["market", "<slug>"]
  if (segments.length < 2) return null;

  return segments[segments.length - 1];
}

// ---------------------------------------------------------------------------
// Gamma API
// ---------------------------------------------------------------------------

interface GammaMarket {
  id: string;
  question: string;
  conditionId: string;
  slug: string;
  // There are more fields but we only need these.
}

/**
 * Resolve slug → conditionId + title via the Polymarket Gamma API.
 * Docs: https://gamma-api.polymarket.com
 */
async function resolveMarketFromGamma(
  slug: string
): Promise<{ conditionId: string; title: string } | null> {
  const url = `https://gamma-api.polymarket.com/markets?slug=${encodeURIComponent(slug)}&limit=1`;

  const res = await fetch(url, {
    headers: { Accept: "application/json" },
    // 10-second hard timeout so the route doesn't stall on a slow upstream
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok) return null;

  const data: GammaMarket[] = await res.json();
  if (!Array.isArray(data) || data.length === 0) return null;

  const market = data[0];
  if (!market.conditionId || !market.question) return null;

  return {
    conditionId: market.conditionId,
    title: market.question,
  };
}

// ---------------------------------------------------------------------------
// CLOB trades API
// ---------------------------------------------------------------------------

interface ClobTrade {
  id: string;
  /** taker side: "BUY" or "SELL" */
  side: string;
  /** number of shares as a string */
  size: string;
  /** price per share as a string (0–1) */
  price: string;
  /** unix timestamp seconds as a number or string */
  timestamp: number | string;
  /** outcome token label, e.g. "Yes", "No" */
  outcome?: string;
  // CLOB also returns maker_order_id, taker_order_id, etc.
}

interface ClobTradeResponse {
  data: ClobTrade[];
  next_cursor?: string;
}

const CLOB_BASE = "https://clob.polymarket.com";
const MIN_USD = 1_000;
/** Maximum trades to fetch from CLOB in one call (API max is 500) */
const CLOB_LIMIT = 500;

/**
 * Fetch recent trades from the CLOB API for the given conditionId.
 * Returns raw CLOB trade objects (up to CLOB_LIMIT).
 *
 * Security note: conditionId is a hex string from Gamma; we validate format
 * before embedding it in the URL to prevent SSRF via crafted slugs.
 */
async function fetchClobTrades(conditionId: string): Promise<ClobTrade[]> {
  // Validate conditionId: must be a 0x-prefixed hex string (66 chars) or
  // plain 64-char hex. Gamma always returns 0x-prefixed.
  if (!/^(0x)?[0-9a-fA-F]{40,66}$/.test(conditionId)) {
    throw new Error(`Unexpected conditionId format: ${conditionId}`);
  }

  const url = `${CLOB_BASE}/trades?market=${encodeURIComponent(conditionId)}&limit=${CLOB_LIMIT}`;

  const res = await fetch(url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok) {
    throw new Error(`CLOB API error: ${res.status}`);
  }

  const body: ClobTradeResponse = await res.json();
  return Array.isArray(body.data) ? body.data : [];
}

// ---------------------------------------------------------------------------
// Transform
// ---------------------------------------------------------------------------

/**
 * Map a raw CLOB trade to a WhaleTrade, or return null if the row is
 * malformed or below the threshold.
 *
 * The CLOB `size` field is shares (tokens), and `price` is per-share in USD.
 * notional = size × price.
 *
 * The `side` field on a CLOB trade is the *taker* side (BUY/SELL).
 * A taker BUY means they're buying YES shares → YES.
 * A taker SELL means they're selling YES shares back → NO directionally.
 * We map taker BUY → YES and taker SELL → NO for simplicity.
 *
 * Note: `outcome` from CLOB directly says "Yes"/"No" for the token traded;
 * we prefer that when available.
 */
function toWhaleTrade(raw: ClobTrade, marketTitle: string): WhaleTrade | null {
  const size = parseFloat(raw.size);
  const price = parseFloat(raw.price);

  if (isNaN(size) || isNaN(price) || price <= 0 || size <= 0) return null;

  const usdSize = Math.round(size * price * 100) / 100;
  if (usdSize < MIN_USD) return null;

  // Determine side: prefer explicit outcome field, fall back to taker side
  let side: "YES" | "NO";
  if (raw.outcome) {
    side = raw.outcome.toUpperCase().startsWith("Y") ? "YES" : "NO";
  } else {
    side = raw.side?.toUpperCase() === "BUY" ? "YES" : "NO";
  }

  // Normalise timestamp → ISO-8601
  const ts = typeof raw.timestamp === "string" ? parseFloat(raw.timestamp) : raw.timestamp;
  const timestamp = isNaN(ts)
    ? new Date().toISOString()
    : new Date(ts * 1000).toISOString();

  return {
    id: raw.id,
    marketTitle,
    usdSize,
    price: Math.round(price * 10_000) / 10_000,
    side,
    timestamp,
  };
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function GET(req: NextRequest) {
  const rawUrl = req.nextUrl.searchParams.get("url");

  if (!rawUrl) {
    return NextResponse.json(
      { error: "Missing `url` query parameter" },
      { status: 400 }
    );
  }

  // Step 1 — extract slug
  const slug = extractSlug(rawUrl);
  if (!slug) {
    return NextResponse.json(
      { error: "Could not parse a market slug from the given URL. Make sure it's a valid polymarket.com market URL." },
      { status: 400 }
    );
  }

  // Step 2 — resolve via Gamma
  let market: { conditionId: string; title: string } | null;
  try {
    market = await resolveMarketFromGamma(slug);
  } catch (err) {
    console.error("[market-trades] Gamma fetch error:", err);
    return NextResponse.json(
      { error: "Failed to contact Polymarket API. Try again shortly." },
      { status: 502 }
    );
  }

  if (!market) {
    return NextResponse.json(
      { error: `No market found for slug "${slug}". Double-check the URL.` },
      { status: 404 }
    );
  }

  // Step 3 — fetch CLOB trades
  let rawTrades: ClobTrade[];
  try {
    rawTrades = await fetchClobTrades(market.conditionId);
  } catch (err) {
    console.error("[market-trades] CLOB fetch error:", err);
    return NextResponse.json(
      { error: "Failed to fetch trades from Polymarket. Try again shortly." },
      { status: 502 }
    );
  }

  // Step 4 — filter & transform (skip malformed rows silently)
  const whaleTrades: WhaleTrade[] = rawTrades
    .map((t) => toWhaleTrade(t, market.title))
    .filter((t): t is WhaleTrade => t !== null)
    // Most recent first
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  return NextResponse.json(
    {
      marketTitle: market.title,
      conditionId: market.conditionId,
      trades: whaleTrades,
      totalFetched: rawTrades.length,
      minUsd: MIN_USD,
    },
    {
      status: 200,
      headers: {
        // Data is ~30s delayed per Polymarket; allow browsers/CDN to cache briefly
        "Cache-Control": "public, s-maxage=30, stale-while-revalidate=60",
      },
    }
  );
}
