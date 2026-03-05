"use client";

import React, { useCallback, useEffect, useState } from "react";
import { useOpsSessionOptional } from "@/components/OpsGate";
import { fetchOps } from "@/utils/ops-api";
import { TrendingUp, DollarSign, Clock, Users, UserCheck } from "lucide-react";
import { formatCentsToDollars } from "@/utils/currency-utils";

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */
interface ProfitShareData {
  month: string;
  net_profit_cents: number;
  net_profit_display: string;
  profit_floor_cents: number;
  profit_floor_display: string;
  profit_above_floor_cents: number;
  profit_above_floor_display: string;
  staff_pool_cents: number;
  staff_pool_display: string;
  staff_pool_rate: number;
  staff_pool_rate_bps?: number;
  total_staff_hours: number;
  total_staff_minutes?: number;
  bonus_per_hour_cents: number;
  bonus_per_hour_display: string;
  floor_progress_pct: number;
  eligible_staff_count: number;
  pending_staff_count: number;
  vesting_months: number;
  probation_days: number;
  order_count: number;
  revenue_display: string;
}

/* ------------------------------------------------------------------ */
/* Component                                                           */
/* ------------------------------------------------------------------ */
export default function ProfitShareCard() {
  const session = useOpsSessionOptional();
  const token = session?.token;

  const [data, setData] = useState<ProfitShareData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchProfitShare = useCallback(async () => {
    if (!token) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetchOps("/get-profit-share-preview", {}, token);
      if (res.status === 401) return; // fetchOps triggers forceOpsLogout
      if (res.status === 429) {
        setError("Rate limited — try again shortly.");
        setLoading(false);
        return;
      }
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error || "Unable to load profit share data.");
        setLoading(false);
        return;
      }
      const d: ProfitShareData = await res.json();
      setData(d);
    } catch {
      setError("Network error loading profit share.");
    }
    setLoading(false);
  }, [token]);

  useEffect(() => {
    fetchProfitShare();
  }, [fetchProfitShare]);

  /* ── Skeleton loader ──────────────────────────────────── */
  if (loading) {
    return (
      <div className="bg-stone-900 border border-stone-800 rounded-xl p-5 space-y-4 animate-pulse">
        <div className="h-5 w-48 bg-stone-800 rounded" />
        <div className="h-4 w-full bg-stone-800 rounded-full" />
        <div className="grid grid-cols-3 gap-3">
          <div className="h-16 bg-stone-800 rounded-lg" />
          <div className="h-16 bg-stone-800 rounded-lg" />
          <div className="h-16 bg-stone-800 rounded-lg" />
        </div>
        <div className="grid grid-cols-1 gap-3">
          <div className="h-10 bg-stone-800 rounded-lg" />
        </div>
      </div>
    );
  }

  /* ── Error state ──────────────────────────────────────── */
  if (error || !data) {
    return (
      <div className="bg-stone-900 border border-red-500/30 rounded-xl p-5">
        <div className="text-sm text-red-400 flex items-center gap-2">
          <TrendingUp size={16} />
          {error || "Profit share data unavailable."}
        </div>
      </div>
    );
  }

  /* ── Derived state ────────────────────────────────────── */
  const aboveFloor = data.profit_above_floor_cents > 0;
  const progressPct = data.floor_progress_pct;
  const progressColor =
    progressPct >= 100
      ? "bg-green-500"
      : progressPct >= 60
        ? "bg-amber-400"
        : "bg-red-400";
  const progressTrack =
    progressPct >= 100
      ? "bg-green-500/10"
      : "bg-stone-800";

  return (
    <div className="bg-stone-900 border border-stone-800 rounded-xl overflow-hidden">
      {/* ── Header ──────────────────────────────────────── */}
      <div className="flex items-center justify-between px-5 min-h-[56px] border-b border-stone-800">
        <span className="font-semibold text-base flex items-center gap-2">
          <TrendingUp size={18} className="text-green-400" />
          Team Profit Share
        </span>
        <span className="text-xs text-stone-500 tabular-nums">
          {data.month}
        </span>
      </div>

      <div className="p-5 space-y-5">
        {/* ── Progress bar toward Profit Floor ──────────── */}
        <div>
          <div className="flex items-center justify-between text-xs mb-2">
            <span className="text-stone-400">
              Progress to {data.profit_floor_display} Floor
            </span>
            <span
              className={`font-bold tabular-nums ${
                progressPct >= 100 ? "text-green-400" : "text-stone-300"
              }`}
            >
              {progressPct}%
            </span>
          </div>
          <div className={`w-full h-3 rounded-full ${progressTrack} overflow-hidden`}>
            <div
              className={`h-full rounded-full transition-all duration-700 ease-out ${progressColor}`}
              style={{ width: `${Math.min(progressPct, 100)}%` }}
            />
          </div>
          <div className="flex items-center justify-between text-[11px] text-stone-500 mt-1.5">
            <span>Net Profit: {data.net_profit_display}</span>
            <span>Floor: {data.profit_floor_display}</span>
          </div>
        </div>

        {/* ── Key metrics grid ─────────────────────────── */}
        <div className="grid grid-cols-3 gap-3">
          {/* Staff Pool */}
          <div className="bg-stone-800/50 rounded-lg p-3 text-center">
            <DollarSign
              size={16}
              className={`mx-auto mb-1.5 ${aboveFloor ? "text-green-400" : "text-stone-500"}`}
            />
            <div
              className={`text-lg font-bold tabular-nums ${
                aboveFloor ? "text-green-400" : "text-stone-500"
              }`}
            >
              {data.staff_pool_display}
            </div>
            <div className="text-[10px] text-stone-500 mt-0.5">
              Staff Pool (10%)
            </div>
          </div>

          {/* Total Hours */}
          <div className="bg-stone-800/50 rounded-lg p-3 text-center">
            <Clock size={16} className="mx-auto mb-1.5 text-blue-400" />
            <div className="text-lg font-bold tabular-nums text-blue-400">
              {data.total_staff_hours.toLocaleString()}h
            </div>
            <div className="text-[10px] text-stone-500 mt-0.5">
              Team Hours
            </div>
          </div>

          {/* Bonus per Hour */}
          <div className="bg-stone-800/50 rounded-lg p-3 text-center">
            <Users
              size={16}
              className={`mx-auto mb-1.5 ${aboveFloor ? "text-amber-400" : "text-stone-500"}`}
            />
            <div
              className={`text-lg font-bold tabular-nums ${
                aboveFloor ? "text-amber-400" : "text-stone-500"
              }`}
            >
              {data.bonus_per_hour_display}
            </div>
            <div className="text-[10px] text-stone-500 mt-0.5">
              Bonus / Hour
            </div>
          </div>
        </div>

        {/* ── Eligible Staff banner ─────────────────────── */}
        <div className="bg-stone-800/50 rounded-lg px-4 py-2.5 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <UserCheck size={15} className="text-emerald-400" />
            <span className="text-sm font-semibold tabular-nums text-emerald-400">
              {data.eligible_staff_count} Eligible Staff
            </span>
            {data.pending_staff_count > 0 && (
              <span className="text-xs text-stone-500">
                ({data.pending_staff_count} pending)
              </span>
            )}
          </div>
          <span
            className="text-[10px] text-stone-600 max-w-[180px] text-right leading-tight"
            title={`Employees must have ${data.vesting_months ?? 6}-month tenure to participate. ${data.probation_days ?? 90}-day probation employees are excluded.`}
          >
            {data.vesting_months ?? 6}-mo vesting per Addendum
          </span>
        </div>

        {/* ── Explainer line ────────────────────────────── */}
        <div className="text-xs text-stone-500 leading-relaxed">
          {aboveFloor ? (
            <>
              Net profit exceeded the {data.profit_floor_display} floor by{" "}
              <span className="text-green-400 font-semibold">
                {data.profit_above_floor_display}
              </span>
              . The 10% staff pool of{" "}
              <span className="text-green-400 font-semibold">
                {data.staff_pool_display}
              </span>{" "}
              divided across {data.total_staff_hours}h ={" "}
              <span className="text-amber-400 font-semibold">
                {data.bonus_per_hour_display}/hr
              </span>{" "}
              bonus.
            </>
          ) : (
            <>
              The shop needs to clear the {data.profit_floor_display} profit
              floor before the staff pool activates.{" "}
              {data.net_profit_cents > 0
                ? `${data.net_profit_display} earned so far — ${formatCentsToDollars(
                    data.profit_floor_cents - data.net_profit_cents
                  )} to go.`
                : "Keep pushing!"}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
