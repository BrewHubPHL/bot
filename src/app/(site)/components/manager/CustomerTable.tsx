"use client";

import React, { useState, useRef, useEffect, useCallback, useMemo, useDeferredValue } from "react";
import { createPortal } from "react-dom";
import {
  Users,
  Mail,
  Phone,
  Star,
  Coffee,
  Package,
  XCircle,
  EllipsisVertical,
  Search,
} from "lucide-react";

/* ================================================================== */
/*  Types                                                              */
/* ================================================================== */
export interface CustomerRow {
  id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  unit_number: string | null;
  is_vip: boolean;
  loyalty_points: number;
  total_orders: number;
  favorite_drink: string | null;
  created_at: string;
}

export type CrmFilter =
  | "all"
  | "app_users"
  | "walk_in"
  | "mailbox"
  | "vip"
  | "loyalty"
  | "active_30d"
  | "new_7d";

const FILTER_LABELS: Record<CrmFilter, string> = {
  all: "All Customers",
  app_users: "App Users",
  walk_in: "Walk-Ins",
  mailbox: "Mailbox Renters",
  vip: "VIP Customers",
  loyalty: "Loyalty Active",
  active_30d: "Active (30d)",
  new_7d: "New This Week",
};

/* ================================================================== */
/*  Action Menu (portal-based to avoid overflow clipping)              */
/* ================================================================== */
interface ActionMenuProps {
  customer: CustomerRow;
  onAction: (action: string, customer: CustomerRow) => void;
}

const ACTIONS = [
  { key: "check-in-package", label: "Check-in Package", Icon: Package },
  { key: "add-loyalty",      label: "Add Loyalty Points", Icon: Star },
  { key: "log-manual-order", label: "Log Manual Order",   Icon: Coffee },
] as const;

