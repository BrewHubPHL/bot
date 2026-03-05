"use client";
/**
 * MaintenanceLogger — Modal for logging a completed maintenance task.
 *
 * Opens from the Assets page. POSTs to log-maintenance-action.js which
 * inserts into maintenance_logs and (via trigger) atomically updates
 * equipment.last_maint_date in a single transaction.
 *
 * On success, calls the onSuccess() callback to refresh the asset table
 * and clear any active "Overdue" toasts.
 */

import React, { useState, useRef, useEffect } from "react";
import {
  Wrench,
  Loader2,
  CalendarDays,
  DollarSign,
  FileText,
} from "lucide-react";
import { fetchOps } from "@/utils/ops-api";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

/* ── Props ─────────────────────────────────────────────────── */
interface MaintenanceLoggerProps {
  /** The equipment asset to log maintenance for */
  asset: {
    id: string;
    name: string;
    category: string;
  };
  /** OpsGate session token */
  token: string;
  /** Called when modal should close */
  onClose: () => void;
  /** Called after a successful log — parent should refetch assets & clear overdue toasts */
  onSuccess: () => void;
}

/* ── Helpers ───────────────────────────────────────────────── */
const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/* ═══════════════════════════════════════════════════════════
   MAINTENANCE LOGGER MODAL
   ═══════════════════════════════════════════════════════════ */
export default function MaintenanceLogger({
  asset,
  token,
  onClose,
  onSuccess,
}: MaintenanceLoggerProps) {
  /* ── Form state ──────────────────────────────────────────── */
  const [performedAt, setPerformedAt] = useState(todayISO());
  const [cost, setCost] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const firstInput = useRef<HTMLInputElement>(null);

  /* ── Focus first input on mount ────────────────────────── */
  useEffect(() => {
    firstInput.current?.focus();
  }, []);

  /* ── Submit ─────────────────────────────────────────────── */
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    // Client-side validation
    if (!performedAt) {
      setError("Date is required");
      return;
    }
    const costNum = Number(cost);
    if (cost === "" || isNaN(costNum) || costNum < 0) {
      setError("Cost must be a non-negative number");
      return;
    }
    if (costNum > 999999.99) {
      setError("Cost cannot exceed $999,999.99");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetchOps(
        "/log-maintenance-action",
        {
          method: "POST",
          body: JSON.stringify({
            equipment_id: asset.id,
            performed_at: performedAt,
            cost: costNum,
            notes: notes.trim() || null,
          }),
        },
        token,
      );

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error || `Failed (${res.status})`);
        return;
      }

      onSuccess();
    } catch {
      setError("Network error — please try again");
    } finally {
      setSubmitting(false);
    }
  };

  /* ── Render via Dialog ─────────────────────────────────── */
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent
        className="rounded-2xl border-stone-700 bg-stone-900 shadow-2xl sm:max-w-lg"
        aria-label={`Log maintenance for ${asset.name}`}
      >
        {/* ── Header ───────────────────────────────────────── */}
        <DialogHeader className="flex-row items-center gap-3 border-b border-stone-800 pb-4">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-amber-500/10">
            <Wrench size={18} className="text-amber-400" />
          </div>
          <div>
            <DialogTitle className="text-sm font-bold text-white">Log Maintenance</DialogTitle>
            <DialogDescription className="text-xs text-stone-400 truncate max-w-[220px]">
              {asset.name} · <span className="capitalize">{asset.category}</span>
            </DialogDescription>
          </div>
        </DialogHeader>

        {/* ── Form ─────────────────────────────────────────── */}
        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Date */}
          <div>
            <label
              htmlFor="maint-date"
              className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-stone-300 uppercase tracking-wider"
            >
              <CalendarDays size={13} className="text-stone-500" />
              Date Performed
            </label>
            <Input
              ref={firstInput}
              id="maint-date"
              type="date"
              required
              max={todayISO()}
              value={performedAt}
              onChange={(e) => setPerformedAt(e.target.value)}
              className="border-stone-700 bg-stone-800 text-white placeholder:text-stone-500 focus-visible:ring-amber-500/40"
            />
          </div>

          {/* Cost */}
          <div>
            <label
              htmlFor="maint-cost"
              className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-stone-300 uppercase tracking-wider"
            >
              <DollarSign size={13} className="text-stone-500" />
              Cost (USD)
            </label>
            <Input
              id="maint-cost"
              type="number"
              required
              min="0"
              max="999999.99"
              step="0.01"
              placeholder="0.00"
              value={cost}
              onChange={(e) => setCost(e.target.value)}
              className="border-stone-700 bg-stone-800 text-white placeholder:text-stone-500 focus-visible:ring-amber-500/40"
            />
          </div>

          {/* Notes */}
          <div>
            <label
              htmlFor="maint-notes"
              className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-stone-300 uppercase tracking-wider"
            >
              <FileText size={13} className="text-stone-500" />
              Notes <span className="text-stone-500 font-normal">(optional)</span>
            </label>
            <textarea
              id="maint-notes"
              rows={3}
              maxLength={2000}
              placeholder="Describe the work performed…"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full rounded-lg border border-stone-700 bg-stone-800 px-3 py-2 text-sm text-white
                         placeholder:text-stone-500 focus:border-amber-500 focus:ring-1 focus:ring-amber-500/40
                         outline-none transition-colors resize-none"
            />
            <p className="mt-1 text-right text-[10px] text-stone-600">{notes.length}/2000</p>
          </div>

          {/* Error */}
          {error && (
            <div
              role="alert"
              className="rounded-lg border border-red-700/50 bg-red-900/30 px-3 py-2 text-xs text-red-300"
            >
              {error}
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center justify-end gap-3 pt-1">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="rounded-lg px-4 py-2 text-sm font-medium text-stone-400
                         hover:text-white hover:bg-stone-800 transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="flex items-center gap-2 rounded-lg bg-amber-600 px-5 py-2 text-sm font-semibold text-white
                         hover:bg-amber-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submitting ? (
                <>
                  <Loader2 size={14} className="animate-spin" />
                  Saving…
                </>
              ) : (
                "Log Maintenance"
              )}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
