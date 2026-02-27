/**
 * useParcelSync — Supabase Realtime Broadcast hook for iPhone ↔ iPad
 * parcel-intake synchronisation.
 *
 * Uses `supabase.channel('parcel_sync')` with Broadcast (no DB writes)
 * for sub-100ms latency between the iPhone Scanner and iPad Command Center.
 *
 * Message types:
 *   'tracking' — iPhone scanned a barcode → { tracking, carrier }
 *   'unit'     — iPhone typed a digit     → { unit }
 *   'submit'   — iPhone hit CHECK IN      → { tracking, carrier, unit, resident }
 *   'result'   — iPad confirms or denies  → { success, error? }
 *   'duplicate' — Duplicate scan detected  → { tracking, carrier, unit }
 */

import { useEffect, useRef, useCallback, useState } from "react";
import { supabase } from "@/lib/supabase";
import type { RealtimeChannel } from "@supabase/supabase-js";

/* ─── Broadcast event types ─────────────────────────────────── */
export type ParcelSyncEvent =
  | { type: "tracking"; tracking: string; carrier: string; seq: number }
  | { type: "unit"; unit: string; seq: number }
  | { type: "submit"; tracking: string; carrier: string; unit: string; residentName: string | null; residentId: string | null }
  | { type: "result"; success: boolean; error?: string; parcelId?: string }
  | { type: "duplicate"; tracking: string; carrier: string; unit: string };

export interface ParcelSyncHandlers {
  onTracking?: (tracking: string, carrier: string, seq: number) => void;
  onUnit?: (unit: string, seq: number) => void;
  onSubmit?: (data: { tracking: string; carrier: string; unit: string; residentName: string | null; residentId: string | null }) => void;
  onResult?: (data: { success: boolean; error?: string; parcelId?: string }) => void;
  onDuplicate?: (data: { tracking: string; carrier: string; unit: string }) => void;
}

const CHANNEL_NAME = "parcel_sync";

export function useParcelSync(handlers: ParcelSyncHandlers) {
  const channelRef = useRef<RealtimeChannel | null>(null);
  const handlersRef = useRef(handlers);
  const [connected, setConnected] = useState(false);

  /** Monotonically-incrementing sequence counter for keystroke ordering */
  const seqRef = useRef(0);

  // Keep handlers ref current
  handlersRef.current = handlers;

  /* ─── Subscribe ──────────────────────────────────────────────── */
  useEffect(() => {
    const channel = supabase.channel(CHANNEL_NAME, {
      config: { broadcast: { self: false } },
    });

    channel
      .on("broadcast", { event: "tracking" }, ({ payload }) => {
        handlersRef.current.onTracking?.(payload.tracking, payload.carrier, payload.seq ?? 0);
      })
      .on("broadcast", { event: "unit" }, ({ payload }) => {
        handlersRef.current.onUnit?.(payload.unit, payload.seq ?? 0);
      })
      .on("broadcast", { event: "submit" }, ({ payload }) => {
        handlersRef.current.onSubmit?.(payload);
      })
      .on("broadcast", { event: "result" }, ({ payload }) => {
        handlersRef.current.onResult?.(payload);
      })
      .on("broadcast", { event: "duplicate" }, ({ payload }) => {
        handlersRef.current.onDuplicate?.(payload);
      })
      .subscribe((status) => {
        setConnected(status === "SUBSCRIBED");
      });

    channelRef.current = channel;

    return () => {
      channel.unsubscribe();
      channelRef.current = null;
      setConnected(false);
    };
  }, []);

  /* ─── Send helpers ───────────────────────────────────────────── */
  const sendTracking = useCallback((tracking: string, carrier: string) => {
    const seq = ++seqRef.current;
    channelRef.current?.send({
      type: "broadcast",
      event: "tracking",
      payload: { tracking, carrier, seq },
    });
  }, []);

  const sendUnit = useCallback((unit: string) => {
    const seq = ++seqRef.current;
    channelRef.current?.send({
      type: "broadcast",
      event: "unit",
      payload: { unit, seq },
    });
  }, []);

  const sendSubmit = useCallback(
    (data: { tracking: string; carrier: string; unit: string; residentName: string | null; residentId: string | null }) => {
      channelRef.current?.send({
        type: "broadcast",
        event: "submit",
        payload: data,
      });
    },
    [],
  );

  const sendResult = useCallback(
    (data: { success: boolean; error?: string; parcelId?: string }) => {
      channelRef.current?.send({
        type: "broadcast",
        event: "result",
        payload: data,
      });
    },
    [],
  );

  const sendDuplicate = useCallback(
    (data: { tracking: string; carrier: string; unit: string }) => {
      channelRef.current?.send({
        type: "broadcast",
        event: "duplicate",
        payload: data,
      });
    },
    [],
  );

  return {
    connected,
    sendTracking,
    sendUnit,
    sendSubmit,
    sendResult,
    sendDuplicate,
  };
}
