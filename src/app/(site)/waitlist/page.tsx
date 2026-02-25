"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";

const MIN_SUBMIT_MS = 2000; // reject submissions faster than 2 s after mount
const COOLDOWN_MS   = 10000; // 10 s cooldown between submissions

export default function WaitlistPage() {
  const [email, setEmail] = useState("");
  const [honeypot, setHoneypot] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  const mountTimeRef = useRef(Date.now());
  const lastSubmitRef = useRef(0);

  /* Capture mount timestamp for timing-based bot defense */
  useEffect(() => {
    mountTimeRef.current = Date.now();
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSuccess(false);

    // Bot defense: honeypot filled = silent reject
    if (honeypot) {
      setSuccess(true); // fake success so bots don't retry
      setEmail("");
      return;
    }

    // Bot defense: timing guard — reject if submitted too fast
    if (Date.now() - mountTimeRef.current < MIN_SUBMIT_MS) {
      setError("Please wait a moment before submitting.");
      return;
    }

    // Rate-limit: cooldown between submissions
    if (Date.now() - lastSubmitRef.current < COOLDOWN_MS) {
      setError("Please wait a few seconds before trying again.");
      return;
    }

    if (!email) {
      setError("Please enter your email.");
      return;
    }
    setLoading(true);
    lastSubmitRef.current = Date.now();
    const { error: insertError } = await supabase.from("waitlist").insert({ email });
    if (insertError) {
      const code = (insertError as { code?: string }).code;
      setError(
        code === "23505"
          ? "You're already on the list! Check your inbox."
          : "Something went wrong. Please try again."
      );
      setLoading(false);
      return;
    }
    setSuccess(true);
    setLoading(false);
    setEmail("");
  }

  return (
    <main className="max-w-md mx-auto px-4 py-10 text-stone-900 bg-white rounded-md shadow-md">
      <Link href="/" className="inline-block mb-6 text-stone-500 hover:text-stone-900">← Back to BrewHub</Link>
      <div className="bg-white p-6 rounded shadow-md">
        <h1 className="font-playfair text-2xl mb-4">Join the BrewHub Waitlist</h1>
        {success ? (
          <div className="bg-green-100 text-green-800 p-4 rounded mb-4">Thank you! You’ve been added to the waitlist.</div>
        ) : null}
        {error ? (
          <div role="alert" className="bg-red-100 text-red-800 p-4 rounded mb-4">{error}</div>
        ) : null}
        <form onSubmit={handleSubmit}>
          {/* ── Honeypot (invisible to humans) ────────────── */}
          <div
            aria-hidden="true"
            style={{ position: "absolute", left: "-5000px" }}
          >
            <label htmlFor="wl_company_name">Leave empty</label>
            <input
              id="wl_company_name"
              name="wl_company_name"
              type="text"
              tabIndex={-1}
              autoComplete="off"
              value={honeypot}
              onChange={(e) => setHoneypot(e.target.value)}
            />
          </div>
          <input
            type="email"
            placeholder="Your Email *"
            required
            className="w-full p-3 mb-4 min-h-[44px] border border-stone-200 rounded"
            value={email}
            onChange={e => setEmail(e.target.value)}
          />
          <button
            type="submit"
            className="w-full bg-stone-900 text-white py-3 min-h-[44px] rounded font-bold mb-2"
            disabled={loading}
          >
            {loading ? "Joining..." : "Join Waitlist"}
          </button>
        </form>
      </div>
    </main>
  );
}
