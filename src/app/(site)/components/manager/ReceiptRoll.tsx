"use client";

import React, { useEffect, useState, useRef, useCallback } from "react";
import { useOpsSessionOptional } from "@/components/OpsGate";
import AuthzErrorStateCard from "@/components/AuthzErrorState";
import { getErrorInfoFromResponse, type AuthzErrorState } from "@/lib/authz";
import { fetchOps } from "@/utils/ops-api";
import { RefreshCw } from "lucide-react";

const MAX_RECEIPTS = 10;
const POLL_INTERVAL_MS = 30_000; // poll every 30 s

/* ─── Types ─── */
interface Receipt {
  id: string;
  receipt_text: string;
  created_at: string;
}

/* ─── Thermal Receipt Card ─── */
function ReceiptCard({ receipt, animate }: { receipt: Receipt; animate: boolean }) {
  const ts = receipt.created_at
    ? new Date(receipt.created_at).toLocaleTimeString("en-US", {
        timeZone: "America/New_York",
        hour: "2-digit",
        minute: "2-digit",
        hour12: true,
      })
    : "";

  return (
    <div
      className={`thermal-receipt ${animate ? "receipt-new receipt-flash" : ""}`}
      onAnimationEnd={(e) => {
        const el = e.currentTarget;
        el.classList.remove("receipt-new", "receipt-flash");
      }}
    >
      <pre className="whitespace-pre text-xs leading-snug m-0">
        {receipt.receipt_text || "(empty receipt)"}
      </pre>
      <span className="block text-right text-[10px] text-stone-400 mt-2">{ts}</span>
    </div>
  );
}

