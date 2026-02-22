"use client";

/**
 * SwipeCartItem — swipe-to-remove cart row with 48px+ touch targets.
 *
 * Touch behaviour:
 * - Horizontal drag beyond THRESHOLD reveals red "Remove" backdrop.
 * - Release past threshold → fires onRemove callback.
 * - Release before threshold → spring back.
 * - Works alongside vertical scroll (no hijacking).
 *
 * Accessibility:
 * - Visible delete button always present (no hover-only).
 * - Keyboard: Delete key on focused row removes item.
 */

import React, { useRef, useState, useCallback } from "react";
import { Minus, Plus, Trash2 } from "lucide-react";

interface Modifier {
  name: string;
  price_cents: number;
}

interface CartItemData {
  id: string;
  name: string;
  price_cents: number;
  modifiers: Modifier[];
  quantity: number;
}

interface SwipeCartItemProps {
  item: CartItemData;
  disabled?: boolean;
  onUpdateQty: (id: string, delta: number) => void;
  onRemove: (id: string) => void;
  formatCents: (c: number) => string;
}

const SWIPE_THRESHOLD = 80; // px needed to confirm removal
const LOCK_VERTICAL = 10;   // px vertical move to abort swipe

export default function SwipeCartItem({
  item,
  disabled = false,
  onUpdateQty,
  onRemove,
  formatCents,
}: SwipeCartItemProps) {
  const [offsetX, setOffsetX] = useState(0);
  const [isSwiping, setIsSwiping] = useState(false);
  const [isRemoving, setIsRemoving] = useState(false);
  const startRef = useRef<{ x: number; y: number; locked: boolean } | null>(null);

  const lineTotal =
    (item.price_cents + item.modifiers.reduce((s, m) => s + m.price_cents, 0)) * item.quantity;

  /* ---- Touch handlers ---- */
  const onTouchStart = useCallback(
    (e: React.TouchEvent) => {
      if (disabled) return;
      const t = e.touches[0];
      startRef.current = { x: t.clientX, y: t.clientY, locked: false };
      setIsSwiping(false);
    },
    [disabled]
  );

  const onTouchMove = useCallback(
    (e: React.TouchEvent) => {
      if (!startRef.current || disabled) return;
      const t = e.touches[0];
      const dx = t.clientX - startRef.current.x;
      const dy = t.clientY - startRef.current.y;

      // If vertical movement exceeds threshold first, abort swipe
      if (!startRef.current.locked && Math.abs(dy) > LOCK_VERTICAL && Math.abs(dy) > Math.abs(dx)) {
        startRef.current = null;
        setOffsetX(0);
        setIsSwiping(false);
        return;
      }

      // Lock horizontal if we passed the threshold
      if (Math.abs(dx) > LOCK_VERTICAL) {
        startRef.current.locked = true;
        setIsSwiping(true);
      }

      // Only allow leftward swipe (negative)
      if (startRef.current.locked) {
        setOffsetX(Math.min(0, dx));
      }
    },
    [disabled]
  );

  const onTouchEnd = useCallback(() => {
    if (!startRef.current) return;
    if (offsetX < -SWIPE_THRESHOLD) {
      // Animate off-screen then remove
      setIsRemoving(true);
      setOffsetX(-300);
      setTimeout(() => onRemove(item.id), 250);
    } else {
      setOffsetX(0);
    }
    setIsSwiping(false);
    startRef.current = null;
  }, [offsetX, onRemove, item.id]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        onRemove(item.id);
      }
    },
    [onRemove, item.id]
  );

  const swipePct = Math.min(1, Math.abs(offsetX) / SWIPE_THRESHOLD);

  return (
    <div
      className={[
        "relative overflow-hidden transition-all",
        isRemoving ? "max-h-0 opacity-0" : "max-h-40",
      ].join(" ")}
      style={{ transitionDuration: isRemoving ? "250ms" : "0ms" }}
    >
      {/* Red backdrop revealed by swipe */}
      <div
        className="absolute inset-0 bg-red-600 flex items-center justify-end pr-5"
        aria-hidden="true"
      >
        <Trash2 size={20} className="text-white" style={{ opacity: swipePct }} />
      </div>

      {/* Foreground cart row */}
      <div
        role="listitem"
        tabIndex={0}
        className="relative bg-stone-900 px-5 py-3 select-none"
        style={{
          transform: `translateX(${offsetX}px)`,
          transition: isSwiping ? "none" : "transform 200ms ease-out",
        }}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onKeyDown={handleKeyDown}
      >
        {/* Item name + price */}
        <div className="flex items-start justify-between">
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-sm text-stone-200">{item.name}</p>
            {item.modifiers.length > 0 && (
              <p className="text-xs text-amber-500/70 mt-0.5">
                {item.modifiers.map((m) => m.name).join(", ")}
              </p>
            )}
          </div>
          <span className="text-sm font-bold text-stone-300 ml-2">{formatCents(lineTotal)}</span>
        </div>

        {/* Quantity controls — 48px min touch targets */}
        {!disabled && (
          <div className="flex items-center justify-between mt-2">
            <div className="flex items-center gap-2">
              <button
                onClick={() => onUpdateQty(item.id, -1)}
                aria-label={`Decrease ${item.name} quantity`}
                className="min-w-[48px] min-h-[48px] flex items-center justify-center rounded-lg bg-stone-800 hover:bg-stone-700 active:bg-stone-600 transition-colors"
              >
                <Minus size={16} />
              </button>
              <span className="w-10 text-center text-sm font-mono font-bold tabular-nums">
                {item.quantity}
              </span>
              <button
                onClick={() => onUpdateQty(item.id, 1)}
                aria-label={`Increase ${item.name} quantity`}
                className="min-w-[48px] min-h-[48px] flex items-center justify-center rounded-lg bg-stone-800 hover:bg-stone-700 active:bg-stone-600 transition-colors"
              >
                <Plus size={16} />
              </button>
            </div>
            {/* Always-visible delete button (not hover-only) */}
            <button
              onClick={() => onRemove(item.id)}
              aria-label={`Remove ${item.name}`}
              className="min-w-[48px] min-h-[48px] flex items-center justify-center text-stone-500 hover:text-red-400 active:text-red-300 transition-colors rounded-lg"
            >
              <Trash2 size={16} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
