"use client";

import type { AuthzErrorState } from "@/lib/authz";
import { Lock, ShieldAlert } from "lucide-react";

interface AuthzErrorStateProps {
  state: AuthzErrorState;
  onAction: () => void;
  className?: string;
}

export default function AuthzErrorStateCard({ state, onAction, className }: AuthzErrorStateProps) {
  const is401 = state.status === 401;

  return (
    <div className={`rounded-xl border px-5 py-4 ${is401 ? "border-amber-500/30 bg-amber-950/30" : "border-red-500/30 bg-red-950/25"} ${className ?? ""}`}>
      <div className="flex items-start gap-3">
        {is401 ? (
          <Lock className="mt-0.5 h-5 w-5 shrink-0 text-amber-400" />
        ) : (
          <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-red-400" />
        )}
        <div className="space-y-1">
          <h3 className="text-sm font-semibold text-white">{state.title}</h3>
          <p className="text-xs text-stone-300">{state.message}</p>
          <button
            type="button"
            onClick={onAction}
            className={`mt-2 inline-flex items-center rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${is401 ? "border-amber-500/40 text-amber-300 hover:bg-amber-500/10" : "border-red-500/40 text-red-300 hover:bg-red-500/10"}`}
          >
            {state.actionLabel}
          </button>
        </div>
      </div>
    </div>
  );
}