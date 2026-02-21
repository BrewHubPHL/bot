"use client";

import React, { useEffect, useState, useRef, useCallback } from "react";
import { useOpsSessionOptional } from "@/components/OpsGate";
import { createClient } from "@supabase/supabase-js";

/* ─── Supabase client (for Realtime subscription) ─── */
const SUPABASE_URL = "https://rruionkpgswvncypweiv.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJydWlvbmtwZ3N3dm5jeXB3ZWl2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjkzMTQ5MDYsImV4cCI6MjA4NDg5MDkwNn0.fzM310q9Qs_f-zhuBqyjnQXs3mDmOp_dbiFRs0ctQmU";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const MAX_RECEIPTS = 10;

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
      <span className="block text-right text-[10px] text-gray-400 mt-2">{ts}</span>
    </div>
  );
}

/* ─── Receipt Roll Component ─── */
export default function ReceiptRoll() {
  const token = useOpsSessionOptional()?.token;
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [newIds, setNewIds] = useState<Set<string>>(new Set());
  const initialLoadDone = useRef(false);

  // Fetch initial receipts
  const loadReceipts = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from("receipt_queue")
        .select("id, receipt_text, created_at")
        .order("created_at", { ascending: false })
        .limit(5);

      if (error) throw error;
      setReceipts(data ?? []);
      initialLoadDone.current = true;
    } catch (err) {
      console.error("Receipt fetch failed:", err);
    }
  }, []);

  useEffect(() => {
    if (!token) return;
    loadReceipts();
  }, [token, loadReceipts]);

  // Realtime subscription for new receipts
  useEffect(() => {
    if (!token) return;

    const channel = supabase
      .channel("manager-receipts")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "receipt_queue" },
        (payload) => {
          const newReceipt = payload.new as Receipt;
          setNewIds((prev) => new Set(prev).add(newReceipt.id));
          setReceipts((prev) => {
            const updated = [newReceipt, ...prev];
            return updated.slice(0, MAX_RECEIPTS);
          });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [token]);

  if (!token) {
    return (
      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-2">🖨️ Live Receipt Roll</h2>
        <div className="text-gray-500 text-sm p-4">Sign in to view receipts</div>
      </section>
    );
  }

  return (
    <section className="mb-8">
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
          scrollbar-color: #444 #1a1a1a;
        }
        .receipt-roll::-webkit-scrollbar { width: 6px; }
        .receipt-roll::-webkit-scrollbar-track { background: #1a1a1a; }
        .receipt-roll::-webkit-scrollbar-thumb { background: #444; border-radius: 3px; }

        .thermal-receipt {
          background: #fffdfa;
          color: #111;
          font-family: 'Courier New', Consolas, monospace;
          font-size: 12px;
          line-height: 1.35;
          padding: 1.25rem 1rem;
          border-radius: 4px 4px 0 0;
          position: relative;
          max-width: 340px;
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

      <div className="flex items-center justify-between mb-2">
        <h2 className="text-lg font-semibold">🖨️ Live Receipt Roll</h2>
        <button
          className="text-gray-400 border border-[#333] px-3 py-1 rounded hover:bg-[#222]"
          onClick={loadReceipts}
        >
          ↻ Refresh
        </button>
      </div>

      <div className="receipt-roll">
        {receipts.length === 0 ? (
          <div className="p-8 text-center text-gray-600 text-sm">
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
