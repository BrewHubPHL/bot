"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { supabase } from "@/lib/supabase"
import AolBuddyQueue from "@/components/AolBuddyQueue"
import type { KdsOrder } from "@/components/KdsOrderCard"
import { toUserSafeMessageFromUnknown } from "@/lib/errorCatalog"

interface QueueMonitorProps { onBack?: () => void; }

/* ── Same API base logic as the KDS page ─────────────────────── */
const API_BASE =
  typeof window !== "undefined" && window.location.hostname === "localhost"
    ? "http://localhost:8888/.netlify/functions"
    : "/.netlify/functions"

/* ── Shape returned by get-queue (public endpoint) ───────────── */
interface QueueItem {
  id: string
  position: number
  name: string
  tag: string
  items: { name: string; mods?: string | null }[]
  status: string
  created_at: string
  minutesAgo: number | null
  isPaid: boolean
}

/** Map the public get-queue response into KdsOrder for AolBuddyQueue */
function toKdsOrder(q: QueueItem): KdsOrder {
  return {
    id: q.id,
    customer_name: q.name,
    is_guest_order: !q.isPaid && ["pending", "unpaid"].includes(q.status),
    status: q.status,
    created_at: q.created_at,
    total_amount_cents: 0,
    items: q.items.map((i, idx) => ({ id: `${q.id}-item-${idx}`, name: i.name, quantity: 1 })),
  }
}

export default function QueueMonitor({ onBack }: QueueMonitorProps) {
  const [orders, setOrders] = useState<KdsOrder[]>([])
  const [error, setError] = useState<string | null>(null)
  // Schema 78: unified pickup count (parcels + outbound awaiting pickup)
  const [pickupCount, setPickupCount] = useState<number>(0)

  /* ---- Auto-fullscreen on mount --------------------------------- */
  useEffect(() => {
    const el = document.documentElement
    if (el.requestFullscreen) el.requestFullscreen().catch(() => {})
    return () => { if (document.fullscreenElement) document.exitFullscreen().catch(() => {}) }
  }, [])

  /* ── Fetch unified pickup count from v_items_to_pickup (schema 78) ── */
  const fetchPickupCount = useCallback(async () => {
    try {
      const { count, error: countErr } = await supabase
        .from("v_items_to_pickup")
        .select("item_id", { count: "exact", head: true })
        .neq("current_status", "completed")
      if (!countErr) setPickupCount(count ?? 0)
    } catch { /* non-critical — badge just won't show */ }
  }, [])

  /* ── Fetch from the PUBLIC get-queue endpoint (no auth needed) ── */
  const fetchOrders = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/get-queue`)
      if (!res.ok) {
        setError("Failed to load orders")
        return
      }
      const data = await res.json() as { queue: QueueItem[] }
      const items: QueueItem[] = Array.isArray(data.queue) ? data.queue : []
      setOrders(items.map(toKdsOrder))
      setError(null)
    } catch (e) {
      setError(toUserSafeMessageFromUnknown(e, "Unable to refresh queue monitor right now."))
    }
    // Also refresh unified count
    fetchPickupCount()
  }, [fetchPickupCount])

  // Fetch once on mount
  useEffect(() => {
    fetchOrders()
  }, [fetchOrders])

  // Realtime push via Supabase — sole data-refresh mechanism (no polling)
  const channelIdRef = useRef(Math.random().toString(36).slice(2, 8))
  useEffect(() => {
    const channel = supabase
      .channel(`queue-monitor-orders-${channelIdRef.current}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "orders", filter: "status=in.(pending,preparing,ready)" },
        () => { fetchOrders() },
      )
      // Schema 78: also refresh when parcels change
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "parcels" },
        () => { fetchPickupCount() },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "outbound_parcels" },
        () => { fetchOrders() },
      )
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [fetchOrders, fetchPickupCount])

  function handleBack() {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {})
    onBack?.()
  }

  if (error) {
    return (
      <div className="fixed inset-0 z-[9999] flex items-center justify-center" style={{ background: "oklch(0.12 0.02 20)" }}>
        <button
          onClick={handleBack}
          aria-label="Back to dashboard"
          className="absolute top-3 left-3 opacity-20 hover:opacity-80 transition-opacity font-mono text-[11px] tracking-widest"
          style={{ color: "oklch(0.75 0.12 70)" }}
        >
          ← DASH
        </button>
        <div className="flex flex-col items-center gap-4">
          <span className="text-red-400 text-sm font-mono">⚠ Queue monitor error: {error}</span>
          <button
            onClick={() => { setError(null); fetchOrders(); }}
            className="px-4 py-2 min-h-[44px] rounded-xl bg-stone-900 border border-stone-800 text-stone-400 text-sm hover:border-stone-600 hover:text-white transition-colors"
          >
            Retry
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-[9999] select-none cursor-none" style={{ background: "oklch(0.12 0.02 20)" }}>
      {/* ── Back button ── */}
      <button
        onClick={handleBack}
        title="Back to dashboard"
        className="absolute top-3 left-3 z-10 flex items-center gap-1.5 px-2.5 py-1.5 rounded opacity-20 hover:opacity-80 transition-opacity font-mono text-[11px] tracking-widest"
        style={{ color: "oklch(0.75 0.12 70)" }}
        aria-label="Back to dashboard"
      >
        ← DASH
      </button>
      {/* Schema 78: unified pickup count badge */}
      {pickupCount > 0 && (
        <div
          className="absolute top-3 right-3 z-10 flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-mono text-[11px] tracking-widest"
          style={{ background: "oklch(0.20 0.04 70)", color: "oklch(0.85 0.12 70)" }}
          title="Total items awaiting pickup (orders + parcels)"
        >
          📦 {pickupCount} pickup
        </div>
      )}
      <AolBuddyQueue orders={orders} />
    </div>
  )
}