/* ─── Receipt Roll Component ─── */
export default function ReceiptRoll() {
  const token = useOpsSessionOptional()?.token;
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [newIds, setNewIds] = useState<Set<string>>(new Set());
  const [rateLimited, setRateLimited] = useState(false);
  const [authzState, setAuthzState] = useState<AuthzErrorState | null>(null);
  const initialLoadDone = useRef(false);
  const backoffRef = useRef<number>(POLL_INTERVAL_MS);
  const backoffTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Fetch receipts via server-side Netlify function (bypasses RLS)
  const loadReceipts = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetchOps("/get-receipts?limit=10");
      if (res.status === 401) return; // fetchOps already triggers forceOpsLogout
      if (res.status === 429) {
        backoffRef.current = Math.min(backoffRef.current * 2, 120_000);
        setRateLimited(true);
        return;
      }
      if (!res.ok) {
        const info = await getErrorInfoFromResponse(res, "Failed to load receipts");
        setAuthzState(info.authz);
        if (info.authz) setReceipts([]);
        if (!info.authz) {
          console.error("Receipt fetch failed:", info.message);
        }
        return;
      }
      setRateLimited(false);
      setAuthzState(null);
      backoffRef.current = POLL_INTERVAL_MS;
      const json = await res.json();
      const incoming = (json.receipts ?? []) as Receipt[];

      setReceipts((prev) => {
        // Detect new IDs for animation
        if (initialLoadDone.current) {
          const prevIds = new Set(prev.map((r) => r.id));
          const freshIds = incoming.filter((r) => !prevIds.has(r.id)).map((r) => r.id);
          if (freshIds.length > 0) {
            setNewIds((old) => {
              const copy = new Set(old);
              freshIds.forEach((id) => copy.add(id));
              return copy;
            });
          }
        }
        initialLoadDone.current = true;
        return incoming;
      });
    } catch (err) {
      console.error("Receipt fetch failed:", (err as Error)?.message);
    }
  }, [token]);

  // Poll for new receipts with exponential backoff on 429
  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    const schedule = async () => {
      if (cancelled) return;
      await loadReceipts();
      if (!cancelled) backoffTimerRef.current = setTimeout(schedule, backoffRef.current);
    };
    schedule();
    return () => {
      cancelled = true;
      if (backoffTimerRef.current) clearTimeout(backoffTimerRef.current);
    };
  }, [token, loadReceipts]);

  const handleAuthzAction = useCallback(() => {
    if (!authzState) return;
    if (authzState.status === 401) {
      sessionStorage.removeItem("ops_session");
      window.location.reload();
      return;
    }
    window.location.href = "/staff-hub";
  }, [authzState]);

  // Realtime subscription removed — anon SELECT on receipt_queue was revoked
  // (schema-66-receipt-leak-fix.sql). Polling via get-receipts is the sole path.

  if (!token) {
    return (
      <section>
        <h2 className="text-lg font-semibold mb-2">🖨️ Live Receipt Roll</h2>
        <div className="text-stone-500 text-sm p-4">Sign in to view receipts</div>
      </section>
    );
  }

  return (
    <section>
      {/* Thermal printer styles */}
      <style>{`
        .receipt-roll {
          display: flex;
          flex-direction: column;
          gap: 1.25rem;
          max-height: 600px;
          overflow-y: auto;
          padding: 1rem;
          scrollbar-width: thin;
          scrollbar-color: rgb(68 64 60) rgb(28 25 23);
        }
        .receipt-roll::-webkit-scrollbar { width: 6px; }
        .receipt-roll::-webkit-scrollbar-track { background: rgb(28 25 23); }
        .receipt-roll::-webkit-scrollbar-thumb { background: rgb(68 64 60); border-radius: 3px; }

        .thermal-receipt {
          background: #fffdfa;
          color: #111;
          font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Courier New', monospace;
          font-size: 12px;
          line-height: 1.35;
          padding: 1.25rem 1rem;
          border-radius: 4px 4px 0 0;
          position: relative;
          max-width: 340px;
          overflow-x: auto;
          box-shadow: 2px 4px 12px rgba(0,0,0,0.45);
        }

        /* Zig-zag torn edge effect */
        .thermal-receipt::after {
          content: '';
          display: block;
          position: absolute;
          bottom: -8px;
          left: 0;
          right: 0;
          height: 8px;
          background:
            linear-gradient(135deg, #fffdfa 33.33%, transparent 33.33%),
            linear-gradient(225deg, #fffdfa 33.33%, transparent 33.33%);
          background-size: 12px 8px;
        }

        /* Slide-in animation for new receipts */
        .receipt-new {
          animation: receiptSlideIn 0.5s ease-out;
        }
        @keyframes receiptSlideIn {
          0%   { opacity: 0; transform: translateY(-20px); }
          100% { opacity: 1; transform: translateY(0); }
        }

        /* Flash highlight on new receipt */
        .receipt-flash {
          animation: receiptSlideIn 0.5s ease-out, flashHighlight 1s ease-out;
        }
        @keyframes flashHighlight {
          0%   { box-shadow: 0 0 20px rgba(243,156,18,0.8); }
          100% { box-shadow: 2px 4px 12px rgba(0,0,0,0.45); }
        }
      `}</style>

      {rateLimited && (
        <div role="status" aria-live="polite" className="text-xs text-amber-400 font-mono px-3 py-1.5 bg-amber-950/40 rounded mb-2">
          ⏳ Rate limited — backing off, will retry automatically
        </div>
      )}

      {authzState && (
        <AuthzErrorStateCard state={authzState} onAction={handleAuthzAction} className="mb-3" />
      )}

      <div className="flex items-center justify-between mb-2">
        <h2 className="text-lg font-semibold">🖨️ Live Receipt Roll</h2>
        <button
          type="button"
          onClick={loadReceipts}
          className="flex items-center gap-2 px-4 py-2 min-h-[44px] rounded-xl
                     bg-stone-900 border border-stone-800 text-stone-400 text-sm
                     hover:border-stone-600 hover:text-white transition-colors"
        >
          <RefreshCw size={14} />
          Refresh
        </button>
      </div>

      <div className="receipt-roll">
        {receipts.length === 0 ? (
          <div className="p-8 text-center text-stone-600 text-sm">
            No receipts yet — they&apos;ll appear here in real time.
          </div>
        ) : (
          receipts.map((r) => (
            <ReceiptCard
              key={r.id}
              receipt={r}
              animate={newIds.has(r.id)}
            />
          ))
        )}
      </div>
    </section>
  );
}
