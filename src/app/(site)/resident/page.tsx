"use client";
import Link from "next/link";
import { useState, useRef } from "react";
import { supabase } from "@/lib/supabase";

const MAX_NAME = 100;
const MAX_UNIT = 20;
const MAX_EMAIL = 254;
const MAX_PHONE = 20;
const MAX_PASSWORD = 128;
const MIN_FORM_TIME_MS = 2000; // bot timing guard

export default function ResidentRegisterPage() {
  const [form, setForm] = useState({
    name: "",
    unit: "",
    email: "",
    password: "",
    confirm: "",
    phone: "",
    sms: false,
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const formLoadedAt = useRef(Date.now());

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSuccess(false);
    if (!form.name || !form.unit || !form.email || !form.password || !form.confirm) {
      setError("Please fill in all required fields.");
      return;
    }
    if (form.password !== form.confirm) {
      setError("Passwords do not match.");
      return;
    }
    // Bot timing guard
    if (Date.now() - formLoadedAt.current < MIN_FORM_TIME_MS) {
      setError("Please slow down and try again.");
      return;
    }
    setLoading(true);

    // Cap inputs
    const safeName = form.name.slice(0, MAX_NAME);
    const safeUnit = form.unit.slice(0, MAX_UNIT);
    const safeEmail = form.email.slice(0, MAX_EMAIL);
    const safePhone = form.phone.slice(0, MAX_PHONE);
    const safePassword = form.password.slice(0, MAX_PASSWORD);

    // 1. Register user with Supabase Auth
    const { data, error: signUpError } = await supabase.auth.signUp({
      email: safeEmail,
      password: safePassword,
      options: {
        data: { full_name: safeName, unit_number: safeUnit, phone: safePhone }
      }
    });
    if (signUpError) {
      console.error("Resident signup error:", signUpError.message);
      const raw = signUpError.message.toLowerCase();
      if (raw.includes("already registered") || raw.includes("user already exists")) {
        setError("An account with this email already exists. Please sign in from the portal.");
      } else {
        setError("Registration failed. Please try again.");
      }
      setLoading(false);
      return;
    }
    // 2. Add to residents table
    const { error: residentError } = await supabase.from("residents").insert({
      name: safeName,
      unit_number: safeUnit,
      email: safeEmail,
      phone: safePhone
    });
    if (residentError) {
      console.error("Resident insert error:", residentError.message);
      if (residentError.code === "23505") {
        setError("This email or unit is already registered. Please sign in from the portal.");
      } else {
        setError("Registration failed. Please try again.");
      }
      setLoading(false);
      return;
    }
    setSuccess(true);
    setLoading(false);
  }

  return (
    <main className="max-w-lg mx-auto px-4 py-10 text-stone-900 bg-white rounded-md shadow-md">
      <Link href="/" className="inline-block mb-6 text-stone-500 hover:text-stone-900">← Back to BrewHub</Link>
      <div className="bg-white p-6 rounded shadow-md">
        <h1 className="font-playfair text-2xl mb-4">Register for package tracking & coffee rewards.</h1>
        {success ? (
          <div className="bg-green-100 text-green-800 p-4 rounded mb-4">Registration successful! Please check your email to verify your account.</div>
        ) : (
          <>
            {error ? (
              <div role="alert" className="bg-red-100 text-red-800 p-4 rounded mb-4">{error}</div>
            ) : null}
            <form onSubmit={handleRegister}>
              <input type="text" placeholder="Full Name *" required maxLength={MAX_NAME} className="w-full p-3 mb-2 min-h-[44px] border border-stone-200 rounded" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value.slice(0, MAX_NAME) }))} />
              <input type="text" placeholder="Unit # or Address *" required maxLength={MAX_UNIT} className="w-full p-3 mb-2 min-h-[44px] border border-stone-200 rounded" value={form.unit} onChange={e => setForm(f => ({ ...f, unit: e.target.value.slice(0, MAX_UNIT) }))} />
              <input type="email" placeholder="Email *" required maxLength={MAX_EMAIL} className="w-full p-3 mb-2 min-h-[44px] border border-stone-200 rounded" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value.slice(0, MAX_EMAIL) }))} />
              <input type="password" placeholder="Password (min 6 characters) *" required maxLength={MAX_PASSWORD} className="w-full p-3 mb-2 min-h-[44px] border border-stone-200 rounded" value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value.slice(0, MAX_PASSWORD) }))} />
              <input type="password" placeholder="Confirm Password *" required maxLength={MAX_PASSWORD} className="w-full p-3 mb-2 min-h-[44px] border border-stone-200 rounded" value={form.confirm} onChange={e => setForm(f => ({ ...f, confirm: e.target.value.slice(0, MAX_PASSWORD) }))} />
              <input type="tel" placeholder="Phone (optional - for text alerts)" maxLength={MAX_PHONE} className="w-full p-3 mb-2 min-h-[44px] border border-stone-200 rounded" value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value.slice(0, MAX_PHONE) }))} />
              <div className="flex items-start gap-2 mb-2">
            <input type="checkbox" id="sms-consent" required className="mt-1" checked={form.sms} onChange={e => setForm(f => ({ ...f, sms: e.target.checked }))} />
            <label htmlFor="sms-consent" className="text-xs text-stone-700">
              I agree to receive SMS notifications about my packages from BrewHub PHL. Message frequency varies. Msg & data rates may apply. Reply STOP to unsubscribe.
            </label>
          </div>
              <p className="text-xs text-stone-400 mb-4">
            By registering, you agree to our
            <Link href="/terms" target="_blank" className="underline ml-1">Terms & Conditions</Link>
            and
            <Link href="/privacy" target="_blank" className="underline ml-1">Privacy Policy</Link>.
          </p>
              <button type="submit" className="w-full bg-stone-900 text-white py-3 min-h-[44px] rounded font-bold mb-2" disabled={loading}>{loading ? "Registering..." : "Register"}</button>
            </form>
            <div className="text-xs text-stone-500 mt-2">Already have an account? <Link href="/portal" className="underline">Log in</Link></div>
          </>
        )}
      </div>
    </main>
  );
}
