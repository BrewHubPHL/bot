"use client";

import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import {
  LogOut, Package, Coffee, QrCode, Mail, Lock, User, Phone,
  ShoppingBag, Clock, ChevronRight, Truck,
} from "lucide-react";
import Link from "next/link";

/* ─── Types ──────────────────────────────────────────────── */
interface ParcelRow {
  id: string;
  tracking_number: string;
  carrier: string | null;
  status: string;
  received_at: string | null;
  unit_number: string | null;
}

interface OrderRow {
  id: string;
  status: string;
  total_amount_cents: number;
  created_at: string;
}

/* ─── Helpers ────────────────────────────────────────────── */
function fmtDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
function fmtCents(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}

const STATUS_STYLE: Record<string, string> = {
  received:    "bg-amber-500/15 text-amber-400 border-amber-500/30",
  in_transit:  "bg-sky-500/15   text-sky-400   border-sky-500/30",
  picked_up:   "bg-green-500/15 text-green-400 border-green-500/30",
  completed:   "bg-green-500/15 text-green-400 border-green-500/30",
  paid:        "bg-green-500/15 text-green-400 border-green-500/30",
  pending:     "bg-stone-700/40 text-stone-400 border-stone-600",
  cancelled:   "bg-red-500/15   text-red-400   border-red-500/30",
};
function badgeClass(status: string) {
  return STATUS_STYLE[status] ?? STATUS_STYLE.pending;
}
function friendlyStatus(s: string) {
  const map: Record<string, string> = {
    received: "Waiting for Pickup",
    in_transit: "In Transit",
    picked_up: "Picked Up",
    completed: "Completed",
    paid: "Completed",
    pending: "Pending",
    cancelled: "Cancelled",
  };
  return map[s] ?? s.replace(/_/g, " ");
}

