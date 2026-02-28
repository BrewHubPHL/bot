"use client";

import { useState, useEffect } from "react";
import {
  LayoutDashboard,
  UtensilsCrossed,
  DollarSign,
  Users,
  MonitorPlay,
  Package,
  Truck,
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

/* ─── Queue monitor (manager-only) ──────────────────────── */
import QueueMonitor from "./QueueMonitor";

/* ─── Parcels departure board (manager-only) ─────────────── */
import ParcelsMonitor from "./ParcelsMonitor";
/* ─── Parcel operations panel (staff view) ─────────── */
import ParcelOpsPanel from "./ParcelOpsPanel";
/* ─── Live Staff Pulse (persistent header badge) ───── */
import LiveStaffPulse from "@/app/(site)/components/manager/LiveStaffPulse";
/* ─── Tab definitions ────────────────────────────────────── */
const TABS: ManagerTab[] = [
  { key: "overview",  label: "Overview",        icon: LayoutDashboard },
  { key: "catalog",   label: "Menu & Catalog",  icon: UtensilsCrossed },
  { key: "payroll",   label: "Payroll",         icon: DollarSign },
  { key: "hiring",    label: "Hiring",          icon: Users },
  { key: "queue",     label: "Queue Monitor",   icon: MonitorPlay },
  { key: "parcels",   label: "Parcel Board",    icon: Package },
];

type TabKey = (typeof TABS)[number]["key"];

/* ═══════════════════════════════════════════════════════════
   MANAGER DASHBOARD
   ═══════════════════════════════════════════════════════════ */
export default function ManagerDashboard() {
  const [activeTab, setActiveTab] = useState<TabKey>("overview");
  const [showDepartureBoard, setShowDepartureBoard] = useState(false);

  useEffect(() => {
    try {
      const p = new URLSearchParams(window.location.search).get("tab") as TabKey | null;
      if (p && TABS.some((t) => t.key === p)) {
        setActiveTab(p as TabKey);
      }
    } catch (e) {
      /* noop */
    }
  }, []);

  return (
    <div className="min-h-screen bg-stone-950 text-white">
      {/* ── Top bar ─────────────────────────────────────── */}
      <header className="sticky top-0 z-40 bg-stone-950/90 backdrop-blur-md border-b border-stone-800">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-lg font-bold tracking-tight">
              Manager Dashboard
            </h1>
            <p className="text-stone-400 text-xs tracking-wider uppercase">
              BrewHub PHL &middot; Staff Operations
            </p>
          </div>
          <div className="flex items-center gap-3">
            <LiveStaffPulse />
            <a 
              href="https://bungeezoo.com" 
              target="_blank" 
              rel="noopener noreferrer"
              className="flex items-center justify-center p-2 text-stone-400 hover:text-stone-100 hover:bg-stone-800 rounded-lg transition-colors group"
              title="Launch Screensaver"
            >
              <MonitorPlay size={20} className="group-hover:scale-110 transition-transform" />
            </a>
            <span className="text-xs text-stone-400 hidden sm:block">
              {new Date().toLocaleDateString("en-US", {
                weekday: "long",
                month: "long",
                day: "numeric",
                year: "numeric",
              })}
            </span>
          </div>
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
          <div className="space-y-6">
            <DashboardOverhaul />
            <ReceiptRoll />
          </div>
        )}

        {activeTab === "catalog" && <CatalogManager />}

        {activeTab === "payroll" && <PayrollSection />}

        {activeTab === "hiring" && <HiringViewer />}

        {activeTab === "queue" && <QueueMonitor onBack={() => setActiveTab("overview")} />}

        {activeTab === "parcels" && (
          showDepartureBoard
            ? <ParcelsMonitor onBack={() => setShowDepartureBoard(false)} />
            : <ParcelOpsPanel onLaunchBoard={() => setShowDepartureBoard(true)} />
        )}
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
