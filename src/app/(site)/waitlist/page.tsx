"use client";
import Link from "next/link";
import { useState } from "react";
import { supabase } from "@/lib/supabase";

export default function WaitlistPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSuccess(false);
    if (!email) {
      setError("Please enter your email.");
      return;
    }
    setLoading(true);
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
