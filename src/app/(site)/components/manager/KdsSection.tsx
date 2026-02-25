"use client";
import React, { useRef, useState } from "react";
import { useOpsSessionOptional } from "@/components/OpsGate";
import { KdsGrid } from "@/components/KdsGrid";
import type { KdsGridState } from "@/components/KdsGrid";
import { RefreshCw } from "lucide-react";

export default function KdsSection() {
  const token = useOpsSessionOptional()?.token ?? null;
  const [ordersLen, setOrdersLen] = useState(0);
  const [error, setError]         = useState<string | null>(null);
  const fetchRef = useRef<(() => void) | null>(null);

  function handleStateChange({ orders, error: err }: KdsGridState) {
    setOrdersLen(orders.length);
    setError(err);
  }

  return (
    <section>
      {/* â”€â”€ Section header â”€â”€ */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-semibold">â˜• Active Orders (KDS)</h2>
          {ordersLen > 0 && (
            <span className="rounded-full bg-amber-900/50 border border-amber-700/40 px-2.5 py-0.5 text-xs font-semibold text-amber-400 tabular-nums">
              {ordersLen}
            </span>
          )}
        </div>
        <button
          type="button"
          className="flex items-center gap-2 px-4 py-2 min-h-[44px] rounded-xl
                     bg-stone-900 border border-stone-800 text-stone-400 text-sm
                     hover:border-stone-600 hover:text-white transition-colors"
          onClick={() => fetchRef.current?.()}
        >
          <RefreshCw size={14} />
          Refresh
        </button>
      </div>

      {error && (
        <p role="alert" className="mb-3 text-red-400 font-mono text-xs bg-red-950/60 px-3 py-2 rounded">
          {error}
        </p>
      )}

      <KdsGrid token={token} onStateChange={handleStateChange} fetchRef={fetchRef} />
    </section>
  );
}

