"use client";
import Link from "next/link";
import { useActionState, useRef, useState, useEffect, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { submitResident, initialState } from "./actions";

const MAX_UNIT = 20;
const MAX_PHONE = 20;

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
  const [state, formAction, isPending] = useActionState(submitResident, initialState);

  const [prefilled, setPrefilled] = useState(false);
  const [inviteExpired, setInviteExpired] = useState(false);
  const [inviteError, setInviteError] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [prefilledUnit, setPrefilledUnit] = useState("");
  const [prefilledPhone, setPrefilledPhone] = useState("");
  const formLoadedAt = useRef(Date.now());

  /* ── Auto-populate unit & phone from URL params (invite link flow) ── */
  useEffect(() => {
    let isMounted = true;
    const urlUnit = searchParams.get("unit");
    const urlPhone = searchParams.get("phone");
    const urlExpires = searchParams.get("expires");
    const urlSig = searchParams.get("sig");

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
          if (!isMounted) return;
          if (data.valid) {
            if (data.unit) setPrefilledUnit(data.unit.slice(0, MAX_UNIT));
            if (data.phone) setPrefilledPhone(data.phone.slice(0, MAX_PHONE));
            setPrefilled(true);
          } else {
            setInviteExpired(true);
            setInviteError(data.reason || "This invite link is invalid or has expired.");
          }
        })
        .catch(() => {
          if (!isMounted) return;
          setInviteExpired(true);
          setInviteError("Unable to verify invite link. Please try again or request a new one.");
        })
        .finally(() => { if (isMounted) setVerifying(false); });
    }
    return () => { isMounted = false; };
  }, [searchParams]);

  return (
    <main className="max-w-lg mx-auto px-4 py-10 text-stone-900 bg-white rounded-md shadow-md">
      <Link href="/" className="inline-block mb-6 text-stone-500 hover:text-stone-900">← Back to BrewHub</Link>
      <div className="bg-white p-6 rounded shadow-md">
        <h1 className="font-playfair text-2xl mb-4">Register for package tracking & coffee rewards.</h1>
        {verifying && (
          <div className="bg-stone-50 text-stone-600 p-4 rounded mb-4 text-sm border border-stone-200 flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" />
            Verifying your invite link…
          </div>
        )}
        {inviteExpired && (
          <div role="alert" className="bg-amber-50 text-amber-900 p-4 rounded mb-4 text-sm border border-amber-300">
            <p className="font-bold mb-1">Invite Expired</p>
            <p>{inviteError || "This invite link is invalid or has expired."}</p>
            <p className="mt-2">Please ask the front desk to resend your package notification, or register manually below.</p>
          </div>
        )}
        {prefilled && !inviteExpired && (
          <div className="bg-blue-50 text-blue-800 p-4 rounded mb-4 text-sm border border-blue-200">
            📦 We&apos;ve pre-filled your unit and phone from the package notification. Just add your name, email, and a password to get started!
          </div>
        )}
        {state.success ? (
          <div className="bg-green-100 text-green-800 p-4 rounded mb-4">Registration successful! Please check your email to verify your account.</div>
        ) : (
          <>
            {state.error && !inviteExpired ? (
              <div role="alert" className="bg-red-100 text-red-800 p-4 rounded mb-4">{state.error}</div>
            ) : null}
            <form action={formAction}>
              <input type="hidden" name="formLoadedAt" value={formLoadedAt.current} />
              <Input type="text" name="name" placeholder="Full Name *" required maxLength={100} className="w-full p-3 mb-2 min-h-[44px]" />
              <Input type="text" name="unit" placeholder="Unit # or Address *" required maxLength={20} defaultValue={prefilledUnit} className={`w-full p-3 mb-2 min-h-[44px] ${prefilled && prefilledUnit ? "border-blue-300 bg-blue-50/50" : ""}`} />
              <Input type="email" name="email" placeholder="Email *" required maxLength={254} className="w-full p-3 mb-2 min-h-[44px]" />
              <Input type="password" name="password" placeholder="Password (min 6 characters) *" required maxLength={128} className="w-full p-3 mb-2 min-h-[44px]" />
              <Input type="password" name="confirm" placeholder="Confirm Password *" required maxLength={128} className="w-full p-3 mb-2 min-h-[44px]" />
              <Input type="tel" name="phone" placeholder="Phone (optional - for text alerts)" maxLength={20} defaultValue={prefilledPhone} className={`w-full p-3 mb-2 min-h-[44px] ${prefilled && prefilledPhone ? "border-blue-300 bg-blue-50/50" : ""}`} />
              <div className="flex items-start gap-2 mb-2">
                <input type="checkbox" id="sms-consent" name="sms" required className="mt-1" />
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
              <Button type="submit" className="w-full py-3 min-h-[44px] font-bold mb-2" disabled={isPending}>
                {isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Registering…
                  </>
                ) : (
                  "Register"
                )}
              </Button>
            </form>
            <div className="text-xs text-stone-500 mt-2">Already have an account? <Link href="/portal" className="underline">Log in</Link></div>
          </>
        )}
      </div>
    </main>
  );
}
