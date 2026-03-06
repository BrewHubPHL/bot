"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  LayoutDashboard,
  UtensilsCrossed,
  DollarSign,
  Users,
  UsersRound,
  MonitorPlay,
  Package,
  Truck,
  Wrench,
  AlertTriangle,
  X,
  Copy,
  ShieldAlert,
  Database,
} from "lucide-react";
import { AlertManagerProvider, useAlertManager, AlertPriority } from "@/context/AlertManager";
import AlertRenderer from "@/components/manager/AlertRenderer";
import SystemHealthBadge from "@/components/manager/SystemHealthBadge";
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
/* ─── Unified CRM Insights (post-migration dashboard) ── */
import CrmInsights from "@/app/(site)/components/manager/CrmInsights";
/* ─── Realtime rate-limit security toasts ─────────────── */
import SecurityAlertToaster from "@/components/manager/SecurityAlertToaster";
/* ─── Export Orders CSV ─────────────────────────────────── */
import ExportOrdersButton from "./ExportOrdersButton";
/* ─── Staff directory (interactive table) ────────────────── */
import StaffSection from "./components/StaffSection";
/* ─── Manager override audit log (Shadcn Data Table) ─────── */
import ManagerOverrideLog from "@/components/manager/ManagerOverrideLog";
/* ─── Unified inventory management panel ─────────────────── */
import InventoryPanel from "./InventoryPanel";
/* ─── Ops session + fetchOps for asset health check ──────── */
import { useOpsSessionOptional } from "@/components/OpsGate";
import { fetchOps } from "@/utils/ops-api";
/* ─── Tab definitions ────────────────────────────────────── */
const TABS: ManagerTab[] = [
  { key: "overview",  label: "Overview",        icon: LayoutDashboard },
  { key: "catalog",   label: "Menu & Catalog",  icon: UtensilsCrossed },
  { key: "payroll",   label: "Payroll",         icon: DollarSign },
  { key: "hiring",    label: "Hiring",          icon: Users },
  { key: "team",      label: "Team",            icon: UsersRound },
  { key: "queue",     label: "Queue Monitor",   icon: MonitorPlay },
  { key: "parcels",   label: "Parcel Board",    icon: Package },
  { key: "inventory", label: "Inventory",       icon: Database },
  { key: "assets",    label: "Assets",          icon: Wrench },
];

type TabKey = (typeof TABS)[number]["key"];

/* ── Schema health alert types ─────────────────────────── */
interface MissingColumn {
  column: string;
  expectedType: string;
  status: string;
  error?: string;
}
interface SchemaHealthReport {
  healthy: boolean;
  table: string;
  tableExists: boolean;
  message: string;
  migrationRequired: boolean;
  missingColumns: MissingColumn[];
  typeMismatches?: { column: string; expectedType: string; actualType: string }[];
}

/**
 * Build safe, transactional migration SQL for schema drift.
 * - Missing columns  → ADD COLUMN
 * - Type mismatches  → ALTER COLUMN … TYPE … USING explicit cast
 * All output is wrapped in BEGIN / COMMIT for atomic rollback.
 */
function buildMigrationSQL(report: SchemaHealthReport): string {
  const lines: string[] = [
    '/* WARNING: Verify backup before running. This script performs type casting. */',
    `-- Migration for table: ${report.table}`,
    '',
    'BEGIN;',
    '',
  ];

  if (!report.tableExists) {
    lines.push(`CREATE TABLE IF NOT EXISTS public.${report.table} (`);
    lines.push('  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),');
    lines.push('  staff_id    uuid NOT NULL REFERENCES public.staff_directory(id),');
    lines.push('  version_tag text NOT NULL,');
    lines.push('  ip_address  text,');
    lines.push('  user_agent  text,');
    lines.push('  sha256_hash text NOT NULL,');
    lines.push('  signed_at   timestamptz NOT NULL DEFAULT now(),');
    lines.push('  created_at  timestamptz NOT NULL DEFAULT now()');
    lines.push(');');
    lines.push('');
    lines.push('COMMIT;');
    return lines.join('\n');
  }

  // --- Missing columns → ADD COLUMN ---
  for (const col of report.missingColumns ?? []) {
    const pgType = col.expectedType === 'timestamp with time zone' ? 'timestamptz' : col.expectedType;
    const dflt = col.column === 'id'
      ? ' DEFAULT gen_random_uuid()'
      : col.column.endsWith('_at')
        ? ' DEFAULT now()'
        : '';
    lines.push(`ALTER TABLE public.${report.table} ADD COLUMN IF NOT EXISTS ${col.column} ${pgType}${dflt};`);
  }

  // --- Type mismatches → ALTER COLUMN TYPE … USING explicit cast ---
  for (const m of report.typeMismatches ?? []) {
    const pgType = m.expectedType === 'timestamp with time zone' ? 'timestamptz' : m.expectedType;
    lines.push(`-- WARNING: ${m.column} has type "${m.actualType}", expected "${m.expectedType}"`);
    lines.push(`ALTER TABLE public.${report.table} ALTER COLUMN ${m.column} TYPE ${pgType} USING (${m.column}::${pgType});`);
  }

  lines.push('');
  lines.push('COMMIT;');
  return lines.join('\n');
}

