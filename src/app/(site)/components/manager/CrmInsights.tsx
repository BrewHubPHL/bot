"use client";

import React, { useCallback, useEffect, useState } from "react";
import { useOpsSessionOptional } from "@/components/OpsGate";
import { fetchOps } from "@/utils/ops-api";
import {
  Users,
  Smartphone,
  Footprints,
  Mailbox,
  Coffee,
  Star,
  Heart,
  TrendingUp,
  UserPlus,
  RefreshCw,
  ArrowRight,
} from "lucide-react";

/* ================================================================== */
/*  Types                                                              */
/* ================================================================== */
interface CrmData {
  total_customers: number;
  app_users: number;
  walk_ins: number;
  mailbox_renters: number;
  vips: number;
  loyalty_active: number;
  total_loyalty_points: number;
  has_ordered: number;
  avg_orders_per_active: number;
  mailbox_cafe_crossover: number;
  active_last_30d: number;
  new_last_7d: number;
  top_drinks: { drink: string; count: number }[];
}

/* ================================================================== */
/*  Stat Card                                                          */
/* ================================================================== */
function StatCard({
  icon: Icon,
  label,
  value,
  sub,
  accent = "amber",
}: {
  icon: React.ElementType;
  label: string;
  value: string | number;
  sub?: string;
  accent?: "amber" | "emerald" | "sky" | "rose" | "violet";
}) {
  const colors: Record<string, { bg: string; icon: string; ring: string }> = {
    amber:   { bg: "bg-amber-500/10",   icon: "text-amber-400",   ring: "ring-amber-500/20" },
    emerald: { bg: "bg-emerald-500/10", icon: "text-emerald-400", ring: "ring-emerald-500/20" },
    sky:     { bg: "bg-sky-500/10",     icon: "text-sky-400",     ring: "ring-sky-500/20" },
    rose:    { bg: "bg-rose-500/10",    icon: "text-rose-400",    ring: "ring-rose-500/20" },
    violet:  { bg: "bg-violet-500/10",  icon: "text-violet-400",  ring: "ring-violet-500/20" },
  };
  const c = colors[accent] || colors.amber;

  return (
    <div
      className={`relative overflow-hidden rounded-xl ${c.bg} ring-1 ${c.ring} p-4 
                  transition-all hover:scale-[1.02] hover:shadow-lg`}
    >
      <div className="flex items-start justify-between">
        <div className="space-y-1">
          <p className="text-xs font-medium uppercase tracking-wider text-stone-400">
            {label}
          </p>
          <p className="text-2xl font-bold text-white tabular-nums">{value}</p>
          {sub && (
            <p className="text-[11px] text-stone-500 leading-tight">{sub}</p>
          )}
        </div>
        <div className={`rounded-lg p-2 ${c.bg}`}>
          <Icon size={20} className={c.icon} />
        </div>
      </div>
    </div>
  );
}

/* ================================================================== */
/*  Overlap Visual                                                     */
/* ================================================================== */
function OverlapVenn({
  mailbox,
  cafe,
  crossover,
}: {
  mailbox: number;
  cafe: number;
  crossover: number;
}) {
  const pct = mailbox > 0 ? Math.round((crossover / mailbox) * 100) : 0;

  return (
    <div className="rounded-xl bg-stone-800/50 ring-1 ring-stone-700/50 p-5">
      <h3 className="text-sm font-semibold text-stone-300 mb-4 flex items-center gap-2">
        <ArrowRight size={14} className="text-amber-500" />
        Mailbox ↔ Cafe Crossover
      </h3>

      <div className="flex items-center justify-center gap-6 py-2">
        {/* Left circle — Mailbox */}
        <div className="relative flex flex-col items-center">
          <div
            className="w-24 h-24 rounded-full bg-sky-500/20 ring-2 ring-sky-500/40
                        flex items-center justify-center"
          >
            <div className="text-center">
              <p className="text-lg font-bold text-sky-300">{mailbox}</p>
              <p className="text-[9px] uppercase tracking-wider text-sky-400/70">Mailbox</p>
            </div>
          </div>
        </div>

        {/* Center overlap badge */}
        <div className="flex flex-col items-center -mx-4 z-10">
          <div
            className="w-16 h-16 rounded-full bg-amber-500/25 ring-2 ring-amber-400/50
                        flex items-center justify-center shadow-lg shadow-amber-500/10"
          >
            <div className="text-center">
              <p className="text-base font-bold text-amber-300">{crossover}</p>
              <p className="text-[8px] uppercase tracking-wider text-amber-400/70">Both</p>
            </div>
          </div>
          <p className="text-xs text-amber-400 font-medium mt-1">{pct}%</p>
        </div>

        {/* Right circle — Cafe */}
        <div className="relative flex flex-col items-center">
          <div
            className="w-24 h-24 rounded-full bg-emerald-500/20 ring-2 ring-emerald-500/40
                        flex items-center justify-center"
          >
            <div className="text-center">
              <p className="text-lg font-bold text-emerald-300">{cafe}</p>
              <p className="text-[9px] uppercase tracking-wider text-emerald-400/70">Cafe</p>
            </div>
          </div>
        </div>
      </div>

      <p className="text-center text-[11px] text-stone-500 mt-3">
        {crossover > 0
          ? `${pct}% of mailbox renters also order from the cafe`
          : "No crossover yet — opportunity to upsell!"}
      </p>
    </div>
  );
}

