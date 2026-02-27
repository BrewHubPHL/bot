"use client";
import Link from "next/link";
import { useState, useRef, useEffect, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";

const MAX_NAME = 100;
const MAX_UNIT = 20;
const MAX_EMAIL = 254;
const MAX_PHONE = 20;
const MAX_PASSWORD = 128;
const MIN_FORM_TIME_MS = 2000; // bot timing guard

const API_BASE =
  typeof window !== "undefined" && window.location.hostname === "localhost"
    ? "http://localhost:8888/.netlify/functions"
    : "/.netlify/functions";

export default function ResidentRegisterPage() {
  return (
    <Suspense fallback={
      <main className="max-w-lg mx-auto px-4 py-10 text-stone-900 bg-white rounded-md shadow-md">
        <div className="bg-white p-6 rounded shadow-md animate-pulse">
          <div className="h-8 bg-stone-200 rounded w-3/4 mb-4" />
          <div className="space-y-3">{[...Array(5)].map((_, i) => <div key={i} className="h-12 bg-stone-100 rounded" />)}</div>
        </div>
      </main>
    }>
      <ResidentRegisterInner />
    </Suspense>
  );
}

function ResidentRegisterInner() {
  const searchParams = useSearchParams();

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
  const [prefilled, setPrefilled] = useState(false);
  const [inviteExpired, setInviteExpired] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const formLoadedAt = useRef(Date.now());

  /* ── Auto-populate unit & phone from URL params (invite link flow) ── */
  /* If the URL contains a `sig` param, verify it server-side before    */
  /* accepting the prefill. Unsigned URLs (no sig) are treated as       */
  /* manual navigation and show a blank form.                           */
  useEffect(() => {
    const urlUnit = searchParams.get("unit");
    const urlPhone = searchParams.get("phone");
    const urlExpires = searchParams.get("expires");
    const urlSig = searchParams.get("sig");

    // If there's a signature, verify it server-side
    if (urlSig && urlExpires) {
      setVerifying(true);

      fetch(`${API_BASE}/verify-invite`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          unit: urlUnit || "",
          phone: urlPhone || "",
          expires: urlExpires,
          sig: urlSig,
        }),
      })
        .then((res) => res.json())
        .then((data) => {
          if (data.valid) {
            // Signature valid — prefill form with verified params
            setForm((f) => ({
              ...f,
              unit: data.unit ? data.unit.slice(0, MAX_UNIT) : f.unit,
              phone: data.phone ? data.phone.slice(0, MAX_PHONE) : f.phone,
            }));
            setPrefilled(true);
          } else {
            // Signature invalid or expired — block prefill
            setInviteExpired(true);
            setError(data.reason || "This invite link is invalid or has expired.");
          }
        })
        .catch(() => {
          // Network error — don't prefill (fail secure)
          setInviteExpired(true);
          setError("Unable to verify invite link. Please try again or request a new one.");
        })
        .finally(() => setVerifying(false));
    } else if (urlUnit || urlPhone) {
      // No signature present — legacy/manual URL. Don't prefill phone/unit
      // from unsigned params to prevent parameter tampering attacks.
      // Show a blank form so the user can register normally.
    }
  }, [searchParams]);

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

    // ── Registration Guard: Check if phone number already exists ──
    // If a resident with this phone already exists (e.g. quick-added ghost),
    // redirect them to verify/login instead of creating a duplicate record.
    // Also blocks cross-unit phone conflicts to prevent identity hijacking.
    if (safePhone) {
      const { data: existingResident, error: lookupError } = await supabase
        .from("residents")
        .select("id, email, unit_number")
        .eq("phone", safePhone)
        .limit(1)
        .maybeSingle();
      if (lookupError) {
        console.error("Phone lookup error:", lookupError.message);
        // Non-fatal: continue with registration and let the DB constraint catch duplicates
      } else if (existingResident) {
        // ── Cross-unit conflict: phone belongs to a different unit ──
        if (
          existingResident.unit_number &&
          safeUnit &&
          existingResident.unit_number.trim().toLowerCase() !== safeUnit.trim().toLowerCase()
        ) {
          setError(
            "This phone number is already associated with a different unit. " +
            "Please contact building management at the front desk or email help@brewhubphl.com to resolve this."
          );
          setLoading(false);
          return;
        }

        // ── Same unit: existing registered user → redirect to login ──
        if (existingResident.email) {
          setError(
            "A resident with this phone number already exists. Please log in from the portal instead."
          );
          setLoading(false);
          return;
        }

        // ── Same unit: ghost record (no email) → allow registration to claim it ──
        // Fall through to the signUp + upsert flow below
      }
    }

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
    // 2. Upsert into residents table (ON CONFLICT phone → update unit_number)
    // This safely handles the case where a ghost record was quick-added by staff
    // and the resident is now completing full registration.
    const { error: residentError } = await supabase.from("residents").upsert(
      {
        name: safeName,
        unit_number: safeUnit,
        email: safeEmail,
        phone: safePhone,
      },
      { onConflict: "phone", ignoreDuplicates: false }
    );
    if (residentError) {
      console.error("Resident upsert error:", residentError.message);
      if (residentError.code === "23505") {
        setError("This email or phone is already registered. Please sign in from the portal.");
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
        {verifying && (
          <div className="bg-stone-50 text-stone-600 p-4 rounded mb-4 text-sm border border-stone-200 flex items-center gap-2">
            <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-stone-400 border-t-transparent" />
            Verifying your invite link…
          </div>
        )}
        {inviteExpired && (
          <div role="alert" className="bg-amber-50 text-amber-900 p-4 rounded mb-4 text-sm border border-amber-300">
            <p className="font-bold mb-1">Invite Expired</p>
            <p>{error || "This invite link is invalid or has expired."}</p>
            <p className="mt-2">Please ask the front desk to resend your package notification, or register manually below.</p>
          </div>
        )}
        {prefilled && !inviteExpired && (
          <div className="bg-blue-50 text-blue-800 p-4 rounded mb-4 text-sm border border-blue-200">
            📦 We&apos;ve pre-filled your unit and phone from the package notification. Just add your name, email, and a password to get started!
          </div>
        )}
        {success ? (
          <div className="bg-green-100 text-green-800 p-4 rounded mb-4">Registration successful! Please check your email to verify your account.</div>
        ) : (
          <>
            {error && !inviteExpired ? (
              <div role="alert" className="bg-red-100 text-red-800 p-4 rounded mb-4">{error}</div>
            ) : null}
            <form onSubmit={handleRegister}>
              <input type="text" placeholder="Full Name *" required maxLength={MAX_NAME} className="w-full p-3 mb-2 min-h-[44px] border border-stone-200 rounded" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value.slice(0, MAX_NAME) }))} />
              <input type="text" placeholder="Unit # or Address *" required maxLength={MAX_UNIT} className={`w-full p-3 mb-2 min-h-[44px] border rounded ${prefilled && form.unit ? 'border-blue-300 bg-blue-50/50' : 'border-stone-200'}`} value={form.unit} onChange={e => setForm(f => ({ ...f, unit: e.target.value.slice(0, MAX_UNIT) }))} />
              <input type="email" placeholder="Email *" required maxLength={MAX_EMAIL} className="w-full p-3 mb-2 min-h-[44px] border border-stone-200 rounded" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value.slice(0, MAX_EMAIL) }))} />
              <input type="password" placeholder="Password (min 6 characters) *" required maxLength={MAX_PASSWORD} className="w-full p-3 mb-2 min-h-[44px] border border-stone-200 rounded" value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value.slice(0, MAX_PASSWORD) }))} />
              <input type="password" placeholder="Confirm Password *" required maxLength={MAX_PASSWORD} className="w-full p-3 mb-2 min-h-[44px] border border-stone-200 rounded" value={form.confirm} onChange={e => setForm(f => ({ ...f, confirm: e.target.value.slice(0, MAX_PASSWORD) }))} />
              <input type="tel" placeholder="Phone (optional - for text alerts)" maxLength={MAX_PHONE} className={`w-full p-3 mb-2 min-h-[44px] border rounded ${prefilled && form.phone ? 'border-blue-300 bg-blue-50/50' : 'border-stone-200'}`} value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value.slice(0, MAX_PHONE) }))} />
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
