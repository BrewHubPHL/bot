"use client";

/**
 * Parcel Operations Panel — Staff-facing parcel management
 *
 * Shows all active parcels with:
 * - "Action Required" section for dead-letter / failed-notification parcels
 * - "STALE" badge for parcels older than 14 days
 * - Standard parcel list for everything else
 *
 * Fetches from the get-arrived-parcels Netlify function (staff-authed).
 */

import { useState, useEffect, useCallback, useRef } from "react";
import {
  Package, AlertTriangle, Clock, MonitorPlay, RefreshCw,
  Mail, MailX, ArrowLeftRight,
} from "lucide-react";
import { cn } from "@/lib/utils";

/* ── Types ──────────────────────────────────────────────── */
interface StaffParcel {
  id: string;
  tracking_number: string | null;
  recipient_name: string | null;
  unit_number: string | null;
  status: string;
  received_at: string | null;
  estimated_value_tier: string;
  notification_failed: boolean;
  has_email: boolean;
  is_stale: boolean;
}

/* ── Config ─────────────────────────────────────────────── */
const API_BASE =
  typeof window !== "undefined" && window.location.hostname === "localhost"
    ? "http://localhost:8888/.netlify/functions"
    : "/.netlify/functions";

const POLL_MS = 30_000;

function getAccessToken(): string | null {
  try {
    const raw = sessionStorage.getItem("ops_session");
    if (!raw) return null;
    return JSON.parse(raw)?.token ?? null;
  } catch {
    return null;
  }
}

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return "—";
  const ms = Date.now() - new Date(dateStr).getTime();
  const mins = Math.max(0, Math.floor(ms / 60_000));
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

/* ── Main Component ─────────────────────────────────────── */
interface ParcelOpsPanelProps {
  onLaunchBoard?: () => void;
}

export default function ParcelOpsPanel({ onLaunchBoard }: ParcelOpsPanelProps) {
  const [parcels, setParcels] = useState<StaffParcel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastFetch, setLastFetch] = useState<number>(0);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchParcels = useCallback(async () => {
    try {
      const token = getAccessToken();
      const res = await fetch(`${API_BASE}/get-arrived-parcels`, {
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      });
      if (!res.ok) {
        setError("Failed to load parcels");
        return;
      }
      const json = await res.json();
      setParcels(json.parcels ?? []);
      setError(null);
      setLastFetch(Date.now());
    } catch {
      setError("Connection error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchParcels();
    const schedule = () => {
      pollRef.current = setTimeout(async () => {
        await fetchParcels();
        schedule();
      }, POLL_MS);
    };
    schedule();
    return () => { if (pollRef.current) clearTimeout(pollRef.current); };
  }, [fetchParcels]);

  /* ── Partition parcels ──────────────────────────────── */
  const deadLetters = parcels.filter((p) => p.notification_failed);
  const staleParcels = parcels.filter((p) => !p.notification_failed && p.is_stale);
  const normalParcels = parcels.filter((p) => !p.notification_failed && !p.is_stale);

  return (
    <div className="space-y-6">
      {/* ── Header bar ────────────────────────────────── */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-bold tracking-tight text-white flex items-center gap-2">
            <Package className="h-5 w-5 text-stone-400" />
            Parcel Operations
          </h2>
          <p className="text-xs text-stone-500 mt-0.5">
            {parcels.length} active parcel{parcels.length !== 1 ? "s" : ""}
            {lastFetch > 0 && (
              <span className="ml-2">· updated {timeAgo(new Date(lastFetch).toISOString())}</span>
            )}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => { setLoading(true); fetchParcels(); }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium
                       bg-stone-800 text-stone-300 border border-stone-700
                       hover:bg-stone-700 transition-colors"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
            Refresh
          </button>
          {onLaunchBoard && (
            <button
              onClick={onLaunchBoard}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium
                         bg-stone-800 text-amber-400 border border-stone-700
                         hover:bg-stone-700 transition-colors"
            >
              <MonitorPlay className="h-3.5 w-3.5" />
              Launch Departure Board
            </button>
          )}
        </div>
      </div>

      {/* ── Error state ───────────────────────────────── */}
      {error && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          <AlertTriangle className="inline h-4 w-4 mr-1.5 -mt-0.5" />
          {error}
        </div>
      )}

      {/* ── Loading skeleton ──────────────────────────── */}
      {loading && parcels.length === 0 && (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-16 rounded-xl bg-stone-900 animate-pulse" />
          ))}
        </div>
      )}

      {/* ════════════════════════════════════════════════
          ACTION REQUIRED — Dead Letter Parcels
          ════════════════════════════════════════════════ */}
      {deadLetters.length > 0 && (
        <section>
          <div className="flex items-center gap-2 mb-3">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-red-500/20">
              <AlertTriangle className="h-3.5 w-3.5 text-red-400" />
            </span>
            <h3 className="text-sm font-bold uppercase tracking-wider text-red-400">
              Action Required — Failed Notifications
            </h3>
            <span className="ml-auto rounded-full bg-red-500 px-2 py-0.5 text-[10px] font-bold text-white">
              {deadLetters.length}
            </span>
          </div>
          <div className="space-y-2">
            {deadLetters.map((p) => (
              <ParcelCard key={p.id} parcel={p} variant="dead-letter" />
            ))}
          </div>
        </section>
      )}

      {/* ════════════════════════════════════════════════
          STALE PARCELS — Older than 14 days
          ════════════════════════════════════════════════ */}
      {staleParcels.length > 0 && (
        <section>
          <div className="flex items-center gap-2 mb-3">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-amber-500/20">
              <Clock className="h-3.5 w-3.5 text-amber-400" />
            </span>
            <h3 className="text-sm font-bold uppercase tracking-wider text-amber-400">
              Stale Parcels — Over 14 Days
            </h3>
            <span className="ml-auto rounded-full bg-amber-500 px-2 py-0.5 text-[10px] font-bold text-white">
              {staleParcels.length}
            </span>
          </div>
          <div className="space-y-2">
            {staleParcels.map((p) => (
              <ParcelCard key={p.id} parcel={p} variant="stale" />
            ))}
          </div>
        </section>
      )}

      {/* ════════════════════════════════════════════════
          NORMAL PARCELS — Awaiting Pickup
          ════════════════════════════════════════════════ */}
      {normalParcels.length > 0 && (
        <section>
          <div className="flex items-center gap-2 mb-3">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-stone-800">
              <Package className="h-3.5 w-3.5 text-stone-400" />
            </span>
            <h3 className="text-sm font-bold uppercase tracking-wider text-stone-400">
              Awaiting Pickup
            </h3>
            <span className="ml-auto rounded-full bg-stone-700 px-2 py-0.5 text-[10px] font-bold text-stone-300">
              {normalParcels.length}
            </span>
          </div>
          <div className="space-y-2">
            {normalParcels.map((p) => (
              <ParcelCard key={p.id} parcel={p} variant="normal" />
            ))}
          </div>
        </section>
      )}

      {/* ── Empty state ───────────────────────────────── */}
      {!loading && parcels.length === 0 && !error && (
        <div className="rounded-xl border border-stone-800 bg-stone-900/50 px-6 py-12 text-center">
          <Package className="mx-auto h-10 w-10 text-stone-600 mb-3" />
          <p className="text-stone-400 text-sm">No active parcels right now.</p>
        </div>
      )}
    </div>
  );
}

