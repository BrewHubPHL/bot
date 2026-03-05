"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import { useOpsSession } from "@/components/OpsGate";
import { fetchOps, OPS_API_BASE } from "@/utils/ops-api";
import { getCanonicalAgreementText } from "@/lib/crypto-utils";
import { CURRENT_AGREEMENT_VERSION } from "@/lib/agreement-constants";

/**
 * AgreementViewer — Displays the employee's hydrated staff agreement in a
 * scrollable pre-wrap container. The user must scroll to the bottom before
 * the PIN-signing form is unlocked.
 *
 * Usage:
 *   <AgreementViewer
 *     versionTag="2027-Q1"
 *     onSigned={(result) => console.log('Signed!', result)}
 *   />
 */

interface SignatureResult {
  success: boolean;
  signature_id: string | null;
  sha256_hash: string;
}

interface AgreementViewerProps {
  /** Version tag for audit trail, e.g. '2027-Q1' */
  versionTag?: string;
  /** Called after a successful digital signature with the audit result. */
  onSigned?: (result: SignatureResult) => void;
}

/* ── Session-recovery helpers ──────────────────────────────── */
const SCROLL_KEY = "brewhub_agreement_read_complete";
const VAULT_KEY = "brewhub_agreement_recovery_vault";
const VAULT_TTL_MS = 5 * 60 * 1000; // 5 minutes

/* ── Engagement gate: scroll checkpoints + time interlock ── */
const MIN_READ_TIME_SEC = 20;
type Checkpoint = "start" | "middle" | "end";
const ALL_CHECKPOINTS: readonly Checkpoint[] = ["start", "middle", "end"] as const;

interface RecoveryVault {
  version_tag: string;
  canonical_text: string;
  staff_id: string;
  timestamp: number;
}

function saveVault(vault: RecoveryVault): void {
  try { localStorage.setItem(VAULT_KEY, JSON.stringify(vault)); } catch { /* storage unavailable */ }
}

function loadVault(): RecoveryVault | null {
  try {
    const raw = localStorage.getItem(VAULT_KEY);
    if (!raw) return null;
    const v: RecoveryVault = JSON.parse(raw);
    if (Date.now() - v.timestamp > VAULT_TTL_MS) { clearVault(); return null; }
    return v;
  } catch { return null; }
}

function clearVault(): void {
  try { localStorage.removeItem(VAULT_KEY); } catch { /* storage unavailable */ }
}

