"use client";
/**
 * Equipment Assets Dashboard
 *
 * Manager-only page showing equipment registry with:
 * - Total Cost of Ownership (purchase price + maintenance costs)
 * - Daily Operating Cost (TCO / days since install)
 * - Health Status (overdue maintenance indicator)
 *
 * Lives at /manager/assets and inherits the (ops) layout + OpsGate.
 */

import React, { useState, useEffect, useCallback, useRef } from "react";
import { toast as sonnerToast } from "sonner";
import {
  Wrench,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  Loader2,
  ChevronLeft,
  ArrowUpDown,
  TrendingUp,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { getErrorInfoFromResponse, type AuthzErrorState } from "@/lib/authz";
import AuthzErrorStateCard from "@/components/AuthzErrorState";
import { useOpsSession } from "@/components/OpsGate";
import { fetchOps } from "@/utils/ops-api";
import { forceOpsLogout } from "@/lib/authz";
import MaintenanceLogger from "@/components/ops/MaintenanceLogger";

/* ── Types ─────────────────────────────────────────────────── */
interface AssetRow {
  id: string;
  name: string;
  category: string;
  purchase_price: number;
  install_date: string;
  maint_frequency_days: number;
  last_maint_date: string | null;
  is_active: boolean;
  total_maint_cost: number;
  total_cost: number;
  days_since_install: number;
  daily_operating_cost: number;
  is_overdue: boolean;
}

interface AssetSummary {
  total_assets: number;
  total_tco: number;
  overdue_count: number;
  has_overdue: boolean;
}

interface ProjectedSpend {
  months: number;
  total_projected_cost: number;
  flagged_equipment: {
    id: string;
    name: string;
    category: string;
    next_maint_date: string;
    avg_recent_cost: number;
    last_maint_date: string | null;
    maint_frequency_days: number;
  }[];
  flagged_count: number;
}

type SortKey = "name" | "total_cost" | "daily_operating_cost" | "is_overdue";
type SortDir = "asc" | "desc";

/* ── Helpers ───────────────────────────────────────────────── */
const usd = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);

