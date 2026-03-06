"use client";

import React, { useCallback, useMemo } from "react";
import { toast as sonnerToast } from "sonner";
import { useQueryState, parseAsString, parseAsStringLiteral } from "nuqs";
import {
  Users,
  Mail,
  Phone,
  Search,
  XCircle,
  EllipsisVertical,
  UserPen,
  ShieldCheck,
  UserX,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";

/* ================================================================== */
/*  Types                                                              */
/* ================================================================== */
export interface StaffRow {
  id: string;
  name: string | null;
  full_name: string | null;
  email: string;
  phone: string | null;
  role: string | null;
  is_active: boolean;
  is_working: boolean;      // computed by v_staff_status view
  created_at: string | null;
}

export type RoleFilter = "all" | "Manager" | "Barista" | "Admin" | "Owner";

const ROLE_OPTIONS: { key: RoleFilter; label: string }[] = [
  { key: "all",      label: "All Roles" },
  { key: "Manager",  label: "Manager" },
  { key: "Barista",  label: "Barista" },
  { key: "Admin",    label: "Admin" },
  { key: "Owner",    label: "Owner" },
];

/* ── Role badge colours ───────────────────────────────────── */
const ROLE_BADGE: Record<string, string> = {
  Manager:  "bg-blue-500/15 text-blue-400 ring-blue-500/30",
  Barista:  "bg-emerald-500/15 text-emerald-400 ring-emerald-500/30",
  Admin:    "bg-violet-500/15 text-violet-400 ring-violet-500/30",
  Owner:    "bg-amber-500/15 text-amber-400 ring-amber-500/30",
};
function roleBadgeCls(role: string | null) {
  return ROLE_BADGE[role ?? ""] ?? "bg-stone-700/40 text-stone-400 ring-stone-600";
}

/* ================================================================== */
/*  Action Menu (portal-based to avoid overflow clipping)              */
/* ================================================================== */
interface ActionMenuProps {
  staff: StaffRow;
  onAction: (action: string, staff: StaffRow) => void;
}

const ACTIONS = [
  { key: "edit-profile",  label: "Edit Profile",         Icon: UserPen },
  { key: "change-role",   label: "Change Role",          Icon: ShieldCheck },
  { key: "deactivate",    label: "Deactivate Employee",  Icon: UserX },
] as const;

function ActionMenu({ staff, onAction }: ActionMenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className="p-1.5 rounded-md text-stone-500 hover:text-white hover:bg-stone-700/60
                     transition-colors focus:outline-none focus:ring-1 focus:ring-amber-500/50"
          title="Actions"
        >
          <EllipsisVertical size={16} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="w-48 bg-stone-800 ring-1 ring-stone-700 border-stone-700
                   shadow-xl shadow-black/40"
      >
        {ACTIONS.map(({ key, label, Icon }) => (
          <DropdownMenuItem
            key={key}
            onClick={() => onAction(key, staff)}
            className={[
              "flex items-center gap-2.5 px-3 py-2 text-sm cursor-pointer",
              key === "deactivate"
                ? "text-rose-400 focus:bg-rose-500/10 focus:text-rose-300"
                : "text-stone-300 focus:bg-amber-500/10 focus:text-amber-300",
            ].join(" ")}
          >
            <Icon size={14} className="shrink-0" />
            {label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/* ================================================================== */
/*  Component                                                          */
/* ================================================================== */
export default function StaffTable({
  staff,
  loading,
  error,
}: {
  staff: StaffRow[];
  loading: boolean;
  error: string | null;
}) {
  /* ── Search & filter state (URL-synced for bookmarkability) ── */
  const [searchTerm, setSearchTerm] = useQueryState("q", parseAsString.withDefault(""));
  const [roleFilter, setRoleFilter] = useQueryState("role",
    parseAsStringLiteral(["all", "Manager", "Barista", "Admin", "Owner"] as const).withDefault("all")
  );

  /* ── Toast helper (delegates to Sonner) ──────────────── */

  const showToast = useCallback((msg: string, type: "success" | "error" = "success") => {
    if (type === "success") sonnerToast.success(msg);
    else sonnerToast.error(msg);
  }, []);

  /* ── Action handler (placeholders) ──────────────────── */
  const handleAction = useCallback(
    (action: string, member: StaffRow) => {
      const name = member.full_name || member.name || "Unknown";
      switch (action) {
        case "edit-profile":
          showToast(`Editing profile for ${name}`);
          break;
        case "change-role":
          showToast(`Changing role for ${name}`);
          break;
        case "deactivate":
          showToast(`Deactivating employee ${name}`, "error");
          break;
        default:
          break;
      }
    },
    [showToast],
  );

  /* ── Derived: filter + search (must be before any early returns to obey Rules of Hooks) ── */
  const needle = searchTerm.trim().toLowerCase();

  const filtered = useMemo(() => {
    let result = staff;

    // Role filter
    if (roleFilter !== "all") {
      result = result.filter(
        (s) => (s.role ?? "").toLowerCase() === roleFilter.toLowerCase(),
      );
    }

    // Text search
    if (needle) {
      result = result.filter((s) => {
        const hay = [s.full_name, s.name, s.email, s.phone]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return hay.includes(needle);
      });
    }

    return result;
  }, [staff, roleFilter, needle]);

  /* ── Loading ────────────────────────────────────────── */
  if (loading) {
    return (
      <div className="rounded-xl bg-stone-800/40 ring-1 ring-stone-700/50 p-8">
        <div className="flex items-center justify-center gap-3 text-stone-400">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-stone-500 border-t-amber-400" />
          <span className="text-sm">Loading staff directory…</span>
        </div>
      </div>
    );
  }

  /* ── Error ──────────────────────────────────────────── */
  if (error) {
    return (
      <div className="rounded-xl bg-rose-500/10 ring-1 ring-rose-500/30 p-6 text-center">
        <p className="text-sm text-rose-300">{error}</p>
      </div>
    );
  }

  /* ── Empty (no data from server) ────────────────────── */
  if (staff.length === 0) {
    return (
      <div className="rounded-xl bg-stone-800/30 ring-1 ring-stone-700/40 p-10 text-center space-y-3">
        <Users size={32} className="mx-auto text-stone-600" />
        <p className="text-sm text-stone-400">No staff members found.</p>
      </div>
    );
  }

  /* ── Table ──────────────────────────────────────────── */
  return (
    <div className="space-y-3">
      {/* ── Header bar ── */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h3 className="text-sm font-semibold text-stone-300 flex items-center gap-2">
          <Users size={14} className="text-amber-500" />
          Staff Directory
          <span className="text-xs font-normal text-stone-500">
            ({filtered.length}
            {needle || roleFilter !== "all"
              ? ` / ${staff.length}`
              : ""})
          </span>
        </h3>

        <div className="flex items-center gap-2 flex-wrap">
          {/* Role filter */}
          <div className="flex rounded-lg ring-1 ring-stone-700/60 overflow-hidden text-xs">
            {ROLE_OPTIONS.map(({ key, label }) => (
              <button
                key={key}
                onClick={() => setRoleFilter(key)}
                className={[
                  "px-2.5 py-1.5 transition-colors",
                  roleFilter === key
                    ? "bg-amber-500/20 text-amber-300"
                    : "bg-stone-800/60 text-stone-400 hover:text-white hover:bg-stone-700/60",
                ].join(" ")}
              >
                {label}
              </button>
            ))}
          </div>

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
              placeholder="Search by name, email, or phone\u2026"
              className="w-52 rounded-lg bg-stone-800/60 ring-1 ring-stone-700/60 pl-8 pr-8 py-1.5
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
        </div>
      </div>

      {/* ── Search / filter empty state ── */}
      {filtered.length === 0 ? (
        <div className="rounded-xl bg-stone-800/30 ring-1 ring-stone-700/40 p-10 text-center space-y-3">
          <Search size={28} className="mx-auto text-stone-600" />
          <p className="text-sm text-stone-400">
            No staff match{needle ? <>&nbsp;<span className="font-medium text-stone-300">&ldquo;{searchTerm}&rdquo;</span></> : " the current filter"}.
          </p>
          <button
            onClick={() => {
              setSearchTerm("");
              setRoleFilter("all");
            }}
            className="inline-flex items-center gap-1.5 text-xs text-amber-400 hover:text-amber-300 transition-colors"
          >
            <XCircle size={12} />
            Clear filters
          </button>
        </div>
      ) : (

      /* ── Scrollable table ── */
      <div className="rounded-xl bg-stone-800/40 ring-1 ring-stone-700/50 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-stone-700/60 text-xs uppercase tracking-wider text-stone-500">
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium hidden sm:table-cell">Contact</th>
                <th className="px-4 py-3 font-medium">Role</th>
                <th className="px-4 py-3 font-medium text-center">Status</th>
                <th className="px-4 py-3 font-medium text-center hidden md:table-cell">On Shift</th>
                <th className="px-4 py-3 font-medium hidden md:table-cell">Joined</th>
                <th className="px-4 py-3 font-medium text-right sticky right-0 bg-stone-800/90 backdrop-blur">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-700/30">
              {filtered.map((s) => {
                const displayName = s.full_name || s.name || "—";
                return (
                  <tr key={s.id} className="hover:bg-stone-700/20 transition-colors">
                    {/* Name */}
                    <td className="px-4 py-3 font-medium text-white whitespace-nowrap">
                      {displayName}
                    </td>

                    {/* Contact */}
                    <td className="px-4 py-3 hidden sm:table-cell">
                      <div className="flex flex-col gap-0.5 text-xs text-stone-400">
                        <span className="flex items-center gap-1 truncate max-w-[200px]">
                          <Mail size={10} className="shrink-0 text-stone-500" />
                          {s.email}
                        </span>
                        {s.phone ? (
                          <span className="flex items-center gap-1">
                            <Phone size={10} className="shrink-0 text-stone-500" />
                            {s.phone}
                          </span>
                        ) : (
                          <span className="flex items-center gap-1 text-stone-600">
                            <Phone size={10} className="shrink-0 text-stone-600" />
                            —
                          </span>
                        )}
                      </div>
                    </td>

                    {/* Role badge */}
                    <td className="px-4 py-3">
                      <span
                        className={[
                          "inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ring-1",
                          roleBadgeCls(s.role),
                        ].join(" ")}
                      >
                        {s.role ?? "Unassigned"}
                      </span>
                    </td>

                    {/* Active / Inactive */}
                    <td className="px-4 py-3 text-center">
                      {s.is_active ? (
                        <span className="inline-flex items-center gap-1 text-xs text-emerald-400">
                          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                          Active
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-xs text-stone-500">
                          <span className="h-1.5 w-1.5 rounded-full bg-stone-600" />
                          Inactive
                        </span>
                      )}
                    </td>

                    {/* On Shift */}
                    <td className="px-4 py-3 text-center hidden md:table-cell">
                      {s.is_working ? (
                        <span className="inline-flex items-center gap-1 text-xs text-sky-400">
                          <span className="h-1.5 w-1.5 rounded-full bg-sky-400 animate-pulse" />
                          Clocked In
                        </span>
                      ) : (
                        <span className="text-xs text-stone-600">—</span>
                      )}
                    </td>

                    {/* Joined */}
                    <td className="px-4 py-3 hidden md:table-cell text-xs text-stone-500 whitespace-nowrap">
                      {s.created_at
                        ? new Date(s.created_at).toLocaleDateString("en-US", {
                            month: "short",
                            day: "numeric",
                            year: "numeric",
                          })
                        : "—"}
                    </td>

                    {/* Actions */}
                    <td className="px-4 py-3 text-right sticky right-0 bg-stone-800/90 backdrop-blur">
                      <ActionMenu staff={s} onAction={handleAction} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      )}

      {/* ── Toast notification ── */}

    </div>
  );
}
