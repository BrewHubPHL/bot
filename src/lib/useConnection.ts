"use client";

/**
 * useConnection.ts — React hook for network connectivity monitoring.
 *
 * Provides:
 * - isOnline: boolean (navigator.onLine + active heartbeat)
 * - wasOffline: boolean (true if we just recovered — triggers sync)
 * - offlineSince: Date | null (when connection was lost)
 *
 * The hook uses both browser events AND an active heartbeat (ping
 * to the health endpoint every 10s) because navigator.onLine lies
 * on iPads — it reports "online" even when the LAN has no internet.
 */

import { useState, useEffect, useRef, useCallback } from "react";

const HEARTBEAT_INTERVAL = 10_000; // 10 seconds
const HEARTBEAT_TIMEOUT = 5_000;   // 5s timeout per check
const HEALTH_URL = "/.netlify/functions/health";

export interface ConnectionState {
  isOnline: boolean;
  wasOffline: boolean;      // flips true for one render cycle after reconnection
  offlineSince: Date | null;
}

export function useConnection(): ConnectionState {
  const [isOnline, setIsOnline] = useState(true);
  const [wasOffline, setWasOffline] = useState(false);
  const [offlineSince, setOfflineSince] = useState<Date | null>(null);
  const prevOnline = useRef(true);

  const checkConnection = useCallback(async () => {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), HEARTBEAT_TIMEOUT);

      const resp = await fetch(HEALTH_URL, {
        method: "GET",
        cache: "no-store",
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (resp.ok) {
        setIsOnline(true);
        if (!prevOnline.current) {
          // Just came back online — signal recovery
          setWasOffline(true);
          setOfflineSince(null);
          setTimeout(() => setWasOffline(false), 100); // reset after one tick
        }
        prevOnline.current = true;
      } else {
        goOffline();
      }
    } catch {
      goOffline();
    }
  }, []);

  const goOffline = useCallback(() => {
    setIsOnline(false);
    if (prevOnline.current) {
      setOfflineSince(new Date());
    }
    prevOnline.current = false;
  }, []);

  useEffect(() => {
    // Browser events (fast but unreliable on iPad Wi-Fi)
    const handleOnline = () => checkConnection();
    const handleOffline = () => goOffline();

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    // Active heartbeat
    checkConnection();
    const interval = setInterval(checkConnection, HEARTBEAT_INTERVAL);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      clearInterval(interval);
    };
  }, [checkConnection, goOffline]);

  return { isOnline, wasOffline, offlineSince };
}