const fmtDate = (d: string | null) =>
  d ? new Date(d + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—";

/* ═══════════════════════════════════════════════════════════
   ASSETS PAGE
   ═══════════════════════════════════════════════════════════ */
export default function AssetsPage() {
  const { token } = useOpsSession();
  const [assets, setAssets] = useState<AssetRow[]>([]);
  const [summary, setSummary] = useState<AssetSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [authzError, setAuthzError] = useState<AuthzErrorState | null>(null);

  /* ── Sort state ──────────────────────────────────────────── */
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  /* ── Maintenance logger modal state ──────────────────────── */
  const [logAsset, setLogAsset] = useState<AssetRow | null>(null);

  /* ── Projected spend state ────────────────────────────────── */
  const [projected, setProjected] = useState<ProjectedSpend | null>(null);
  const [projectedLoading, setProjectedLoading] = useState(true);
  const [projectedExpanded, setProjectedExpanded] = useState(false);

  /* ── Toast (delegates to Sonner) ────────────────────── */
  const showToast = useCallback((msg: string, type: "success" | "error" = "success") => {
    if (type === "success") sonnerToast.success(msg);
    else sonnerToast.error(msg);
  }, []);

  /* ── Fetch ───────────────────────────────────────────────── */
  const fetchAssets = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchOps("/get-asset-analytics", {}, token);
      if (!res.ok) {
        const info = await getErrorInfoFromResponse(res);
        if (info.authz) { setAuthzError(info.authz); return; }
        showToast(info.message || "Failed to load asset data", "error");
        return;
      }
      const json = await res.json();
      setAssets(json.assets ?? []);
      setSummary(json.summary ?? null);
    } catch {
      showToast("Network error loading assets", "error");
    } finally {
      setLoading(false);
    }
  }, [token, showToast]);

  useEffect(() => { fetchAssets(); }, [fetchAssets]);

  /* ── Fetch projected maintenance spend ────────────────────── */
  const fetchProjected = useCallback(async () => {
    setProjectedLoading(true);
    try {
      const res = await fetchOps("/get-projected-maintenance?months=3", {}, token);
      if (!res.ok) {
        // Non-critical — card simply won't render
        console.warn("[ASSETS] Failed to load projected spend");
        return;
      }
      const json = await res.json();
      setProjected(json);
    } catch {
      console.warn("[ASSETS] Network error loading projected spend");
    } finally {
      setProjectedLoading(false);
    }
  }, [token]);

  useEffect(() => { fetchProjected(); }, [fetchProjected]);

  /* ── Maintenance log success handler ──────────────────────── */
  const handleMaintenanceLogged = useCallback(() => {
    setLogAsset(null);
    showToast("Maintenance logged successfully");
    fetchAssets(); // Refresh table — clears overdue status if resolved
    fetchProjected(); // Refresh projected spend card
  }, [showToast, fetchAssets, fetchProjected]);

  /* ── Sort logic ──────────────────────────────────────────── */
  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  const sorted = [...assets].sort((a, b) => {
    const dir = sortDir === "asc" ? 1 : -1;
    switch (sortKey) {
      case "name":
        return dir * a.name.localeCompare(b.name);
      case "total_cost":
        return dir * (a.total_cost - b.total_cost);
      case "daily_operating_cost":
        return dir * (a.daily_operating_cost - b.daily_operating_cost);
      case "is_overdue":
        return dir * (Number(a.is_overdue) - Number(b.is_overdue));
      default:
        return 0;
    }
  });

  /* ── Auth error state ────────────────────────────────────── */
  if (authzError) return <AuthzErrorStateCard state={authzError} onAction={() => forceOpsLogout()} />;

  /* ── Render ──────────────────────────────────────────────── */
  return (
    <div className="min-h-screen bg-stone-950 text-white">
      {/* ── Header ─────────────────────────────────────────── */}
      <header className="sticky top-0 z-40 bg-stone-950/90 backdrop-blur-md border-b border-stone-800">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <a
              href="/manager?tab=overview"
              className="text-stone-400 hover:text-white transition-colors"
              aria-label="Back to Dashboard"
            >
              <ChevronLeft size={20} />
            </a>
            <div>
              <h1 className="text-lg font-bold tracking-tight flex items-center gap-2">
                <Wrench size={20} className="text-amber-400" />
                Equipment Assets
              </h1>
              <p className="text-stone-400 text-xs tracking-wider uppercase">
                Total Cost of Ownership &middot; Maintenance Tracking
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={fetchAssets}
            disabled={loading}
            className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium rounded-lg
                       bg-stone-800 hover:bg-stone-700 text-stone-300 hover:text-white
                       transition-colors disabled:opacity-50"
          >
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
            Refresh
          </button>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
        {/* ── Summary cards ──────────────────────────────── */}
        {summary && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
            <div className="bg-stone-900 border border-stone-800 rounded-xl p-4">
              <p className="text-xs text-stone-400 uppercase tracking-wider mb-1">Total Assets</p>
              <p className="text-2xl font-bold text-white">{summary.total_assets}</p>
            </div>
            <div className="bg-stone-900 border border-stone-800 rounded-xl p-4">
              <p className="text-xs text-stone-400 uppercase tracking-wider mb-1">Total TCO</p>
              <p className="text-2xl font-bold text-amber-400">{usd(summary.total_tco)}</p>
            </div>
            <div className={`bg-stone-900 border rounded-xl p-4 ${
              summary.overdue_count > 0 ? "border-red-700/60" : "border-stone-800"
            }`}>
              <p className="text-xs text-stone-400 uppercase tracking-wider mb-1">Overdue</p>
              <p className={`text-2xl font-bold ${
                summary.overdue_count > 0 ? "text-red-400" : "text-emerald-400"
              }`}>
                {summary.overdue_count > 0
                  ? `${summary.overdue_count} item${summary.overdue_count !== 1 ? "s" : ""}`
                  : "All Clear"}
              </p>
            </div>

            {/* ── Finance: Projected Maintenance Spend ──── */}
            <div className="bg-stone-900 border border-blue-700/40 rounded-xl p-4">
              <div className="flex items-center justify-between mb-1">
                <p className="text-xs text-stone-400 uppercase tracking-wider flex items-center gap-1">
                  <TrendingUp size={12} className="text-blue-400" />
                  Est. Maint. Spend (Next 90d)
                </p>
              </div>
              {projectedLoading ? (
                <div className="flex items-center gap-2 mt-1">
                  <Loader2 size={16} className="animate-spin text-blue-400" />
                  <span className="text-stone-500 text-xs">Calculating…</span>
                </div>
              ) : projected ? (
                <>
                  <p className="text-2xl font-bold text-blue-400">
                    {usd(projected.total_projected_cost)}
                  </p>
                  {projected.flagged_count > 0 && (
                    <button
                      type="button"
                      onClick={() => setProjectedExpanded((p) => !p)}
                      className="mt-2 flex items-center gap-1 text-xs text-stone-400 hover:text-white transition-colors"
                    >
                      {projected.flagged_count} item{projected.flagged_count !== 1 ? "s" : ""} flagged
                      {projectedExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                    </button>
                  )}
                  {projectedExpanded && projected.flagged_equipment.length > 0 && (
                    <ul className="mt-2 space-y-1.5 text-xs border-t border-stone-800 pt-2">
                      {projected.flagged_equipment.map((eq) => (
                        <li key={eq.id} className="flex items-center justify-between">
                          <span className="text-stone-300 truncate mr-2">{eq.name}</span>
                          <span className="font-mono text-blue-300 whitespace-nowrap">
                            {usd(eq.avg_recent_cost)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              ) : (
                <p className="text-stone-500 text-sm mt-1">Unavailable</p>
              )}
            </div>
          </div>
        )}

        {/* ── Loading state ────────────────────────────────── */}
        {loading && (
          <div className="flex items-center justify-center py-20">
            <Loader2 size={28} className="animate-spin text-amber-400" />
            <span className="ml-3 text-stone-400 text-sm">Loading equipment data…</span>
          </div>
        )}

        {/* ── Empty state ──────────────────────────────────── */}
        {!loading && assets.length === 0 && (
          <div className="text-center py-20 text-stone-500">
            <Wrench size={40} className="mx-auto mb-4 opacity-40" />
            <p className="text-sm">No equipment registered yet.</p>
          </div>
        )}

        {/* ── Table ────────────────────────────────────────── */}
        {!loading && assets.length > 0 && (
          <div className="overflow-x-auto rounded-xl border border-stone-800 bg-stone-900/50">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-stone-800 text-stone-400 text-xs uppercase tracking-wider">
                  <SortHeader label="Equipment" sortKey="name" currentKey={sortKey} dir={sortDir} onToggle={toggleSort} />
                  <th className="px-4 py-3 text-left hidden sm:table-cell">Category</th>
                  <th className="px-4 py-3 text-left hidden md:table-cell">Installed</th>
                  <th className="px-4 py-3 text-left hidden lg:table-cell">Last Maint.</th>
                  <SortHeader label="TCO" sortKey="total_cost" currentKey={sortKey} dir={sortDir} onToggle={toggleSort} className="text-right" />
                  <SortHeader label="Daily Cost" sortKey="daily_operating_cost" currentKey={sortKey} dir={sortDir} onToggle={toggleSort} className="text-right hidden sm:table-cell" />
                  <SortHeader label="Health" sortKey="is_overdue" currentKey={sortKey} dir={sortDir} onToggle={toggleSort} className="text-center" />
                  <th className="px-4 py-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-800/60">
                {sorted.map((asset) => (
                  <tr
                    key={asset.id}
                    className="hover:bg-stone-800/40 transition-colors"
                  >
                    <td className="px-4 py-3 font-medium text-white">
                      {asset.name}
                    </td>
                    <td className="px-4 py-3 text-stone-400 hidden sm:table-cell capitalize">
                      {asset.category}
                    </td>
                    <td className="px-4 py-3 text-stone-400 hidden md:table-cell">
                      {fmtDate(asset.install_date)}
                    </td>
                    <td className="px-4 py-3 text-stone-400 hidden lg:table-cell">
                      {fmtDate(asset.last_maint_date)}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-amber-300">
                      {usd(asset.total_cost)}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-stone-300 hidden sm:table-cell">
                      {usd(asset.daily_operating_cost)}<span className="text-stone-500">/d</span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      {asset.is_overdue ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-red-900/40 text-red-400 border border-red-700/40">
                          <AlertTriangle size={12} />
                          Overdue
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-900/40 text-emerald-400 border border-emerald-700/40">
                          <CheckCircle2 size={12} />
                          OK
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => setLogAsset(asset)}
                        className="inline-flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded-lg
                                   bg-amber-600/20 text-amber-400 border border-amber-600/30
                                   hover:bg-amber-600/30 hover:text-amber-300 transition-colors"
                      >
                        <Wrench size={12} />
                        Log Maint.
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>

      {/* ── Maintenance Logger Modal ──────────────────────── */}
      {logAsset && (
        <MaintenanceLogger
          asset={logAsset}
          token={token}
          onClose={() => setLogAsset(null)}
          onSuccess={handleMaintenanceLogged}
        />
      )}

      {/* ── Toast ──────────────────────────────────────────── */}
    </div>
  );
}

/* ── Sortable column header component ──────────────────────── */
function SortHeader({
  label,
  sortKey: key,
  currentKey,
  dir,
  onToggle,
  className = "",
}: {
  label: string;
  sortKey: SortKey;
  currentKey: SortKey;
  dir: SortDir;
  onToggle: (k: SortKey) => void;
  className?: string;
}) {
  const isActive = currentKey === key;
  return (
    <th className={`px-4 py-3 ${className}`}>
      <button
        type="button"
        onClick={() => onToggle(key)}
        className="inline-flex items-center gap-1 hover:text-white transition-colors"
      >
        {label}
        <ArrowUpDown
          size={12}
          className={isActive ? "text-amber-400" : "text-stone-600"}
        />
        {isActive && (
          <span className="text-amber-400 text-[10px]">{dir === "asc" ? "▲" : "▼"}</span>
        )}
      </button>
    </th>
  );
}
