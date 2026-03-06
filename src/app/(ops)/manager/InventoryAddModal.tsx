"use client";

import { useState, useCallback } from "react";
import { X, Plus, Loader2, AlertTriangle } from "lucide-react";
import { fetchOps } from "@/utils/ops-api";

/* ─── Types ────────────────────────────────────────────── */
interface InventoryAddModalProps {
  token: string;
  onClose: () => void;
  onCreated: () => void;
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
export default function InventoryAddModal({ token, onClose, onCreated }: InventoryAddModalProps) {
  const [name, setName] = useState("");
  const [barcode, setBarcode] = useState("");
  const [category, setCategory] = useState<string>(CATEGORY_OPTIONS[0]);
  const [unitCost, setUnitCost] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const trimmedName = name.trim();
    const trimmedBarcode = barcode.trim();

    if (!trimmedName) { setError("Item name is required."); return; }
    if (trimmedName.length > 100) { setError("Item name must be 100 characters or fewer."); return; }
    if (!trimmedBarcode) { setError("Barcode is required."); return; }
    if (trimmedBarcode.length > 50) { setError("Barcode must be 50 characters or fewer."); return; }
    if (!/^[A-Za-z0-9\-_.]+$/.test(trimmedBarcode)) {
      setError("Barcode can only contain letters, numbers, dashes, dots, and underscores.");
      return;
    }

    let unitCostCents: number | null = null;
    if (unitCost.trim() !== "") {
      const parsed = parseFloat(unitCost.trim());
      if (isNaN(parsed) || parsed < 0 || parsed > 999999) {
        setError("Unit cost must be a positive dollar amount (e.g. 4.50).");
        return;
      }
      unitCostCents = Math.round(parsed * 100);
    }

    setSaving(true);
    try {
      const res = await fetchOps("/create-inventory-item", {
        method: "POST",
        body: JSON.stringify({ name: trimmedName, barcode: trimmedBarcode, category, unit_cost_cents: unitCostCents }),
      }, token);

      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: "Request failed" }));
        setError(body.error || `Server error (${res.status})`);
        return;
      }

      onCreated();
    } catch {
      setError("Connection error. Check your network.");
    } finally {
      setSaving(false);
    }
  }, [name, barcode, category, unitCost, token, onCreated]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-stone-900 border border-stone-700 rounded-2xl p-6 w-full max-w-md mx-4 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-lg font-bold text-white flex items-center gap-2">
            <Plus className="h-5 w-5 text-amber-400" />
            Add Inventory Item
          </h3>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-stone-400 hover:text-white hover:bg-stone-800 transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <p className="text-stone-400 text-xs mb-5">
          New items default to <strong className="text-amber-400">Simulation</strong> mode.
          Promote to Production once verified on-site.
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Item Name */}
          <div>
            <label htmlFor="inv-name" className="block text-xs font-medium text-stone-300 mb-1.5">
              Item Name
            </label>
            <input
              id="inv-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Oat Milk (64oz)"
              maxLength={100}
              className="w-full px-3 py-2.5 bg-stone-800 border border-stone-700 rounded-xl text-white text-sm placeholder:text-stone-500 focus:outline-none focus:ring-2 focus:ring-amber-500/40"
              disabled={saving}
              autoFocus
            />
          </div>

          {/* Barcode */}
          <div>
            <label htmlFor="inv-barcode" className="block text-xs font-medium text-stone-300 mb-1.5">
              Barcode / SKU
            </label>
            <input
              id="inv-barcode"
              type="text"
              value={barcode}
              onChange={(e) => setBarcode(e.target.value)}
              placeholder="e.g. 012345678905 or BRW-OAT64"
              maxLength={50}
              className="w-full px-3 py-2.5 bg-stone-800 border border-stone-700 rounded-xl text-white text-sm placeholder:text-stone-500 focus:outline-none focus:ring-2 focus:ring-amber-500/40 font-mono"
              disabled={saving}
            />
          </div>

          {/* Category */}
          <div>
            <label htmlFor="inv-category" className="block text-xs font-medium text-stone-300 mb-1.5">
              Category
            </label>
            <select
              id="inv-category"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="w-full px-3 py-2.5 bg-stone-800 border border-stone-700 rounded-xl text-white text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/40"
              disabled={saving}
            >
              {CATEGORY_OPTIONS.map((cat) => (
                <option key={cat} value={cat}>{cat}</option>
              ))}
            </select>
          </div>

          {/* Unit Cost */}
          <div>
            <label htmlFor="inv-cost" className="block text-xs font-medium text-stone-300 mb-1.5">
              Unit Cost <span className="text-stone-500">(optional)</span>
            </label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-500 text-sm">$</span>
              <input
                id="inv-cost"
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
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              {saving ? "Creating…" : "Add Item"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