/* ── Parcel Card ──────────────────────────────────────────── */

function ParcelCard({
  parcel,
  variant,
}: {
  parcel: StaffParcel;
  variant: "dead-letter" | "stale" | "normal";
}) {
  const borderColor =
    variant === "dead-letter"
      ? "border-red-500/40"
      : variant === "stale"
        ? "border-amber-500/30"
        : "border-stone-800";

  const bgColor =
    variant === "dead-letter"
      ? "bg-red-500/5"
      : variant === "stale"
        ? "bg-amber-500/5"
        : "bg-stone-900/50";

  return (
    <div className={cn("rounded-xl border px-4 py-3 flex items-center gap-4", borderColor, bgColor)}>
      {/* ── Left: Badges ── */}
      <div className="flex flex-col items-center gap-1 shrink-0 w-20">
        {variant === "dead-letter" && (
          <span className="inline-flex items-center gap-1 rounded-md bg-red-500 px-2 py-0.5 text-[10px] font-bold text-white uppercase tracking-wider whitespace-nowrap">
            <MailX className="h-3 w-3" /> Failed
          </span>
        )}
        {variant === "stale" && (
          <span className="inline-flex items-center gap-1 rounded-md bg-red-500 px-2 py-0.5 text-[10px] font-bold text-white uppercase tracking-wider whitespace-nowrap">
            <Clock className="h-3 w-3" /> Stale
          </span>
        )}
        {variant === "normal" && (
          <span className="inline-flex items-center gap-1 rounded-md bg-stone-700 px-2 py-0.5 text-[10px] font-medium text-stone-300 uppercase tracking-wider whitespace-nowrap">
            <Package className="h-3 w-3" /> Active
          </span>
        )}
        {parcel.estimated_value_tier !== "standard" && (
          <span className="inline-flex rounded-md bg-amber-500/20 px-1.5 py-0.5 text-[9px] font-bold text-amber-400 uppercase tracking-widest">
            {parcel.estimated_value_tier === "high_value" ? "High $" : parcel.estimated_value_tier}
          </span>
        )}
      </div>

      {/* ── Center: Details ── */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-white truncate">
            {parcel.recipient_name || "Unknown Resident"}
          </span>
          {parcel.unit_number && (
            <span className="text-xs text-stone-500">Unit {parcel.unit_number}</span>
          )}
        </div>
        <div className="text-xs text-stone-400 mt-0.5 truncate">
          {parcel.tracking_number || "No tracking"}
        </div>
        {variant === "dead-letter" && (
          <div className="text-xs mt-1 flex items-center gap-1.5">
            {parcel.has_email ? (
              <span className="text-amber-400 flex items-center gap-1">
                <Mail className="h-3 w-3" /> Has email — notification bounced
              </span>
            ) : (
              <span className="text-red-400 flex items-center gap-1">
                <MailX className="h-3 w-3" /> No email on file — manual notice required
              </span>
            )}
          </div>
        )}
        {variant === "stale" && (
          <div className="text-xs text-amber-400 mt-1 flex items-center gap-1">
            <ArrowLeftRight className="h-3 w-3" />
            Return to Sender?
          </div>
        )}
      </div>

      {/* ── Right: Time ── */}
      <div className="text-right shrink-0">
        <div className={cn(
          "text-xs font-medium",
          variant === "stale" ? "text-red-400" : "text-stone-500",
        )}>
          {timeAgo(parcel.received_at)}
        </div>
        {parcel.received_at && (
          <div className="text-[10px] text-stone-600 mt-0.5">
            {new Date(parcel.received_at).toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
            })}
          </div>
        )}
      </div>
    </div>
  );
}