export default function AgreementViewer({
  versionTag = CURRENT_AGREEMENT_VERSION,
  onSigned,
}: AgreementViewerProps) {
  const { staff, token, refreshSession } = useOpsSession();

  const [agreement, setAgreement] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /* ── Engagement-gate state ──────────────────────────────── */
  const [engagementComplete, setEngagementComplete] = useState(false);
  const [checkpointsSeen, setCheckpointsSeen] = useState<Set<Checkpoint>>(new Set());
  const [timeRemaining, setTimeRemaining] = useState(MIN_READ_TIME_SEC);
  const [isPageVisible, setIsPageVisible] = useState(true);

  const [pin, setPin] = useState("");
  const [signing, setSigning] = useState(false);
  const [signError, setSignError] = useState<string | null>(null);
  const [signed, setSigned] = useState(false);
  const [signatureHash, setSignatureHash] = useState<string | null>(null);

  /* ── 401 recovery state ──────────────────────────────── */
  const [showReauthModal, setShowReauthModal] = useState(false);
  const [reauthPin, setReauthPin] = useState("");
  const [reauthError, setReauthError] = useState<string | null>(null);
  const [reauthLoading, setReauthLoading] = useState(false);
  const [signingPhase, setSigningPhase] = useState<
    "idle" | "signing" | "verifying" | "retrying"
  >("idle");

  const scrollRef = useRef<HTMLDivElement>(null);
  const reauthInputRef = useRef<HTMLInputElement>(null);

  /* ── Checkpoint sentinel refs ───────────────────────────── */
  const checkpointStartRef = useRef<HTMLDivElement>(null);
  const checkpointMidRef = useRef<HTMLDivElement>(null);
  const checkpointEndRef = useRef<HTMLDivElement>(null);

  /* ── Timer bookkeeping refs (mutable, no re-renders) ───── */
  const elapsedRef = useRef(0);
  const lastTickRef = useRef<number | null>(null);
  const timerIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  /* ── Memoised agreement halves for checkpoint sentinels ── */
  const agreementSections = useMemo(() => {
    if (!agreement) return null;
    const lines = agreement.split("\n");
    const mid = Math.floor(lines.length / 2);
    return { firstHalf: lines.slice(0, mid).join("\n"), secondHalf: lines.slice(mid).join("\n") };
  }, [agreement]);

  // ── Fetch the agreement on mount ────────────────────────────
  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const res = await fetchOps("/get-employee-contract", {}, token);
        if (!res.ok) {
          const body = await res.json().catch(() => ({ error: "Failed to load agreement" }));
          throw new Error(body.error || `HTTP ${res.status}`);
        }
        const data = await res.json();
        if (!cancelled) setAgreement(data.agreement);
      } catch (err: unknown) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load agreement");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, [token]);

  // ── Restore engagement-complete state from sessionStorage ──
  useEffect(() => {
    try {
      if (sessionStorage.getItem(SCROLL_KEY) === "true") {
        setEngagementComplete(true);
      }
    } catch { /* sessionStorage unavailable */ }
  }, []);

  // ── Intersection Observer: 3 scroll checkpoints ─────────────
  useEffect(() => {
    if (engagementComplete || !agreement) return;
    const root = scrollRef.current;
    if (!root) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const cp = (entry.target as HTMLElement).dataset.checkpoint as Checkpoint | undefined;
            if (cp) {
              setCheckpointsSeen((prev) => {
                if (prev.has(cp)) return prev;
                const next = new Set(prev);
                next.add(cp);
                return next;
              });
            }
          }
        }
      },
      { root, threshold: 0.1 },
    );

    const sentinels = [checkpointStartRef.current, checkpointMidRef.current, checkpointEndRef.current];
    sentinels.forEach((el) => el && observer.observe(el));

    return () => observer.disconnect();
  }, [engagementComplete, agreement]);

  // ── Page Visibility API: pause timer when tab hidden ────────
  useEffect(() => {
    const handleVisChange = () => setIsPageVisible(!document.hidden);
    document.addEventListener("visibilitychange", handleVisChange);
    return () => document.removeEventListener("visibilitychange", handleVisChange);
  }, []);

  // ── Countdown timer (pauses when page not visible) ──────────
  useEffect(() => {
    if (engagementComplete || !agreement) return;

    if (!isPageVisible) {
      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current);
        timerIntervalRef.current = null;
      }
      lastTickRef.current = null;
      return;
    }

    // Resume / start — tick every 250 ms for a smooth countdown
    lastTickRef.current = Date.now();
    timerIntervalRef.current = setInterval(() => {
      const now = Date.now();
      const delta = (now - (lastTickRef.current ?? now)) / 1000;
      lastTickRef.current = now;
      elapsedRef.current += delta;
      const remaining = Math.max(0, MIN_READ_TIME_SEC - elapsedRef.current);
      setTimeRemaining(remaining);
    }, 250);

    return () => {
      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current);
        timerIntervalRef.current = null;
      }
    };
  }, [engagementComplete, agreement, isPageVisible]);

  // ── Derived gate values ─────────────────────────────────────
  const allCheckpointsSeen = checkpointsSeen.size === ALL_CHECKPOINTS.length;
  const timeLockSatisfied = timeRemaining <= 0;

  // ── Sync: mark engagement complete once both gates pass ─────
  useEffect(() => {
    if (engagementComplete) return;
    if (allCheckpointsSeen && timeLockSatisfied) {
      setEngagementComplete(true);
      try { sessionStorage.setItem(SCROLL_KEY, "true"); } catch { /* storage unavailable */ }
    }
  }, [allCheckpointsSeen, timeLockSatisfied, engagementComplete]);

  // ── PIN submit — calls record-agreement-signature (401-aware) ──
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = pin.trim();
    if (trimmed.length !== 6 || !/^\d{6}$/.test(trimmed)) return;
    if (!agreement) return;

    setSigning(true);
    setSignError(null);
    setSigningPhase("signing");

    try {
      const canonicalText = getCanonicalAgreementText(agreement);

      // Persist scroll state before the network call (defensive)
      try { sessionStorage.setItem(SCROLL_KEY, "true"); } catch {}

      const res = await fetchOps("/record-agreement-signature", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pin: trimmed,
          staff_id: staff.id,
          agreement_text: canonicalText,
          version_tag: versionTag,
        }),
      }, token, { skipAutoLogout: true });

      // ── 401 Recovery: session expired mid-signing ──────
      if (res.status === 401) {
        saveVault({
          version_tag: versionTag,
          canonical_text: canonicalText,
          staff_id: staff.id,
          timestamp: Date.now(),
        });
        setShowReauthModal(true);
        setReauthPin("");
        setReauthError(null);
        setSigning(false);
        setSigningPhase("idle");
        // Focus the re-auth input after modal renders
        setTimeout(() => reauthInputRef.current?.focus(), 100);
        return;
      }

      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: "Signature failed" }));
        throw new Error(body.error || `HTTP ${res.status}`);
      }

      const result: SignatureResult = await res.json();
      setSigned(true);
      setSignatureHash(result.sha256_hash);
      clearVault();
      try { sessionStorage.removeItem(SCROLL_KEY); } catch {}
      onSigned?.(result);
    } catch (err: unknown) {
      setSignError(err instanceof Error ? err.message : "Signature failed");
      setPin("");
    } finally {
      setSigning(false);
      setSigningPhase("idle");
    }
  };

  // ── PIN input: digits only, max 6 ──────────────────────────
  const handlePinChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value.replace(/\D/g, "").slice(0, 6);
    setPin(value);
  };

  // ── Re-auth modal: PIN change handler ──────────────────────
  const handleReauthPinChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value.replace(/\D/g, "").slice(0, 6);
    setReauthPin(value);
    if (reauthError) setReauthError(null);
  };

  // ── Re-auth modal: transparent retry flow ──────────────────
  const handleReauthSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = reauthPin.trim();
    if (trimmed.length !== 6 || !/^\d{6}$/.test(trimmed)) return;

    setReauthLoading(true);
    setReauthError(null);
    setSigningPhase("verifying");

    try {
      // Step 1: Re-authenticate via pin-login (sets new HttpOnly cookie)
      const loginRes = await fetch(`${OPS_API_BASE}/pin-login`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-BrewHub-Action": "true",
        },
        credentials: "include",
        body: JSON.stringify({ pin: trimmed }),
      });

      const loginData = await loginRes.json();

      if (!loginRes.ok) {
        if (loginData.error === "TOTP_REQUIRED") {
          setReauthError("Your account requires 2FA. Please return to the main login screen.");
          setSigningPhase("idle");
          return;
        }
        setReauthError(loginData.error || "Invalid PIN");
        setReauthPin("");
        setSigningPhase("idle");
        return;
      }

      const newToken: string = loginData.token;

      // Step 2: Retrieve vault and retry signature
      setSigningPhase("retrying");

      const vault = loadVault();
      if (!vault) {
        setReauthError("Recovery data expired. Please dismiss and try signing again.");
        setSigningPhase("idle");
        return;
      }

      const retryRes = await fetchOps("/record-agreement-signature", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pin: trimmed,
          staff_id: vault.staff_id,
          agreement_text: vault.canonical_text,
          version_tag: vault.version_tag,
        }),
      }, newToken, { skipAutoLogout: true });

      if (!retryRes.ok) {
        const body = await retryRes.json().catch(() => ({ error: "Signature failed" }));
        throw new Error(body.error || `Retry failed (HTTP ${retryRes.status})`);
      }

      const result: SignatureResult = await retryRes.json();

      // Step 3: Sync parent session context with the new cookie
      await refreshSession().catch(() => {});

      // Step 4: Success — clean up and proceed
      clearVault();
      try { sessionStorage.removeItem(SCROLL_KEY); } catch {}
      setShowReauthModal(false);
      setSigned(true);
      setSignatureHash(result.sha256_hash);
      onSigned?.(result);
    } catch (err: unknown) {
      setReauthError(err instanceof Error ? err.message : "Recovery failed");
      setReauthPin("");
    } finally {
      setReauthLoading(false);
      setSigningPhase("idle");
    }
  };

  const handleReauthDismiss = () => {
    setShowReauthModal(false);
    setReauthPin("");
    setReauthError(null);
    setSigningPhase("idle");
    // Vault remains in localStorage so user can retry from the main form
  };

  // ── Render ──────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="animate-spin h-8 w-8 border-4 border-amber-600 border-t-transparent rounded-full" />
        <span className="ml-3 text-gray-600">Loading agreement…</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-red-300 bg-red-50 p-6 text-center">
        <p className="text-red-700 font-medium">Unable to load agreement</p>
        <p className="text-red-500 text-sm mt-1">{error}</p>
      </div>
    );
  }

  if (signed) {
    return (
      <div className="flex flex-col items-center gap-4 max-w-3xl mx-auto py-12">
        <div className="h-16 w-16 rounded-full bg-green-100 flex items-center justify-center">
          <span className="text-3xl">✓</span>
        </div>
        <h2 className="text-xl font-bold text-green-800">Agreement Signed</h2>
        <p className="text-gray-600 text-sm text-center max-w-md">
          Your digital signature has been recorded. A copy has been sent to management for their records.
        </p>
        {signatureHash && (
          <p className="text-xs text-gray-400 font-mono break-all max-w-md text-center">
            SHA-256: {signatureHash}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 max-w-3xl mx-auto">
      {/* ── Agreement text with checkpoint sentinels ──────── */}
      <div
        ref={scrollRef}
        className="h-[60vh] overflow-y-auto rounded-lg border border-gray-300 bg-white p-6 shadow-inner"
      >
        {/* Checkpoint: START */}
        <div ref={checkpointStartRef} data-checkpoint="start" aria-hidden="true" className="h-px" />

        {agreementSections && (
          <>
            <pre className="whitespace-pre-wrap font-mono text-sm leading-relaxed text-gray-800">
              {agreementSections.firstHalf}
            </pre>

            {/* Checkpoint: MIDDLE */}
            <div ref={checkpointMidRef} data-checkpoint="middle" aria-hidden="true" className="h-px" />

            <pre className="whitespace-pre-wrap font-mono text-sm leading-relaxed text-gray-800">
              {agreementSections.secondHalf}
            </pre>
          </>
        )}

        {/* Checkpoint: END */}
        <div ref={checkpointEndRef} data-checkpoint="end" aria-hidden="true" className="h-px" />
      </div>

      {/* ── Engagement feedback / countdown ──────────────── */}
      {!engagementComplete && (
        <div className="flex flex-col items-center gap-1.5 text-sm">
          {!allCheckpointsSeen && (
            <p className="text-amber-700 font-medium animate-pulse">
              ↓ Scroll through the full agreement to continue ↓
            </p>
          )}
          {allCheckpointsSeen && timeRemaining > 0 && (
            <p className="text-amber-700 font-medium">
              ✓ Scrolled — finishing review…
            </p>
          )}
          {timeRemaining > 0 && (
            <p className="text-amber-600 font-semibold tabular-nums">
              Please review the terms… {Math.ceil(timeRemaining)}s remaining
            </p>
          )}
          {/* Checkpoint progress dots */}
          <div className="flex gap-2 mt-1" aria-label="Reading progress">
            {ALL_CHECKPOINTS.map((cp) => (
              <span
                key={cp}
                className={`h-2.5 w-2.5 rounded-full transition-colors ${
                  checkpointsSeen.has(cp) ? "bg-green-500" : "bg-gray-300"
                }`}
                title={`Section: ${cp}`}
              />
            ))}
          </div>
        </div>
      )}

      {/* ── PIN signing form (unlocked after engagement) ──── */}
      {engagementComplete && (
        <form onSubmit={handleSubmit} className="flex flex-col items-center gap-3">
          <p className="text-green-700 font-medium text-sm">
            ✓ You have reviewed the full agreement
          </p>

          {signError && (
            <p className="text-red-600 text-sm font-medium bg-red-50 px-4 py-2 rounded-lg">
              {signError}
            </p>
          )}

          <label htmlFor="sign-pin" className="text-sm font-medium text-gray-700">
            Enter your 6-digit PIN to digitally sign
          </label>

          <input
            id="sign-pin"
            type="password"
            inputMode="numeric"
            autoComplete="off"
            maxLength={6}
            value={pin}
            onChange={handlePinChange}
            placeholder="••••••"
            className="w-40 text-center text-2xl tracking-[0.3em] border border-gray-300 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-amber-500"
            disabled={signing}
          />

          <button
            type="submit"
            disabled={pin.length !== 6 || signing}
            className="px-6 py-2 rounded-lg font-semibold text-white bg-amber-600 hover:bg-amber-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {signing
              ? signingPhase === "retrying"
                ? "Verifying & Sealing…"
                : "Signing…"
              : "Sign Agreement"}
          </button>
        </form>
      )}

      {/* ── Re-auth Recovery Modal (401 mid-flow) ──────── */}
      {showReauthModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm mx-4 p-6">
            <div className="flex flex-col items-center gap-4">
              {/* Lock icon */}
              <div className="h-12 w-12 rounded-full bg-amber-100 flex items-center justify-center">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                </svg>
              </div>

              {/* Title & explanation */}
              <h3 className="text-lg font-bold text-gray-900">Session Expired</h3>
              <p className="text-sm text-gray-600 text-center leading-relaxed">
                Your session timed out during signing. Re-enter your 6-digit PIN to
                continue&nbsp;&mdash;&nbsp;your progress has been saved.
              </p>

              {/* Error display */}
              {reauthError && (
                <p className="text-red-600 text-sm font-medium bg-red-50 px-4 py-2 rounded-lg w-full text-center">
                  {reauthError}
                </p>
              )}

              {/* PIN form */}
              <form onSubmit={handleReauthSubmit} className="flex flex-col items-center gap-3 w-full">
                <input
                  ref={reauthInputRef}
                  type="password"
                  inputMode="numeric"
                  autoComplete="off"
                  maxLength={6}
                  value={reauthPin}
                  onChange={handleReauthPinChange}
                  placeholder="••••••"
                  disabled={reauthLoading}
                  className="w-40 text-center text-2xl tracking-[0.3em] border border-gray-300 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-amber-500 disabled:opacity-50"
                />

                <button
                  type="submit"
                  disabled={reauthPin.length !== 6 || reauthLoading}
                  className="w-full px-6 py-2.5 rounded-lg font-semibold text-white bg-amber-600 hover:bg-amber-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {reauthLoading
                    ? signingPhase === "retrying"
                      ? "Verifying & Sealing…"
                      : "Verifying…"
                    : "Re-authenticate & Sign"}
                </button>

                <button
                  type="button"
                  onClick={handleReauthDismiss}
                  disabled={reauthLoading}
                  className="text-sm text-gray-500 hover:text-gray-700 disabled:opacity-50 transition-colors"
                >
                  Cancel
                </button>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
