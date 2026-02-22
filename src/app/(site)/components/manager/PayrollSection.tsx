"use client";
import React, { useCallback, useEffect, useState } from "react";
import { useOpsSessionOptional } from "@/components/OpsGate";

const API_BASE =
  typeof window !== "undefined" && window.location.hostname === "localhost"
    ? "http://localhost:8888/.netlify/functions"
    : "/.netlify/functions";

/* ------------------------------------------------------------------ */
/* Constants                                                           */
/* ------------------------------------------------------------------ */
const MISSED_PUNCH_THRESHOLD_MS = 16 * 60 * 60 * 1000; // 16 hours
const OT_THRESHOLD_HOURS = 40;

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */
interface StaffRow {
  id: string;
  full_name: string | null;
  email: string;
  hourly_rate: string | null;
}

interface TimeLog {
  employee_email: string;
  action_type: string;
  clock_in: string | null;
  clock_out: string | null;
  created_at: string;
}

interface Shift {
  start: Date;
  end: Date;
  hours: number;
}

interface PayrollRow {
  name: string;
  email: string;
  rate: number;
  regularHours: number;
  overtimeHours: number;   // 1.5× — Mon–Sat OT + Sunday hours within the 40 h weekly threshold
  doubleTimeHours: number; // 2×  — Sunday hours that fall in the OT window (stacking)
  grossPay: number;
  currentStatus: "IN" | "OFF";
  missedPunch: boolean;
  missedPunchClockIn: string | null; // ISO timestamp of the open clock-in
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

/** Returns YYYY-MM-DD for the Monday of the week containing `date`. */
function getMondayKey(date: Date): string {
  const d = new Date(date);
  const day = d.getDay(); // 0=Sun … 6=Sat
  d.setDate(d.getDate() - (day === 0 ? 6 : day - 1));
  d.setHours(0, 0, 0, 0);
  return d.toISOString().slice(0, 10);
}

/**
 * Pairs sequential in/out logs into complete shifts.
 * Returns { shifts, missedPunch }.
 * A missed punch is any 'in' with no matching 'out' after 16 hours.
 */
function buildShifts(logs: TimeLog[]): { shifts: Shift[]; missedPunch: boolean; missedPunchClockIn: string | null } {
  const sorted = [...logs].sort(
    (a, b) =>
      new Date(a.clock_in ?? a.created_at).getTime() -
      new Date(b.clock_in ?? b.created_at).getTime()
  );

  const shifts: Shift[] = [];
  let pendingIn: Date | null = null;
  let missedPunch = false;
  let missedPunchClockIn: string | null = null;

  for (const log of sorted) {
    const type = (log.action_type ?? "").toLowerCase();
    const ts = new Date(log.clock_in ?? log.created_at);

    if (type === "in") {
      // If there's already an open 'in' without an 'out', flag it
      if (pendingIn !== null) {
        if (Date.now() - pendingIn.getTime() > MISSED_PUNCH_THRESHOLD_MS) {
          missedPunch = true;
          missedPunchClockIn = pendingIn.toISOString();
        }
      }
      pendingIn = ts;
    } else if (type === "out") {
      if (pendingIn !== null) {
        const endTs = new Date(log.clock_out ?? log.created_at);
        const hours = (endTs.getTime() - pendingIn.getTime()) / 3_600_000;
        if (hours > 0) shifts.push({ start: pendingIn, end: endTs, hours });
        pendingIn = null;
      }
    }
  }

  // Trailing open 'in' with no 'out'
  if (pendingIn !== null && Date.now() - pendingIn.getTime() > MISSED_PUNCH_THRESHOLD_MS) {
    missedPunch = true;
    missedPunchClockIn = pendingIn.toISOString();
  }

  return { shifts, missedPunch, missedPunchClockIn };
}

/**
 * Stacking overtime model:
 *   Mon–Sat ≤ 40 h/week accumulated → regularHours   (1×)
 *   Mon–Sat >  40 h/week accumulated → overtimeHours  (1.5×)
 *   Sunday  ≤ 40 h/week accumulated → overtimeHours  (1.5× — Sunday premium)
 *   Sunday  >  40 h/week accumulated → doubleTimeHours (2×  — Sunday + OT stack)
 *
 * The 40 h threshold is a running total across ALL days in the week,
 * processed chronologically so early-week shifts fill regular first.
 */
function calcHours(shifts: Shift[]): {
  regularHours: number;
  overtimeHours: number;
  doubleTimeHours: number;
} {
  // Group by ISO week
  const weekShifts = new Map<string, Shift[]>();
  for (const s of shifts) {
    const key = getMondayKey(s.start);
    if (!weekShifts.has(key)) weekShifts.set(key, []);
    weekShifts.get(key)!.push(s);
  }

  let regularHours = 0;
  let overtimeHours = 0;
  let doubleTimeHours = 0;

  for (const weekGroup of weekShifts.values()) {
    const sorted = [...weekGroup].sort((a, b) => a.start.getTime() - b.start.getTime());
    let running = 0;

    for (const shift of sorted) {
      const isSunday = shift.start.getDay() === 0;
      let remaining = shift.hours;

      while (remaining > 0) {
        if (running >= OT_THRESHOLD_HOURS) {
          // Past 40 h threshold — highest tier
          if (isSunday) doubleTimeHours += remaining;
          else overtimeHours += remaining;
          running += remaining;
          remaining = 0;
        } else {
          // Below threshold — fill up to 40 h
          const hoursToThreshold = Math.min(remaining, OT_THRESHOLD_HOURS - running);
          if (isSunday) overtimeHours += hoursToThreshold; // Sunday-within-40h = 1.5×
          else regularHours += hoursToThreshold;            // Mon–Sat-within-40h = 1×
          running += hoursToThreshold;
          remaining -= hoursToThreshold;
          // If remaining > 0, next loop iteration covers the >40h branch
        }
      }
    }
  }

  return { regularHours, overtimeHours, doubleTimeHours };
}

/** Returns today's date as a YYYY-MM-DD string. */
function toDateInput(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Triggers a CSV file download in the browser. */
function downloadCsv(rows: PayrollRow[]): void {
  const header = "Employee Name,Email,Regular Hours (1x),OT + Sun Hours (1.5x),Sun OT Hours (2x),Hourly Rate,Gross Pay Estimate";
  const lines = rows.map((r) =>
    [
      `"${r.name.replace(/"/g, '""')}"`,
      `"${r.email}"`,
      r.regularHours.toFixed(2),
      r.overtimeHours.toFixed(2),
      r.doubleTimeHours.toFixed(2),
      r.rate.toFixed(2),
      r.grossPay.toFixed(2),
    ].join(",")
  );
  const csv = [header, ...lines].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `payroll_${Date.now()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

/* ------------------------------------------------------------------ */
/* Component                                                           */
/* ------------------------------------------------------------------ */
export default function PayrollSection() {
  const token = useOpsSessionOptional()?.token;
  // ---- Date range: default to last 14 days ----------------------
  const today = new Date();
  const defaultEnd = toDateInput(today);
  const defaultStart = toDateInput(new Date(today.getTime() - 14 * 24 * 3_600_000));

  const [startDate, setStartDate] = useState(defaultStart);
  const [endDate, setEndDate] = useState(defaultEnd);

  const [payroll, setPayroll] = useState<PayrollRow[]>([]);
  const [loading, setLoading] = useState(true);

  // ---- Fix clock-out state --------------------------------------
  const [fixingEmail, setFixingEmail] = useState<string | null>(null);
  const [fixTime, setFixTime] = useState("");
  const [fixBusy, setFixBusy] = useState(false);
  const [fixError, setFixError] = useState("");
  const [fixSuccess, setFixSuccess] = useState("");

  // ---- Fetch + compute ------------------------------------------
  const fetchPayroll = useCallback(async () => {
    if (!token) { setLoading(false); return; }
    setLoading(true);

    try {
      const res = await fetch(
        `${API_BASE}/get-payroll?start=${encodeURIComponent(startDate)}&end=${encodeURIComponent(endDate)}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (!res.ok) throw new Error("Payroll fetch failed");
      const data = await res.json();

      const staffData = (data.staff ?? []) as StaffRow[];
      const logs = (data.logs ?? []) as TimeLog[];

      const rows: PayrollRow[] = staffData.map((emp) => {
      const empLogs = logs.filter((l) => l.employee_email === emp.email);
      const { shifts, missedPunch, missedPunchClockIn } = buildShifts(empLogs);
      const { regularHours, overtimeHours, doubleTimeHours } = calcHours(shifts);
      const rate = parseFloat(emp.hourly_rate ?? "0") || 0;
      // Gross pay: regular 1× + OT 1.5× + Sunday-over-40h 2×
      const grossPay =
        regularHours * rate +
        overtimeHours * rate * 1.5 +
        doubleTimeHours * rate * 2;

      // Current clock status (last log in entire logs for this emp, not date-filtered)
      const lastLog = empLogs[empLogs.length - 1];
      const currentStatus: "IN" | "OFF" =
        (lastLog?.action_type ?? "").toLowerCase() === "in" ? "IN" : "OFF";

      return {
        name: emp.full_name ?? "Staff",
        email: emp.email,
        rate,
        regularHours,
        overtimeHours,
        doubleTimeHours,
        grossPay,
        currentStatus,
        missedPunch,
        missedPunchClockIn,
      };
    });

    setPayroll(rows);
    } catch (err) {
      console.error("Payroll fetch failed:", err);
      setPayroll([]);
    }
    setLoading(false);
  }, [startDate, endDate, token]);

  useEffect(() => {
    fetchPayroll();
  }, [fetchPayroll]);

  // ---- Summary totals -------------------------------------------
  const totalRegular = payroll.reduce((s, r) => s + r.regularHours, 0);
  const totalOvertime = payroll.reduce((s, r) => s + r.overtimeHours, 0);
  const totalDoubleTime = payroll.reduce((s, r) => s + r.doubleTimeHours, 0);
  const totalGross = payroll.reduce((s, r) => s + r.grossPay, 0);
  const hasMissed = payroll.some((r) => r.missedPunch);

  // ---- Fix clock-out handler ------------------------------------
  const handleFixClockOut = async (email: string) => {
    if (!token || !fixTime) return;
    setFixBusy(true);
    setFixError("");
    setFixSuccess("");

    try {
      const res = await fetch(`${API_BASE}/fix-clock`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          "X-BrewHub-Action": "true",
        },
        body: JSON.stringify({
          employee_email: email,
          clock_out_time: new Date(fixTime).toISOString(),
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Fix failed");

      setFixSuccess(`Clock-out fixed for ${email}`);
      setFixingEmail(null);
      setFixTime("");
      setTimeout(() => setFixSuccess(""), 4000);

      // Refresh payroll data
      fetchPayroll();
    } catch (err: unknown) {
      setFixError(err instanceof Error ? err.message : "Failed to fix clock-out");
    } finally {
      setFixBusy(false);
    }
  };

  // ---- Render ---------------------------------------------------
  return (
    <section className="mb-8">
      {/* ── Header ── */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <h2 className="text-lg font-semibold">💰 Payroll Tally</h2>

        {/* Date range picker */}
        <div className="flex items-center gap-2 text-sm">
          <input
            type="date"
            value={startDate}
            max={endDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="bg-[#1a1a1a] border border-[#333] rounded px-2 py-1 text-[#f5f5f5]
                       focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
          <span className="text-gray-500">→</span>
          <input
            type="date"
            value={endDate}
            min={startDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="bg-[#1a1a1a] border border-[#333] rounded px-2 py-1 text-[#f5f5f5]
                       focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
          <button
            type="button"
            onClick={fetchPayroll}
            className="text-gray-400 hover:text-white transition-colors px-1"
            title="Refresh"
          >
            ↻
          </button>
        </div>

        {/* CSV export */}
        <button
          type="button"
          onClick={() => downloadCsv(payroll)}
          disabled={loading || payroll.length === 0}
          className="bg-green-700 hover:bg-green-600 disabled:opacity-40 disabled:cursor-not-allowed
                     text-white text-xs font-semibold px-4 py-2 rounded-lg transition-colors"
        >
          ⬇ Download Payroll CSV
        </button>
      </div>

      {/* ── Summary bar ── */}
      {!loading && payroll.length > 0 && (
        <div className="grid grid-cols-4 gap-3 mb-3">
          <div className="bg-[#1a1a1a] border border-[#333] rounded-lg px-4 py-3 text-center">
            <div className="text-xs text-gray-500 mb-1">Regular (1×)</div>
            <div className="text-lg font-bold text-[#f5f5f5]">{totalRegular.toFixed(1)} h</div>
          </div>
          <div className="bg-[#1a1a1a] border border-[#333] rounded-lg px-4 py-3 text-center">
            <div className="text-xs text-gray-500 mb-1">OT / Sun (1.5×)</div>
            <div className={`text-lg font-bold ${totalOvertime > 0 ? "text-amber-400" : "text-[#f5f5f5]"}`}>
              {totalOvertime.toFixed(1)} h
            </div>
          </div>
          <div className="bg-[#1a1a1a] border border-[#333] rounded-lg px-4 py-3 text-center">
            <div className="text-xs text-gray-500 mb-1">Sun OT (2×)</div>
            <div className={`text-lg font-bold ${totalDoubleTime > 0 ? "text-red-400" : "text-[#f5f5f5]"}`}>
              {totalDoubleTime.toFixed(1)} h
            </div>
          </div>
          <div className="bg-[#1a1a1a] border border-[#333] rounded-lg px-4 py-3 text-center">
            <div className="text-xs text-gray-500 mb-1">Est. Gross Pay</div>
            <div className="text-lg font-bold text-green-400">${totalGross.toFixed(2)}</div>
          </div>
        </div>
      )}

      {/* ── Missed punch alert ── */}
      {hasMissed && !loading && (
        <div className="mb-3 flex items-center gap-2 bg-red-500/10 border border-red-500/30 rounded-lg px-4 py-2 text-red-400 text-sm">
          <span className="font-bold">⚠</span>
          One or more staff members have a missing clock-out. Use the Fix button below to set the correct clock-out time.
        </div>
      )}

      {/* ── Fix success / error banners ── */}
      {fixSuccess && (
        <div className="mb-3 flex items-center gap-2 bg-green-500/10 border border-green-500/30 rounded-lg px-4 py-2 text-green-400 text-sm">
          ✓ {fixSuccess}
        </div>
      )}
      {fixError && (
        <div className="mb-3 flex items-center gap-2 bg-red-500/10 border border-red-500/30 rounded-lg px-4 py-2 text-red-400 text-sm">
          ✕ {fixError}
        </div>
      )}

      {/* ── Table ── */}
      <div className="bg-[#1a1a1a] rounded-lg overflow-hidden border border-[#333]">
        <div className="grid grid-cols-[2fr_1fr_1fr_1fr_1fr_1fr] gap-2 px-6 py-3 text-xs font-bold uppercase tracking-wider text-gray-500 bg-[#222]">
          <span>Staff</span>
          <span>Rate</span>
          <span>Regular</span>
          <span>OT</span>
          <span>Est. Gross</span>
          <span>Status</span>
        </div>

        {loading ? (
          <div className="px-6 py-6 text-gray-500">Loading…</div>
        ) : payroll.length === 0 ? (
          <div className="px-6 py-6 text-gray-500">No staff found.</div>
        ) : (
          payroll.map((row, idx) => (
            <div
              key={idx}
              className="grid grid-cols-[2fr_1fr_1fr_1fr_1fr_1fr] gap-2 px-6 py-3 border-t border-[#222] items-center"
            >
              {/* Name + email + missed punch badge */}
              <div className="min-w-0">
                <div className="font-semibold truncate">{row.name}</div>
                <div className="text-xs text-gray-500 truncate">{row.email}</div>
                {row.missedPunch && (
                  <div className="mt-1">
                    <span className="inline-block text-[10px] font-bold uppercase tracking-wide
                                     bg-red-500/20 text-red-400 border border-red-500/30 rounded px-2 py-0.5">
                      Missing Clock-Out
                    </span>
                    {row.missedPunchClockIn && (
                      <div className="mt-1 text-[10px] text-gray-400">
                        Clocked in{" "}
                        <span className="text-amber-400 font-semibold">
                          {new Date(row.missedPunchClockIn).toLocaleString("en-US", {
                            timeZone: "America/New_York",
                            weekday: "short",
                            month: "short",
                            day: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                            hour12: true,
                          })}
                        </span>
                        {" "}({Math.round((Date.now() - new Date(row.missedPunchClockIn).getTime()) / 3_600_000)}h ago)
                      </div>
                    )}

                    {fixingEmail === row.email ? (
                      <div className="mt-2 flex flex-col gap-1.5">
                        <label className="text-[10px] text-gray-400">When did they clock out?</label>
                        <input
                          type="datetime-local"
                          value={fixTime}
                          onChange={(e) => setFixTime(e.target.value)}
                          className="bg-[#111] border border-[#444] rounded px-2 py-1 text-xs text-white
                                     focus:outline-none focus:ring-1 focus:ring-amber-500 w-full max-w-[220px]"
                        />
                        <div className="flex gap-1.5">
                          <button
                            type="button"
                            disabled={!fixTime || fixBusy}
                            onClick={() => handleFixClockOut(row.email)}
                            className="bg-amber-600 hover:bg-amber-500 disabled:opacity-40
                                       text-white text-[10px] font-bold px-3 py-1 rounded transition-colors"
                          >
                            {fixBusy ? "Saving…" : "Save Clock-Out"}
                          </button>
                          <button
                            type="button"
                            onClick={() => { setFixingEmail(null); setFixTime(""); setFixError(""); }}
                            className="text-gray-500 hover:text-white text-[10px] px-2 py-1 rounded
                                       border border-[#333] transition-colors"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => { setFixingEmail(row.email); setFixError(""); }}
                        className="mt-1 block text-[10px] font-semibold text-amber-400 hover:text-amber-300
                                   underline underline-offset-2 transition-colors"
                      >
                        Fix Clock-Out →
                      </button>
                    )}
                  </div>
                )}
              </div>

              {/* Rate */}
              <div className="text-sm">${row.rate.toFixed(2)}/hr</div>

              {/* Regular hours */}
              <div className="text-sm">{row.regularHours.toFixed(2)} h</div>

              {/* Premium hours — three possible tiers */}
              <div className="text-sm font-semibold space-y-0.5">
                {row.overtimeHours > 0 && (
                  <div className="text-amber-400">{row.overtimeHours.toFixed(2)} h ×1.5</div>
                )}
                {row.doubleTimeHours > 0 && (
                  <div className="text-red-400">{row.doubleTimeHours.toFixed(2)} h ×2 ☀</div>
                )}
                {row.overtimeHours === 0 && row.doubleTimeHours === 0 && (
                  <span className="text-gray-500">—</span>
                )}
              </div>

              {/* Gross pay */}
              <div className="text-green-400 font-semibold">${row.grossPay.toFixed(2)}</div>

              {/* Clock status */}
              <div>
                <span
                  className={`rounded-full px-3 py-1 text-xs font-bold text-white ${
                    row.currentStatus === "IN" ? "bg-green-600" : "bg-[#444] text-gray-400"
                  }`}
                >
                  {row.currentStatus}
                </span>
              </div>
            </div>
          ))
        )}
      </div>
    </section>
  );
}
