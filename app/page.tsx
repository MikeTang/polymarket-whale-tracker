"use client";

import { useEffect, useRef, useState } from "react";
import { loadData, saveData } from "@/lib/storage";
import type { WhaleTrade } from "@/app/api/market-trades/route";

// ---------------------------------------------------------------------------
// Persisted shape
// ---------------------------------------------------------------------------

interface PersistedState {
  url: string;
  trades: WhaleTrade[];
  checkedIds: string[];
  fetchedAt: string | null;
}

const STORAGE_KEY = "whale-tracker-state";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatTime(iso: string): { time: string; day: string } {
  const d = new Date(iso);
  const now = new Date();
  const isToday =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const isYesterday =
    d.getFullYear() === yesterday.getFullYear() &&
    d.getMonth() === yesterday.getMonth() &&
    d.getDate() === yesterday.getDate();

  return {
    time: d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    day: isToday ? "Today" : isYesterday ? "Yesterday" : d.toLocaleDateString(),
  };
}

function formatRelative(iso: string | null): string {
  if (!iso) return "—";
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} hr ago`;
  return `${Math.floor(diff / 86400)} days ago`;
}

function truncateConditionId(id: string | undefined): string {
  if (!id) return "—";
  // trades don't carry conditionId; we just show from the URL input
  return id.length > 10 ? `${id.slice(0, 6)}...${id.slice(-4)}` : id;
}

// Extract a rough "ID" from the URL for the info strip (last path segment)
function slugFromUrl(url: string): string {
  try {
    const u = new URL(url.trim());
    const segs = u.pathname.split("/").filter(Boolean);
    const slug = segs[segs.length - 1] ?? "";
    return slug.length > 12 ? `${slug.slice(0, 6)}…${slug.slice(-4)}` : slug;
  } catch {
    return "—";
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function Home() {
  const [url, setUrl] = useState("");
  const [trades, setTrades] = useState<WhaleTrade[]>([]);
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fetchedAt, setFetchedAt] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);

  // Relative-time ticker
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  // -------------------------------------------------------------------------
  // Load persisted state on mount
  // -------------------------------------------------------------------------
  useEffect(() => {
    loadData<PersistedState>(STORAGE_KEY)
      .then((saved) => {
        if (saved) {
          setUrl(saved.url ?? "");
          setTrades(saved.trades ?? []);
          setCheckedIds(new Set(saved.checkedIds ?? []));
          setFetchedAt(saved.fetchedAt ?? null);
        }
      })
      .catch(() => {
        // Non-fatal: start fresh if storage fails
      })
      .finally(() => setHydrated(true));
  }, []);

  // -------------------------------------------------------------------------
  // Persist state whenever it meaningfully changes (skip pre-hydration)
  // -------------------------------------------------------------------------
  const persistRef = useRef(false);
  useEffect(() => {
    if (!hydrated) return;
    // Debounce to avoid hammering the API on every keystroke
    const timer = setTimeout(() => {
      const state: PersistedState = {
        url,
        trades,
        checkedIds: Array.from(checkedIds),
        fetchedAt,
      };
      saveData(STORAGE_KEY, state).catch(() => {});
    }, 500);
    persistRef.current = true;
    return () => clearTimeout(timer);
  }, [url, trades, checkedIds, fetchedAt, hydrated]);

  // -------------------------------------------------------------------------
  // Fetch trades
  // -------------------------------------------------------------------------
  async function handleFetch() {
    if (!url.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/market-trades?url=${encodeURIComponent(url.trim())}`
      );
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `HTTP ${res.status}`);
      }
      const data: WhaleTrade[] = await res.json();
      setTrades(data);
      setCheckedIds(new Set()); // reset checks on fresh fetch
      setFetchedAt(new Date().toISOString());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  // -------------------------------------------------------------------------
  // Checklist actions
  // -------------------------------------------------------------------------
  function toggleCheck(id: string) {
    setCheckedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function clearAll() {
    setCheckedIds(new Set());
  }

  // Sort: unchecked first, checked last
  const sortedTrades = [...trades].sort((a, b) => {
    const aChecked = checkedIds.has(a.id) ? 1 : 0;
    const bChecked = checkedIds.has(b.id) ? 1 : 0;
    return aChecked - bChecked;
  });

  const remaining = trades.filter((t) => !checkedIds.has(t.id)).length;

  // Derive market title from first trade (they all share the same market)
  const marketTitle = trades[0]?.marketTitle ?? null;

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------
  return (
    <>
      {/* ------------------------------------------------------------------ */}
      {/* Header */}
      {/* ------------------------------------------------------------------ */}
      <header className="border-b border-gray-800 bg-gray-950/80 backdrop-blur sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center text-lg">
              🐋
            </div>
            <div>
              <h1 className="text-base font-bold text-white leading-none">
                Whale Tracker
              </h1>
              <p className="text-xs text-gray-500 mt-0.5">
                Polymarket → Kalshi copy-trade assistant
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 text-xs text-emerald-400 font-medium">
            <span className="w-2 h-2 rounded-full bg-emerald-400 pulse-dot" />
            Live
          </div>
        </div>
      </header>

      {/* ------------------------------------------------------------------ */}
      {/* Main */}
      {/* ------------------------------------------------------------------ */}
      <main className="max-w-5xl mx-auto px-6 py-8 space-y-6">
        {/* URL Input Card */}
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 whale-glow">
          <label className="block text-sm font-semibold text-gray-300 mb-2">
            Polymarket Market URL
          </label>
          <p className="text-xs text-gray-500 mb-4">
            Paste a market URL — the app extracts the market ID and fetches
            trades over $1,000.
          </p>
          <div className="flex gap-3">
            <input
              type="text"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleFetch()}
              placeholder="https://polymarket.com/event/..."
              className="flex-1 bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent font-mono"
            />
            <button
              onClick={handleFetch}
              disabled={loading || !url.trim()}
              className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold text-sm px-5 py-3 rounded-xl transition-colors whitespace-nowrap flex items-center gap-2"
            >
              {loading ? (
                <>
                  <svg
                    className="animate-spin h-4 w-4"
                    viewBox="0 0 24 24"
                    fill="none"
                  >
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                    />
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8v8H4z"
                    />
                  </svg>
                  Fetching…
                </>
              ) : (
                <>
                  <span>⚡</span> Fetch Trades
                </>
              )}
            </button>
          </div>

          {/* Info strip */}
          <div className="mt-3 flex items-center gap-4 text-xs text-gray-500 flex-wrap">
            {url.trim() && (
              <>
                <span>
                  Extracted ID:{" "}
                  <code className="text-indigo-400 bg-indigo-950 px-1.5 py-0.5 rounded">
                    {slugFromUrl(url)}
                  </code>
                </span>
                <span>•</span>
              </>
            )}
            <span>
              Min trade size:{" "}
              <span className="text-white font-medium">$1,000</span>
            </span>
            {fetchedAt && (
              <>
                <span>•</span>
                <span>
                  Last fetched:{" "}
                  <span className="text-white">{formatRelative(fetchedAt)}</span>
                </span>
              </>
            )}
          </div>

          {/* Error */}
          {error && (
            <div className="mt-3 text-xs text-red-400 bg-red-950/50 border border-red-900 rounded-lg px-3 py-2">
              {error}
            </div>
          )}
        </div>

        {/* Market Info Banner — shown once we have trades */}
        {marketTitle && (
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-xs font-medium text-indigo-400 uppercase tracking-wider mb-1">
                  Active Market
                </div>
                <h2 className="text-lg font-bold text-white leading-snug">
                  {marketTitle}
                </h2>
                <div className="flex items-center gap-4 mt-2 text-sm text-gray-400">
                  <span>
                    {trades.length} whale trade
                    {trades.length !== 1 ? "s" : ""} found
                  </span>
                </div>
              </div>
              {/* YES / NO price pills derived from last trade prices */}
              {trades.length > 0 && (
                <div className="flex gap-3 shrink-0">
                  {/* Show YES price from most recent YES trade, NO price from most recent NO trade */}
                  {(() => {
                    const yesPrice = trades.find((t) => t.side === "YES")?.price;
                    const noPrice = trades.find((t) => t.side === "NO")?.price;
                    return (
                      <>
                        {yesPrice !== undefined && (
                          <div className="text-center bg-emerald-950 border border-emerald-800 rounded-xl px-4 py-2">
                            <div className="text-xl font-bold text-emerald-400">
                              {Math.round(yesPrice * 100)}¢
                            </div>
                            <div className="text-xs text-emerald-600 font-medium mt-0.5">
                              YES
                            </div>
                          </div>
                        )}
                        {noPrice !== undefined && (
                          <div className="text-center bg-red-950 border border-red-900 rounded-xl px-4 py-2">
                            <div className="text-xl font-bold text-red-400">
                              {Math.round(noPrice * 100)}¢
                            </div>
                            <div className="text-xs text-red-600 font-medium mt-0.5">
                              NO
                            </div>
                          </div>
                        )}
                      </>
                    );
                  })()}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Empty state — after a fetch returns nothing */}
        {!loading && fetchedAt && trades.length === 0 && (
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-10 text-center">
            <div className="text-3xl mb-3">🔍</div>
            <p className="text-gray-400 font-medium">No whale trades found</p>
            <p className="text-xs text-gray-600 mt-1">
              No trades over $1,000 in the most recent 500 trades for this
              market.
            </p>
          </div>
        )}

        {/* Whale Trades Checklist */}
        {trades.length > 0 && (
          <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
            {/* Header */}
            <div className="px-6 py-4 border-b border-gray-800 flex items-center justify-between">
              <div>
                <h3 className="font-bold text-white">Whale Trades</h3>
                <p className="text-xs text-gray-500 mt-0.5">
                  Showing {trades.length} trade
                  {trades.length !== 1 ? "s" : ""} over $1,000 · Check off as
                  you mirror on Kalshi
                </p>
              </div>
              <div className="flex items-center gap-3">
                {remaining > 0 && (
                  <span className="text-xs bg-amber-950 text-amber-400 border border-amber-800 px-2.5 py-1 rounded-full font-medium">
                    {remaining} remaining
                  </span>
                )}
                {remaining === 0 && trades.length > 0 && (
                  <span className="text-xs bg-emerald-950 text-emerald-400 border border-emerald-800 px-2.5 py-1 rounded-full font-medium">
                    All done ✓
                  </span>
                )}
                {checkedIds.size > 0 && (
                  <button
                    onClick={clearAll}
                    className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
                  >
                    Clear all
                  </button>
                )}
              </div>
            </div>

            {/* Table */}
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-gray-500 uppercase tracking-wider border-b border-gray-800">
                    <th className="px-6 py-3 text-left w-10" />
                    <th className="px-4 py-3 text-left">Time</th>
                    <th className="px-4 py-3 text-left">Side</th>
                    <th className="px-4 py-3 text-right">Size (USD)</th>
                    <th className="px-4 py-3 text-right">Price</th>
                    <th className="px-4 py-3 text-right">Implied Odds</th>
                    <th className="px-4 py-3 text-right">Shares</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-800/60">
                  {sortedTrades.map((trade) => {
                    const checked = checkedIds.has(trade.id);
                    const { time, day } = formatTime(trade.timestamp);
                    // shares = usdSize / price (approx)
                    const shares =
                      trade.price > 0
                        ? Math.round(trade.usdSize / trade.price)
                        : 0;

                    return (
                      <tr
                        key={trade.id}
                        onClick={() => toggleCheck(trade.id)}
                        className={`transition-colors cursor-pointer ${
                          checked
                            ? "checked-row"
                            : "hover:bg-gray-800/40"
                        }`}
                      >
                        {/* Checkbox */}
                        <td className="px-6 py-4">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleCheck(trade.id)}
                            onClick={(e) => e.stopPropagation()}
                            className="w-4 h-4 rounded accent-indigo-500 cursor-pointer"
                          />
                        </td>

                        {/* Time */}
                        <td className="px-4 py-4 whitespace-nowrap">
                          <div className="font-medium text-gray-200">{time}</div>
                          <div className="text-xs text-gray-600">{day}</div>
                        </td>

                        {/* Side badge */}
                        <td className="px-4 py-4">
                          {trade.side === "YES" ? (
                            <span className="badge inline-flex items-center gap-1 bg-emerald-950 text-emerald-400 border border-emerald-800 text-xs font-bold px-2.5 py-1 rounded-full">
                              ▲ YES
                            </span>
                          ) : (
                            <span className="badge inline-flex items-center gap-1 bg-red-950 text-red-400 border border-red-900 text-xs font-bold px-2.5 py-1 rounded-full">
                              ▼ NO
                            </span>
                          )}
                        </td>

                        {/* Size */}
                        <td className="px-4 py-4 text-right font-bold text-white text-base">
                          ${trade.usdSize.toLocaleString()}
                        </td>

                        {/* Price */}
                        <td className="px-4 py-4 text-right text-gray-300 font-mono">
                          ${trade.price.toFixed(2)}
                        </td>

                        {/* Implied odds */}
                        <td className="px-4 py-4 text-right">
                          <span
                            className={
                              trade.side === "YES"
                                ? "text-emerald-400 font-semibold"
                                : "text-red-400 font-semibold"
                            }
                          >
                            {Math.round(trade.price * 100)}%
                          </span>
                        </td>

                        {/* Shares */}
                        <td className="px-4 py-4 text-right text-gray-400 font-mono">
                          {shares.toLocaleString()}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Initial empty state — before first fetch */}
        {!fetchedAt && !loading && (
          <div className="bg-gray-900 border border-gray-800 border-dashed rounded-2xl p-12 text-center">
            <div className="text-4xl mb-4">🐋</div>
            <p className="text-gray-400 font-medium text-lg">
              Paste a Polymarket URL above
            </p>
            <p className="text-xs text-gray-600 mt-2 max-w-xs mx-auto">
              Trades over $1,000 will appear here. Check them off as you mirror
              each bet on Kalshi.
            </p>
          </div>
        )}
      </main>
    </>
  );
}
