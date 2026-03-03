"use client";

import { useState } from "react";
import { Download } from "lucide-react";
import { supabase } from "@/lib/supabase";

/**
 * Fetches all coffee_orders (oldest → newest), converts to CSV,
 * and triggers a browser download.
 */
export default function ExportOrdersButton() {
  const [loading, setLoading] = useState(false);

  async function handleExport() {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("coffee_orders")
        .select("*")
        .order("created_at", { ascending: true });

      if (error) throw error;

      if (!data || data.length === 0) {
        alert("No orders found to export.");
        return;
      }

      /* ── Build CSV ─────────────────────────────────── */
      const headers = Object.keys(data[0]);
      const csvRows = [
        headers.join(","),
        ...data.map((row) =>
          headers
            .map((h) => {
              const val = row[h];
              if (val === null || val === undefined) return "";
              const str = String(val).replace(/"/g, '""');
              return `"${str}"`;
            })
            .join(",")
        ),
      ];
      const csv = csvRows.join("\n");

      /* ── Trigger download ──────────────────────────── */
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `coffee_orders_${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err: unknown) {
      console.error("Export failed:", err);
      alert("Failed to export orders. Check the console for details.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      onClick={handleExport}
      disabled={loading}
      className="inline-flex items-center gap-2 rounded-lg bg-stone-800 px-4 py-2 text-sm font-medium text-stone-100 transition-colors hover:bg-stone-700 disabled:opacity-50 disabled:cursor-not-allowed"
    >
      <Download size={16} />
      {loading ? "Exporting…" : "Export Orders CSV"}
    </button>
  );
}
