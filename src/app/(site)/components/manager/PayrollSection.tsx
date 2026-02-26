"use client";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { useOpsSessionOptional } from "@/components/OpsGate";
import { Download, RefreshCw, X, Clock, AlertTriangle, Pencil, Info } from "lucide-react";
import ManagerChallengeModal from "@/components/ManagerChallengeModal";
import { toUserSafeMessageFromUnknown } from "@/lib/errorCatalog";

const API_BASE =
  typeof window !== "undefined" && window.location.hostname === "localhost"
    ? "http://localhost:8888/.netlify/functions"
    : "/.netlify/functions";

/* ------------------------------------------------------------------ */
/* Constants                                                           */
/* ------------------------------------------------------------------ */
const MISSED_PUNCH_THRESHOLD_MS = 16 * 60 * 60 * 1000; // 16 hours
const SHOP_TZ = "America/New_York";

/* ------------------------------------------------------------------ */
/* Timezone helpers — display & input always use America/New_York       */
/* ------------------------------------------------------------------ */

/**
 * Interpret a <input type="datetime-local"> value (no TZ info) as
 * America/New_York time and return a proper ISO 8601 UTC string.
 *
 * The payroll UI shows clock-in times in Eastern, so the manager
 * naturally enters the clock-out in Eastern as well.  Without this
 * conversion, new Date(dtLocal) silently uses the *browser* timezone
 * which may differ (e.g. a laptop still on UTC, or a manager on
 * vacation in another timezone) and produces a wrong UTC timestamp.
 */
function datetimeLocalToEasternISO(dtLocal: string): string {
  const [datePart, timePart] = dtLocal.split("T");
  const [y, mo, d] = datePart.split("-").map(Number);
  const [h, mi] = (timePart ?? "00:00").split(":").map(Number);

  // Treat the raw components as UTC so we have a stable reference.
  const asUTC = Date.UTC(y, mo - 1, d, h, mi);

  // Find how America/New_York renders that same UTC instant,
  // then measure the gap — that gap is the NY offset.
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: SHOP_TZ,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  });
  const parts = fmt.formatToParts(new Date(asUTC));
  const g = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  const nyAtUTC = Date.UTC(g("year"), g("month") - 1, g("day"), g("hour") === 24 ? 0 : g("hour"), g("minute"));

  // offsetMs is negative when NY is behind UTC (e.g. −5 h for EST)
  const offsetMs = nyAtUTC - asUTC;

  // The user typed Eastern values, so true UTC = raw − offset
  return new Date(asUTC - offsetMs).toISOString();
}

/**
 * Convert a UTC ISO string to a `datetime-local` value in Eastern,
 * for use as an <input> min / default value.
 */
function utcToEasternDatetimeLocal(isoUtc: string): string {
  const d = new Date(isoUtc);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: SHOP_TZ,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(d);
  const g = (t: string) => parts.find((p) => p.type === t)!.value;
  const hr = g("hour") === "24" ? "00" : g("hour");
  return `${g("year")}-${g("month")}-${g("day")}T${hr}:${g("minute")}`;
}

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

interface PayrollSummaryRow {
  employee_email: string;
  employee_name: string | null;
  hourly_rate: number | null;
  pay_period_start: string;
  pay_period_end: string;
  clocked_minutes: number;
  adjustment_minutes: number;
  total_minutes: number;
  total_hours: number;
  gross_pay: number;
  active_shifts: number;
}

interface OpenShiftRow {
  id: string;
  employee_email: string;
  clock_in: string;
  created_at: string;
}

interface PendingFixAction {
  email: string;
  clockOutTimeISO: string;
  reason: string;
}

interface PendingAdjustAction {
  employee_email: string;
  delta_minutes: number;
  reason: string;
  target_date?: string;
}

interface OverrideLogEntry {
  id: string;
  action_type: string;
  manager_email: string;
  target_employee: string;
  details: Record<string, unknown>;
  created_at: string;
}

interface SheetTarget {
  email: string;
  displayName: string;
  clockInISO: string;
}

