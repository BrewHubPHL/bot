"use client";
import Link from "next/link";
import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";

export default function ParcelsPage() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [authChecking, setAuthChecking] = useState(true);

  // Require Supabase JWT — redirect unauthenticated users
  useEffect(() => {
    async function checkAuth() {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user?.email) {
        // Not authenticated — redirect to portal login
        window.location.href = "/portal?redirect=/parcels";
        return;
      }
      setUserEmail(session.user.email);
      setAuthChecking(false);
    }
    checkAuth();
  }, []);

  async function handleLookup(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setResults([]);
    if (!userEmail) {
      setError("You must be logged in to search parcels.");
      return;
    }
    setLoading(true);

    // Only search parcels belonging to the authenticated user's email
    const { data, error: fetchError } = await supabase
      .from("parcels")
      .select("id, tracking_number, carrier, recipient_name, unit_number, status, received_at, picked_up_at")
      .eq("recipient_email", userEmail)
      .order("received_at", { ascending: false })
      .limit(20);
    if (fetchError) {
      setError("Unable to load your parcels right now.");
    } else {
      setResults(data || []);
    }
    setLoading(false);
  }

  if (authChecking) {
    return (
      <main className="max-w-2xl mx-auto px-4 py-10 text-stone-900 bg-white rounded-md shadow-md">
        <p className="text-center text-stone-500 py-20">Verifying your identity…</p>
      </main>
    );
  }

  return (
    <main className="max-w-2xl mx-auto px-4 py-10 text-stone-900 bg-white rounded-md shadow-md">
      <header className="flex items-center justify-between mb-8 border-b pb-4">
        <div className="flex items-center gap-3 font-bold text-lg">
          <img src="/logo.png" alt="BrewHub PHL logo" className="h-9 w-9 rounded-full" />
          BrewHub PHL
        </div>
        <Link href="/" className="text-stone-500 hover:text-stone-900">Home</Link>
      </header>
      <h1 className="font-playfair text-2xl mb-4">Your Parcels</h1>
      <p className="mb-6 text-stone-600">Viewing parcels for <strong>{userEmail}</strong>. Pick up packages at BrewHub PHL in Point Breeze, South Philadelphia (19146).</p>
      <form onSubmit={handleLookup} className="mb-6">
        <button type="submit" className="bg-stone-900 text-white px-6 py-3 rounded font-bold w-full" disabled={loading}>
          {loading ? "Loading..." : "Load My Parcels"}
        </button>
      </form>
      {error && <div className="bg-red-100 text-red-800 p-3 rounded mb-4">{error}</div>}
      {results.length > 0 && (
        <div className="mb-6">
          <h2 className="font-bold mb-2">Your Parcels</h2>
          <div className="space-y-2">
            {results.map((p) => (
              <div key={p.id} className="bg-stone-50 border border-stone-200 rounded p-3 flex flex-col md:flex-row md:items-center md:justify-between">
                <div>
                  <div className="font-semibold">{p.tracking_number} <span className="text-xs text-stone-400">({p.carrier})</span></div>
                  <div className="text-xs text-stone-500">Recipient: {p.recipient_name} | Unit: {p.unit_number}</div>
                  <div className="text-xs text-stone-400">Received: {p.received_at ? new Date(p.received_at).toLocaleString() : "-"}</div>
                </div>
                <div className="mt-2 md:mt-0 text-xs font-bold uppercase px-3 py-1 rounded-full"
                  style={{ background: p.status === 'picked_up' ? '#d1fae5' : '#fef3c7', color: p.status === 'picked_up' ? '#065f46' : '#92400e' }}>
                  {p.status.replace(/_/g, ' ')}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      <footer className="mt-10 text-xs text-stone-400 uppercase">BrewHub PHL &bull; Point Breeze, Philadelphia</footer>
    </main>
  );
}
