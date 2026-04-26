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

// Extract a rough "slug" from the URL for the info strip (last path segment)
function slugFromUrl(url: string): string {
  try {
    const u = new URL(url.trim());
    const segs = u.pathname.split("/").filter(Boolean);
    const slug = segs[segs.length - 1] ?? "";
    return slug.length > 14 ? `${slug.slice(0, 8)}…${slug.slice(-4)}` : slug;
  } catch {
    return "—";
  }
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function SideBadge({ side, checked }: { side: string; checked: boolean }) {
  if (checked) {
    return (
      <span className="badge inline-flex items-center gap-1 bg-gray-800 text-gray-500 border border-gray-700 text-xs font-bold px-2.5 py-1 rounded-full tracking-wide">
        {side === "YES" ? "▲" : "▼"} {side}
      </span>
    );
  }
  if (side === "YES") {
    return (
      <span className="badge inline-flex items-center gap-1 bg-emerald-950 text-emerald-400 border border-emerald-800 text-xs font-bold px-2.5 py-1 rounded-full tracking-wide">
        ▲ YES
      </span>
    );
  }
  return (
    <span className="badge inline-flex items-center gap-1 bg-red-950 text-red-400 border border-red-900 text-xs font-bold px-2.5 py-1 rounded-full tracking-wide">
      ▼ NO
    </span>
  );
}

function SpinnerIcon() {
  return (
    <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
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
  );
}

function CheckIcon() {
  return (
    <svg
      className="w-3.5 h-3.5 text-indigo-500"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M5 13l4 4L19 7"
      />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Main component
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

  // Sort: unchecked first (newest at top within group), checked last
  const sortedTrades = [...trades].sort((a, b) => {
    const aChecked = checkedIds.has(a.id) ? 1 : 0;
    const bChecked = checkedIds.has(b.id) ? 1 : 0;
    return aChecked - bChecked;
  });

  const remaining = trades.filter((t) => !checkedIds.has(t.id)).length;
  const marketTitle = trades[0]?.marketTitle ?? null;

  // Aggregate stats
  const totalVolume = trades.reduce((sum, t) => sum + t.usdSize, 0);
  const yesFlow = trades
    .filter((t) => t.side === "YES")
    .reduce((sum, t) => sum + t.usdSize, 0);
  const noFlow = trades
    .filter((t) => t.side === "NO")
    .reduce((sum, t) => sum + t.usdSize, 0);

  // Representative prices for the market info banner
  const yesPrice = trades.find((t) => t.side === "YES")?.price;
  const noPrice = trades.find((t) => t.side === "NO")?.price;

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------
  return (
    <>
      {/* ------------------------------------------------------------------ */}
      {/* Header                                                              */}
      {/* ------------------------------------------------------------------ */}
      <header className="border-b border-gray-800 bg-gray-950/80 backdrop-blur sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center text-lg shadow-lg shadow-indigo-900/40">
              🐋
            </div>
            <div>
              <h1 className="text-base font-bold text-white leading-none tracking-tight">
                Whale Tracker
              </h1>
              <p className="text-xs text-gray-500 mt-0.5">
                Polymarket → Kalshi copy-trade assistant
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 text-xs text-emerald-400 font-semibold">
            <span className="w-2 h-2 rounded-full bg-emerald-400 pulse-dot" />
            Live
          </div>
        </div>
      </header>

      {/* ------------------------------------------------------------------ */}
      {/* Main                                                                */}
      {/* ------------------------------------------------------------------ */}
      <main className="max-w-5xl mx-auto px-6 py-8 space-y-5">

        {/* ---------------------------------------------------------------- */}
        {/* URL Input Card                                                    */}
        {/* ---------------------------------------------------------------- */}
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 whale-glow">
          <label className="block text-sm font-semibold text-gray-200 mb-1">
            Polymarket Market URL
          </label>
          <p className="text-xs text-gray-500 mb-4 leading-relaxed">
            Paste a market URL — the app extracts the market ID and fetches
            trades over <span className="text-white font-medium">$1,000</span>.
          </p>
          <div className="flex gap-3">
            <input
              type="text"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleFetch()}
              placeholder="https://polymarket.com/event/..."
              className="flex-1 bg-gray-800/80 border border-gray-700 rounded-xl px-4 py-3 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 font-mono transition-all"
            />
            <button
              onClick={handleFetch}
              disabled={loading || !url.trim()}
              className="bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold text-sm px-6 py-3 rounded-xl transition-all shadow-lg shadow-indigo-900/30 whitespace-nowrap flex items-center gap-2"
            >
              {loading ? (
                <>
                  <SpinnerIcon />
                  Fetching…
                </>
              ) : (
                <>
                  <span>⚡</span>
                  Fetch Trades
                </>
              )}
            </button>
          </div>

          {/* Info strip */}
          <div className="mt-3 flex items-center gap-3 text-xs text-gray-500 flex-wrap">
            {url.trim() && (
              <>
                <span>
                  Extracted ID:{" "}
                  <code className="text-indigo-400 bg-indigo-950/80 border border-indigo-900/60 px-1.5 py-0.5 rounded text-[11px]">
                    {slugFromUrl(url)}
                  </code>
                </span>
                <span className="text-gray-700">•</span>
              </>
            )}
            <span>
              Min size:{" "}
              <span className="text-gray-300 font-medium">$1,000</span>
            </span>
            {fetchedAt && (
              <>
                <span className="text-gray-700">•</span>
                <span>
                  Last fetched:{" "}
                  <span className="text-gray-300">
                    {formatRelative(fetchedAt)}
                  </span>
                </span>
              </>
            )}
          </div>
        </div>

        {/* ---------------------------------------------------------------- */}
        {/* Error banner                                                      */}
        {/* ---------------------------------------------------------------- */}
        {error && (
          <div className="bg-red-950/60 border border-red-800/60 rounded-xl px-5 py-4 flex items-start gap-3">
            <span className="text-red-400 text-lg leading-none mt-0.5">⚠</span>
            <div>
              <p className="text-red-300 font-semibold text-sm">
                Failed to fetch trades
              </p>
              <p className="text-red-400/80 text-xs mt-0.5">{error}</p>
            </div>
          </div>
        )}

        {/* ---------------------------------------------------------------- */}
        {/* Loading skeleton                                                  */}
        {/* ---------------------------------------------------------------- */}
        {loading && (
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 space-y-3 animate-pulse">
            <div className="h-4 bg-gray-800 rounded w-2/5" />
            <div className="h-3 bg-gray-800 rounded w-1/3" />
            <div className="mt-4 space-y-2">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-12 bg-gray-800/70 rounded-lg" />
              ))}
            </div>
          </div>
        )}

        {/* ---------------------------------------------------------------- */}
        {/* Market info banner                                                */}
        {/* ---------------------------------------------------------------- */}
        {!loading && marketTitle && (
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="text-[10px] font-semibold text-indigo-400 uppercase tracking-widest mb-1.5">
                  Active Market
                </div>
                <h2 className="text-lg font-bold text-white leading-snug">
                  {marketTitle}
                </h2>
                {fetchedAt && (
                  <div className="flex items-center gap-2 mt-2 text-xs text-gray-500">
                    <span>
                      Data as of{" "}
                      <span className="text-gray-300">
                        {formatRelative(fetchedAt)}
                      </span>
                    </span>
                  </div>
                )}
              </div>
              {(yesPrice !== undefined || noPrice !== undefined) && (
                <div className="flex gap-2.5 shrink-0">
                  {yesPrice !== undefined && (
                    <div className="text-center bg-emerald-950 border border-emerald-800/70 rounded-xl px-4 py-2.5 min-w-[60px]">
                      <div className="text-xl font-bold text-emerald-400 size-value">
                        {Math.round(yesPrice * 100)}¢
                      </div>
                      <div className="text-[10px] text-emerald-600 font-semibold mt-0.5 tracking-wider uppercase">
                        YES
                      </div>
                    </div>
                  )}
                  {noPrice !== undefined && (
                    <div className="text-center bg-red-950 border border-red-900/70 rounded-xl px-4 py-2.5 min-w-[60px]">
                      <div className="text-xl font-bold text-red-400 size-value">
                        {Math.round(noPrice * 100)}¢
                      </div>
                      <div className="text-[10px] text-red-600 font-semibold mt-0.5 tracking-wider uppercase">
                        NO
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ---------------------------------------------------------------- */}
        {/* Empty state                                                       */}
        {/* ---------------------------------------------------------------- */}
        {!loading && fetchedAt && trades.length === 0 && (
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-12 text-center">
            <div className="text-4xl mb-3">🔍</div>
            <p className="text-gray-300 font-semibold">No whale trades found</p>
            <p className="text-xs text-gray-600 mt-1.5">
              No trades over $1,000 in the most recent 500 trades for this
              market.
            </p>
          </div>
        )}

        {/* ---------------------------------------------------------------- */}
        {/* Whale Trades Checklist                                            */}
        {/* ---------------------------------------------------------------- */}
        {trades.length > 0 && (
          <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden card-shadow">

            {/* Card header */}
            <div className="px-6 py-4 border-b border-gray-800 flex items-center justify-between gap-4">
              <div>
                <h3 className="font-bold text-white text-base tracking-tight">
                  Whale Trades
                </h3>
                <p className="text-xs text-gray-500 mt-0.5">
                  Showing{" "}
                  <span className="text-gray-300 font-medium">
                    {trades.length}
                  </span>{" "}
                  trades over $1,000 · Check off as you mirror on Kalshi
                </p>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                {remaining > 0 && (
                  <span className="text-xs bg-amber-950 text-amber-400 border border-amber-800/70 px-2.5 py-1 rounded-full font-semibold">
                    {remaining} remaining
                  </span>
                )}
                {remaining === 0 && trades.length > 0 && (
                  <span className="text-xs bg-emerald-950 text-emerald-400 border border-emerald-800/70 px-2.5 py-1 rounded-full font-semibold">
                    ✓ All done
                  </span>
                )}
                {checkedIds.size > 0 && (
                  <button
                    onClick={clearAll}
                    className="text-xs text-gray-500 hover:text-gray-300 transition-colors underline underline-offset-2"
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
                  <tr className="text-[11px] text-gray-500 uppercase tracking-wider border-b border-gray-800 bg-gray-950/30">
                    <th className="px-6 py-3 text-left w-10" />
                    <th className="px-4 py-3 text-left font-semibold">Time</th>
                    <th className="px-4 py-3 text-left font-semibold">Side</th>
                    <th className="px-4 py-3 text-right font-semibold">Size (USD)</th>
                    <th className="px-4 py-3 text-right font-semibold">Price</th>
                    <th className="px-4 py-3 text-right font-semibold">Implied</th>
                    <th className="px-4 py-3 text-right font-semibold">Shares</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-800/50">
                  {sortedTrades.map((trade) => {
                    const checked = checkedIds.has(trade.id);
                    const { time, day } = formatTime(trade.timestamp);
                    const shares =
                      trade.price > 0
                        ? Math.round(trade.usdSize / trade.price)
                        : 0;

                    return (
                      <tr
                        key={trade.id}
                        onClick={() => toggleCheck(trade.id)}
                        className={`trade-row transition-all duration-150 cursor-pointer ${
                          checked ? "checked-row" : "hover:bg-gray-800/30"
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
                          <div className="font-semibold text-gray-100 tabular-nums">
                            {time}
                          </div>
                          <div className="text-[11px] text-gray-600 mt-0.5">
                            {day}
                          </div>
                        </td>

                        {/* Side badge */}
                        <td className="px-4 py-4">
                          <SideBadge side={trade.side} checked={checked} />
                        </td>

                        {/* Size — hero number */}
                        <td className="px-4 py-4 text-right">
                          <span className="font-bold text-white text-base size-value">
                            ${trade.usdSize.toLocaleString()}
                          </span>
                        </td>

                        {/* Price */}
                        <td className="px-4 py-4 text-right">
                          <span className="text-gray-300 font-mono text-sm tabular-nums">
                            ${trade.price.toFixed(2)}
                          </span>
                        </td>

                        {/* Implied odds */}
                        <td className="px-4 py-4 text-right">
                          <span
                            className={`font-bold text-sm tabular-nums ${
                              checked
                                ? "text-gray-500"
                                : trade.side === "YES"
                                ? "text-emerald-400"
                                : "text-red-400"
                            }`}
                          >
                            {Math.round(trade.price * 100)}%
                          </span>
                        </td>

                        {/* Shares */}
                        <td className="px-4 py-4 text-right">
                          <span className="text-gray-400 font-mono text-sm tabular-nums">
                            {shares.toLocaleString()}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Footer summary */}
            <div className="border-t border-gray-800 px-6 py-4 bg-gray-950/40 flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-6 text-sm">
                <div>
                  <span className="text-gray-500 text-xs uppercase tracking-wider font-medium">
                    Total volume
                  </span>
                  <div className="font-bold text-white size-value">
                    ${totalVolume.toLocaleString()}
                  </div>
                </div>
                <div>
                  <span className="text-gray-500 text-xs uppercase tracking-wider font-medium">
                    YES flow
                  </span>
                  <div className="font-semibold text-emerald-400 size-value">
                    ${yesFlow.toLocaleString()}
                  </div>
                </div>
                <div>
                  <span className="text-gray-500 text-xs uppercase tracking-wider font-medium">
                    NO flow
                  </span>
                  <div className="font-semibold text-red-400 size-value">
                    ${noFlow.toLocaleString()}
                  </div>
                </div>
              </div>
              <div className="text-xs text-gray-600 flex items-center gap-1.5">
                <CheckIcon />
                Progress auto-saved
              </div>
            </div>
          </div>
        )}

        {/* ---------------------------------------------------------------- */}
        {/* Kalshi hint banner                                                */}
        {/* ---------------------------------------------------------------- */}
        {trades.length > 0 && yesPrice !== undefined && (
          <div className="bg-indigo-950/40 border border-indigo-800/40 rounded-2xl p-5 flex items-start gap-4">
            <div className="text-2xl mt-0.5 shrink-0">💡</div>
            <div>
              <div className="font-semibold text-indigo-300 text-sm mb-1">
                Mirroring to Kalshi
              </div>
              <p className="text-xs text-indigo-400/90 leading-relaxed">
                Whales are buying{" "}
                <span className="font-bold text-indigo-200">YES</span> at{" "}
                <span className="font-bold text-indigo-200">
                  {Math.round(yesPrice * 100)}¢
                </span>{" "}
                on Polymarket. Find the equivalent Kalshi contract and look for
                YES contracts trading near{" "}
                <span className="font-bold text-indigo-200">
                  {Math.round(yesPrice * 100)}¢
                </span>
                . Check off each row once you&apos;ve placed your mirrored trade
                so you don&apos;t double-execute.
              </p>
            </div>
          </div>
        )}

        {/* ---------------------------------------------------------------- */}
        {/* Initial empty state (before first fetch)                         */}
        {/* ---------------------------------------------------------------- */}
        {!loading && !fetchedAt && (
          <div className="bg-gray-900/50 border border-gray-800/50 border-dashed rounded-2xl p-12 text-center">
            <div className="text-4xl mb-4">🐋</div>
            <p className="text-gray-400 font-semibold text-base">
              Paste a market URL above to get started
            </p>
            <p className="text-xs text-gray-600 mt-2 leading-relaxed max-w-sm mx-auto">
              The tracker will pull recent trades and filter down to anything
              over $1,000 — the moves worth copying.
            </p>
          </div>
        )}
      </main>

      {/* ------------------------------------------------------------------ */}
      {/* Footer                                                              */}
      {/* ------------------------------------------------------------------ */}
      <footer className="border-t border-gray-800/60 mt-12">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between text-xs text-gray-600">
          <span>Whale Tracker · Polymarket public API · Data delayed ~30s</span>
          <span>Progress persisted across sessions</span>
        </div>
      </footer>
    </>
  );
}
