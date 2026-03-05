"use client";

/**
 * /staff-hub/onboarding — Onboarding page for unsigned staff.
 *
 * Displays the AgreementViewer component (scroll-to-sign flow).
 * Once the employee signs, triggers a session refresh so the
 * onboarding_complete flag updates to true, automatically
 * unlocking the rest of the app via OpsGate.
 */

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { useOpsSession } from "@/components/OpsGate";
import AgreementViewer from "@/components/AgreementViewer";
import { CURRENT_AGREEMENT_VERSION } from "@/lib/agreement-constants";
import { CheckCircle2 } from "lucide-react";

export default function OnboardingPage() {
  const { staff, refreshSession } = useOpsSession();
  const router = useRouter();
  const [completed, setCompleted] = useState(false);

  const handleSigned = useCallback(
    async (result: { success: boolean; signature_id: string | null; sha256_hash: string }) => {
      if (!result.success) return;

      setCompleted(true);

      // Refresh the PIN session — pin-verify will now return
      // onboarding_complete: true, which unlocks OpsGate.
      try {
        await refreshSession();
      } catch {
        // If refresh fails, fall back to a full page reload
        // which re-runs verifySession on mount.
        window.location.href = "/staff-hub";
        return;
      }

      // Navigate to the appropriate landing page
      const role = (staff.role || "").toLowerCase();
      const landingPage = role === "manager" || role === "admin" ? "/manager" : "/staff-hub";
      router.replace(landingPage);
    },
    [refreshSession, staff.role, router],
  );

  if (completed) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-4 text-center"
        style={{ background: "linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)" }}
      >
        <div className="h-16 w-16 rounded-full bg-green-900/50 flex items-center justify-center mb-4">
          <CheckCircle2 className="w-8 h-8 text-green-400" />
        </div>
        <h1 className="text-2xl font-bold text-white mb-2">Welcome to BrewHub!</h1>
        <p className="text-zinc-400 text-sm max-w-md">
          Your agreement has been signed. Redirecting you to the staff portal…
        </p>
      </div>
    );
  }

  return (
    <div
      className="min-h-screen flex flex-col"
      style={{ background: "linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)" }}
    >
      {/* Header */}
      <header
        className="flex items-center justify-between px-8 py-4 border-b border-white/10"
        style={{ background: "rgba(0,0,0,0.3)" }}
      >
        <div className="text-2xl font-bold text-white">
          Brew<span className="text-amber-400">Hub</span>{" "}
          <span className="text-base font-normal text-zinc-400">Onboarding</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm text-stone-400">{staff.name || staff.email}</span>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 p-6 md:p-10">
        <div className="max-w-3xl mx-auto">
          <h1 className="text-2xl font-bold text-white mb-2">Mutual Working Agreement</h1>
          <p className="text-zinc-400 text-sm mb-6">
            Please read the full agreement below. Once you&apos;ve scrolled to the bottom, you can sign with your PIN.
          </p>

          <AgreementViewer versionTag={CURRENT_AGREEMENT_VERSION} onSigned={handleSigned} />
        </div>
      </main>
    </div>
  );
}
