"use client";

import { useState, useEffect } from 'react';
import { useOpsSession } from '@/components/OpsGate';
import { useConnection } from '@/lib/useConnection';
import OfflineBanner from '@/components/OfflineBanner';
import { KdsGrid } from '@/components/KdsGrid';
import type { KdsGridState } from '@/components/KdsGrid';

function getAccessToken(): string | null {
  try {
    const raw = sessionStorage.getItem("ops_session");
    if (!raw) return null;
    return JSON.parse(raw)?.token ?? null;
  } catch { return null; }
}

/* â”€â”€ Page â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
export default function KDS() {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const session = useOpsSession();
  const { isOnline, wasOffline, offlineSince } = useConnection();

  const [clock, setClock]           = useState<string>("");
  const [ordersLen, setOrdersLen]   = useState(0);
  const [kdsSource, setKdsSource]   = useState<"live" | "cached">("live");
  const [error, setError]           = useState<string | null>(null);

  // Tick the clock every second
  useEffect(() => {
    const tick = () => setClock(new Date().toLocaleTimeString());
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, []);

  function handleStateChange({ orders, source, error: err }: KdsGridState) {
    setOrdersLen(orders.length);
    setKdsSource(source);
    setError(err);
  }

  return (
    <main className="min-h-screen bg-stone-950 p-6 md:p-10" aria-label="Kitchen Display System">
      <OfflineBanner isOnline={isOnline} wasOffline={wasOffline} offlineSince={offlineSince} />

      <header className="flex flex-wrap justify-between items-end mb-8 md:mb-12 border-b-2 border-stone-800 pb-6 md:pb-8 gap-4">
        <div>
          <h1 className="text-4xl md:text-6xl font-black font-playfair tracking-tighter uppercase italic text-white">
            BrewHub <span className="text-stone-500">KDS</span>
          </h1>
          <p className="text-sm font-mono text-stone-600 mt-2">
            {isOnline ? 'SYSTEM ONLINE' : 'âš  OFFLINE â€” SHOWING LAST KNOWN ORDERS'}
            {kdsSource === 'cached' && isOnline ? ' (cached)' : ''}
            {' // '}{clock || 'â€”'} // {ordersLen} active
          </p>
        </div>
        {error && (
          <p role="alert" className="text-red-400 font-mono text-sm bg-red-950 px-4 py-2 rounded">
            {error}
          </p>
        )}
      </header>

      <KdsGrid token={getAccessToken()} onStateChange={handleStateChange} />
    </main>
  );
}


