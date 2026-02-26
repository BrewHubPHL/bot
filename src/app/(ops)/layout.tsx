// src/app/(ops)/layout.tsx
import type { Metadata } from "next";
import OpsGate from "@/components/OpsGate";
import StaffNavigation from "@/components/StaffNavigation";
import ServiceWorkerRegistrar from "@/components/ServiceWorkerRegistrar";

export const metadata: Metadata = {
  icons: {
    icon: "/favicon.ico",
    apple: "/favicon.ico",
  },
};

export default function OpsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-stone-950 text-white antialiased overflow-hidden">
      {/* Register service worker for offline resilience */}
      <ServiceWorkerRegistrar />
      {/* PIN-gated: all ops pages require 6-digit staff PIN */}
      <OpsGate>
        {children}
        {/* Floating escape-hatch button — returns staff to their dashboard */}
        <StaffNavigation />
      </OpsGate>
    </div>
  );
}