/* ================================================================== */
/*  Top Drinks Bar Chart                                               */
/* ================================================================== */
function TopDrinks({ drinks }: { drinks: CrmData["top_drinks"] }) {
  if (!drinks || drinks.length === 0) return null;
  const max = Math.max(...drinks.map((d) => d.count), 1);

  return (
    <div className="rounded-xl bg-stone-800/50 ring-1 ring-stone-700/50 p-5">
      <h3 className="text-sm font-semibold text-stone-300 mb-3 flex items-center gap-2">
        <Coffee size={14} className="text-amber-500" />
        Top Favorite Drinks
        <span className="text-[10px] text-stone-500 font-normal">(besides Black Coffee)</span>
      </h3>
      <div className="space-y-2">
        {drinks.map((d) => {
          const w = Math.max((d.count / max) * 100, 8);
          return (
            <div key={d.drink} className="flex items-center gap-3">
              <span className="text-xs text-stone-400 w-28 truncate text-right">
                {d.drink}
              </span>
              <div className="flex-1 h-5 bg-stone-700/40 rounded-full overflow-hidden">
                <div
                  className="h-full bg-amber-500/60 rounded-full transition-all duration-700"
                  style={{ width: `${w}%` }}
                />
              </div>
              <span className="text-xs font-medium text-stone-300 tabular-nums w-8 text-right">
                {d.count}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ================================================================== */
/*  Main Component                                                     */
/* ================================================================== */
export default function CrmInsights() {
  const session = useOpsSessionOptional();
  const token = session?.token;

  const [data, setData] = useState<CrmData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchOps("/get-crm-insights", {}, token);
      if (!res.ok) {
        setError(`Failed to load (${res.status})`);
        return;
      }
      const json: CrmData = await res.json();
      setData(json);
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  /* ── Loading / Error states ──────────────────────────── */
  if (loading) {
    return (
      <div className="rounded-xl bg-stone-800/40 ring-1 ring-stone-700/50 p-8">
        <div className="flex items-center justify-center gap-3 text-stone-400">
          <RefreshCw size={16} className="animate-spin" />
          <span className="text-sm">Loading CRM insights…</span>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="rounded-xl bg-rose-500/10 ring-1 ring-rose-500/30 p-6 text-center">
        <p className="text-sm text-rose-300">{error || "No data"}</p>
        <button
          onClick={fetchData}
          className="mt-2 text-xs text-stone-400 hover:text-white transition-colors underline"
        >
          Retry
        </button>
      </div>
    );
  }

  /* ── Render ──────────────────────────────────────────── */
  return (
    <section className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <Users size={20} className="text-amber-400" />
            Unified CRM Insights
          </h2>
          <p className="text-xs text-stone-500 mt-0.5">
            Complete view of your customer base after the CRM merge
          </p>
        </div>
        <button
          onClick={fetchData}
          disabled={loading}
          className="flex items-center gap-1.5 text-xs text-stone-400 hover:text-white
                     transition-colors px-3 py-1.5 rounded-lg hover:bg-stone-800"
        >
          <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
          Refresh
        </button>
      </div>

      {/* ── Primary KPI Grid ─────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard
          icon={Users}
          label="Total Customers"
          value={data.total_customers.toLocaleString()}
          sub={`${data.new_last_7d} new this week`}
          accent="amber"
        />
        <StatCard
          icon={Smartphone}
          label="App Users"
          value={data.app_users.toLocaleString()}
          sub={`${data.total_customers > 0 ? Math.round((data.app_users / data.total_customers) * 100) : 0}% of total`}
          accent="emerald"
        />
        <StatCard
          icon={Footprints}
          label="Walk-Ins"
          value={data.walk_ins.toLocaleString()}
          sub="No app account yet"
          accent="sky"
        />
        <StatCard
          icon={Mailbox}
          label="Mailbox Renters"
          value={data.mailbox_renters.toLocaleString()}
          sub={`${data.mailbox_cafe_crossover} also order cafe`}
          accent="violet"
        />
      </div>

      {/* ── Secondary stats ──────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard
          icon={Star}
          label="VIP Customers"
          value={data.vips}
          accent="rose"
        />
        <StatCard
          icon={Heart}
          label="Loyalty Active"
          value={data.loyalty_active.toLocaleString()}
          sub={`${data.total_loyalty_points.toLocaleString()} pts in system`}
          accent="amber"
        />
        <StatCard
          icon={TrendingUp}
          label="Active (30d)"
          value={data.active_last_30d}
          sub={`Avg ${data.avg_orders_per_active} orders each`}
          accent="emerald"
        />
        <StatCard
          icon={UserPlus}
          label="New This Week"
          value={data.new_last_7d}
          accent="sky"
        />
      </div>

      {/* ── Crossover Venn + Drinks ──────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <OverlapVenn
          mailbox={data.mailbox_renters}
          cafe={data.has_ordered}
          crossover={data.mailbox_cafe_crossover}
        />
        <TopDrinks drinks={data.top_drinks} />
      </div>
    </section>
  );
}
