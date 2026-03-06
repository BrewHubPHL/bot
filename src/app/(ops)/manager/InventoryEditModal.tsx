"use client";

import { useState, useCallback } from "react";
import { X, Save, Loader2, AlertTriangle, Pencil } from "lucide-react";
import { fetchOps } from "@/utils/ops-api";

/* ─── Types ────────────────────────────────────────────── */
export interface EditableInventoryItem {
  id: string;
  item_name: string;
  category: string;
  current_stock: number | null;
  min_threshold: number | null;
  unit: string;
  unit_cost_cents: number | null;
}

interface InventoryEditModalProps {
  token: string;
  item: EditableInventoryItem;
  onClose: () => void;
  onUpdated: () => void;
}

const CATEGORY_OPTIONS = [
  "Coffee Beans",
  "Milk & Dairy",
  "Syrups & Flavors",
  "Cups & Lids",
  "Pastry & Food",
  "Cleaning Supplies",
  "Equipment Parts",
  "Merchandise",
  "Other",
] as const;

/* ─── Modal ────────────────────────────────────────────── */
export default function InventoryEditModal({
  token,
  item,
  onClose,
  onUpdated,
}: InventoryEditModalProps) {
  const [name, setName] = useState(item.item_name);
  const [category, setCategory] = useState(item.category || "Other");
  const [unit, setUnit] = useState(item.unit || "units");
  const [minThreshold, setMinThreshold] = useState(
    item.min_threshold != null ? String(item.min_threshold) : "10",
  );
  const [unitCost, setUnitCost] = useState(
    item.unit_cost_cents != null ? (item.unit_cost_cents / 100).toFixed(2) : "",
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setError(null);

      const trimmedName = name.trim();
      if (!trimmedName) {
        setError("Item name is required.");
        return;
      }
      if (trimmedName.length > 100) {
        setError("Item name must be 100 characters or fewer.");
        return;
      }

      const threshold = Number(minThreshold);
      if (!Number.isFinite(threshold) || threshold < 0 || threshold > 100000) {
        setError("Threshold must be 0–100,000.");
        return;
      }

      let costCents: number | null = null;
      if (unitCost.trim() !== "") {
        const parsed = parseFloat(unitCost.trim());
        if (isNaN(parsed) || parsed < 0 || parsed > 999999) {
          setError("Unit cost must be a positive dollar amount (e.g. 4.50).");
          return;
        }
        costCents = Math.round(parsed * 100);
      }

      setSaving(true);
      try {
        const res = await fetchOps(
          "/update-inventory-item",
          {
            method: "POST",
            body: JSON.stringify({
              id: item.id,
              item_name: trimmedName,
              category,
              unit: unit.trim() || "units",
              min_threshold: Math.round(threshold),
              unit_cost_cents: costCents,
            }),
          },
          token,
        );

        if (!res.ok) {
          const body = await res.json().catch(() => ({ error: "Request failed" }));
          setError(body.error || `Server error (${res.status})`);
          return;
        }

        onUpdated();
      } catch {
        setError("Connection error. Check your network.");
      } finally {
        setSaving(false);
      }
    },
    [name, category, unit, minThreshold, unitCost, item.id, token, onUpdated],
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-stone-900 border border-stone-700 rounded-2xl p-6 w-full max-w-md mx-4 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-lg font-bold text-white flex items-center gap-2">
            <Pencil className="h-5 w-5 text-amber-400" />
            Edit Item
          </h3>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-stone-400 hover:text-white hover:bg-stone-800 transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Item Name */}
          <div>
            <label
              htmlFor="edit-name"
              className="block text-xs font-medium text-stone-300 mb-1.5"
            >
              Item Name
            </label>
            <input
              id="edit-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={100}
              className="w-full px-3 py-2.5 bg-stone-800 border border-stone-700 rounded-xl text-white text-sm placeholder:text-stone-500 focus:outline-none focus:ring-2 focus:ring-amber-500/40"
              disabled={saving}
              autoFocus
            />
          </div>

          {/* Category */}
          <div>
            <label
              htmlFor="edit-category"
              className="block text-xs font-medium text-stone-300 mb-1.5"
            >
              Category
            </label>
            <select
              id="edit-category"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="w-full px-3 py-2.5 bg-stone-800 border border-stone-700 rounded-xl text-white text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/40"
              disabled={saving}
            >
              {CATEGORY_OPTIONS.map((cat) => (
                <option key={cat} value={cat}>
                  {cat}
                </option>
              ))}
            </select>
          </div>

          {/* Unit + Threshold row */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label
                htmlFor="edit-unit"
                className="block text-xs font-medium text-stone-300 mb-1.5"
              >
                Unit
              </label>
              <input
                id="edit-unit"
                type="text"
                value={unit}
                onChange={(e) => setUnit(e.target.value)}
                maxLength={20}
                className="w-full px-3 py-2.5 bg-stone-800 border border-stone-700 rounded-xl text-white text-sm placeholder:text-stone-500 focus:outline-none focus:ring-2 focus:ring-amber-500/40"
                disabled={saving}
              />
            </div>
            <div>
              <label
                htmlFor="edit-threshold"
                className="block text-xs font-medium text-stone-300 mb-1.5"
              >
                Min Threshold
              </label>
              <input
                id="edit-threshold"
                type="number"
                min={0}
                max={100000}
                value={minThreshold}
                onChange={(e) => setMinThreshold(e.target.value)}
                className="w-full px-3 py-2.5 bg-stone-800 border border-stone-700 rounded-xl text-white text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/40"
                disabled={saving}
              />
            </div>
          </div>

          {/* Unit Cost */}
          <div>
            <label
              htmlFor="edit-cost"
              className="block text-xs font-medium text-stone-300 mb-1.5"
            >
              Unit Cost
            </label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-500 text-sm">
                $
              </span>
              <input
                id="edit-cost"
                type="text"
                inputMode="decimal"
                value={unitCost}
                onChange={(e) => setUnitCost(e.target.value)}
                placeholder="0.00"
                maxLength={10}
                className="w-full pl-7 pr-3 py-2.5 bg-stone-800 border border-stone-700 rounded-xl text-white text-sm placeholder:text-stone-500 focus:outline-none focus:ring-2 focus:ring-amber-500/40 font-mono"
                disabled={saving}
              />
            </div>
            <p className="text-[10px] text-stone-500 mt-1">
              Leave blank if cost is unknown.
            </p>
          </div>

          {/* Error */}
          {error && (
            <div className="flex items-start gap-2 text-red-400 text-xs bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2.5">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2.5 rounded-xl bg-stone-800 text-stone-300 text-sm font-medium hover:bg-stone-700 transition-colors"
              disabled={saving}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex-1 px-4 py-2.5 rounded-xl bg-amber-600 text-white text-sm font-bold hover:bg-amber-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Save className="h-4 w-4" />
              )}
              {saving ? "Saving…" : "Save Changes"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