/* ═══════════════════════════════════════════════════════════
   MANAGER DASHBOARD
   ═══════════════════════════════════════════════════════════ */
export default function ManagerDashboard() {
  return (
    <AlertManagerProvider>
      <ManagerDashboardInner />
    </AlertManagerProvider>
  );
}

function ManagerDashboardInner() {
  const [activeTab, setActiveTab] = useState<TabKey>("overview");
  const [showDepartureBoard, setShowDepartureBoard] = useState(false);

  /* ── Centralized alert system ────────────────────────── */
  const { pushAlert } = useAlertManager();

  /* ── Overdue-asset state (push into AlertManager) ───── */
  const session = useOpsSessionOptional();
  const overdueFetched = useRef(false);

  /* ── Schema health state (push into AlertManager) ───── */
  const schemaChecked = useRef(false);

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

  /* ── Check schema health on mount → push P0 alert ──── */
  useEffect(() => {
    if (schemaChecked.current || !session?.token || !session?.verified) return;
    schemaChecked.current = true;

    (async () => {
      try {
        const res = await fetchOps("/get-schema-health", {}, session.token);
        if (!res.ok) return;
        const data: SchemaHealthReport = await res.json();
        if (!data.healthy) {
          pushAlert({
            id: "schema-mismatch",
            priority: AlertPriority.P0,
            title: "System Integrity Alert",
            message: data.message,
            category: "schema",
            dismissible: true,
            actionLabel: "Copy Migration SQL",
            onAction: () => {
              const sql = buildMigrationSQL(data);
              navigator.clipboard.writeText(sql);
            },
            meta: {
              missingColumns: data.missingColumns,
              typeMismatches: data.typeMismatches ?? [],
            },
          });
        }
      } catch {
        /* non-critical — schema check is advisory */
      }
    })();
  }, [session?.token, session?.verified, pushAlert]);

  /* ── Check asset health on mount → push P1 alert ───── */
  useEffect(() => {
    if (overdueFetched.current || !session?.token || !session?.verified) return;
    overdueFetched.current = true;

    (async () => {
      try {
        const res = await fetchOps("/get-asset-analytics", {}, session.token);
        if (!res.ok) return;
        const json = await res.json();
        if (json.summary?.has_overdue) {
          const count = json.summary.overdue_count;
          pushAlert({
            id: "asset-overdue",
            priority: AlertPriority.P1,
            title: "Maintenance Overdue",
            message: `${count} asset${count !== 1 ? "s" : ""} overdue for maintenance.`,
            category: "asset",
            dismissible: true,
            actionLabel: "View Assets",
            onAction: () => setActiveTab("assets" as TabKey),
          });
        }
      } catch {
        /* non-critical — swallow silently */
      }
    })();
  }, [session?.token, session?.verified, pushAlert]);

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
            <SystemHealthBadge />
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

      {/* ── Centralized alert renderer (P0 modal + P1/P2 banners) ── */}
      <AlertRenderer />

      {/* ── Realtime rate-limit security toasts ── */}
      <SecurityAlertToaster />

      {/* ── Tab content ─────────────────────────────────── */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-8 pb-28 md:pb-8">
        {activeTab === "overview" && (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold text-stone-200">Overview</h2>
              <ExportOrdersButton />
            </div>
            <DashboardOverhaul />
            <CrmInsights />
            <ManagerOverrideLog />
            <ReceiptRoll />
          </div>
        )}

        {activeTab === "catalog" && <CatalogManager />}

        {activeTab === "payroll" && <PayrollSection />}

        {activeTab === "hiring" && <HiringViewer />}

        {activeTab === "team" && <StaffSection />}

        {activeTab === "queue" && <QueueMonitor onBack={() => setActiveTab("overview")} />}

        {activeTab === "parcels" && (
          showDepartureBoard
            ? <ParcelsMonitor onBack={() => setShowDepartureBoard(false)} />
            : <ParcelOpsPanel onLaunchBoard={() => setShowDepartureBoard(true)} />
        )}

        {activeTab === "inventory" && <InventoryPanel />}

        {activeTab === "assets" && (
          <div className="space-y-4">
            <h2 className="text-base font-semibold text-stone-200 flex items-center gap-2">
              <Wrench size={18} className="text-amber-400" /> Equipment Assets
            </h2>
            <p className="text-stone-400 text-sm">
              Full asset dashboard available at{" "}
              <a href="/manager/assets" className="text-amber-400 underline hover:text-amber-300">
                /manager/assets
              </a>
            </p>
            <iframe
              src="/manager/assets"
              title="Equipment Assets"
              className="w-full min-h-[80vh] rounded-xl border border-stone-800 bg-stone-900"
            />
          </div>
        )}
      </main>

      {/* Overdue asset alerts are now pushed into AlertManager (P1 banner). */}

      {/* ── Mobile bottom tab bar ───────────────────────── */}
      <MobileBottomTabBar
        tabs={TABS}
        activeTab={activeTab}
        onTabChange={(k) => setActiveTab(k as TabKey)}
      />
    </div>
  );
}
