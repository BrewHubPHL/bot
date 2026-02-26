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

/* ── Poll interval (ms) — matches /queue page cadence ────────── */
const POLL_MS = 10_000

export default function QueueMonitor({ onBack }: QueueMonitorProps) {
  const [orders, setOrders] = useState<KdsOrder[]>([])
  const [error, setError] = useState<string | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  /* ---- Auto-fullscreen on mount --------------------------------- */
  useEffect(() => {
    const el = document.documentElement
    if (el.requestFullscreen) el.requestFullscreen().catch(() => {})
    return () => { if (document.fullscreenElement) document.exitFullscreen().catch(() => {}) }
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
  }, [])

  // Initial fetch + polling, with tab-visibility pause
  useEffect(() => {
    const startPoll = () => {
      if (timerRef.current) clearInterval(timerRef.current)
      timerRef.current = setInterval(fetchOrders, POLL_MS)
    }
    const stopPoll = () => {
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null }
    }

    fetchOrders()
    startPoll()

    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        fetchOrders()
        startPoll()
      } else {
        stopPoll()
      }
    }
    document.addEventListener("visibilitychange", handleVisibility)

    return () => {
      stopPoll()
      document.removeEventListener("visibilitychange", handleVisibility)
    }
  }, [fetchOrders])

  // Realtime push via Supabase — resets the poll cadence so the next
  // scheduled tick doesn't fire immediately after a push-triggered fetch.
  const channelIdRef = useRef(Math.random().toString(36).slice(2, 8))
  useEffect(() => {
    const channel = supabase
      .channel(`queue-monitor-orders-${channelIdRef.current}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "orders" },
        () => {
          fetchOrders()
          // Reset interval only if it's currently running (tab visible)
          if (timerRef.current) {
            clearInterval(timerRef.current)
            timerRef.current = setInterval(fetchOrders, POLL_MS)
          }
        },
      )
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [fetchOrders])

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
      <AolBuddyQueue orders={orders} />
    </div>
  )
}
