"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { useOpsSessionOptional } from "@/components/OpsGate";
import {
  Search,
  Download,
  RefreshCw,
  Clock,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Wifi,
  WifiOff,
  ChevronDown,
  ChevronUp,
} from "lucide-react";

/* ================================================================== */
/*  Constants                                                          */
/* ================================================================== */
const API_BASE =
  typeof window !== "undefined" && window.location.hostname === "localhost"
    ? "http://localhost:8888/.netlify/functions"
    : "/.netlify/functions";

const POLL_MS = 15_000; // auto-refresh every 15 s
const SHOP_TZ = "America/New_York";

/* ================================================================== */
/*  Types                                                              */
/* ================================================================== */
interface SearchResult {
  type: "order" | "parcel" | "loyalty" | "staff";
  id: string;
  title: string;
  subtitle: string;
  badge?: string;
  badgeColor?: string;
}

interface OpenShift {
  id: string;
  employee_email: string;
  clock_in: string;
  created_at: string;
}

interface SyncStatus {
  ok: boolean;
  lastSync: Date | null;
  message: string;
}

/* ================================================================== */
/*  Helpers                                                            */
/* ================================================================== */
function fmtET(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    timeZone: SHOP_TZ,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
}

function hoursAgo(iso: string): number {
  return Math.round((Date.now() - new Date(iso).getTime()) / 3_600_000);
}

