"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { supabase } from "@/lib/supabase"
import AolBuddyQueue from "@/components/AolBuddyQueue"
import type { KdsOrder } from "@/components/KdsOrderCard"
import AuthzErrorStateCard from "@/components/AuthzErrorState"
import { getErrorInfoFromResponse, type AuthzErrorState } from "@/lib/authz"
import { toUserSafeMessageFromUnknown } from "@/lib/errorCatalog"

interface QueueMonitorProps { onBack?: () => void; }

/* ── Same API base logic as the KDS page ─────────────────────── */
const API_BASE =
  typeof window !== "undefined" && window.location.hostname === "localhost"
    ? "http://localhost:8888/.netlify/functions"
    : "/.netlify/functions"

function getAccessToken(): string | null {
  try {
    const raw = sessionStorage.getItem("ops_session")
    if (!raw) return null
    return JSON.parse(raw)?.token ?? null
  } catch {
    return null
  }
}

interface APIOrder {
  id: string
  status: string
  first_name: string | null
  created_at: string
  is_guest_order?: boolean
  total_amount_cents?: number
  coffee_orders?: {
    id: string
    drink_name: string
    customizations?: string
    price?: number
  }[]
}

function toKdsOrder(o: APIOrder): KdsOrder {
  return {
    id: o.id,
    customer_name: o.first_name,
    is_guest_order: o.is_guest_order ?? false,
    status: o.status,
    created_at: o.created_at,
    total_amount_cents: o.total_amount_cents ?? 0,
    items: (o.coffee_orders ?? []).map((c) => ({
      name: c.drink_name,
      quantity: 1,
    })),
  }
}

/* ── Poll interval (ms) ──────────────────────────────────────── */
const POLL_MS = 15_000

export default function QueueMonitor({ onBack }: QueueMonitorProps) {
  const [orders, setOrders] = useState<KdsOrder[]>([])
  const [error, setError] = useState<string | null>(null)
  const [authzState, setAuthzState] = useState<AuthzErrorState | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  /* ---- Auto-fullscreen on mount --------------------------------- */
  useEffect(() => {
    const el = document.documentElement
    if (el.requestFullscreen) el.requestFullscreen().catch(() => {})
    return () => { if (document.fullscreenElement) document.exitFullscreen().catch(() => {}) }
  }, [])

  const fetchOrders = useCallback(async () => {
    const token = getAccessToken()
    try {
      const res = await fetch(`${API_BASE}/get-kds-orders`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
      if (!res.ok) {
        const info = await getErrorInfoFromResponse(res, "Failed to load orders")
        setAuthzState(info.authz)
        setError(info.authz ? null : info.message)
        return
      }
      // API returns { orders: [...] } — destructure before mapping
      const { orders: rawOrders } = await res.json() as { orders: APIOrder[] }
      setOrders(rawOrders.map(toKdsOrder))
      setAuthzState(null)
      setError(null)
    } catch (e) {
      setAuthzState(null)
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
  useEffect(() => {
    const channel = supabase
      .channel("queue-monitor-orders")
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

  function handleAuthzAction() {
    if (authzState?.status === 401) {
      sessionStorage.removeItem("ops_session")
      window.location.reload()
      return
    }
    handleBack()
  }

  if (authzState) {
    return (
      <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4" style={{ background: "oklch(0.12 0.02 20)" }}>
        <AuthzErrorStateCard state={authzState} onAction={handleAuthzAction} className="max-w-md w-full" />
      </div>
    )
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