function ActionMenu({ customer, onAction }: ActionMenuProps) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  /* Position the portal menu relative to the trigger button */
  const openMenu = useCallback(() => {
    if (!btnRef.current) return;
    const rect = btnRef.current.getBoundingClientRect();
    setPos({
      top: rect.bottom + 4,
      left: rect.right - 192, // 192px = w-48
    });
    setOpen(true);
  }, []);

  /* Close on outside click or Escape */
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (
        menuRef.current &&
        !menuRef.current.contains(e.target as Node) &&
        btnRef.current &&
        !btnRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open]);

  return (
    <>
      <button
        ref={btnRef}
        onClick={() => (open ? setOpen(false) : openMenu())}
        aria-haspopup="true"
        aria-expanded={open}
        className="p-1.5 rounded-md text-stone-500 hover:text-white hover:bg-stone-700/60
                   transition-colors focus:outline-none focus:ring-1 focus:ring-amber-500/50"
        title="Actions"
      >
        <EllipsisVertical size={16} />
      </button>

      {open &&
        pos &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            className="fixed z-[9999] w-48 rounded-lg bg-stone-800 ring-1 ring-stone-700
                       shadow-xl shadow-black/40 py-1 animate-in fade-in-0 zoom-in-95"
            style={{ top: pos.top, left: pos.left }}
          >
            {ACTIONS.map(({ key, label, Icon }) => (
              <button
                key={key}
                role="menuitem"
                onClick={() => {
                  onAction(key, customer);
                  setOpen(false);
                }}
                className="flex w-full items-center gap-2.5 px-3 py-2 text-sm text-stone-300
                           hover:bg-amber-500/10 hover:text-amber-300 transition-colors"
              >
                <Icon size={14} className="shrink-0" />
                {label}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}

/* ================================================================== */
/*  Component                                                          */
/* ================================================================== */
export default function CustomerTable({
  customers,
  loading,
  error,
  activeFilter,
  onClearFilter,
}: {
  customers: CustomerRow[];
  loading: boolean;
  error: string | null;
  activeFilter: CrmFilter;
  onClearFilter: () => void;
}) {
  /* ── Search state ────────────────────────────────────── */
  const [searchTerm, setSearchTerm] = useState("");
  const deferredSearchTerm = useDeferredValue(searchTerm);

  /* ── Toast state ─────────────────────────────────────── */
  const [toast, setToast] = useState<{ msg: string; type: "success" | "error" } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((msg: string, type: "success" | "error" = "success") => {
    setToast({ msg, type });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3500);
  }, []);

  /* ── Action handler (placeholders) ──────────────────── */
  const handleAction = useCallback(
    (action: string, customer: CustomerRow) => {
      const name = customer.full_name || "Unknown";
      switch (action) {
        case "check-in-package":
          showToast(`Checking in package for ${name}`);
          break;
        case "add-loyalty":
          showToast(`Adding loyalty points for ${name}`);
          break;
        case "log-manual-order":
          showToast(`Logging manual order for ${name}`);
          break;
        default:
          break;
      }
    },
    [showToast],
  );

  /* ── Search filter (deferred + memoized) ─────────────── */
  const filtered = useMemo(() => {
    const safeCustomers = customers ?? [];
    const needle = deferredSearchTerm.trim().toLowerCase();
    if (!needle) return safeCustomers;
    return safeCustomers.filter((c) => {
      const hay = [
        c.full_name,
        c.email,
        c.phone,
        c.unit_number,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(needle);
    });
  }, [customers, deferredSearchTerm]);
  const needle = deferredSearchTerm.trim().toLowerCase();

  /* ── Loading ─────────────────────────────────────────── */
  if (loading) {
    return (
      <div className="rounded-xl bg-stone-800/40 ring-1 ring-stone-700/50 p-8">
        <div className="flex items-center justify-center gap-3 text-stone-400">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-stone-500 border-t-amber-400" />
          <span className="text-sm">Loading customers…</span>
        </div>
      </div>
    );
  }

  /* ── Error ───────────────────────────────────────────── */
  if (error) {
    return (
      <div className="rounded-xl bg-rose-500/10 ring-1 ring-rose-500/30 p-6 text-center">
        <p className="text-sm text-rose-300">{error}</p>
      </div>
    );
  }

  const label = FILTER_LABELS[activeFilter] || "Customers";

  /* ── Empty (no data from server) ─────────────────────── */
  if (customers.length === 0) {
    return (
      <div className="rounded-xl bg-stone-800/30 ring-1 ring-stone-700/40 p-10 text-center space-y-3">
        <Users size={32} className="mx-auto text-stone-600" />
        <p className="text-sm text-stone-400">
          No customers found for <span className="font-medium text-stone-300">&ldquo;{label}&rdquo;</span>
        </p>
        {activeFilter !== "all" && (
          <button
            onClick={onClearFilter}
            className="inline-flex items-center gap-1.5 text-xs text-amber-400 hover:text-amber-300 transition-colors"
          >
            <XCircle size={12} />
            Clear filter
          </button>
        )}
      </div>
    );
  }

  /* ── Table ───────────────────────────────────────────── */
  return (
    <div className="space-y-3">
      {/* Header bar */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h3 className="text-sm font-semibold text-stone-300 flex items-center gap-2">
          <Users size={14} className="text-amber-500" />
          {label}
          <span className="text-xs font-normal text-stone-500">
            ({filtered.length}
            {needle && filtered.length !== customers.length
              ? ` / ${customers.length}`
              : ""}
            {customers.length >= 500 ? "+" : ""})
          </span>
        </h3>

        <div className="flex items-center gap-2">
          {/* Search input */}
          <div className="relative">
            <Search
              size={14}
              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-stone-500 pointer-events-none"
            />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search by name, email, or unit\u2026"
              className="w-56 rounded-lg bg-stone-800/60 ring-1 ring-stone-700/60 pl-8 pr-8 py-1.5
                         text-xs text-stone-200 placeholder:text-stone-500
                         focus:outline-none focus:ring-amber-500/50 transition-shadow"
            />
            {searchTerm && (
              <button
                onClick={() => setSearchTerm("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-stone-500
                           hover:text-white transition-colors"
                aria-label="Clear search"
              >
                <XCircle size={14} />
              </button>
            )}
          </div>

          {activeFilter !== "all" && (
            <button
              onClick={onClearFilter}
              className="flex items-center gap-1.5 text-xs text-stone-400 hover:text-white
                         transition-colors px-2 py-1 rounded-md hover:bg-stone-800"
            >
              <XCircle size={12} />
              Clear Filter
            </button>
          )}
        </div>
      </div>

      {/* Search-empty state */}
      {needle && filtered.length === 0 ? (
        <div className="rounded-xl bg-stone-800/30 ring-1 ring-stone-700/40 p-10 text-center space-y-3">
          <Search size={28} className="mx-auto text-stone-600" />
          <p className="text-sm text-stone-400">
            No customers match&nbsp;
            <span className="font-medium text-stone-300">&ldquo;{searchTerm}&rdquo;</span>
          </p>
          <button
            onClick={() => setSearchTerm("")}
            className="inline-flex items-center gap-1.5 text-xs text-amber-400 hover:text-amber-300 transition-colors"
          >
            <XCircle size={12} />
            Clear search
          </button>
        </div>
      ) : (

      /* Scrollable table */
      <div className="rounded-xl bg-stone-800/40 ring-1 ring-stone-700/50 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-stone-700/60 text-xs uppercase tracking-wider text-stone-500">
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium hidden sm:table-cell">Contact</th>
                <th className="px-4 py-3 font-medium hidden md:table-cell">Unit</th>
                <th className="px-4 py-3 font-medium text-center">VIP</th>
                <th className="px-4 py-3 font-medium text-right hidden sm:table-cell">Loyalty</th>
                <th className="px-4 py-3 font-medium text-right">Orders</th>
                <th className="px-4 py-3 font-medium hidden lg:table-cell">Fav Drink</th>
                <th className="px-4 py-3 font-medium hidden md:table-cell">Joined</th>
                <th className="px-4 py-3 font-medium text-right sticky right-0 bg-stone-800/90 backdrop-blur">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-700/30">
              {filtered.map((c) => (
                <tr
                  key={c.id}
                  className="hover:bg-stone-700/20 transition-colors"
                >
                  <td className="px-4 py-3 font-medium text-white whitespace-nowrap">
                    {c.full_name || "—"}
                  </td>
                  <td className="px-4 py-3 hidden sm:table-cell">
                    <div className="flex flex-col gap-0.5 text-xs text-stone-400">
                      {c.email && (
                        <span className="flex items-center gap-1 truncate max-w-[180px]">
                          <Mail size={10} className="shrink-0 text-stone-500" />
                          {c.email}
                        </span>
                      )}
                      {c.phone && (
                        <span className="flex items-center gap-1">
                          <Phone size={10} className="shrink-0 text-stone-500" />
                          {c.phone}
                        </span>
                      )}
                      {!c.email && !c.phone && (
                        <span className="text-stone-600">—</span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 hidden md:table-cell">
                    {c.unit_number ? (
                      <span className="inline-flex items-center gap-1 text-xs text-violet-400">
                        <Package size={10} />
                        {c.unit_number}
                      </span>
                    ) : (
                      <span className="text-stone-600 text-xs">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-center">
                    {c.is_vip ? (
                      <Star size={14} className="inline text-amber-400" fill="currentColor" />
                    ) : (
                      <span className="text-stone-700">·</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right hidden sm:table-cell">
                    <span className="tabular-nums text-xs text-stone-400">
                      {c.loyalty_points > 0 ? c.loyalty_points.toLocaleString() : "—"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <span className="tabular-nums text-xs text-stone-300">
                      {c.total_orders}
                    </span>
                  </td>
                  <td className="px-4 py-3 hidden lg:table-cell">
                    {c.favorite_drink ? (
                      <span className="inline-flex items-center gap-1 text-xs text-emerald-400 truncate max-w-[140px]">
                        <Coffee size={10} />
                        {c.favorite_drink}
                      </span>
                    ) : (
                      <span className="text-stone-600 text-xs">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 hidden md:table-cell text-xs text-stone-500 whitespace-nowrap">
                    {c.created_at
                      ? new Date(c.created_at).toLocaleDateString("en-US", {
                          month: "short",
                          day: "numeric",
                          year: "numeric",
                        })
                      : "—"}
                  </td>
                  <td className="px-4 py-3 text-right sticky right-0 bg-stone-800/90 backdrop-blur">
                    <ActionMenu customer={c} onAction={handleAction} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      )}

      {/* ── Toast notification ── */}
      {toast && (
        <div
          role={toast.type === "error" ? "alert" : "status"}
          className={[
            "fixed bottom-8 left-1/2 -translate-x-1/2 z-50 px-6 py-3 rounded-xl shadow-2xl",
            "flex items-center gap-3 text-sm font-semibold transition-all duration-300",
            toast.type === "success" ? "bg-emerald-600 text-white" : "bg-red-600 text-white",
          ].join(" ")}
        >
          {toast.type === "success" ? "✓" : "✗"} {toast.msg}
        </div>
      )}
    </div>
  );
}
