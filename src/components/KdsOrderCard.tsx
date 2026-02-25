"use client"

import { useState, useCallback } from "react"
import { cn } from "@/lib/utils"
import {
  Clock,
  User,
  Coffee,
  Check,
  AlertTriangle,
  CreditCard,
} from "lucide-react"

/* ------------------------------------------------------------------ */
/*  Types                                                               */
/* ------------------------------------------------------------------ */

export interface KdsOrderItem {
  name: string
  quantity: number
}

export interface KdsOrder {
  id: string
  customer_name: string | null
  is_guest_order: boolean
  status: string
  created_at: string
  total_amount_cents: number
  items: KdsOrderItem[]
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                             */
/* ------------------------------------------------------------------ */

function formatRelativeTime(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000)
  if (seconds < 60) return "just now"
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  return `${hours}h ago`
}

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`
}

/* ------------------------------------------------------------------ */
/*  Component                                                           */
/* ------------------------------------------------------------------ */

interface KdsOrderCardProps {
  order: KdsOrder
  /** Timestamp the order was placed */
  createdAt: Date
  className?: string
  actionSlot?: React.ReactNode
  urgencyRing?: string
  isExiting?: boolean
}

export function KdsOrderCard({ order, createdAt, className, actionSlot, urgencyRing, isExiting = false }: KdsOrderCardProps) {
  const [tickedItems, setTickedItems] = useState<Set<number>>(new Set())

  const toggleItem = useCallback((idx: number) => {
    setTickedItems((prev) => {
      const next = new Set(prev)
      if (next.has(idx)) next.delete(idx)
      else next.add(idx)
      return next
    })
  }, [])

  const allDone = tickedItems.size === order.items.length
  const isGuest = order.is_guest_order

  return (
    <div
      className={cn(
        "relative flex flex-col rounded-xl border bg-card text-card-foreground shadow-sm transition-all duration-300",
        isGuest && "animate-pulse-border",
        urgencyRing,
        isExiting
          ? "opacity-0 scale-95 translate-y-4"
          : allDone
            ? "opacity-60 scale-100 translate-y-0"
            : "opacity-100 scale-100 translate-y-0",
        className,
      )}
    >
      {/* ------- Header ------- */}
      <div className="flex items-start justify-between gap-3 px-5 pt-5 pb-3">
        <div className="flex items-center gap-3 min-w-0">
          <div
            className={cn(
              "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg",
              isGuest ? "bg-accent/15 text-accent" : "bg-primary/15 text-primary",
            )}
          >
            <User className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold leading-tight text-foreground">
              {order.customer_name || "Guest"}
            </p>
            <p className="mt-0.5 font-mono text-xs text-muted-foreground">
              #{order.id.slice(0, 6).toUpperCase()}
            </p>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1.5 text-muted-foreground">
          <Clock className="h-3.5 w-3.5" />
          <span className="text-xs font-medium">{formatRelativeTime(createdAt)}</span>
        </div>
      </div>

      {/* ------- Guest / Unpaid Banner ------- */}
      {isGuest && (
        <div className="mx-5 flex items-center gap-2 rounded-lg bg-accent/10 px-3 py-2">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-accent" />
          <span className="text-xs font-semibold uppercase tracking-wide text-accent">
            Unpaid &mdash; Collect at counter
          </span>
        </div>
      )}

      {/* ------- Items ------- */}
      <div className="flex flex-col gap-0 px-5 pt-3 pb-2">
        {order.items.map((item, idx) => {
          const done = tickedItems.has(idx)
          return (
            <button
              key={idx}
              type="button"
              onClick={() => toggleItem(idx)}
              className={cn(
                "group flex items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors duration-200",
                "hover:bg-secondary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                done && "bg-secondary/40",
              )}
            >
              {/* Checkbox circle */}
              <span
                className={cn(
                  "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition-all duration-300",
                  done
                    ? "border-primary bg-primary text-primary-foreground scale-110"
                    : "border-muted-foreground/40 text-transparent group-hover:border-primary/60",
                )}
              >
                <Check
                  className={cn(
                    "h-3 w-3 transition-all duration-300",
                    done ? "opacity-100 scale-100" : "opacity-0 scale-50",
                  )}
                />
              </span>

              {/* Drink icon + name */}
              <Coffee
                className={cn(
                  "h-4 w-4 shrink-0 transition-colors duration-300",
                  done ? "text-muted-foreground/50" : "text-primary",
                )}
              />
              <span
                className={cn(
                  "flex-1 text-sm font-medium transition-all duration-300",
                  done
                    ? "text-muted-foreground/50 line-through decoration-primary/40"
                    : "text-foreground",
                )}
              >
                {item.name}
              </span>

              {/* Quantity badge (simple span as fallback) */}
              <span
                className={cn(
                  "rounded-md bg-muted px-2 py-0.5 text-xs font-semibold tabular-nums transition-opacity duration-300",
                  done && "opacity-40",
                )}
              >
                x{item.quantity}
              </span>
            </button>
          )
        })}
      </div>

      {/* ------- Footer ------- */}
      <div className="mt-auto flex items-center justify-between border-t border-border/60 px-5 py-3">
        <div className="flex items-center gap-1.5 text-muted-foreground">
          <CreditCard className="h-3.5 w-3.5" />
          <span className="text-xs font-medium">{formatCents(order.total_amount_cents)}</span>
        </div>

        {allDone ? (
          <span className="flex items-center gap-1 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 px-2.5 py-0.5 text-xs font-semibold">
            <Check className="h-3 w-3" /> All Items Done
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">{tickedItems.size}/{order.items.length} done</span>
        )}
      </div>

      {/* Optional action slot */}
      {actionSlot && (
        <div className="px-4 pb-4 pt-1 space-y-2">{actionSlot}</div>
      )}
    </div>
  )
}
