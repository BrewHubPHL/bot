"use client";

import { useState, useEffect } from "react";
import { useRouter, usePathname } from "next/navigation";
import { Home, X } from "lucide-react";
import { useOpsSessionOptional } from "@/components/OpsGate";

/**
 * StaffNavigation — a subtle floating "escape hatch" button
 * that returns ops staff to their role-appropriate dashboard.
 *
 * Drop into (ops)/layout.tsx as a child of <OpsGate>.
 * Auto-hides on the home-base page itself.
 */
export default function StaffNavigation() {
  const session = useOpsSessionOptional();
  const router = useRouter();
  const pathname = usePathname();
  const [dismissed, setDismissed] = useState(false);

  // Reset dismissed state when navigating to a new page
  useEffect(() => {
    setDismissed(false);
  }, [pathname]);

  if (!session) return null; // only show when authenticated

  const role = session.staff.role?.toLowerCase() ?? "";
  const homeBase =
    role === "manager" || role === "admin" || role === "owner"
      ? "/manager"
      : "/staff-hub";

  const homeLabel =
    role === "manager" || role === "admin" || role === "owner"
      ? "Manager Dashboard"
      : "Staff Hub";

  // Don't render on the home-base page itself
  if (pathname === homeBase) return null;

  // User dismissed it for this page
  if (dismissed) return null;

  return (
    <div className="fixed bottom-5 left-5 z-50 flex items-center gap-1.5 group">
      {/* Main home button */}
      <button
        onClick={() => router.push(homeBase)}
        aria-label={`Return to ${homeLabel}`}
        title={homeLabel}
        className="
          flex items-center justify-center
          w-11 h-11 rounded-full
          bg-zinc-800/70 backdrop-blur-md
          border border-zinc-700/50
          text-zinc-400 hover:text-amber-400
          hover:bg-zinc-700/80 hover:border-amber-500/40
          shadow-lg shadow-black/30
          transition-all duration-200 ease-out
          hover:scale-105 active:scale-95
        "
      >
        <Home className="w-5 h-5" />
      </button>

      {/* Tooltip label — appears on hover */}
      <span
        className="
          pointer-events-none
          max-w-0 overflow-hidden opacity-0
          group-hover:max-w-48 group-hover:opacity-100
          transition-all duration-300
          text-xs font-medium text-zinc-300
          bg-zinc-800/90 backdrop-blur-md
          border border-zinc-700/50
          rounded-lg px-3 py-1.5
          whitespace-nowrap shadow-lg
        "
      >
        ← {homeLabel}
      </span>

      {/* Dismiss 'x' — subtle, appears on hover */}
      <button
        onClick={() => setDismissed(true)}
        aria-label="Dismiss navigation button"
        className="
          pointer-events-none opacity-0
          group-hover:pointer-events-auto group-hover:opacity-60
          hover:!opacity-100
          transition-opacity duration-200
          text-zinc-500 hover:text-zinc-300
          w-5 h-5
        "
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
