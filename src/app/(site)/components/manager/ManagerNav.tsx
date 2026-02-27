"use client";

import Link from "next/link";
import type { LucideIcon } from "lucide-react";

export interface ManagerTab {
  key: string;
  label: string;
  icon: LucideIcon;
}

interface ManagerNavProps {
  tabs: ManagerTab[];
  activeTab: string;
  onTabChange: (key: string) => void;
}

/* ─────────────────────────────────────────────────────────────
   ManagerNav
   • Desktop (md+): horizontal tab strip rendered inside the
     sticky header of manager/page.tsx.
   • Mobile (<md):  fixed bottom tab bar with icon + label,
     rendered as a sibling to <main> in manager/page.tsx.
   Both variants are exported so page.tsx can render each in
   the correct slot without duplicating the TABS array.
───────────────────────────────────────────────────────────── */

/** Horizontal tab strip for the desktop header. */
export function DesktopTabNav({ tabs, activeTab, onTabChange }: ManagerNavProps) {
  return (
    <nav
      className="relative flex gap-1 overflow-x-auto pb-px scrollbar-hide -mb-px
                 [mask-image:linear-gradient(to_right,black_calc(100%-2rem),transparent)]
                 sm:[mask-image:none]"
      aria-label="Manager sections"
    >
      {tabs.map(({ key, label, icon: Icon }) => {
        const active = activeTab === key;
        return (
          <button
            key={key}
            type="button"
            onClick={() => onTabChange(key)}
            aria-current={active ? "page" : undefined}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium whitespace-nowrap
                        border-b-2 transition-colors focus-visible:outline-none
                        focus-visible:ring-2 focus-visible:ring-amber-500/60 ${
              active
                ? "border-amber-500 text-amber-400"
                : "border-transparent text-stone-500 hover:text-stone-300 hover:border-stone-700"
            }`}
          >
            <Icon size={16} aria-hidden="true" />
            {label}
          </button>
        );
      })}
    </nav>
  );
}

/** Fixed bottom tab bar for mobile. */
export function MobileBottomTabBar({ tabs, activeTab, onTabChange }: ManagerNavProps) {
  return (
    <nav
      className="fixed bottom-0 inset-x-0 z-50 md:hidden
                 bg-stone-950/95 backdrop-blur-md border-t border-stone-800
                 pb-safe"
      aria-label="Manager sections"
    >
      <div className="flex items-stretch h-16">
        {tabs.map(({ key, label, icon: Icon }) => {
          const active = activeTab === key;
          return (
            <button
              key={key}
              type="button"
              onClick={() => onTabChange(key)}
              aria-current={active ? "page" : undefined}
              className={`flex flex-1 flex-col items-center justify-center gap-0.5
                          text-[10px] font-medium tracking-wide transition-colors
                          focus-visible:outline-none focus-visible:ring-2
                          focus-visible:ring-inset focus-visible:ring-amber-500/60
                          active:bg-stone-800/60 ${
                active ? "text-amber-400" : "text-stone-500"
              }`}
            >
              <Icon
                size={22}
                strokeWidth={active ? 2.2 : 1.6}
                aria-hidden="true"
              />
              <span className="truncate max-w-full px-0.5">{label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}

/** @deprecated — use DesktopTabNav / MobileBottomTabBar directly. */
export default function ManagerNav() {
  return null;
}

/* ─── Quick links (shared) ── */
export function ManagerQuickLinks() {
  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 flex items-center gap-3 min-h-[44px] text-xs text-stone-500">
      <Link href="/pos"       className="min-h-[44px] inline-flex items-center hover:text-amber-400 transition-colors">POS</Link>
      <Link href="/kds"       className="min-h-[44px] inline-flex items-center hover:text-amber-400 transition-colors">KDS</Link>
      <Link href="/scanner"   className="min-h-[44px] inline-flex items-center hover:text-amber-400 transition-colors">Scanner</Link>
      <Link href="/staff-hub" className="min-h-[44px] inline-flex items-center hover:text-amber-400 transition-colors">Staff Hub</Link>
      <Link href="/manager/fulfillment" className="min-h-[44px] inline-flex items-center hover:text-amber-400 transition-colors">Fulfillment</Link>
      <Link href="/manager/calender"    className="min-h-[44px] inline-flex items-center hover:text-amber-400 transition-colors">Schedule</Link>
      <span className="text-stone-600" aria-hidden="true">|</span>
      <Link href="/"          className="min-h-[44px] inline-flex items-center hover:text-amber-400 transition-colors">Main Site</Link>
    </div>
  );
}