/* ================================================================== */
/*  COMPONENT                                                          */
/* ================================================================== */
export default function DashboardOverhaul() {
  const session = useOpsSessionOptional();
  const token = session?.token;

  /* ── Connection / sync status ────────────────────────── */
  const [sync, setSync] = useState<SyncStatus>({
    ok: true,
    lastSync: null,
    message: "Connecting…",
  });

  /* ── Global search ───────────────────────────────────── */
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* ── Open shifts (from get-payroll?view=summary) ─────── */
  const [openShifts, setOpenShifts] = useState<OpenShift[]>([]);
  const [shiftsLoading, setShiftsLoading] = useState(true);

  /* ── Quick stats ─────────────────────────────────────── */
  const [stats, setStats] = useState({
    revenue: 0,
    orders: 0,
    staffCount: 0,
    labor: 0,
  });
  const [statsLoading, setStatsLoading] = useState(true);

  /* ── Fix clock-out inline ────────────────────────────── */
  const [fixingId, setFixingId] = useState<string | null>(null);
  const [fixTime, setFixTime] = useState("");
  const [fixBusy, setFixBusy] = useState(false);

  /* ── Toast messages ──────────────────────────────────── */
  const [toast, setToast] = useState<{
    type: "success" | "error" | "info";
    message: string;
  } | null>(null);

  /* ── Action panels ───────────────────────────────────── */
  const [openShiftsExpanded, setOpenShiftsExpanded] = useState(true);

  /* ── CSV export ──────────────────────────────────────── */
  const [exporting, setExporting] = useState(false);

  // ──────────────────────────────────────────────────────
  //  Auto-dismissing toast
  // ──────────────────────────────────────────────────────
  const showToast = useCallback(
    (type: "success" | "error" | "info", message: string) => {
      setToast({ type, message });
      setTimeout(() => setToast(null), 5000);
    },
    []
  );

  // ──────────────────────────────────────────────────────
  //  DATA: Fetch stats
  // ──────────────────────────────────────────────────────
  const fetchStats = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch(`${API_BASE}/get-manager-stats`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = await res.json();
      setStats({
        revenue: d.revenue ?? 0,
        orders: d.orders ?? 0,
        staffCount: d.staffCount ?? 0,
        labor: d.labor ?? 0,
      });
      setStatsLoading(false);
      setSync({ ok: true, lastSync: new Date(), message: "Live" });
    } catch {
      setSync((prev) => ({
        ok: false,
        lastSync: prev.lastSync,
        message: "Connection Glitch",
      }));
      setStatsLoading(false);
    }
  }, [token]);

  // ──────────────────────────────────────────────────────
  //  DATA: Fetch open shifts
  // ──────────────────────────────────────────────────────
  const fetchOpenShifts = useCallback(async () => {
    if (!token) return;
    setShiftsLoading(true);
    try {
      const res = await fetch(
        `${API_BASE}/get-payroll?view=summary`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = await res.json();
      setOpenShifts(d.openShifts ?? []);
    } catch {
      // Non-fatal — just keep old data
    }
    setShiftsLoading(false);
  }, [token]);

  // ──────────────────────────────────────────────────────
  //  DATA: Global search
  // ──────────────────────────────────────────────────────
  const runSearch = useCallback(
    async (q: string) => {
      if (!token || q.length < 2) {
        setResults([]);
        setSearching(false);
        return;
      }
      setSearching(true);
      const hits: SearchResult[] = [];

      try {
        // Parallel: search orders, parcels, staff, customers
        const headers = { Authorization: `Bearer ${token}` };
        const encoded = encodeURIComponent(q.trim());

        const [ordersRes, parcelsRes, staffRes] = await Promise.all([
          fetch(`${API_BASE}/get-recent-activity`, { headers }).then((r) =>
            r.ok ? r.json() : null
          ),
          fetch(`${API_BASE}/get-payroll?view=summary`, { headers }).then(
            (r) => (r.ok ? r.json() : null)
          ),
          fetch(`${API_BASE}/get-manager-stats`, { headers }).then((r) =>
            r.ok ? r.json() : null
          ),
        ]);

        const lowerQ = q.toLowerCase().trim();

        // Filter orders by customer name or order ID
        if (ordersRes?.orders) {
          for (const o of ordersRes.orders) {
            const name = (o.customer_name || "").toLowerCase();
            const id = (o.id || "").toLowerCase();
            if (name.includes(lowerQ) || id.includes(lowerQ)) {
              hits.push({
                type: "order",
                id: o.id,
                title: o.customer_name || "Guest Order",
                subtitle: `Order ${o.id.slice(0, 8)}… · ${o.status}`,
                badge: o.status,
                badgeColor:
                  o.status === "completed"
                    ? "bg-green-600"
                    : o.status === "pending"
                      ? "bg-amber-600"
                      : "bg-[#444]",
              });
            }
          }
        }

        // Filter payroll summary by employee name/email
        if (parcelsRes?.summary) {
          for (const s of parcelsRes.summary) {
            const name = (s.employee_name || "").toLowerCase();
            const email = (s.employee_email || "").toLowerCase();
            if (name.includes(lowerQ) || email.includes(lowerQ)) {
              hits.push({
                type: "staff",
                id: email,
                title: s.employee_name || email,
                subtitle: `${s.total_hours?.toFixed(1) ?? 0}h this period · $${s.gross_pay?.toFixed(2) ?? "0.00"}`,
                badge: s.active_shifts > 0 ? "Clocked In" : "Off",
                badgeColor:
                  s.active_shifts > 0 ? "bg-green-600" : "bg-[#444]",
              });
            }
          }
        }
      } catch {
        // Search failures are non-fatal
      }

      setResults(hits);
      setSearching(false);
    },
    [token]
  );

  // Debounced search
  const handleSearchInput = useCallback(
    (val: string) => {
      setQuery(val);
      setSearchOpen(val.length >= 2);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => runSearch(val), 300);
    },
    [runSearch]
  );

  // Close search dropdown on outside click
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setSearchOpen(false);
      }
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  // ──────────────────────────────────────────────────────
  //  ACTION: Fix clock-out
  // ──────────────────────────────────────────────────────
  const handleFixClock = useCallback(
    async (email: string) => {
      if (!token || !fixTime) return;
      setFixBusy(true);
      try {
        const res = await fetch(`${API_BASE}/fix-clock`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
            "X-BrewHub-Action": "true",
          },
          body: JSON.stringify({
            employee_email: email,
            clock_out_time: new Date(fixTime).toISOString(),
          }),
        });
        const d = await res.json();
        if (!res.ok) throw new Error(d.error || "Fix failed");
        showToast("success", `Clock-out fixed for ${email}`);
        setFixingId(null);
        setFixTime("");
        fetchOpenShifts();
        fetchStats();
      } catch (err) {
        showToast(
          "error",
          err instanceof Error ? err.message : "Failed to fix clock-out"
        );
      }
      setFixBusy(false);
    },
    [token, fixTime, showToast, fetchOpenShifts, fetchStats]
  );

  // ──────────────────────────────────────────────────────
  //  ACTION: One-click CSV export
  // ──────────────────────────────────────────────────────
  const handleExportCSV = useCallback(async () => {
    if (!token) return;
    setExporting(true);
    try {
      const res = await fetch(`${API_BASE}/export-csv`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Export failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `brewhub-payroll-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      showToast("success", "Payroll CSV downloaded");
    } catch {
      showToast("error", "Export failed — tap to retry");
    }
    setExporting(false);
  }, [token, showToast]);

  // ──────────────────────────────────────────────────────
  //  AUTO-REFRESH (SWR-style heartbeat)
  // ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!token) return;
    fetchStats();
    fetchOpenShifts();
    const interval = setInterval(() => {
      fetchStats();
      fetchOpenShifts();
    }, POLL_MS);
    return () => clearInterval(interval);
  }, [token, fetchStats, fetchOpenShifts]);

  // ──────────────────────────────────────────────────────
  //  RENDER
  // ──────────────────────────────────────────────────────
  const missedShifts = openShifts.filter(
    (s) => hoursAgo(s.clock_in) >= 16
  );
  const normalShifts = openShifts.filter(
    (s) => hoursAgo(s.clock_in) < 16
  );

  return (
    <div className="space-y-4">
      {/* ═══════════════════════════════════════════════════
          TRAFFIC-LIGHT CONNECTION BANNER
          ═══════════════════════════════════════════════════ */}
      {!sync.ok && (
        <button
          type="button"
          onClick={() => {
            fetchStats();
            fetchOpenShifts();
          }}
          className="w-full flex items-center justify-center gap-3 min-h-[56px]
                     bg-red-500/10 border border-red-500/30 rounded-xl px-6 py-4
                     text-red-400 text-base font-semibold
                     active:scale-[0.98] transition-all"
        >
          <WifiOff size={22} />
          <span>⚠️ Connection Glitch — Tap to Retry</span>
        </button>
      )}

      {sync.ok && sync.lastSync && (
        <div className="flex items-center gap-2 text-xs text-green-400/80 px-1">
          <Wifi size={14} />
          <span>
            Live · Last sync{" "}
            {sync.lastSync.toLocaleTimeString("en-US", {
              timeZone: SHOP_TZ,
              hour: "2-digit",
              minute: "2-digit",
              second: "2-digit",
              hour12: true,
            })}
          </span>
          <span className="ml-auto text-gray-600">Auto-refreshes every 15s</span>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════
          GLOBAL SEARCH BAR
          ═══════════════════════════════════════════════════ */}
      <div ref={searchRef} className="relative">
        <div
          className="flex items-center gap-3 bg-[#1a1a1a] border border-[#444]
                     rounded-xl px-5 min-h-[56px] focus-within:border-amber-500
                     focus-within:ring-1 focus-within:ring-amber-500/30
                     transition-all"
        >
          <Search size={20} className="text-gray-500 flex-shrink-0" />
          <input
            type="text"
            value={query}
            onChange={(e) => handleSearchInput(e.target.value)}
            onFocus={() => query.length >= 2 && setSearchOpen(true)}
            placeholder="Search names, order IDs, emails…"
            className="flex-1 bg-transparent text-white text-base
                       placeholder:text-gray-600 outline-none py-3"
          />
          {searching && (
            <RefreshCw size={16} className="text-amber-400 animate-spin flex-shrink-0" />
          )}
        </div>

        {/* ── Search Dropdown ── */}
        {searchOpen && (
          <div
            className="absolute top-full left-0 right-0 mt-1 z-50
                       bg-[#1a1a1a] border border-[#444] rounded-xl shadow-2xl
                       max-h-[400px] overflow-y-auto"
          >
            {results.length === 0 && !searching && query.length >= 2 && (
              <div className="px-5 py-4 text-gray-500 text-sm">
                No results for &ldquo;{query}&rdquo;
              </div>
            )}
            {results.map((r, idx) => (
              <button
                key={r.type + r.id + idx}
                type="button"
                onClick={() => {
                  setSearchOpen(false);
                  // Could navigate — for now, just copy ID to clipboard
                  navigator.clipboard?.writeText(r.id);
                  showToast("info", `Copied ${r.type} ID: ${r.id.slice(0, 12)}…`);
                }}
                className="w-full flex items-center gap-4 px-5 py-3
                           min-h-[56px] text-left border-b border-[#222]
                           last:border-b-0 hover:bg-[#222] active:bg-[#333]
                           transition-colors"
              >
                <div className="flex-shrink-0 w-8 h-8 rounded-full bg-[#333]
                               flex items-center justify-center text-xs font-bold uppercase">
                  {r.type === "order" && "🧾"}
                  {r.type === "parcel" && "📦"}
                  {r.type === "staff" && "👤"}
                  {r.type === "loyalty" && "⭐"}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-sm text-white truncate">
                    {r.title}
                  </div>
                  <div className="text-xs text-gray-500 truncate">
                    {r.subtitle}
                  </div>
                </div>
                {r.badge && (
                  <span
                    className={`flex-shrink-0 rounded-full px-3 py-1 text-[11px]
                               font-bold text-white ${r.badgeColor || "bg-[#444]"}`}
                  >
                    {r.badge}
                  </span>
                )}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ═══════════════════════════════════════════════════
          TOAST — floating notification
          ═══════════════════════════════════════════════════ */}
      {toast && (
        <div
          className={`flex items-center gap-3 min-h-[56px] rounded-xl px-5 py-3
                     text-sm font-semibold transition-all animate-in fade-in
                     ${
                       toast.type === "success"
                         ? "bg-green-500/10 border border-green-500/30 text-green-400"
                         : toast.type === "error"
                           ? "bg-red-500/10 border border-red-500/30 text-red-400"
                           : "bg-blue-500/10 border border-blue-500/30 text-blue-400"
                     }`}
        >
          {toast.type === "success" && <CheckCircle size={20} />}
          {toast.type === "error" && <XCircle size={20} />}
          {toast.type === "info" && <Search size={20} />}
          <span>{toast.message}</span>
          <button
            type="button"
            onClick={() => setToast(null)}
            className="ml-auto p-1 hover:opacity-70"
          >
            ✕
          </button>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════
          QUICK STATS — touch-friendly cards
          ═══════════════════════════════════════════════════ */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          {
            label: "Today's Revenue",
            value: statsLoading ? "…" : `$${stats.revenue.toFixed(2)}`,
            color: "text-green-400",
            icon: "💰",
          },
          {
            label: "Orders Today",
            value: statsLoading ? "…" : String(stats.orders),
            color: "text-blue-400",
            icon: "🧾",
          },
          {
            label: "Staff On Shift",
            value: statsLoading ? "…" : String(stats.staffCount),
            color:
              stats.staffCount > 0 ? "text-green-400" : "text-gray-400",
            icon: "👥",
          },
          {
            label: "Est. Labor Cost",
            value: statsLoading ? "…" : `$${stats.labor.toFixed(2)}`,
            color: "text-amber-400",
            icon: "⏱",
          },
        ].map((card) => (
          <div
            key={card.label}
            className="bg-[#1a1a1a] border border-[#333] rounded-xl
                       px-4 py-4 min-h-[80px] flex flex-col justify-center"
          >
            <div className="text-xs text-gray-500 mb-1 flex items-center gap-1.5">
              <span>{card.icon}</span> {card.label}
            </div>
            <div className={`text-2xl font-bold ${card.color}`}>
              {card.value}
            </div>
          </div>
        ))}
      </div>

      {/* ═══════════════════════════════════════════════════
          OPEN SHIFTS — "⏰ Shift needs a fix" card
          ═══════════════════════════════════════════════════ */}
      {openShifts.length > 0 && (
        <div className="bg-[#1a1a1a] border border-amber-500/30 rounded-xl overflow-hidden">
          {/* Header — collapsible */}
          <button
            type="button"
            onClick={() => setOpenShiftsExpanded((v) => !v)}
            className="w-full flex items-center justify-between gap-3
                       px-5 min-h-[56px] text-left
                       hover:bg-[#222] active:bg-[#333] transition-colors"
          >
            <div className="flex items-center gap-3">
              {missedShifts.length > 0 ? (
                <AlertTriangle size={22} className="text-red-400" />
              ) : (
                <Clock size={22} className="text-amber-400" />
              )}
              <div>
                <span className="text-base font-semibold text-white">
                  {missedShifts.length > 0
                    ? `⏰ ${missedShifts.length} shift${missedShifts.length > 1 ? "s" : ""} need${missedShifts.length === 1 ? "s" : ""} a fix`
                    : `${openShifts.length} staff on the clock`}
                </span>
                {missedShifts.length > 0 && normalShifts.length > 0 && (
                  <span className="text-xs text-gray-500 ml-2">
                    + {normalShifts.length} active
                  </span>
                )}
              </div>
            </div>
            {openShiftsExpanded ? (
              <ChevronUp size={18} className="text-gray-500" />
            ) : (
              <ChevronDown size={18} className="text-gray-500" />
            )}
          </button>

          {/* Body */}
          {openShiftsExpanded && (
            <div className="px-5 pb-4 space-y-2">
              {/* Missed (red) */}
              {missedShifts.map((s) => (
                <ShiftRow
                  key={s.id}
                  shift={s}
                  variant="missed"
                  fixingId={fixingId}
                  fixTime={fixTime}
                  fixBusy={fixBusy}
                  onFixStart={() => {
                    setFixingId(s.id);
                    setFixTime("");
                  }}
                  onFixCancel={() => {
                    setFixingId(null);
                    setFixTime("");
                  }}
                  onFixTimeChange={setFixTime}
                  onFixSubmit={() => handleFixClock(s.employee_email)}
                />
              ))}
              {/* Active (amber) */}
              {normalShifts.map((s) => (
                <ShiftRow
                  key={s.id}
                  shift={s}
                  variant="active"
                  fixingId={fixingId}
                  fixTime={fixTime}
                  fixBusy={fixBusy}
                  onFixStart={() => {
                    setFixingId(s.id);
                    setFixTime("");
                  }}
                  onFixCancel={() => {
                    setFixingId(null);
                    setFixTime("");
                  }}
                  onFixTimeChange={setFixTime}
                  onFixSubmit={() => handleFixClock(s.employee_email)}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Zero open shifts = green ✓ */}
      {!shiftsLoading && openShifts.length === 0 && (
        <div
          className="flex items-center gap-3 bg-green-500/5 border border-green-500/20
                     rounded-xl px-5 min-h-[56px] text-green-400 text-sm font-medium"
        >
          <CheckCircle size={20} />
          All shifts are closed — payroll is clean.
        </div>
      )}

      {/* ═══════════════════════════════════════════════════
          BIG ACTION BUTTONS
          ═══════════════════════════════════════════════════ */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {/* One-Click Payroll Export */}
        <button
          type="button"
          onClick={handleExportCSV}
          disabled={exporting}
          className="flex items-center justify-center gap-3 min-h-[56px]
                     bg-gradient-to-br from-emerald-600 to-emerald-700
                     hover:from-emerald-500 hover:to-emerald-600
                     disabled:opacity-50 disabled:cursor-not-allowed
                     text-white text-base font-semibold rounded-xl px-6
                     active:scale-[0.98] transition-all shadow-lg"
        >
          <Download size={20} />
          {exporting ? "Generating…" : "Download Payroll CSV"}
        </button>

        {/* Manual refresh */}
        <button
          type="button"
          onClick={() => {
            fetchStats();
            fetchOpenShifts();
            showToast("info", "Refreshing dashboard…");
          }}
          className="flex items-center justify-center gap-3 min-h-[56px]
                     bg-[#1a1a1a] border border-[#444]
                     hover:bg-[#222] hover:border-amber-500/40
                     text-white text-base font-semibold rounded-xl px-6
                     active:scale-[0.98] transition-all"
        >
          <RefreshCw size={20} />
          Refresh Now
        </button>
      </div>
    </div>
  );
}

/* ================================================================== */
/*  SUB-COMPONENT: Shift Row                                           */
/* ================================================================== */
interface ShiftRowProps {
  shift: OpenShift;
  variant: "missed" | "active";
  fixingId: string | null;
  fixTime: string;
  fixBusy: boolean;
  onFixStart: () => void;
  onFixCancel: () => void;
  onFixTimeChange: (val: string) => void;
  onFixSubmit: () => void;
}

function ShiftRow({
  shift,
  variant,
  fixingId,
  fixTime,
  fixBusy,
  onFixStart,
  onFixCancel,
  onFixTimeChange,
  onFixSubmit,
}: ShiftRowProps) {
  const hrs = hoursAgo(shift.clock_in);
  const isMissed = variant === "missed";
  const isFixing = fixingId === shift.id;

  return (
    <div
      className={`flex flex-wrap items-center justify-between gap-3
                  rounded-lg px-4 min-h-[56px] py-3
                  border transition-colors
                  ${
                    isMissed
                      ? "bg-red-500/5 border-red-500/20"
                      : "bg-[#111] border-[#333]"
                  }`}
    >
      <div className="flex items-center gap-3 min-w-0 flex-1">
        <div
          className={`w-3 h-3 rounded-full flex-shrink-0 ${
            isMissed ? "bg-red-500 animate-pulse" : "bg-green-500"
          }`}
        />
        <div className="min-w-0">
          <div className="font-semibold text-sm truncate">
            {shift.employee_email}
          </div>
          <div className="text-xs text-gray-500">
            Clocked in{" "}
            <span
              className={
                isMissed
                  ? "text-red-400 font-bold"
                  : "text-amber-400 font-semibold"
              }
            >
              {fmtET(shift.clock_in)}
            </span>{" "}
            ({hrs}h ago)
          </div>
        </div>
      </div>

      {isFixing ? (
        <div className="flex items-center gap-2 flex-shrink-0">
          <input
            type="datetime-local"
            value={fixTime}
            onChange={(e) => onFixTimeChange(e.target.value)}
            className="bg-[#111] border border-[#444] rounded-lg px-3 py-2
                       text-sm text-white min-h-[44px] w-[200px]
                       focus:outline-none focus:ring-1 focus:ring-amber-500"
          />
          <button
            type="button"
            disabled={!fixTime || fixBusy}
            onClick={onFixSubmit}
            className="min-h-[44px] px-4 rounded-lg text-sm font-bold
                       bg-amber-600 hover:bg-amber-500 disabled:opacity-40
                       text-white active:scale-95 transition-all"
          >
            {fixBusy ? "…" : "Save"}
          </button>
          <button
            type="button"
            onClick={onFixCancel}
            className="min-h-[44px] px-3 rounded-lg text-sm
                       border border-[#333] text-gray-500 hover:text-white
                       active:scale-95 transition-all"
          >
            ✕
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={onFixStart}
          className={`flex-shrink-0 min-h-[44px] px-4 rounded-lg text-sm font-semibold
                     border active:scale-95 transition-all
                     ${
                       isMissed
                         ? "border-red-500/40 text-red-400 hover:bg-red-500/10"
                         : "border-amber-500/30 text-amber-400 hover:bg-amber-500/10"
                     }`}
        >
          Fix Clock-Out
        </button>
      )}
    </div>
  );
}
