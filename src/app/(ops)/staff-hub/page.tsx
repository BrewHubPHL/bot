"use client";

import { useState, useEffect, useCallback } from "react";
import { useOpsSession } from "@/components/OpsGate";
import Link from "next/link";
import AuthzErrorStateCard from "@/components/AuthzErrorState";
import { getErrorInfoFromResponse, type AuthzErrorState } from "@/lib/authz";
import { toUserSafeMessageFromUnknown } from "@/lib/errorCatalog";

/* ─── API base ─── */
const API_BASE =
  typeof window !== "undefined" && window.location.hostname === "localhost"
    ? "http://localhost:8888/.netlify/functions"
    : "/.netlify/functions";

/* ─── Staff Hub Page ─── */
export default function StaffHubPage() {
  const { staff, token } = useOpsSession();
  const [currentTime, setCurrentTime] = useState<Date | null>(null);
  const [isWorking, setIsWorking] = useState(staff.is_working);
  const [shiftStart, setShiftStart] = useState<Date | null>(null);
  const [shiftDuration, setShiftDuration] = useState("0:00:00");
  const [clockLoading, setClockLoading] = useState(false);
  const [message, setMessage] = useState<{ text: string; type: "success" | "error" } | null>(null);
  const [authzState, setAuthzState] = useState<AuthzErrorState | null>(null);

  // Clock display
  useEffect(() => {
    setCurrentTime(new Date());
    const tick = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(tick);
  }, []);

  // Shift duration timer
  useEffect(() => {
    if (!isWorking || !shiftStart) return;
    const tick = setInterval(() => {
      const diff = Date.now() - shiftStart.getTime();
      const h = Math.floor(diff / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      setShiftDuration(`${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`);
    }, 1000);
    return () => clearInterval(tick);
  }, [isWorking, shiftStart]);

  // Load initial status — check if currently clocked in and when shift started
  useEffect(() => {
    if (isWorking) {
      // Estimate shift start from current time (OpsGate already has is_working)
      setShiftStart(new Date());
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const showMessage = useCallback((text: string, type: "success" | "error") => {
    setMessage({ text, type });
    setTimeout(() => setMessage(null), 4000);
  }, []);

  const toggleClock = useCallback(async () => {
    setClockLoading(true);
    const action = isWorking ? "out" : "in";

    try {
      const res = await fetch(`${API_BASE}/pin-clock`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          "X-BrewHub-Action": "true",
        },
        body: JSON.stringify({ action }),
      });

      if (!res.ok) {
        const info = await getErrorInfoFromResponse(res, `Failed to clock ${action}`);
        if (info.authz) {
          setAuthzState(info.authz);
        }
        throw new Error(info.message);
      }

      const data = await res.json();
      setAuthzState(null);

      setIsWorking(action === "in");
      if (action === "in") {
        setShiftStart(new Date());
      } else {
        setShiftStart(null);
        setShiftDuration("0:00:00");
      }
      showMessage(`Successfully clocked ${action}!`, "success");
    } catch (err: unknown) {
      const msg = toUserSafeMessageFromUnknown(err, "Unable to update clock status right now.");
      showMessage(msg, "error");
    } finally {
      setClockLoading(false);
    }
  }, [isWorking, token, showMessage]);

  const isManager = staff.role === "manager" || staff.role === "admin";

  const handleAuthzAction = useCallback(() => {
    if (!authzState) return;
    if (authzState.status === 401) {
      sessionStorage.removeItem("ops_session");
      window.location.reload();
      return;
    }
    window.location.href = "/staff-hub";
  }, [authzState]);

  return (
    <div
      className="min-h-screen flex flex-col"
      style={{ background: "linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)" }}
    >
      {/* Header */}
      <header className="flex items-center justify-between px-8 py-4 border-b border-white/10"
        style={{ background: "rgba(0,0,0,0.3)" }}>
        <div className="text-2xl font-bold text-white">
          Brew<span className="text-amber-400">Hub</span> Staff
        </div>
        <div className="flex items-center gap-4">
          <span className="text-sm text-stone-400">{staff.name || staff.email}</span>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 flex flex-col items-center justify-center p-8 gap-8">
        {/* Clock */}
        <div className="text-center">
          <div className="text-6xl font-bold text-white tabular-nums" style={{ textShadow: "0 4px 20px rgba(0,0,0,0.3)" }}>
            {currentTime?.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: true }) ?? "--:--:--"}
          </div>
          <div className="text-lg text-stone-500 mt-2">
            {currentTime?.toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" }) ?? ""}
          </div>
        </div>

        {/* Status Card */}
        <div className="w-full max-w-md rounded-3xl p-10 text-center border border-white/10"
          style={{ background: "rgba(255,255,255,0.08)", backdropFilter: "blur(10px)" }}>
          <div className="text-sm text-stone-500 uppercase tracking-widest mb-2">Your Status</div>
          <div className={`text-3xl font-bold mb-6 ${isWorking ? "text-emerald-400" : "text-red-400"}`}>
            {isWorking ? "Clocked In" : "Clocked Out"}
          </div>

          <button
            onClick={toggleClock}
            disabled={clockLoading}
            className={`w-full py-5 rounded-2xl text-xl font-bold text-white uppercase tracking-widest
                       transition-all hover:-translate-y-0.5 disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none
                       ${isWorking
                         ? "bg-gradient-to-br from-red-500 to-red-700 shadow-[0_8px_24px_rgba(231,76,60,0.4)] hover:shadow-[0_12px_32px_rgba(231,76,60,0.5)]"
                         : "bg-gradient-to-br from-emerald-500 to-emerald-600 shadow-[0_8px_24px_rgba(39,174,96,0.4)] hover:shadow-[0_12px_32px_rgba(39,174,96,0.5)]"
                       }`}
          >
            {clockLoading ? "Processing…" : isWorking ? "🛑 Clock Out" : "▶ Clock In"}
          </button>

          {/* Message */}
          {message && (
            <div className={`mt-4 py-3 px-4 rounded-lg text-sm ${
              message.type === "success"
                ? "bg-emerald-500/20 text-emerald-400"
                : "bg-red-500/20 text-red-400"
            }`}>
              {message.text}
            </div>
          )}

          {authzState && (
            <div className="mt-4">
              <AuthzErrorStateCard state={authzState} onAction={handleAuthzAction} />
            </div>
          )}

          {/* Shift Duration */}
          {isWorking && (
            <div className="mt-6 pt-6 border-t border-white/10 text-stone-500 text-sm">
              <div>Current shift started</div>
              <div className="text-2xl font-semibold text-amber-400 mt-2 tabular-nums">{shiftDuration}</div>
            </div>
          )}
        </div>

        {/* Quick Links Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 w-full max-w-xl">
          <Link href="/kds" className="group rounded-2xl p-6 text-center text-white no-underline border border-white/10
                                        transition-all hover:-translate-y-1 hover:border-amber-400"
            style={{ background: "rgba(255,255,255,0.08)", backdropFilter: "blur(10px)" }}>
            <div className="text-3xl mb-2">☕</div>
            <div className="text-xs font-semibold uppercase tracking-widest group-hover:text-amber-400">KDS</div>
          </Link>
          <Link href="/cafe" className="group rounded-2xl p-6 text-center text-white no-underline border border-white/10
                                         transition-all hover:-translate-y-1 hover:border-amber-400"
            style={{ background: "rgba(255,255,255,0.08)", backdropFilter: "blur(10px)" }}>
            <div className="text-3xl mb-2">💳</div>
            <div className="text-xs font-semibold uppercase tracking-widest group-hover:text-amber-400">Cafe POS</div>
          </Link>
          <Link href="/parcels-pickup" className="group rounded-2xl p-6 text-center text-white no-underline border border-white/10
                                            transition-all hover:-translate-y-1 hover:border-amber-400"
            style={{ background: "rgba(255,255,255,0.08)", backdropFilter: "blur(10px)" }}>
            <div className="text-3xl mb-2">📦</div>
            <div className="text-xs font-semibold uppercase tracking-widest group-hover:text-amber-400">Parcel Pickup</div>
          </Link>
          <Link href="/scanner" className="group rounded-2xl p-6 text-center text-white no-underline border border-white/10
                                            transition-all hover:-translate-y-1 hover:border-amber-400"
            style={{ background: "rgba(255,255,255,0.08)", backdropFilter: "blur(10px)" }}>
            <div className="text-3xl mb-2">📋</div>
            <div className="text-xs font-semibold uppercase tracking-widest group-hover:text-amber-400">Inventory</div>
          </Link>
          {isManager && (
            <Link href="/manager" className="group rounded-2xl p-6 text-center text-white no-underline col-span-2 sm:col-span-4
                                              border border-amber-400/40 transition-all hover:-translate-y-1 hover:border-amber-400"
              style={{ background: "rgba(243,156,18,0.15)" }}>
              <div className="text-3xl mb-2">📊</div>
              <div className="text-xs font-semibold uppercase tracking-widest text-amber-400">Manager Dashboard</div>
            </Link>
          )}
        </div>
      </main>
    </div>
  );
}