/* ─── Skeleton loader ────────────────────────────────────── */
function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded bg-stone-800 ${className}`} />;
}
function CardSkeleton() {
  return (
    <div className="bg-stone-950 border border-stone-800 rounded-xl p-6 space-y-4">
      <Skeleton className="h-4 w-32" />
      <Skeleton className="h-14 w-full" />
      <Skeleton className="h-14 w-full" />
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   MAIN COMPONENT
   ═══════════════════════════════════════════════════════════ */
export default function ResidentPortal() {
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [dataLoading, setDataLoading] = useState(true);
  const [authMode, setAuthMode] = useState<"login" | "signup">("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [authError, setAuthError] = useState("");
  const [authLoading, setAuthLoading] = useState(false);

  /* Dashboard state */
  const [parcels, setParcels] = useState<ParcelRow[]>([]);
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [loyalty, setLoyalty] = useState({ points: 0 });

  /* ── Auth bootstrap ────────────────────────────────────── */
  useEffect(() => {
    const getSession = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        setUser(session.user);
        loadData(session.user.id, String(session.user.email));
      }
      setLoading(false);
    };
    getSession();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) {
        setUser(session.user);
        loadData(session.user.id, String(session.user.email));
      } else {
        setUser(null);
      }
    });
    return () => subscription.unsubscribe();
  }, []);

  /* ── Data loader ───────────────────────────────────────── */
  async function loadData(userId: string, userEmail: string) {
    setDataLoading(true);
    const [parcelRes, orderRes, loyaltyRes] = await Promise.all([
      supabase
        .from("parcels")
        .select("id, tracking_number, carrier, status, received_at, unit_number")
        .eq("recipient_email", userEmail)
        .neq("status", "picked_up")
        .order("received_at", { ascending: false }),
      supabase
        .from("orders")
        .select("id, status, total_amount_cents, created_at")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(5),
      supabase
        .from("customers")
        .select("loyalty_points")
        .eq("email", userEmail)
        .maybeSingle(),
    ]);

    if (parcelRes.data) setParcels(parcelRes.data);
    if (orderRes.data) setOrders(orderRes.data);
    if (loyaltyRes.data) setLoyalty({ points: loyaltyRes.data.loyalty_points });
    setDataLoading(false);
  }

  /* ── Auth handler ──────────────────────────────────────── */
  async function handleAuth(e: React.FormEvent) {
    e.preventDefault();
    setAuthError("");
    setAuthLoading(true);

    try {
      if (authMode === "signup") {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: { data: { full_name: name, phone } },
        });
        if (error) throw error;
        setAuthError("Check your email to confirm your account!");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
    } catch (err: any) {
      setAuthError(err.message || "Authentication failed");
    }
    setAuthLoading(false);
  }

  /* ── Print keychain ────────────────────────────────────── */
  const printKeychain = () => {
    const barcodeUrl = `https://barcodeapi.org/api/128/${encodeURIComponent(user.email)}`;
    const printWindow = window.open("", "_blank");
    if (!printWindow) return;
    const doc = printWindow.document;
    doc.title = "BrewHub Loyalty";
    const container = doc.createElement("div");
    container.style.cssText = "border:2px dashed #000; padding:20px; width:200px; text-align:center;";
    const heading = doc.createElement("h3");
    heading.textContent = "BrewHub Loyalty";
    container.appendChild(heading);
    const img = doc.createElement("img");
    img.src = barcodeUrl;
    img.style.width = "100%";
    container.appendChild(img);
    const emailP = doc.createElement("p");
    emailP.textContent = user.email;
    container.appendChild(emailP);
    doc.body.appendChild(container);
    printWindow.print();
  };

  /* ═══════════════════════════════════════════════════════════
     RENDER — Loading
     ═══════════════════════════════════════════════════════════ */
  if (loading) {
    return (
      <div className="min-h-screen bg-stone-950 flex items-center justify-center pt-24">
        <div className="animate-pulse text-center">
          <div className="w-16 h-16 bg-stone-800 rounded-full mx-auto mb-4" />
          <p className="text-stone-500 text-sm">Loading&hellip;</p>
        </div>
      </div>
    );
  }

  /* ═══════════════════════════════════════════════════════════
     RENDER — Auth Gate
     ═══════════════════════════════════════════════════════════ */
  if (!user) {
    return (
      <div className="min-h-screen bg-stone-950 flex items-center justify-center pt-24 px-4">
        <div className="w-full max-w-md bg-stone-900 rounded-xl shadow-2xl p-8 border border-stone-800">
          <div className="text-center mb-8">
            <img src="/logo.png" alt="BrewHub" className="w-20 h-20 mx-auto rounded-full border-2 border-stone-700 mb-4" />
            <h1 className="font-playfair text-3xl text-white">Resident Portal</h1>
            <p className="text-stone-500 text-sm mt-2">Track packages, earn rewards, and more</p>
          </div>

          <div className="flex mb-6 border-b border-stone-800">
            <button
              onClick={() => setAuthMode("login")}
              className={`flex-1 pb-3 text-sm font-semibold transition-colors ${authMode === "login" ? "text-white border-b-2 border-amber-500" : "text-stone-500"}`}
            >
              Sign In
            </button>
            <button
              onClick={() => setAuthMode("signup")}
              className={`flex-1 pb-3 text-sm font-semibold transition-colors ${authMode === "signup" ? "text-white border-b-2 border-amber-500" : "text-stone-500"}`}
            >
              Create Account
            </button>
          </div>

          <form onSubmit={handleAuth} className="space-y-4">
            {authMode === "signup" && (
              <div>
                <label className="block text-xs uppercase tracking-wider text-stone-500 mb-2">Full Name</label>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-500" size={18} />
                  <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Jane Doe" required className="w-full pl-10 pr-4 py-3 bg-stone-800 border border-stone-700 rounded-lg text-white placeholder-stone-600 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/50" />
                </div>
              </div>
            )}

            <div>
              <label className="block text-xs uppercase tracking-wider text-stone-500 mb-2">Email</label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-500" size={18} />
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" required className="w-full pl-10 pr-4 py-3 bg-stone-800 border border-stone-700 rounded-lg text-white placeholder-stone-600 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/50" />
              </div>
            </div>

            {authMode === "signup" && (
              <div>
                <label className="block text-xs uppercase tracking-wider text-stone-500 mb-2">Phone Number</label>
                <div className="relative">
                  <Phone className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-500" size={18} />
                  <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="(555) 123-4567" required className="w-full pl-10 pr-4 py-3 bg-stone-800 border border-stone-700 rounded-lg text-white placeholder-stone-600 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/50" />
                </div>
              </div>
            )}

            <div>
              <label className="block text-xs uppercase tracking-wider text-stone-500 mb-2">Password</label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-500" size={18} />
                <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" required minLength={6} className="w-full pl-10 pr-4 py-3 bg-stone-800 border border-stone-700 rounded-lg text-white placeholder-stone-600 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/50" />
              </div>
            </div>

            {authError && (
              <div className={`text-sm p-3 rounded-lg ${authError.includes("Check your email") ? "bg-green-500/10 text-green-400 border border-green-500/20" : "bg-red-500/10 text-red-400 border border-red-500/20"}`}>
                {authError}
              </div>
            )}

            <button type="submit" disabled={authLoading} className="w-full py-3 bg-amber-600 hover:bg-amber-500 text-white rounded-lg font-semibold transition-colors disabled:opacity-50">
              {authLoading ? "Please wait…" : authMode === "login" ? "Sign In" : "Create Account"}
            </button>
          </form>

          <div className="mt-6 space-y-3">
            <p className="text-center text-xs text-stone-600">
              By continuing, you agree to our{" "}
              <a href="/terms.html" className="underline hover:text-stone-400">Terms</a> and{" "}
              <a href="/privacy.html" className="underline hover:text-stone-400">Privacy Policy</a>
            </p>
            {authMode === "signup" && (
              <div className="bg-stone-800/50 border border-stone-700 rounded-lg p-3 text-xs text-stone-500 space-y-1">
                <p className="font-medium text-stone-400">🔒 Your Privacy Matters</p>
                <p>We never sell your data to third parties. Your information is used only to provide BrewHub services.</p>
                <p>SMS: Reply <span className="font-semibold">STOP</span> anytime to unsubscribe. Msg &amp; data rates may apply.</p>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  /* ═══════════════════════════════════════════════════════════
     RENDER — Authenticated Dashboard
     ═══════════════════════════════════════════════════════════ */
  const waitingParcels = parcels.length;

  return (
    <div className="min-h-screen bg-stone-950 pt-24 pb-16">
      <div className="max-w-2xl mx-auto px-4 space-y-6">

        {/* ── Header ─────────────────────────────────────── */}
        <div className="flex justify-between items-center">
          <div>
            <h1 className="font-playfair text-3xl text-white">Welcome Home.</h1>
            <p className="text-stone-500 text-sm mt-1">{user.email}</p>
          </div>
          <button
            onClick={() => supabase.auth.signOut().then(() => window.location.reload())}
            className="text-stone-600 hover:text-red-400 transition-colors p-2 rounded-lg hover:bg-stone-900"
            aria-label="Sign out"
          >
            <LogOut size={20} />
          </button>
        </div>

        {/* ── QR Code — top priority ─────────────────────── */}
        <div className="bg-stone-900 border border-stone-800 rounded-xl p-6 text-center">
          <div className="flex items-center justify-center gap-2 mb-4 text-stone-500">
            <QrCode size={16} />
            <span className="uppercase tracking-[0.2em] text-[10px] font-bold">Loyalty QR</span>
          </div>
          <img
            src={`https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(user?.email || "")}&bgcolor=0C0A09&color=FFFFFF`}
            alt="Loyalty QR Code"
            className="mx-auto rounded-lg border border-stone-700"
            width={160}
            height={160}
          />
          <p className="text-stone-600 text-xs mt-3">Show this at the cafe to earn rewards</p>
        </div>

        {/* ── Loyalty Card ───────────────────────────────── */}
        <div className="bg-stone-900 border border-stone-800 rounded-xl p-6 relative overflow-hidden">
          <div className="relative z-10">
            <div className="flex items-center gap-2 mb-3 text-stone-500">
              <Coffee size={16} />
              <span className="uppercase tracking-[0.2em] text-[10px] font-bold">Coffee Rewards</span>
            </div>
            <div className="flex items-baseline gap-3">
              <span className="text-4xl font-playfair text-white">{Math.floor((loyalty.points % 500) / 50)}</span>
              <span className="text-stone-600 text-sm">/10 cups until your next free drink</span>
            </div>
            <div className="mt-4 flex gap-1">
              {Array.from({ length: 10 }).map((_, i) => (
                <div
                  key={i}
                  className={`h-2 flex-1 rounded-full transition-colors ${
                    i < Math.floor((loyalty.points % 500) / 50) ? "bg-amber-500" : "bg-stone-800"
                  }`}
                />
              ))}
            </div>
            <button onClick={printKeychain} className="mt-4 text-[10px] uppercase tracking-widest text-stone-500 hover:text-stone-300 border border-stone-700 px-4 py-2 rounded-lg hover:bg-stone-800 transition-colors">
              Print Keychain Card
            </button>
          </div>
          <QrCode className="absolute -right-6 -bottom-6 opacity-[0.03] text-white" size={160} />
        </div>

        {/* ── Your Packages ──────────────────────────────── */}
        {dataLoading ? (
          <CardSkeleton />
        ) : (
          <div className="bg-stone-900 border border-stone-800 rounded-xl p-6">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2 text-stone-400">
                <Package size={16} />
                <h2 className="font-playfair text-lg text-white">Your Packages</h2>
              </div>
              {waitingParcels > 0 && (
                <span className="flex items-center gap-1.5 text-xs font-bold text-amber-400 bg-amber-500/10 border border-amber-500/20 px-3 py-1 rounded-full animate-pulse">
                  <span className="w-2 h-2 rounded-full bg-amber-400" />
                  {waitingParcels} waiting
                </span>
              )}
            </div>

            {parcels.length === 0 ? (
              <div className="text-center py-8">
                <Truck className="mx-auto text-stone-700 mb-3" size={32} />
                <p className="text-stone-600 text-sm">No packages currently waiting.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {parcels.map((p) => (
                  <div
                    key={p.id}
                    className="flex items-center gap-4 bg-stone-800/50 border border-stone-700/50 rounded-lg p-4 hover:border-stone-600 transition-colors"
                  >
                    {/* Carrier icon */}
                    <div className="flex-shrink-0 w-10 h-10 rounded-full bg-stone-800 border border-stone-700 flex items-center justify-center">
                      <Package size={16} className="text-stone-400" />
                    </div>

                    {/* Detail */}
                    <div className="flex-1 min-w-0">
                      <p className="text-white text-sm font-semibold truncate">
                        {p.carrier || "Unknown Carrier"}
                      </p>
                      <p className="text-stone-500 text-xs">
                        ...{p.tracking_number?.slice(-8)} &middot; {fmtDate(p.received_at)}
                      </p>
                    </div>

                    {/* Status badge */}
                    <span className={`flex-shrink-0 text-[10px] uppercase font-bold px-3 py-1 rounded-full border ${badgeClass(p.status)}`}>
                      {friendlyStatus(p.status)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── Recent Orders ──────────────────────────────── */}
        {dataLoading ? (
          <CardSkeleton />
        ) : (
          <div className="bg-stone-900 border border-stone-800 rounded-xl p-6">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2 text-stone-400">
                <ShoppingBag size={16} />
                <h2 className="font-playfair text-lg text-white">Recent Orders</h2>
              </div>
              <Link href="/shop" className="text-xs text-stone-600 hover:text-amber-400 flex items-center gap-1 transition-colors">
                Shop <ChevronRight size={12} />
              </Link>
            </div>

            {orders.length === 0 ? (
              <div className="text-center py-8">
                <Coffee className="mx-auto text-stone-700 mb-3" size={32} />
                <p className="text-stone-600 text-sm">No orders yet. Grab your first coffee!</p>
                <Link href="/shop" className="inline-block mt-3 text-xs text-amber-500 hover:text-amber-400 underline underline-offset-2 transition-colors">
                  Browse the menu →
                </Link>
              </div>
            ) : (
              <div className="space-y-2">
                {orders.map((o) => (
                  <div
                    key={o.id}
                    className="flex items-center justify-between bg-stone-800/50 border border-stone-700/50 rounded-lg px-4 py-3 hover:border-stone-600 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <div className="flex-shrink-0 w-8 h-8 rounded-full bg-stone-800 border border-stone-700 flex items-center justify-center">
                        <Clock size={14} className="text-stone-500" />
                      </div>
                      <div>
                        <p className="text-white text-sm font-medium">{fmtCents(o.total_amount_cents)}</p>
                        <p className="text-stone-500 text-xs">{fmtDate(o.created_at)}</p>
                      </div>
                    </div>
                    <span className={`text-[10px] uppercase font-bold px-3 py-1 rounded-full border ${badgeClass(o.status)}`}>
                      {friendlyStatus(o.status)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── Footer ─────────────────────────────────────── */}
        <p className="text-center text-stone-700 text-[10px] pb-4">
          BrewHub PHL &middot; Point Breeze, Philadelphia
        </p>
      </div>
    </div>
  );
}