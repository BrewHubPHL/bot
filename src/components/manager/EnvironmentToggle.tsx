"use client";

import { useState, useCallback, type ReactNode } from "react";
import { ShieldAlert, FlaskConical, Factory } from "lucide-react";

/* ─── Types ────────────────────────────────────────────── */
export type DataEnv = "simulation" | "production";

interface EnvironmentToggleProps {
  activeEnv: DataEnv;
  onEnvChange: (env: DataEnv) => void;
}

/* ─── Confirmation Modal ───────────────────────────────── */
function ConfirmProductionModal({
  onConfirm,
  onCancel,
}: {
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-stone-900 border border-amber-600/40 rounded-2xl p-6 max-w-sm mx-4 shadow-2xl">
        <div className="flex items-center gap-3 mb-4">
          <ShieldAlert className="h-6 w-6 text-amber-400 shrink-0" />
          <h3 className="text-lg font-bold text-white">Switch to Production?</h3>
        </div>
        <p className="text-stone-300 text-sm leading-relaxed mb-6">
          You are about to view <strong className="text-emerald-400">live production data</strong>.
          Any items created or promoted in this view affect real accounting and stock alerts.
        </p>
        <div className="flex gap-3">
          <button
            onClick={onCancel}
            className="flex-1 px-4 py-2.5 rounded-xl bg-stone-800 text-stone-300 text-sm font-medium hover:bg-stone-700 transition-colors"
          >
            Stay in Simulation
          </button>
          <button
            onClick={onConfirm}
            className="flex-1 px-4 py-2.5 rounded-xl bg-emerald-600 text-white text-sm font-bold hover:bg-emerald-500 transition-colors"
          >
            View Production
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─── Environment Toggle ───────────────────────────────── */
export default function EnvironmentToggle({ activeEnv, onEnvChange }: EnvironmentToggleProps) {
  const [showConfirm, setShowConfirm] = useState(false);

  const handleToggle = useCallback(() => {
    if (activeEnv === "simulation") {
      // Switching TO production → require confirmation
      setShowConfirm(true);
    } else {
      // Switching TO simulation → always safe
      onEnvChange("simulation");
    }
  }, [activeEnv, onEnvChange]);

  const confirmProduction = useCallback(() => {
    setShowConfirm(false);
    onEnvChange("production");
  }, [onEnvChange]);

  const isSim = activeEnv === "simulation";

  return (
    <>
      <button
        onClick={handleToggle}
        className={`
          inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full text-xs font-bold
          tracking-wide uppercase transition-all duration-200
          ${isSim
            ? "bg-amber-500/15 text-amber-400 border border-amber-500/30 hover:bg-amber-500/25"
            : "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/25"
          }
        `}
        title={`Currently viewing ${activeEnv} data. Click to switch.`}
      >
        {isSim ? (
          <FlaskConical className="h-3.5 w-3.5" />
        ) : (
          <Factory className="h-3.5 w-3.5" />
        )}
        {activeEnv}
      </button>

      {showConfirm && (
        <ConfirmProductionModal
          onConfirm={confirmProduction}
          onCancel={() => setShowConfirm(false)}
        />
      )}
    </>
  );
}
