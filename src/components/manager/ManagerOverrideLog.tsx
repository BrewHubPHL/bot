"use client";

import { useCallback, useEffect, useState } from "react";
import { type ColumnDef } from "@tanstack/react-table";
import { ArrowUpDown, MoreHorizontal } from "lucide-react";
import { useOpsSession } from "@/components/OpsGate";
import { fetchOps } from "@/utils/ops-api";
import { DataTable } from "@/components/ui/data-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

// ─── Types ───────────────────────────────────────────────────────────────────

interface OverrideEntry {
  id: string;
  action_type: string;
  manager_email: string;
  target_entity: string | null;
  target_id: string | null;
  target_employee: string | null;
  details: Record<string, unknown> | null;
  challenge_method: string | null;
  ip_address: string | null;
  created_at: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString("en-US", {
      timeZone: "America/New_York",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
  } catch {
    return iso;
  }
}

function challengeBadge(method: string | null) {
  if (method === "none_legacy") {
    return (
      <Badge className="bg-red-600 text-white hover:bg-red-700 border-red-700">
        none_legacy
      </Badge>
    );
  }
  if (method === "totp") {
    return <Badge variant="default">totp</Badge>;
  }
  if (method === "pin_reentry") {
    return <Badge variant="secondary">pin_reentry</Badge>;
  }
  return <span className="text-muted-foreground text-xs">—</span>;
}

const ACTION_LABELS: Record<string, string> = {
  comp_order: "Comp Order",
  adjust_hours: "Adjust Hours",
  fix_clock: "Fix Clock",
  void_order: "Void Order",
  voucher_override: "Voucher Override",
  inventory_adjust: "Inventory Adjust",
  discount_override: "Discount Override",
  parcel_override: "Parcel Override",
  schedule_edit: "Schedule Edit",
  pin_reset: "PIN Reset",
  role_change: "Role Change",
  rate_limit_triggered: "Rate Limit Triggered",
};

// ─── Columns ─────────────────────────────────────────────────────────────────

const columns: ColumnDef<OverrideEntry>[] = [
  {
    accessorKey: "created_at",
    header: ({ column }) => (
      <Button
        variant="ghost"
        onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
      >
        Date
        <ArrowUpDown className="ml-2 h-4 w-4" />
      </Button>
    ),
    cell: ({ row }) => formatDate(row.getValue("created_at")),
  },
  {
    accessorKey: "action_type",
    header: "Action",
    cell: ({ row }) => {
      const val = row.getValue("action_type") as string;
      return (
        <span className="font-medium">
          {ACTION_LABELS[val] ?? val}
        </span>
      );
    },
  },
  {
    accessorKey: "manager_email",
    header: "Manager",
    cell: ({ row }) => {
      const email = row.getValue("manager_email") as string;
      return <span className="truncate max-w-[180px] block">{email}</span>;
    },
  },
  {
    accessorKey: "target_employee",
    header: "Target Employee",
    cell: ({ row }) => row.getValue("target_employee") ?? "—",
  },
  {
    accessorKey: "challenge_method",
    header: "Challenge",
    cell: ({ row }) => challengeBadge(row.getValue("challenge_method")),
  },
  {
    id: "actions",
    cell: ({ row }) => {
      const entry = row.original;
      return (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="h-8 w-8 p-0">
              <span className="sr-only">Open menu</span>
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>Actions</DropdownMenuLabel>
            <DropdownMenuItem
              onClick={() => navigator.clipboard.writeText(entry.id)}
            >
              Copy ID
            </DropdownMenuItem>
            {entry.details && (
              <DropdownMenuItem
                onClick={() =>
                  navigator.clipboard.writeText(
                    JSON.stringify(entry.details, null, 2)
                  )
                }
              >
                Copy Details JSON
              </DropdownMenuItem>
            )}
            {entry.target_id && (
              <DropdownMenuItem
                onClick={() =>
                  navigator.clipboard.writeText(entry.target_id!)
                }
              >
                Copy Target ID
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      );
    },
  },
];

// ─── Component ───────────────────────────────────────────────────────────────

export default function ManagerOverrideLog() {
  const { token } = useOpsSession();
  const [rows, setRows] = useState<OverrideEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchLog = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchOps("/get-override-log?limit=200", {}, token);
      if (!res.ok) {
        setError(`Failed to load override log (${res.status})`);
        setLoading(false);
        return;
      }
      const data = await res.json();
      setRows(data.rows ?? []);
    } catch {
      setError("Network error loading override log");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    fetchLog();
  }, [fetchLog]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-amber-400" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-red-800 bg-red-950/50 p-4 text-red-300 text-sm">
        {error}
        <button
          onClick={fetchLog}
          className="ml-3 underline hover:text-red-100"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-stone-300 uppercase tracking-wider">
          Manager Override Audit Log
        </h3>
        <Button variant="outline" size="sm" onClick={fetchLog}>
          Refresh
        </Button>
      </div>
      <DataTable columns={columns} data={rows} />
    </div>
  );
}