/** Returns today's date as a YYYY-MM-DD string. */
function toDateInput(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Preset date-range helpers */
function getPresetRange(label: string): { start: string; end: string } {
  const now = new Date();
  const todayStr = toDateInput(now);
  if (label === "Today") {
    return { start: todayStr, end: todayStr };
  }
  if (label === "This Week") {
    const day = now.getDay(); // 0=Sun
    const diffToMon = (day === 0 ? -6 : 1 - day);
    const mon = new Date(now);
    mon.setDate(now.getDate() + diffToMon);
    const sun = new Date(mon);
    sun.setDate(mon.getDate() + 6);
    return { start: toDateInput(mon), end: toDateInput(sun) };
  }
  if (label === "Last 2 Weeks") {
    const start = new Date(now.getTime() - 13 * 24 * 3_600_000);
    return { start: toDateInput(start), end: todayStr };
  }
  if (label === "This Month") {
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    return { start: toDateInput(start), end: todayStr };
  }
  return { start: toDateInput(new Date(now.getTime() - 13 * 24 * 3_600_000)), end: todayStr };
}

const DATE_PRESETS = ["Today", "This Week", "Last 2 Weeks", "This Month"] as const;

/** Triggers a CSV download from the DB summary rows. */
function downloadSummaryCsv(rows: PayrollSummaryRow[]): void {
  const header = "Employee Name,Email,Pay Period Start,Pay Period End,Clocked Hours,Adjustments (h),Total Hours,Gross Pay";
  const lines = rows.map((r) =>
    [
      `"${(r.employee_name ?? r.employee_email).replace(/"/g, '""')}"`,
      `"${r.employee_email}"`,
      r.pay_period_start,
      r.pay_period_end,
      (r.clocked_minutes / 60).toFixed(2),
      (r.adjustment_minutes / 60).toFixed(2),
      r.total_hours.toFixed(2),
      r.gross_pay.toFixed(2),
    ].join(",")
  );
  const csv = [header, ...lines].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `brewhub-payroll-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

/* ------------------------------------------------------------------ */
/* Component                                                           */
/* ------------------------------------------------------------------ */
export default function PayrollSection() {
  const token = useOpsSessionOptional()?.token;
  // ---- Date range: default to Last 2 Weeks preset ---------------
  const today = new Date();
  const defaultEnd = toDateInput(today);
  const defaultStart = toDateInput(new Date(today.getTime() - 13 * 24 * 3_600_000));

  const [startDate, setStartDate] = useState(defaultStart);
  const [endDate, setEndDate] = useState(defaultEnd);
  const [activePreset, setActivePreset] = useState<string>("Last 2 Weeks");

  // ---- Summary state (single source of truth: DB view) ----------
  const [summaryRows, setSummaryRows] = useState<PayrollSummaryRow[]>([]);
  const [openShifts, setOpenShifts] = useState<OpenShiftRow[]>([]);
  const [summaryLoading, setSummaryLoading] = useState(true);

  // ---- Fix clock-out bottom-sheet state ------------------------
  const [sheetTarget, setSheetTarget] = useState<SheetTarget | null>(null);
  const [sheetVisible, setSheetVisible] = useState(false);
  const [fixTime, setFixTime] = useState("");
  const [fixBusy, setFixBusy] = useState(false);
  const [fixError, setFixError] = useState("");
  const [fixSuccess, setFixSuccess] = useState("");
  const [fixReason, setFixReason] = useState("");

  // ---- Adjust Hours modal state --------------------------------
  const [adjustTarget, setAdjustTarget] = useState<PayrollSummaryRow | null>(null);
  const [adjustDelta, setAdjustDelta] = useState("");
  const [adjustReason, setAdjustReason] = useState("");
  const [adjustBusy, setAdjustBusy] = useState(false);
  const [adjustError, setAdjustError] = useState("");
  const [adjustSuccess, setAdjustSuccess] = useState("");
  const [pendingAdjust, setPendingAdjust] = useState<PendingAdjustAction | null>(null);
  const [showAdjustChallenge, setShowAdjustChallenge] = useState(false);

  // ---- Override / audit log (for "Edited" badges) ---------------
  const [overrides, setOverrides] = useState<OverrideLogEntry[]>([]);
  const [auditPopup, setAuditPopup] = useState<string | null>(null); // employee_email

  // Open/close helpers ----------------------------------------
  const openSheet = useCallback((target: SheetTarget) => {
    setSheetTarget(target);
    setFixTime("");
    setFixReason("");
    setFixError("");
    // micro-delay lets the DOM mount before the CSS transition fires
    requestAnimationFrame(() => requestAnimationFrame(() => setSheetVisible(true)));
  }, []);

  const closeSheet = useCallback(() => {
    setSheetVisible(false);
    setTimeout(() => {
      setSheetTarget(null);
      setFixTime("");
      setFixReason("");
      setFixError("");
    }, 320); // matches transition duration
  }, []);

  // ---- Challenge modal state ------------------------------------
  const [pendingAction, setPendingAction] = useState<PendingFixAction | null>(null);
  const [showChallengeModal, setShowChallengeModal] = useState(false);

  // ---- Polling backoff refs (declared before callbacks that use them) --
  const payrollBackoffRef = useRef<number>(60_000);
  const payrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ---- Fetch summary --------------------------------------------
  const fetchSummary = useCallback(async () => {
    if (!token) { setSummaryLoading(false); return; }
    setSummaryLoading(true);
    try {
      const res = await fetch(
        `${API_BASE}/get-payroll?view=summary&start=${encodeURIComponent(startDate)}&end=${encodeURIComponent(endDate)}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (res.status === 429) {
        payrollBackoffRef.current = Math.min(payrollBackoffRef.current * 2, 300_000);
        setSummaryLoading(false);
        return;
      }
      if (!res.ok) throw new Error("Summary fetch failed");
      payrollBackoffRef.current = 60_000; // reset on success
      const data = await res.json();
      setSummaryRows(data.summary ?? []);
      setOpenShifts(data.openShifts ?? []);
      setOverrides(data.overrides ?? []);
    } catch (err) {
      console.error("Summary fetch failed:", err);
      setSummaryRows([]);
      setOpenShifts([]);
      setOverrides([]);
    }
    setSummaryLoading(false);
  }, [startDate, endDate, token]);

  useEffect(() => {
    fetchSummary();
  }, [fetchSummary]);

  // ---- Auto-refresh payroll with adaptive backoff on 429 --------
  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    const schedule = () => {
      if (cancelled) return;
      payrollTimerRef.current = setTimeout(async () => {
        if (!cancelled) {
          await fetchSummary();
          schedule();
        }
      }, payrollBackoffRef.current);
    };
    schedule();
    return () => {
      cancelled = true;
      if (payrollTimerRef.current) clearTimeout(payrollTimerRef.current);
    };
  }, [token, fetchSummary]);

  // ---- Derived totals from DB summary ---------------------------
  const totalHours = summaryRows.reduce((s, r) => s + r.total_hours, 0);
  const totalGross = summaryRows.reduce((s, r) => s + r.gross_pay, 0);
  const totalAdjMins = summaryRows.reduce((s, r) => s + r.adjustment_minutes, 0);
  const hasOpenShifts = openShifts.length > 0;

  // ---- Fix clock-out handler ------------------------------------
  const handleFixClockOut = async (email: string, challengeNonce?: string) => {
    if (!token || !fixTime) return;
    setFixBusy(true);
    setFixError("");
    setFixSuccess("");

    const clockOutTimeISO = datetimeLocalToEasternISO(fixTime);
    const reason = fixReason.trim();

    try {
      const res = await fetch(`${API_BASE}/fix-clock`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          "X-BrewHub-Action": "true",
          ...(challengeNonce ? { "x-brewhub-challenge": challengeNonce } : {}),
        },
        body: JSON.stringify({
          employee_email: email,
          clock_out_time: clockOutTimeISO,
          reason,
          ...(challengeNonce ? { _challenge_nonce: challengeNonce } : {}),
        }),
      });

      const data = await res.json();

      // ---- Step-up: backend requires manager challenge ----------
      if (res.status === 403 && (data.error ?? "").toLowerCase().includes("challenge")) {
        setPendingAction({ email, clockOutTimeISO, reason });
        setShowChallengeModal(true);
        setFixBusy(false);
        return;
      }

      if (!res.ok) throw new Error(data.error || "Fix failed");

      setFixSuccess(`Clock-out fixed for ${email}`);
      closeSheet();
      setPendingAction(null);
      setTimeout(() => setFixSuccess(""), 4000);

      // Refresh payroll summary
      fetchSummary();
    } catch (err: unknown) {
      setFixError(toUserSafeMessageFromUnknown(err, "Unable to fix clock-out right now."));
    } finally {
      setFixBusy(false);
    }
  };

  // ---- Replay fix-clock after successful manager challenge ------
  const handleChallengeSuccess = useCallback(async (nonce: string) => {
    setShowChallengeModal(false);
    if (!pendingAction || !token) return;

    setFixBusy(true);
    setFixError("");
    try {
      const res = await fetch(`${API_BASE}/fix-clock`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          "X-BrewHub-Action": "true",
          "x-brewhub-challenge": nonce,
        },
        body: JSON.stringify({
          employee_email: pendingAction.email,
          clock_out_time: pendingAction.clockOutTimeISO,
          reason: pendingAction.reason,
          _challenge_nonce: nonce,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Fix failed after challenge");

      setFixSuccess(`Clock-out fixed for ${pendingAction.email}`);
      closeSheet();
      setPendingAction(null);
      setTimeout(() => setFixSuccess(""), 4000);

      fetchSummary();
    } catch (err: unknown) {
      setFixError(toUserSafeMessageFromUnknown(err, "Unable to fix clock-out right now."));
    } finally {
      setFixBusy(false);
    }
  }, [pendingAction, token, fetchSummary, closeSheet]);

  // ---- Adjust Hours handler -------------------------------------
  const handleAdjustHours = async (challengeNonce?: string) => {
    if (!token || !adjustTarget) return;
    const delta = Number(adjustDelta);
    if (!delta || isNaN(delta)) { setAdjustError("Enter a non-zero number of minutes."); return; }
    if (Math.abs(delta) > 1440) { setAdjustError("Adjustment cannot exceed ±24 hours (1440 minutes)."); return; }
    const reason = adjustReason.trim();
    if (reason.length < 10) { setAdjustError("Reason must be at least 10 characters (IRS compliance)."); return; }

    setAdjustBusy(true);
    setAdjustError("");
    setAdjustSuccess("");

    try {
      const res = await fetch(`${API_BASE}/update-hours`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          "X-BrewHub-Action": "true",
          ...(challengeNonce ? { "x-brewhub-challenge": challengeNonce } : {}),
        },
        body: JSON.stringify({
          employee_email: adjustTarget.employee_email,
          delta_minutes: delta,
          reason,
          ...(challengeNonce ? { _challenge_nonce: challengeNonce } : {}),
        }),
      });

      const data = await res.json();

      // Step-up: backend requires manager TOTP challenge
      if (res.status === 403 && (data.error ?? "").toLowerCase().includes("challenge")) {
        setPendingAdjust({ employee_email: adjustTarget.employee_email, delta_minutes: delta, reason });
        setShowAdjustChallenge(true);
        setAdjustBusy(false);
        return;
      }

      if (!res.ok) {
        const msg = data.details?.map((d: { message: string }) => d.message).join("; ") || data.error || "Adjustment failed";
        throw new Error(msg);
      }

      setAdjustSuccess(`Hours adjusted for ${adjustTarget.employee_name || adjustTarget.employee_email}`);
      setAdjustTarget(null);
      setPendingAdjust(null);
      setTimeout(() => setAdjustSuccess(""), 4000);
      fetchSummary();
    } catch (err: unknown) {
      setAdjustError(toUserSafeMessageFromUnknown(err, "Unable to adjust hours right now."));
    } finally {
      setAdjustBusy(false);
    }
  };

  // ---- Replay adjust-hours after successful TOTP challenge ------
  const handleAdjustChallengeSuccess = useCallback(async (nonce: string) => {
    setShowAdjustChallenge(false);
    if (!pendingAdjust || !token) return;

    setAdjustBusy(true);
    setAdjustError("");
    try {
      const res = await fetch(`${API_BASE}/update-hours`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          "X-BrewHub-Action": "true",
          "x-brewhub-challenge": nonce,
        },
        body: JSON.stringify({
          employee_email: pendingAdjust.employee_email,
          delta_minutes: pendingAdjust.delta_minutes,
          reason: pendingAdjust.reason,
          _challenge_nonce: nonce,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Adjustment failed after challenge");

      setAdjustSuccess(`Hours adjusted for ${pendingAdjust.employee_email}`);
      setAdjustTarget(null);
      setPendingAdjust(null);
      setTimeout(() => setAdjustSuccess(""), 4000);
      fetchSummary();
    } catch (err: unknown) {
      setAdjustError(toUserSafeMessageFromUnknown(err, "Unable to adjust hours right now."));
    } finally {
      setAdjustBusy(false);
    }
  }, [pendingAdjust, token, fetchSummary]);

  // ---- Helper: get overrides for a specific employee ------------
  const getEmployeeOverrides = useCallback((email: string) => {
    return overrides.filter((o) => o.target_employee === email);
  }, [overrides]);

  // ---- Render ---------------------------------------------------
  return (
    <section className="space-y-4">

      {/* ── Header ── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">💰 Payroll</h2>

        <div className="flex items-center gap-2 text-sm">
          <input
            type="date"
            value={startDate}
            max={endDate}
            onChange={(e) => { setStartDate(e.target.value); setActivePreset(""); }}
            className="bg-stone-900 border border-stone-800 rounded-lg px-3 py-2 text-stone-100
                       focus:outline-none focus:ring-1 focus:ring-amber-500 min-h-[44px]"
          />
          <span className="text-stone-500">→</span>
          <input
            type="date"
            value={endDate}
            min={startDate}
            onChange={(e) => { setEndDate(e.target.value); setActivePreset(""); }}
            className="bg-stone-900 border border-stone-800 rounded-lg px-3 py-2 text-stone-100
                       focus:outline-none focus:ring-1 focus:ring-amber-500 min-h-[44px]"
          />
          <button
            type="button"
            onClick={() => fetchSummary()}
            aria-label="Refresh"
            className="flex items-center justify-center w-11 min-h-[44px] rounded-xl
                       bg-stone-900 border border-stone-800 hover:border-stone-600
                       text-stone-400 hover:text-white transition-colors"
          >
            <RefreshCw size={16} />
          </button>
        </div>

        <button
          type="button"
          onClick={() => downloadSummaryCsv(summaryRows)}
          disabled={summaryLoading || summaryRows.length === 0}
          className="flex items-center gap-2 min-h-[44px] px-4 rounded-xl
                     bg-gradient-to-br from-emerald-600 to-emerald-700
                     hover:from-emerald-500 hover:to-emerald-600
                     disabled:opacity-40 disabled:cursor-not-allowed
                     text-white text-sm font-semibold transition-all active:scale-[0.98]"
        >
          <Download size={16} />
          Download CSV
        </button>
      </div>

      {/* ── Date-range preset pills ── */}
      <div className="flex flex-wrap gap-2">
        {DATE_PRESETS.map((label) => (
          <button
            key={label}
            type="button"
            onClick={() => {
              const { start, end } = getPresetRange(label);
              setStartDate(start);
              setEndDate(end);
              setActivePreset(label);
            }}
            className={`min-h-[36px] px-4 rounded-full text-xs font-semibold transition-all
                        active:scale-[0.97] border
                        ${
                          activePreset === label
                            ? "bg-amber-500/20 border-amber-500/60 text-amber-300"
                            : "bg-stone-900 border-stone-800 text-stone-400 hover:border-amber-500/40 hover:text-white"
                        }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* -- Stat tiles -- */}
      {!summaryLoading && summaryRows.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="bg-stone-900 border border-stone-800 rounded-xl px-4 py-4 flex flex-col justify-center">
            <div className="text-xs text-stone-500 mb-1">Total Hours</div>
            <div className="text-2xl font-bold text-stone-100">{totalHours.toFixed(1)} h</div>
          </div>
          <div className="bg-stone-900 border border-stone-800 rounded-xl px-4 py-4 flex flex-col justify-center">
            <div className="text-xs text-stone-500 mb-1">Adjustments</div>
            <div className={`text-2xl font-bold ${totalAdjMins !== 0 ? "text-amber-400" : "text-stone-500"}`}>
              {totalAdjMins > 0 ? "+" : ""}{(totalAdjMins / 60).toFixed(1)} h
            </div>
          </div>
          <div className="bg-stone-900 border border-stone-800 rounded-xl px-4 py-4 flex flex-col justify-center">
            <div className="text-xs text-stone-500 mb-1">Est. Gross Pay</div>
            <div className="text-2xl font-bold text-green-400">${totalGross.toFixed(2)}</div>
          </div>
          <div className="bg-stone-900 border border-stone-800 rounded-xl px-4 py-4 flex flex-col justify-center">
            <div className="text-xs text-stone-500 mb-1">Open Shifts</div>
            <div className={`text-2xl font-bold ${hasOpenShifts ? "text-amber-400" : "text-stone-500"}`}>
              {openShifts.length}
            </div>
          </div>
        </div>
      )}

      {/* -- Fix success / error banners -- */}
      {fixSuccess && (
        <div className="flex items-center gap-2 bg-green-500/10 border border-green-500/30 rounded-xl px-4 py-3 text-green-400 text-sm">
          âœ“ {fixSuccess}
        </div>
      )}
      {fixError && (
        <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3 text-red-400 text-sm">
          âœ• {fixError}
        </div>
      )}

      {/* -- Open Shifts Card -- */}
      {openShifts.length > 0 && !summaryLoading && (
        <div className="bg-stone-900 border border-amber-500/30 rounded-xl p-4">
          <h3 className="text-sm font-bold text-amber-400 mb-3 flex items-center gap-2">
            <span>⏱</span>
            Open Shifts — {openShifts.length} Unfinalised
          </h3>
          <p className="text-xs text-stone-400 mb-3">
            These employees are still clocked in. Their hours will{" "}
            <strong className="text-white">not</strong> count toward payroll
            totals until the shift is closed.
          </p>
          <div className="space-y-2">
            {openShifts.map((os) => {
              const clockInDate = new Date(os.clock_in);
              const hoursAgo = Math.round(
                (Date.now() - clockInDate.getTime()) / 3_600_000
              );
              const isAlerted = hoursAgo >= (MISSED_PUNCH_THRESHOLD_MS / 3_600_000);
              return (
                <div
                  key={os.id}
                  className="flex items-center justify-between gap-3 bg-stone-950
                             rounded-xl px-4 py-3 border border-stone-800"
                >
                  <div className="min-w-0">
                    <span className="font-semibold text-sm truncate block">
                      {os.employee_email}
                    </span>
                    <span className="text-xs text-stone-500">
                      Clocked in{" "}
                      <span
                        className={
                          isAlerted
                            ? "text-red-400 font-bold"
                            : "text-amber-400 font-semibold"
                        }
                      >
                        {clockInDate.toLocaleString("en-US", {
                          timeZone: SHOP_TZ,
                          weekday: "short",
                          month: "short",
                          day: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                          hour12: true,
                        })}
                      </span>{" "}
                      ({hoursAgo}h ago)
                    </span>
                    {isAlerted && (
                      <span
                        className="mt-1 inline-block text-[10px] font-bold uppercase tracking-wide
                                   bg-red-500/20 text-red-400 border border-red-500/30 rounded px-2 py-0.5"
                      >
                        Likely Missed
                      </span>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={() => openSheet({
                      email: os.employee_email,
                      displayName: os.employee_email,
                      clockInISO: os.clock_in,
                    })}
                    className="flex-shrink-0 flex items-center gap-1.5 text-xs font-semibold
                               text-amber-400 hover:text-amber-300
                               border border-amber-500/30 hover:border-amber-400/60
                               rounded-lg px-3 min-h-[44px] transition-colors active:scale-[0.98]"
                  >
                    <Clock size={13} />
                    Fix Clock-Out
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* -- Pay Period Summary Table (single source of truth) -- */}
      <div className="bg-stone-900 border border-stone-800 rounded-xl overflow-hidden">
        <div className="px-5 py-3 border-b border-stone-800 flex items-center justify-between min-h-[56px]">
          <h3 className="text-sm font-bold text-stone-100 flex items-center gap-2">
            <span>ðŸ“Š</span> Pay Period Summary
          </h3>
          <span className="text-[10px] text-stone-600">
            Source: v_payroll_summary Â· excludes active shifts
          </span>
        </div>

        <div
          className="hidden md:grid md:grid-cols-[2fr_1fr_1fr_1fr_1fr_1fr_auto]
                     gap-2 px-5 py-2 text-xs font-bold uppercase tracking-wider
                     text-stone-500 bg-stone-800"
        >
          <span>Staff</span>
          <span>Period</span>
          <span>Clocked</span>
          <span>Adjustments</span>
          <span>Total Hours</span>
          <span>Gross Pay</span>
          <span className="text-center">Actions</span>
        </div>

        {summaryLoading ? (
          <div className="space-y-2 px-5 py-6">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="h-10 bg-stone-800 rounded-lg animate-pulse" />
            ))}
          </div>
        ) : summaryRows.length === 0 ? (
          <div className="px-5 py-6 text-stone-500 text-sm">
            No payroll data for this period.
          </div>
        ) : (
          summaryRows.map((row, idx) => {
            const empOverrides = getEmployeeOverrides(row.employee_email);
            const hasEdits = row.adjustment_minutes !== 0 || empOverrides.length > 0;
            return (
            <div
              key={`${row.employee_email}-${row.pay_period_start}-${idx}`}
              className="flex flex-col md:grid md:grid-cols-[2fr_1fr_1fr_1fr_1fr_1fr_auto]
                         gap-2 px-5 py-4 border-t border-stone-800 text-sm"
            >
              <div className="min-w-0">
                <div className="font-semibold truncate flex items-center gap-2">
                  {row.employee_name || row.employee_email}
                  {hasEdits && (
                    <span className="relative inline-flex">
                      <button
                        type="button"
                        onClick={() => setAuditPopup(auditPopup === row.employee_email ? null : row.employee_email)}
                        className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide
                                   bg-amber-500/20 text-amber-400 border border-amber-500/30
                                   rounded px-1.5 py-0.5 cursor-pointer hover:bg-amber-500/30 transition-colors"
                        title="This timesheet has been edited. Click for details."
                      >
                        <Info size={10} />
                        Edited
                      </button>
                      {auditPopup === row.employee_email && empOverrides.length > 0 && (
                        <div
                          className="absolute left-0 top-full mt-1 z-50 w-80 max-h-60 overflow-y-auto
                                     bg-stone-950 border border-amber-500/40 rounded-xl shadow-2xl p-3 text-xs"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <div className="font-bold text-amber-400 mb-2 flex items-center justify-between">
                            <span>Audit Trail</span>
                            <button type="button" onClick={() => setAuditPopup(null)} className="text-stone-500 hover:text-white">
                              <X size={12} />
                            </button>
                          </div>
                          {empOverrides.map((o) => (
                            <div key={o.id} className="border-t border-stone-800 pt-2 mt-2 first:border-0 first:pt-0 first:mt-0">
                              <div className="text-stone-300">
                                <span className="font-semibold text-amber-400">
                                  {o.action_type === "adjust_hours" ? "Hours Adjusted" : "Clock Fixed"}
                                </span>
                                {" by "}
                                <span className="text-stone-200 font-semibold">{o.manager_email}</span>
                              </div>
                              {o.details?.reason && (
                                <div className="text-stone-400 mt-1">
                                  Reason: <span className="text-stone-300 italic">&quot;{String(o.details.reason)}&quot;</span>
                                </div>
                              )}
                              {o.details?.delta_minutes != null && (
                                <div className="text-stone-500 mt-0.5">
                                  Delta: {Number(o.details.delta_minutes) > 0 ? "+" : ""}{Number(o.details.delta_minutes)} min
                                </div>
                              )}
                              <div className="text-stone-600 mt-0.5">
                                {new Date(o.created_at).toLocaleString("en-US", { timeZone: SHOP_TZ, dateStyle: "short", timeStyle: "short" })}
                              </div>
                            </div>
                          ))}
                          {empOverrides.length === 0 && (
                            <div className="text-stone-500 italic">Adjustment recorded — no additional details available.</div>
                          )}
                        </div>
                      )}
                    </span>
                  )}
                </div>
                <div className="text-xs text-stone-500 truncate">
                  {row.employee_email}
                </div>
                {row.active_shifts > 0 && (
                  <span
                    className="mt-1 inline-block text-[10px] font-bold uppercase tracking-wide
                               bg-amber-500/20 text-amber-400 border border-amber-500/30
                               rounded px-2 py-0.5"
                  >
                    {row.active_shifts} open shift
                    {row.active_shifts > 1 ? "s" : ""}
                  </span>
                )}
              </div>
              <div className="text-xs text-stone-400">
                <span className="md:hidden font-semibold text-stone-500">Period: </span>
                {row.pay_period_start}
                <br />
                <span className="text-stone-600">→</span> {row.pay_period_end}
              </div>
              <div>
                <span className="md:hidden text-xs font-semibold text-stone-500">Clocked: </span>
                {(row.clocked_minutes / 60).toFixed(1)} h
              </div>
              <div
                className={
                  row.adjustment_minutes !== 0
                    ? "text-amber-400 font-semibold"
                    : "text-stone-500"
                }
              >
                <span className="md:hidden text-xs font-semibold text-stone-500">Adj: </span>
                {row.adjustment_minutes > 0 ? "+" : ""}
                {(row.adjustment_minutes / 60).toFixed(1)} h
              </div>
              <div className="font-semibold">
                <span className="md:hidden text-xs font-semibold text-stone-500">Total: </span>
                {row.total_hours.toFixed(1)} h
              </div>
              <div className="text-green-400 font-semibold">
                <span className="md:hidden text-xs font-semibold text-stone-500">Gross: </span>
                ${row.gross_pay.toFixed(2)}
              </div>
              <div className="flex items-center justify-center">
                <button
                  type="button"
                  onClick={() => {
                    setAdjustTarget(row);
                    setAdjustDelta("");
                    setAdjustReason("");
                    setAdjustError("");
                    setAdjustSuccess("");
                  }}
                  className="flex items-center gap-1 text-xs font-semibold
                             text-stone-400 hover:text-amber-400
                             border border-stone-700 hover:border-amber-500/40
                             rounded-lg px-2.5 min-h-[36px] transition-colors active:scale-[0.98]"
                  title="Adjust hours for this employee"
                >
                  <Pencil size={12} />
                  <span className="hidden lg:inline">Adjust Hours</span>
                </button>
              </div>
            </div>
            );
          })
        )}
      </div>

      {/* -- Adjust success / error banners -- */}
      {adjustSuccess && (
        <div className="flex items-center gap-2 bg-green-500/10 border border-green-500/30 rounded-xl px-4 py-3 text-green-400 text-sm">
          ✓ {adjustSuccess}
        </div>
      )}

      {/* -- Adjust Hours Modal -- */}
      {adjustTarget && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 z-40 bg-black/60"
            onClick={() => { if (!adjustBusy) setAdjustTarget(null); }}
            aria-hidden="true"
          />

          {/* Modal panel */}
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="adjust-modal-title"
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
          >
            <div
              className="w-full max-w-md bg-stone-900 border border-stone-700 rounded-2xl shadow-2xl overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Header */}
              <div className="flex items-start justify-between px-5 pt-5 pb-4 border-b border-stone-800">
                <div className="min-w-0 flex-1 pr-3">
                  <h2 id="adjust-modal-title" className="text-base font-bold text-white flex items-center gap-2">
                    <Pencil size={16} className="text-amber-400 flex-shrink-0" />
                    Adjust Hours
                  </h2>
                  <div className="mt-1 text-sm text-stone-300 font-semibold truncate">
                    {adjustTarget.employee_name || adjustTarget.employee_email}
                  </div>
                  <div className="text-xs text-stone-500 truncate">
                    {adjustTarget.employee_email}
                  </div>
                  <div className="mt-1 text-xs text-stone-500">
                    Period: {adjustTarget.pay_period_start} → {adjustTarget.pay_period_end}
                  </div>
                  <div className="mt-1 text-xs text-stone-400">
                    Current: {adjustTarget.total_hours.toFixed(1)}h total ({(adjustTarget.clocked_minutes / 60).toFixed(1)}h clocked
                    {adjustTarget.adjustment_minutes !== 0 && (
                      <>, {adjustTarget.adjustment_minutes > 0 ? "+" : ""}{(adjustTarget.adjustment_minutes / 60).toFixed(1)}h adj</>
                    )}
                    )
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => { if (!adjustBusy) setAdjustTarget(null); }}
                  aria-label="Close"
                  className="flex-shrink-0 flex items-center justify-center w-10 h-10 rounded-full
                             bg-stone-700 hover:bg-stone-600 text-stone-400 hover:text-white
                             transition-colors active:scale-[0.95]"
                >
                  <X size={18} />
                </button>
              </div>

              {/* Form body */}
              <div className="px-5 pt-5 pb-6 space-y-5">
                {/* Inline error */}
                {adjustError && (
                  <div
                    role="alert"
                    className="flex items-center gap-2 bg-red-500/10 border border-red-500/30
                               rounded-xl px-4 py-3 text-red-400 text-sm"
                  >
                    <AlertTriangle size={16} className="flex-shrink-0" />
                    {adjustError}
                  </div>
                )}

                {/* Delta minutes */}
                <div className="space-y-2">
                  <label
                    htmlFor="adjust-delta"
                    className="block text-xs font-semibold text-stone-400 uppercase tracking-wider"
                  >
                    Adjustment (minutes) <span className="text-red-400">*</span>
                  </label>
                  <input
                    id="adjust-delta"
                    type="number"
                    value={adjustDelta}
                    onChange={(e) => setAdjustDelta(e.target.value)}
                    placeholder="e.g. 30 to add, -30 to subtract"
                    min={-1440}
                    max={1440}
                    className="w-full bg-stone-950 border border-stone-700 rounded-xl px-4
                               text-sm text-white placeholder:text-stone-600
                               focus:outline-none focus:ring-2 focus:ring-amber-500/60 min-h-[52px]"
                  />
                  <p className="text-[10px] text-stone-600">
                    Positive = add hours · Negative = subtract hours · Max ±1440 min (24h)
                  </p>
                  {adjustDelta && !isNaN(Number(adjustDelta)) && Number(adjustDelta) !== 0 && (
                    <p className="text-xs text-amber-400 font-semibold">
                      New total will be ≈ {(adjustTarget.total_hours + Number(adjustDelta) / 60).toFixed(1)}h
                    </p>
                  )}
                </div>

                {/* Reason (IRS-compliant: minimum 10 characters) */}
                <div className="space-y-2">
                  <label
                    htmlFor="adjust-reason"
                    className="block text-xs font-semibold text-stone-400 uppercase tracking-wider"
                  >
                    Reason (IRS Audit) <span className="text-red-400">*</span>
                  </label>
                  <textarea
                    id="adjust-reason"
                    value={adjustReason}
                    onChange={(e) => setAdjustReason(e.target.value)}
                    placeholder="Minimum 10 characters — e.g. 'Missed 30 min break deduction per employee request on 2/24'"
                    maxLength={500}
                    rows={3}
                    className="w-full bg-stone-950 border border-stone-700 rounded-xl px-4 py-3
                               text-sm text-white placeholder:text-stone-600
                               focus:outline-none focus:ring-2 focus:ring-amber-500/60 resize-none"
                  />
                  <div className="flex justify-between text-[10px] text-stone-600">
                    <span>
                      {adjustReason.trim().length < 10
                        ? `${10 - adjustReason.trim().length} more character${10 - adjustReason.trim().length !== 1 ? "s" : ""} required`
                        : "✓ Meets minimum length"}
                    </span>
                    <span>{adjustReason.length}/500</span>
                  </div>
                </div>

                {/* IRS compliance notice */}
                <div className="flex items-start gap-2 bg-amber-500/5 border border-amber-500/20 rounded-xl px-3 py-2.5">
                  <AlertTriangle size={14} className="text-amber-500 flex-shrink-0 mt-0.5" />
                  <p className="text-[11px] text-stone-400 leading-relaxed">
                    <strong className="text-amber-400">IRS Audit Trail:</strong> This adjustment will be
                    permanently recorded with your manager ID, the reason provided, and a timestamp. This
                    record cannot be edited or deleted.
                  </p>
                </div>

                {/* Buttons */}
                <div className="flex gap-3 pt-1">
                  <button
                    type="button"
                    onClick={() => { if (!adjustBusy) setAdjustTarget(null); }}
                    className="flex-1 min-h-[52px] rounded-xl border border-stone-700
                               text-stone-400 hover:text-white hover:border-stone-400
                               text-sm font-semibold transition-all active:scale-[0.98]"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={
                      adjustBusy ||
                      !adjustDelta ||
                      isNaN(Number(adjustDelta)) ||
                      Number(adjustDelta) === 0 ||
                      adjustReason.trim().length < 10
                    }
                    onClick={() => handleAdjustHours()}
                    className="flex-[2] min-h-[52px] rounded-xl
                               bg-gradient-to-br from-amber-500 to-amber-600
                               hover:from-amber-400 hover:to-amber-500
                               disabled:opacity-40 disabled:cursor-not-allowed
                               text-white text-sm font-bold transition-all active:scale-[0.98]"
                  >
                    {adjustBusy ? "Submitting…" : "Submit Adjustment"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </>
      )}

      {/* -- Manager Challenge Modal (fix-clock) -- */}
      {showChallengeModal && token && (
        <ManagerChallengeModal
          actionType="fix_clock"
          actionDescription={`Fix clock-out for ${pendingAction?.email ?? ""}`}
          token={token}
          onSuccess={handleChallengeSuccess}
          onCancel={() => {
            setShowChallengeModal(false);
            setPendingAction(null);
            setFixBusy(false);
          }}
        />
      )}

      {/* -- Manager Challenge Modal (adjust-hours) -- */}
      {showAdjustChallenge && token && (
        <ManagerChallengeModal
          actionType="adjust_hours"
          actionDescription={`Adjust hours for ${pendingAdjust?.employee_email ?? ""}`}
          token={token}
          onSuccess={handleAdjustChallengeSuccess}
          onCancel={() => {
            setShowAdjustChallenge(false);
            setPendingAdjust(null);
            setAdjustBusy(false);
          }}
        />
      )}

      {/* ── Fix Clock-Out Bottom Sheet ── */}
      {sheetTarget && (
        <>
          {/* Backdrop */}
          <div
            className={`fixed inset-0 z-40 bg-black/60 transition-opacity duration-300
                        ${sheetVisible ? "opacity-100" : "opacity-0 pointer-events-none"}`}
            onClick={closeSheet}
            aria-hidden="true"
          />

          {/* Sheet panel */}
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="fix-sheet-title"
            className={`fixed inset-x-0 bottom-0 z-50 flex flex-col
                        bg-stone-900 border-t border-stone-800 rounded-t-xl
                        shadow-2xl transition-transform duration-300 ease-out
                        max-h-[90dvh] overflow-y-auto
                        ${sheetVisible ? "translate-y-0" : "translate-y-full"}`}
          >
            {/* Drag handle */}
            <div className="flex justify-center pt-3 pb-1 flex-shrink-0">
              <div className="w-10 h-1 rounded-full bg-stone-600" />
            </div>

            {/* Header row */}
            <div className="flex items-start justify-between px-5 pt-3 pb-4 border-b border-stone-800 flex-shrink-0">
              <div className="min-w-0 flex-1 pr-3">
                <h2 id="fix-sheet-title" className="text-base font-bold text-white flex items-center gap-2">
                  <Clock size={16} className="text-amber-400 flex-shrink-0" />
                  Fix Clock-Out
                </h2>
                <div className="mt-1 text-sm text-stone-300 font-semibold truncate">
                  {sheetTarget.displayName}
                </div>
                {(() => {
                  const clockInDate = new Date(sheetTarget.clockInISO);
                  const hoursAgo = Math.round(
                    (Date.now() - clockInDate.getTime()) / 3_600_000
                  );
                  const isAlerted =
                    hoursAgo >= MISSED_PUNCH_THRESHOLD_MS / 3_600_000;
                  return (
                    <div className="mt-1 text-xs text-stone-400 flex flex-wrap items-center gap-1.5">
                      <span>Clocked in</span>
                      <span
                        className={
                          isAlerted
                            ? "text-red-400 font-semibold"
                            : "text-amber-400 font-semibold"
                        }
                      >
                        {clockInDate.toLocaleString("en-US", {
                          timeZone: SHOP_TZ,
                          weekday: "short",
                          month: "short",
                          day: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                          hour12: true,
                        })}
                      </span>
                      <span>({hoursAgo}h ago)</span>
                      {isAlerted && (
                        <span
                          className="text-[10px] font-bold uppercase tracking-wide
                                     bg-red-500/20 text-red-400 border border-red-500/30
                                     rounded px-1.5 py-0.5"
                        >
                          Likely Missed
                        </span>
                      )}
                    </div>
                  );
                })()}
              </div>
              <button
                type="button"
                onClick={closeSheet}
                aria-label="Close"
                className="flex-shrink-0 flex items-center justify-center w-10 h-10 rounded-full
                           bg-stone-700 hover:bg-stone-600 text-stone-400 hover:text-white
                           transition-colors active:scale-[0.95]"
              >
                <X size={18} />
              </button>
            </div>

            {/* Form body */}
            <div className="px-5 pt-5 pb-10 space-y-5 flex-1">
              {/* Inline error */}
              {fixError && (
                <div
                  role="alert"
                  className="flex items-center gap-2 bg-red-500/10 border border-red-500/30
                             rounded-xl px-4 py-3 text-red-400 text-sm"
                >
                  <AlertTriangle size={16} className="flex-shrink-0" />
                  {fixError}
                </div>
              )}

              {/* Clock-out time */}
              <div className="space-y-2">
                <label
                  htmlFor="fix-sheet-time"
                  className="block text-xs font-semibold text-stone-400 uppercase tracking-wider"
                >
                  Clock-Out Time
                </label>
                <input
                  id="fix-sheet-time"
                  type="datetime-local"
                  value={fixTime}
                  onChange={(e) => setFixTime(e.target.value)}
                  min={utcToEasternDatetimeLocal(sheetTarget.clockInISO)}
                  className="w-full bg-stone-950 border border-stone-700 rounded-xl px-4
                             text-sm text-white focus:outline-none focus:ring-2
                             focus:ring-amber-500/60 min-h-[52px]"
                />
                <p className="text-[10px] text-stone-600">All times Eastern (ET)</p>
              </div>

              {/* Reason */}
              <div className="space-y-2">
                <label
                  htmlFor="fix-sheet-reason"
                  className="block text-xs font-semibold text-stone-400 uppercase tracking-wider"
                >
                  Reason <span className="text-red-400">*</span>
                </label>
                <input
                  id="fix-sheet-reason"
                  type="text"
                  value={fixReason}
                  onChange={(e) => setFixReason(e.target.value)}
                  placeholder="e.g. Staff forgot to clock out"
                  maxLength={200}
                  className="w-full bg-stone-950 border border-stone-700 rounded-xl px-4
                             text-sm text-white placeholder:text-stone-600
                             focus:outline-none focus:ring-2 focus:ring-amber-500/60 min-h-[52px]"
                />
                {fixReason.length > 0 && (
                  <p className="text-[10px] text-stone-600 text-right">
                    {fixReason.length}/200
                  </p>
                )}
              </div>

              {/* Buttons */}
              <div className="flex gap-3 pt-1">
                <button
                  type="button"
                  onClick={closeSheet}
                  className="flex-1 min-h-[52px] rounded-xl border border-stone-700
                             text-stone-400 hover:text-white hover:border-stone-400
                             text-sm font-semibold transition-all active:scale-[0.98]"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={!fixTime || !fixReason.trim() || fixBusy}
                  onClick={() => handleFixClockOut(sheetTarget.email)}
                  className="flex-[2] min-h-[52px] rounded-xl
                             bg-gradient-to-br from-amber-500 to-amber-600
                             hover:from-amber-400 hover:to-amber-500
                             disabled:opacity-40 disabled:cursor-not-allowed
                             text-white text-sm font-bold transition-all active:scale-[0.98]"
                >
                  {fixBusy ? "Saving…" : "Save Clock-Out"}
                </button>
              </div>
            </div>
          </div>
        </>
      )}    </section>
  );
}
