"use client";

import { useState } from "react";
import Link from "next/link";
import {
  LayoutDashboard,
  UtensilsCrossed,
  DollarSign,
  Users,
} from "lucide-react";

/* ─── Existing manager components ────────────────────────── */
import DashboardOverhaul from "@/app/(site)/components/manager/DashboardOverhaul";
import RecentActivity from "@/app/(site)/components/manager/RecentActivity";
import CatalogManager from "@/app/(site)/components/manager/CatalogManager";
import PayrollSection from "@/app/(site)/components/manager/PayrollSection";
import ReceiptRoll from "@/app/(site)/components/manager/ReceiptRoll";

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

        {/* ── Quick nav links to other ops pages ── */}
        <div className="max-w-7xl mx-auto px-4 sm:px-6 flex gap-3 py-1.5 text-[11px] text-stone-500">
          <Link href="/pos" className="hover:text-amber-400 transition-colors">POS</Link>
          <Link href="/kds" className="hover:text-amber-400 transition-colors">KDS</Link>
          <Link href="/scanner" className="hover:text-amber-400 transition-colors">Scanner</Link>
          <Link href="/staff-hub" className="hover:text-amber-400 transition-colors">Staff Hub</Link>
          <span className="text-stone-700">|</span>
          <Link href="/" className="hover:text-amber-400 transition-colors">Main Site</Link>
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
            <DashboardOverhaul />
            <ReceiptRoll />
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
