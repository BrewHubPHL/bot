"use client";

/**
 * AuthCleanupProvider — thin client-side wrapper that activates
 * session-cleanup listeners (Supabase auth state → localStorage wipe).
 *
 * Mounted once in RootLayout. Renders children transparently.
 *
 * Doomsday Scenario 8: THE IDENTITY CRISIS
 */

import { useAuthCleanup } from "@/lib/useAuthCleanup";

export default function AuthCleanupProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  useAuthCleanup();
  return <>{children}</>;
}
