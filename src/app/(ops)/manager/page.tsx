"use client";

import { useState } from "react";
import {
  LayoutDashboard,
  UtensilsCrossed,
  DollarSign,
  Users,
} from "lucide-react";

/* ─── Existing manager components ────────────────────────── */
import StatsGrid from "@/app/(site)/components/manager/StatsGrid";
import RecentActivity from "@/app/(site)/components/manager/RecentActivity";
import CatalogManager from "@/app/(site)/components/manager/CatalogManager";
import PayrollSection from "@/app/(site)/components/manager/PayrollSection";

/* ─── New hiring viewer (co-located) ────────────────────── */
import HiringViewer from "./HiringViewer";

/* ─── Tab definitions ────────────────────────────────────── */
const TABS = [
  { key: "overview",  label: "Overview",        icon: LayoutDashboard },
  { key: "catalog",   label: "Menu & Catalog",  icon: UtensilsCrossed },
  { key: "payroll",   label: "Payroll",         icon: DollarSign },
  { key: "hiring",    label: "Hiring",          icon: Users },
] as const;

type TabKey = (typeof TABS)[number]["key"];

/* ═══════════════════════════════════════════════════════════
   MANAGER DASHBOARD
   ═══════════════════════════════════════════════════════════ */
export default function ManagerDashboard() {
  const [activeTab, setActiveTab] = useState<TabKey>("overview");

  return (
    <div className="min-h-screen bg-stone-950 text-white">
      {/* ── Top bar ─────────────────────────────────────── */}
      <header className="sticky top-0 z-40 bg-stone-950/90 backdrop-blur-md border-b border-stone-800">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-lg font-bold tracking-tight">
              Manager Dashboard
            </h1>
            <p className="text-stone-500 text-xs tracking-wider uppercase">
              BrewHub PHL &middot; Staff Operations
            </p>
          </div>
          <span className="text-xs text-stone-600 hidden sm:block">
            {new Date().toLocaleDateString("en-US", {
              weekday: "long",
              month: "long",
              day: "numeric",
              year: "numeric",
            })}
          </span>
        </div>

        {/* ── Tab bar (horizontal, scrollable on mobile) ── */}
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <nav className="flex gap-1 overflow-x-auto pb-px scrollbar-hide -mb-px">
            {TABS.map(({ key, label, icon: Icon }) => {
              const active = activeTab === key;
              return (
                <button
                  key={key}
                  onClick={() => setActiveTab(key)}
                  className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
                    active
                      ? "border-amber-500 text-amber-400"
                      : "border-transparent text-stone-500 hover:text-stone-300 hover:border-stone-700"
                  }`}
                >
                  <Icon size={16} />
                  {label}
                </button>
              );
            })}
          </nav>
        </div>
      </header>

      {/* ── Tab content ─────────────────────────────────── */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
        {activeTab === "overview" && (
          <div className="space-y-2">
            <StatsGrid />
            <RecentActivity />
          </div>
        )}

        {activeTab === "catalog" && <CatalogManager />}

        {activeTab === "payroll" && <PayrollSection />}

        {activeTab === "hiring" && <HiringViewer />}
      </main>
    </div>
  );
}
