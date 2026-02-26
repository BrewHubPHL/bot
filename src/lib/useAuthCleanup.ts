"use client";

/**
 * useAuthCleanup — wipes session-sensitive localStorage on auth changes
 *
 * Listens to Supabase `onAuthStateChange` and clears customer-facing
 * persisted carts when a user signs out. Prevents "session bleed" where
 * Customer B inherits Customer A's half-built cart on a shared device.
 *
 * Also clears carts on `SIGNED_IN` to ensure a fresh start when a new
 * user logs in (covers the case where sign-out was missed / tab closed).
 *
 * Doomsday Scenario 8: THE IDENTITY CRISIS
 */

import { useEffect } from "react";
import { supabase } from "@/lib/supabase";

/** All localStorage keys that hold session-sensitive customer data */
const SESSION_KEYS = [
  "brewhub_cart",       // merch shop cart (ShopClient.tsx / checkout/page.tsx)
  "brewhub_cafe_cart",  // café ordering cart (cafe/page.tsx)
  "brewhub_email",      // pre-filled email on landing page
] as const;

function clearSessionStorage() {
  for (const key of SESSION_KEYS) {
    try {
      localStorage.removeItem(key);
    } catch {
      // Storage unavailable (private browsing quota, etc.)
    }
  }
}

/**
 * Call this hook once near the app root (e.g. in a layout or provider).
 * It subscribes to Supabase auth events and returns nothing.
 */
export function useAuthCleanup(): void {
  useEffect(() => {
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") {
        clearSessionStorage();
      }
      // On SIGNED_IN with a different user, also clear to prevent bleed
      if (event === "SIGNED_IN") {
        clearSessionStorage();
      }
    });

    return () => subscription.unsubscribe();
  }, []);
}

export default useAuthCleanup;
