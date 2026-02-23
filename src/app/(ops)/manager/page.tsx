"use client";

import { useState } from "react";
import {
  LayoutDashboard,
  UtensilsCrossed,
  DollarSign,
  Users,
} from "lucide-react";
import {
  DesktopTabNav,
  MobileBottomTabBar,
  ManagerQuickLinks,
  type ManagerTab,
} from "@/app/(site)/components/manager/ManagerNav";

/* ─── Existing manager components ────────────────────────── */
import DashboardOverhaul from "@/app/(site)/components/manager/DashboardOverhaul";
import CatalogManager from "@/app/(site)/components/manager/CatalogManager";
import PayrollSection from "@/app/(site)/components/manager/PayrollSection";
import ReceiptRoll from "@/app/(site)/components/manager/ReceiptRoll";

/* ─── New hiring viewer (co-located) ────────────────────── */
import HiringViewer from "./HiringViewer";

/* ─── Tab definitions ────────────────────────────────────── */
const TABS: ManagerTab[] = [
  { key: "overview",  label: "Overview",        icon: LayoutDashboard },
  { key: "catalog",   label: "Menu & Catalog",  icon: UtensilsCrossed },
  { key: "payroll",   label: "Payroll",         icon: DollarSign },
  { key: "hiring",    label: "Hiring",          icon: Users },
];

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
        <ManagerQuickLinks />

        {/* ── Desktop tab bar (hidden on mobile) ── */}
        <div className="max-w-7xl mx-auto px-4 sm:px-6 hidden md:block">
          <DesktopTabNav
            tabs={TABS}
            activeTab={activeTab}
            onTabChange={(k) => setActiveTab(k as TabKey)}
          />
        </div>
      </header>

      {/* ── Tab content ─────────────────────────────────── */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-8 pb-28 md:pb-8">
        {activeTab === "overview" && (
          <div className="space-y-2">
            <DashboardOverhaul />
            <ReceiptRoll />
          </div>
        )}

        {activeTab === "catalog" && <CatalogManager />}

        {activeTab === "payroll" && <PayrollSection />}

        {activeTab === "hiring" && <HiringViewer />}
      </main>

      {/* ── Mobile bottom tab bar ───────────────────────── */}
      <MobileBottomTabBar
        tabs={TABS}
        activeTab={activeTab}
        onTabChange={(k) => setActiveTab(k as TabKey)}
      />
    </div>
  );
}
