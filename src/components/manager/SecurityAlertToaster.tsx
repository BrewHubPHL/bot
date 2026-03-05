"use client";

import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { useOpsSessionOptional } from "@/components/OpsGate";
import type { RealtimeChannel } from "@supabase/supabase-js";

/**
 * SecurityAlertToaster — Realtime rate-limit alert toaster for the Manager Dashboard.
 *
 * Subscribes to Postgres INSERT events on `manager_override_log` where
 * `action_type = 'rate_limit_triggered'`. Fires a high-priority Sonner toast
 * with the redacted IP hash and source function name.
 *
 * Only activates when the user has a valid staff_pin session (OpsSession).
 */
export default function SecurityAlertToaster() {
  const session = useOpsSessionOptional();
  const channelRef = useRef<RealtimeChannel | null>(null);

  useEffect(() => {
    // Guard: only subscribe when an authenticated ops session exists
    if (!session?.token) return;

    const channel = supabase
      .channel("security-rate-limit-alerts")
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "manager_override_log",
          filter: "action_type=eq.rate_limit_triggered",
        },
        (payload) => {
          const row = payload.new as {
            ip_address?: string;
            target_entity?: string;
            details?: Record<string, unknown>;
            created_at?: string;
          };

          const ip = row.ip_address
            ? `${row.ip_address.slice(0, 12)}…`
            : "unknown";
          const source = row.target_entity || "unknown function";

          toast.error("Rate Limit Triggered", {
            description: `IP ${ip} — ${source}`,
            duration: 12_000,
          });
        }
      )
      .subscribe();

    channelRef.current = channel;

    return () => {
      supabase.removeChannel(channel);
      channelRef.current = null;
    };
  }, [session?.token]);

  // Don't render anything without a session
  if (!session?.token) return null;

  return null;
}
