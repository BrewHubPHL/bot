"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  Package, Search, Plus, ScanLine, RefreshCw, Loader2,
  CheckCircle2, AlertTriangle, ArrowUpCircle, ChevronDown,
  ChevronUp, X, Pencil,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useOpsSession } from "@/components/OpsGate";
import { fetchOps } from "@/utils/ops-api";
import EnvironmentToggle, { type DataEnv } from "@/components/manager/EnvironmentToggle";
import InventoryAddModal from "./InventoryAddModal";
import InventoryEditModal from "./InventoryEditModal";

/* ─── Types ────────────────────────────────────────────── */
interface InventoryItem {
  id: string;
  item_name: string;
  category: string;
  current_stock: number | null;
  min_threshold: number | null;
  unit: string;
  unit_cost_cents: number | null;
  data_integrity_level: DataEnv;
}

type SortField = "item_name" | "category" | "current_stock" | "unit_cost_cents";
type SortDir = "asc" | "desc";

/* ─── Helpers ──────────────────────────────────────────── */
function stockBadge(stock: number | null, threshold: number | null) {
  if (stock === null || threshold === null) return "text-stone-500";
  if (stock === 0) return "text-red-400";
  if (stock < threshold) return "text-amber-400";
  return "text-emerald-400";
}

function envBadge(level: DataEnv) {
  return level === "production"
    ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30"
    : "bg-amber-500/15 text-amber-400 border-amber-500/30";
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
export default function InventoryPanel() {
  const { token } = useOpsSession();

  /* ── State ────────────────────────────────────────────── */
  const [activeEnv, setActiveEnv] = useState<DataEnv>("simulation");
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [sortField, setSortField] = useState<SortField>("item_name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [promoting, setPromoting] = useState(false);
  const [promoteResult, setPromoteResult] = useState<string | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [editItem, setEditItem] = useState<InventoryItem | null>(null);

  const fetchRef = useRef(0); // stale-closure guard

  /* ── Fetch inventory ──────────────────────────────────── */
  const fetchInventory = useCallback(async () => {
    const id = ++fetchRef.current;
    setLoading(true);
    setError(null);
    setSelectedIds(new Set());
    setPromoteResult(null);

    try {
      const res = await fetchOps(
        `/get-inventory?level=${activeEnv}`,
        {},
        token,
      );
      if (id !== fetchRef.current) return; // stale
      if (!res.ok) {
        setError("Failed to load inventory");
        return;
      }
      const json = await res.json();
      setItems(json.inventory ?? []);
    } catch {
      if (id === fetchRef.current) setError("Connection error");
    } finally {
      if (id === fetchRef.current) setLoading(false);
    }
  }, [activeEnv, token]);

  useEffect(() => { fetchInventory(); }, [fetchInventory]);

  /* ── Search + sort ────────────────────────────────────── */
  const filtered = items.filter((i) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      i.item_name.toLowerCase().includes(q) ||
      i.category.toLowerCase().includes(q)
    );
  });

  const sorted = [...filtered].sort((a, b) => {
    let cmp = 0;
    if (sortField === "item_name") cmp = a.item_name.localeCompare(b.item_name);
    else if (sortField === "category") cmp = a.category.localeCompare(b.category);
    else if (sortField === "current_stock") cmp = (a.current_stock ?? 0) - (b.current_stock ?? 0);
    else if (sortField === "unit_cost_cents") cmp = (a.unit_cost_cents ?? 0) - (b.unit_cost_cents ?? 0);
    return sortDir === "asc" ? cmp : -cmp;
  });

  const toggleSort = (field: SortField) => {
    if (sortField === field) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortField(field); setSortDir("asc"); }
  };

  const SortIcon = ({ field }: { field: SortField }) =>
    sortField === field
      ? sortDir === "asc" ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />
      : <ChevronDown className="h-3 w-3 opacity-30" />;

  /* ── Selection ────────────────────────────────────────── */
  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === sorted.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(sorted.map((i) => i.id)));
    }
  };

  /* ── Promote to production ────────────────────────────── */
  const handlePromote = useCallback(async () => {
    if (selectedIds.size === 0 || activeEnv !== "simulation") return;
    setPromoting(true);
    setPromoteResult(null);
    try {
      const res = await fetchOps("/promote-to-production", {
        method: "POST",
        body: JSON.stringify({ table: "inventory", ids: [...selectedIds] }),
      }, token);

      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: "Request failed" }));
        setPromoteResult(`Error: ${body.error || res.status}`);
        return;
      }

      const json = await res.json();
      const count = json.result?.promoted_count ?? selectedIds.size;
      setPromoteResult(`${count} item${count !== 1 ? "s" : ""} promoted to production`);
      // Refresh the list
      fetchInventory();
    } catch {
      setPromoteResult("Connection error during promotion");
    } finally {
      setPromoting(false);
    }
  }, [selectedIds, activeEnv, token, fetchInventory]);

  /* ── Env change ───────────────────────────────────────── */
  const handleEnvChange = useCallback((env: DataEnv) => {
    setActiveEnv(env);
    setSearch("");
  }, []);

  /* ── Stats ────────────────────────────────────────────── */
  const lowStockCount = items.filter(
    (i) => i.current_stock !== null && i.min_threshold !== null && i.current_stock < i.min_threshold
  ).length;
  const outOfStockCount = items.filter((i) => i.current_stock === 0).length;

  /* ── Render ───────────────────────────────────────────── */
  return (
    <div className="space-y-5">
      {/* ── Header ─────────────────────────────────────── */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-bold tracking-tight text-white flex items-center gap-2">
            <Package className="h-5 w-5 text-stone-400" />
            Inventory Management
          </h2>
          <p className="text-xs text-stone-500 mt-0.5">
            {items.length} item{items.length !== 1 ? "s" : ""}
            {lowStockCount > 0 && (
              <span className="text-amber-400 ml-2">&middot; {lowStockCount} low stock</span>
            )}
            {outOfStockCount > 0 && (
              <span className="text-red-400 ml-2">&middot; {outOfStockCount} out of stock</span>
            )}
            {(() => {
              const val = items.reduce((s, i) => s + (i.current_stock ?? 0) * (i.unit_cost_cents ?? 0), 0);
              return val > 0 ? (
                <span className="text-emerald-400 ml-2">&middot; ${(val / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })} value</span>
              ) : null;
            })()}
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <EnvironmentToggle activeEnv={activeEnv} onEnvChange={handleEnvChange} />

          <a
            href="/scanner"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-stone-800 border border-stone-700 text-stone-300 text-xs font-medium hover:bg-stone-700 hover:text-white transition-colors"
            title="Open barcode scanner"
          >
            <ScanLine className="h-3.5 w-3.5" />
            Scanner
          </a>

          <button
            onClick={() => setShowAddModal(true)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-amber-600 text-white text-xs font-bold hover:bg-amber-500 transition-colors"
          >
            <Plus className="h-3.5 w-3.5" />
            Add Item
          </button>

          <button
            onClick={fetchInventory}
            disabled={loading}
            className="p-1.5 rounded-lg text-stone-400 hover:text-white hover:bg-stone-800 transition-colors disabled:opacity-50"
            title="Refresh"
          >
            <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
          </button>
        </div>
      </div>

      {/* ── Search ─────────────────────────────────────── */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-stone-500" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search items by name or category…"
          className="w-full pl-10 pr-10 py-2.5 bg-stone-900 border border-stone-800 rounded-xl text-sm text-white placeholder:text-stone-500 focus:outline-none focus:ring-2 focus:ring-amber-500/40"
        />
        {search && (
          <button
            onClick={() => setSearch("")}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-stone-500 hover:text-stone-300"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* ── Promote bar (simulation only) ─────────────── */}
      {activeEnv === "simulation" && selectedIds.size > 0 && (
        <div className="flex items-center justify-between bg-emerald-500/10 border border-emerald-500/20 rounded-xl px-4 py-3">
          <span className="text-emerald-300 text-sm font-medium">
            {selectedIds.size} item{selectedIds.size !== 1 ? "s" : ""} selected
          </span>
          <button
            onClick={handlePromote}
            disabled={promoting}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-600 text-white text-xs font-bold hover:bg-emerald-500 transition-colors disabled:opacity-50"
          >
            {promoting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <ArrowUpCircle className="h-4 w-4" />
            )}
            {promoting ? "Promoting…" : "Promote to Production"}
          </button>
        </div>
      )}

      {/* ── Promote result toast ──────────────────────── */}
      {promoteResult && (
        <div className={cn(
          "flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium",
          promoteResult.startsWith("Error")
            ? "bg-red-500/10 border border-red-500/20 text-red-400"
            : "bg-emerald-500/10 border border-emerald-500/20 text-emerald-400"
        )}>
          {promoteResult.startsWith("Error")
            ? <AlertTriangle className="h-4 w-4 shrink-0" />
            : <CheckCircle2 className="h-4 w-4 shrink-0" />
          }
          {promoteResult}
          <button
            onClick={() => setPromoteResult(null)}
            className="ml-auto text-stone-500 hover:text-stone-300"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* ── Error state ───────────────────────────────── */}
      {error && (
        <div className="flex items-center gap-2 text-red-400 text-sm bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {error}
          <button onClick={fetchInventory} className="ml-auto text-xs underline hover:text-red-300">
            Retry
          </button>
        </div>
      )}

      {/* ── Loading state ─────────────────────────────── */}
      {loading && !error && (
        <div className="flex items-center justify-center py-16 text-stone-500">
          <Loader2 className="h-6 w-6 animate-spin mr-2" />
          Loading inventory…
        </div>
      )}

      {/* ── Empty state ───────────────────────────────── */}
      {!loading && !error && items.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-stone-500">
          <Package className="h-10 w-10 mb-3 opacity-40" />
          <p className="text-sm font-medium">No inventory items in {activeEnv} mode</p>
          <p className="text-xs mt-1">Add items manually or scan barcodes to get started.</p>
        </div>
      )}

      {/* ── Data table ────────────────────────────────── */}
      {!loading && !error && sorted.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-stone-800">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-stone-900/80 text-stone-400 text-xs uppercase tracking-wider">
                {activeEnv === "simulation" && (
                  <th className="px-3 py-3 w-10">
                    <input
                      type="checkbox"
                      checked={selectedIds.size === sorted.length && sorted.length > 0}
                      onChange={toggleSelectAll}
                      className="rounded border-stone-600 bg-stone-800 text-amber-500 focus:ring-amber-500/40"
                    />
                  </th>
                )}
                <th
                  className="px-4 py-3 text-left cursor-pointer hover:text-stone-200 transition-colors"
                  onClick={() => toggleSort("item_name")}
                >
                  <span className="inline-flex items-center gap-1">
                    Item <SortIcon field="item_name" />
                  </span>
                </th>
                <th
                  className="px-4 py-3 text-left cursor-pointer hover:text-stone-200 transition-colors"
                  onClick={() => toggleSort("category")}
                >
                  <span className="inline-flex items-center gap-1">
                    Category <SortIcon field="category" />
                  </span>
                </th>
                <th
                  className="px-4 py-3 text-right cursor-pointer hover:text-stone-200 transition-colors"
                  onClick={() => toggleSort("current_stock")}
                >
                  <span className="inline-flex items-center gap-1 justify-end">
                    Stock <SortIcon field="current_stock" />
                  </span>
                </th>
                <th
                  className="px-4 py-3 text-right cursor-pointer hover:text-stone-200 transition-colors"
                  onClick={() => toggleSort("unit_cost_cents")}
                >
                  <span className="inline-flex items-center gap-1 justify-end">
                    Unit Cost <SortIcon field="unit_cost_cents" />
                  </span>
                </th>
                <th className="px-4 py-3 text-right">Threshold</th>
                <th className="px-4 py-3 text-left">Unit</th>
                <th className="px-4 py-3 text-center">Level</th>
                <th className="px-2 py-3 text-center w-10"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-800/60">
              {sorted.map((item) => {
                const isLow = item.current_stock !== null && item.min_threshold !== null
                  && item.current_stock < item.min_threshold;
                const isSelected = selectedIds.has(item.id);

                return (
                  <tr
                    key={item.id}
                    className={cn(
                      "hover:bg-stone-800/40 transition-colors",
                      isSelected && "bg-emerald-500/5",
                      isLow && "bg-amber-500/5",
                    )}
                  >
                    {activeEnv === "simulation" && (
                      <td className="px-3 py-2.5">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleSelect(item.id)}
                          className="rounded border-stone-600 bg-stone-800 text-amber-500 focus:ring-amber-500/40"
                        />
                      </td>
                    )}
                    <td className="px-4 py-2.5 font-medium text-white">
                      {item.item_name}
                    </td>
                    <td className="px-4 py-2.5 text-stone-400">{item.category || "—"}</td>
                    <td className={cn("px-4 py-2.5 text-right font-mono tabular-nums", stockBadge(item.current_stock, item.min_threshold))}>
                      {item.current_stock ?? "—"}
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono tabular-nums text-stone-300">
                      {item.unit_cost_cents != null
                        ? `$${(item.unit_cost_cents / 100).toFixed(2)}`
                        : <span className="text-stone-600">—</span>}
                    </td>
                    <td className="px-4 py-2.5 text-right text-stone-500 font-mono tabular-nums">
                      {item.min_threshold ?? "—"}
                    </td>
                    <td className="px-4 py-2.5 text-stone-400">{item.unit}</td>
                    <td className="px-4 py-2.5 text-center">
                      <span className={cn(
                        "inline-block px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border",
                        envBadge(item.data_integrity_level),
                      )}>
                        {item.data_integrity_level === "production" ? "prod" : "sim"}
                      </span>
                    </td>
                    <td className="px-2 py-2.5 text-center">
                      <button
                        onClick={() => setEditItem(item)}
                        className="p-1.5 rounded-md text-stone-500 hover:text-amber-400 hover:bg-stone-700/60 transition-colors"
                        title="Edit item"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ── No search results ─────────────────────────── */}
      {!loading && !error && items.length > 0 && sorted.length === 0 && (
        <div className="text-center py-10 text-stone-500 text-sm">
          No items match &ldquo;{search}&rdquo;
        </div>
      )}

      {/* ── Add Modal ─────────────────────────────────── */}
      {showAddModal && (
        <InventoryAddModal
          token={token}
          onClose={() => setShowAddModal(false)}
          onCreated={() => { setShowAddModal(false); fetchInventory(); }}
        />
      )}

      {editItem && (
        <InventoryEditModal
          token={token}
          item={editItem}
          onClose={() => setEditItem(null)}
          onUpdated={() => { setEditItem(null); fetchInventory(); }}
        />
      )}
    </div>
  );
}
