// src/app/(ops)/layout.tsx
import OpsGate from "@/components/OpsGate";

export default function OpsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-black text-white antialiased overflow-hidden">
      {/* PIN-gated: all ops pages require 6-digit staff PIN */}
      <OpsGate>{children}</OpsGate>
    </div>
  );
}