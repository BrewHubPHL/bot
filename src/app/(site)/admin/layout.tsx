// src/app/(site)/admin/layout.tsx
// Manager-only gate for all /admin/* pages
import OpsGate from "@/components/OpsGate";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <OpsGate requireManager>
      {children}
    </OpsGate>
  );
}
