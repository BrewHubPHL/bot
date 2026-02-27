"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import type { User as SupaUser } from "@supabase/supabase-js";
import QRCode from "qrcode";
import {
  LogOut, Package, Coffee, QrCode, Mail, Lock, User, Phone,
  ShoppingBag, Clock, ChevronRight, Truck, Zap,
} from "lucide-react";
import Link from "next/link";

/* ─── Constants ──────────────────────────────────────────── */
const MAX_NAME = 100;
const MAX_EMAIL = 254;
const MAX_PHONE = 20;
const MAX_PASSWORD = 128;
const MAX_AUTH_ATTEMPTS = 5;
const AUTH_COOLDOWN_MS = 30_000; // 30 seconds
const COFFEE_TTL_MS = 10 * 60 * 1000; // 10 minutes

/* ─── Types ──────────────────────────────────────────────── */
interface ParcelRow {
  id: string;
  tracking_number: string;
  carrier: string | null;
  status: string;
  received_at: string | null;
  unit_number: string | null;
}

interface CoffeeItem {
  id: string;
  drink_name: string;
  customizations: string | null;
  completed_at: string | null;
}

interface CoffeeQueueOrder {
  id: string;
  status: string;
  created_at: string;
  customer_name: string | null;
  coffee_orders: CoffeeItem[];
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
function fmtTime(iso: string | null) {
  if (!iso) return "";
  return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}
function fmtCents(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}

/** Filter orders older than COFFEE_TTL_MS */
function isWithinTTL(createdAt: string): boolean {
  return Date.now() - new Date(createdAt).getTime() < COFFEE_TTL_MS;
}

const STATUS_STYLE: Record<string, string> = {
  arrived:     "bg-amber-500/15 text-amber-400 border-amber-500/30",
  received:    "bg-amber-500/15 text-amber-400 border-amber-500/30",
  in_transit:  "bg-sky-500/15   text-sky-400   border-sky-500/30",
  picked_up:   "bg-green-500/15 text-green-400 border-green-500/30",
  completed:   "bg-green-500/15 text-green-400 border-green-500/30",
  paid:        "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  pending:     "bg-stone-700/40 text-stone-400 border-stone-600",
  unpaid:      "bg-orange-500/15 text-orange-400 border-orange-500/30",
  preparing:   "bg-amber-500/15 text-amber-400 border-amber-500/30",
  ready:       "bg-sky-500/15   text-sky-400   border-sky-500/30",
  cancelled:   "bg-red-500/15   text-red-400   border-red-500/30",
  refunded:    "bg-stone-700/40 text-stone-400 border-stone-600",
};
function badgeClass(status: string) {
  return STATUS_STYLE[status] ?? STATUS_STYLE.pending;
}
function friendlyStatus(s: string) {
  const map: Record<string, string> = {
    arrived: "Waiting for Pickup",
    received: "Waiting for Pickup",
    in_transit: "In Transit",
    picked_up: "Picked Up",
    completed: "Completed",
    paid: "Order Received",
    pending: "Pending",
    unpaid: "Pay at Counter",
    preparing: "Preparing",
    ready: "Ready for Pickup",
    cancelled: "Cancelled",
    refunded: "Refunded",
    abandoned: "Expired",
    amount_mismatch: "Payment Issue",
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

/* ─── 80s Phosphor Scanline overlay ──────────────────────── */
function PhosphorOverlay() {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 z-10"
      style={{
        background:
          "repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,0,0,0.15) 2px, rgba(0,0,0,0.15) 4px)",
      }}
    />
  );
}

/* ═══════════════════════════════════════════════════════════
   MAIN COMPONENT
   ═══════════════════════════════════════════════════════════ */
export default function ResidentPortal() {
  const [user, setUser] = useState<SupaUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [dataLoading, setDataLoading] = useState(true);
  const [authMode, setAuthMode] = useState<"login" | "signup">("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [authError, setAuthError] = useState("");
  const [authLoading, setAuthLoading] = useState(false);
  const [signupDone, setSignupDone] = useState(false);

  /* Auth rate-limiting state */
  const authAttemptsRef = useRef(0);
  const cooldownUntilRef = useRef(0);
  const [cooldownRemaining, setCooldownRemaining] = useState(0);

  /* Dashboard state */
  const [unitNumber, setUnitNumber] = useState<string | null>(null);
  const [parcels, setParcels] = useState<ParcelRow[]>([]);
  const [coffeeQueue, setCoffeeQueue] = useState<CoffeeQueueOrder[]>([]);
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [loyalty, setLoyalty] = useState({ points: 0 });
  const [qrError, setQrError] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [pickupQrUrl, setPickupQrUrl] = useState<string | null>(null);
  const [isMaintenanceMode, setIsMaintenanceMode] = useState(false);
  const [parcelPop, setParcelPop] = useState<string | null>(null); // id of freshly arrived parcel

  /* ── Client-side QR generation (H6: UUID never leaves browser) ── */
  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;

    // Loyalty QR
    QRCode.toDataURL(`brewhub-loyalty:${user.id}`, {
      width: 180,
      margin: 1,
      color: { dark: "#FFFFFF", light: "#0C0A09" },
    })
      .then((url: string) => { if (!cancelled) setQrDataUrl(url); })
      .catch(() => { if (!cancelled) setQrError(true); });

    // Pickup QR — staff scans this to clear parcels / complete handoff
    QRCode.toDataURL(`brewhub-pickup:${user.id}`, {
      width: 200,
      margin: 1,
      color: { dark: "#F59E0B", light: "#0C0A09" },
    })
      .then((url: string) => { if (!cancelled) setPickupQrUrl(url); })
      .catch(() => { /* non-critical */ });

    return () => { cancelled = true; };
  }, [user?.id]);

  /* ── Client-side barcode for print keychain (H6) ───────── */
  const drawBarcode128 = useCallback((canvas: HTMLCanvasElement, text: string) => {
    // Minimal Code 128B renderer — encodes printable ASCII
    const CODE128B_START = 104;
    const CODE128_STOP = 106;
    const PATTERNS: number[][] = [
      [2,1,2,2,2,3],[2,2,2,1,2,3],[2,2,2,3,2,1],[1,2,1,2,2,4],[1,2,1,4,2,2],
      [1,4,1,2,2,2],[1,2,2,2,1,4],[1,2,2,4,1,2],[1,4,2,2,1,2],[2,2,1,2,1,4],
      [2,2,1,4,1,2],[2,4,1,2,1,2],[1,1,2,2,3,2],[1,2,2,1,3,2],[1,2,2,3,1,2],
      [1,1,3,2,2,2],[1,2,3,1,2,2],[1,2,3,2,2,1],[2,2,3,2,1,1],[2,2,1,1,3,2],
      [2,2,1,3,1,2],[2,1,3,2,1,2],[2,2,3,1,1,2],[3,1,2,1,3,1],[3,1,1,2,2,2],
      [3,2,1,1,2,2],[3,2,1,2,2,1],[3,1,2,2,1,2],[3,2,2,1,1,2],[3,2,2,2,1,1],
      [2,1,2,1,2,3],[2,1,2,3,2,1],[2,3,2,1,2,1],[1,1,1,3,2,3],[1,3,1,1,2,3],
      [1,3,1,3,2,1],[1,1,2,3,1,3],[1,3,2,1,1,3],[1,3,2,3,1,1],[2,1,1,3,1,3],
      [2,3,1,1,1,3],[2,3,1,3,1,1],[1,1,2,1,3,3],[1,1,2,3,3,1],[1,3,2,1,3,1],
      [1,1,3,1,2,3],[1,1,3,3,2,1],[1,3,3,1,2,1],[3,1,3,1,2,1],[2,1,1,3,3,1],
      [2,3,1,1,3,1],[2,1,3,1,1,3],[2,1,3,3,1,1],[2,1,3,1,3,1],[3,1,1,1,2,3],
      [3,1,1,3,2,1],[3,3,1,1,2,1],[3,1,2,1,1,3],[3,1,2,3,1,1],[3,3,2,1,1,1],
      [3,1,4,1,1,1],[2,2,1,4,1,1],[4,3,1,1,1,1],[1,1,1,2,2,4],[1,1,1,4,2,2],
      [1,2,1,1,2,4],[1,2,1,4,2,1],[1,4,1,1,2,2],[1,4,1,2,2,1],[1,1,2,2,1,4],
      [1,1,2,4,1,2],[1,2,2,1,1,4],[1,2,2,4,1,1],[1,4,2,1,1,2],[1,4,2,2,1,1],
      [2,4,1,2,1,1],[2,2,1,1,1,4],[4,1,3,1,1,1],[2,4,1,1,1,2],[1,3,4,1,1,1],
      [1,1,1,2,4,2],[1,2,1,1,4,2],[1,2,1,2,4,1],[1,1,4,2,1,2],[1,2,4,1,1,2],
      [1,2,4,2,1,1],[4,1,1,2,1,2],[4,2,1,1,1,2],[4,2,1,2,1,1],[2,1,2,1,4,1],
      [2,1,4,1,2,1],[4,1,2,1,2,1],[1,1,1,1,4,3],[1,1,1,3,4,1],[1,3,1,1,4,1],
      [1,1,4,1,1,3],[1,1,4,3,1,1],[4,1,1,1,1,3],[4,1,1,3,1,1],[1,1,3,1,4,1],
      [1,1,4,1,3,1],[3,1,1,1,4,1],[4,1,1,1,3,1],[2,1,1,4,1,2],[2,1,1,2,1,4],
      [2,1,1,2,3,2],[2,3,3,1,1,1,2],
    ];
    const STOP_PATTERN = PATTERNS[CODE128_STOP];
    const values: number[] = [CODE128B_START];
    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i) - 32;
      if (code < 0 || code > 94) continue;
      values.push(code);
    }
    let checksum = values[0];
    for (let i = 1; i < values.length; i++) checksum += values[i] * i;
    values.push(checksum % 103);
    const bars: number[] = [];
    for (const v of values) {
      const p = PATTERNS[v];
      if (p) bars.push(...p);
    }
    bars.push(...STOP_PATTERN);
    const barWidth = 1;
    const totalWidth = bars.reduce((s, b) => s + b, 0) * barWidth + 20;
    const height = 50;
    canvas.width = totalWidth;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, totalWidth, height);
    let x = 10;
    for (let i = 0; i < bars.length; i++) {
      if (i % 2 === 0) {
        ctx.fillStyle = "#000";
        ctx.fillRect(x, 0, bars[i] * barWidth, height);
      }
      x += bars[i] * barWidth;
    }
  }, []);

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
        setQrError(false);
        loadData(session.user.id, String(session.user.email));
      } else {
        setUser(null);
      }
    });
    return () => subscription.unsubscribe();
  }, []);

  /* ── Realtime subscriptions: parcels (by unit), orders, coffee ── */
  useEffect(() => {
    if (!user?.id) return;

    const userId = user.id;

    // ── 1. Parcels channel — filter by unit_number ─────────────
    // We subscribe on the parcels table. When a new parcel is scanned in
    // the back, it "pops" onto the resident's screen instantly.
    let parcelsChannel: ReturnType<typeof supabase.channel> | null = null;
    if (unitNumber) {
      parcelsChannel = supabase
        .channel(`portal-parcels-unit-${unitNumber}`)
        .on(
          "postgres_changes" as never,
          { event: "*", schema: "public", table: "parcels", filter: `unit_number=eq.${unitNumber}` },
          (payload: { new?: ParcelRow; eventType?: string }) => {
            // Re-fetch parcels on any change
            supabase
              .from("parcels")
              .select("id, tracking_number, carrier, status, received_at, unit_number")
              .eq("unit_number", unitNumber)
              .in("status", ["arrived", "pending_notification"])
              .order("received_at", { ascending: false })
              .then(({ data }) => {
                if (data) {
                  setParcels(data);
                  // "Pop" animation for INSERT events
                  if (payload.eventType === "INSERT" && payload.new?.id) {
                    setParcelPop(payload.new.id);
                    setTimeout(() => setParcelPop(null), 1500);
                  }
                }
              });
          },
        )
        .subscribe();
    }

    // ── 2. Orders channel — re-check coffee queue on status change ──
    const ordersChannel = supabase
      .channel(`portal-orders-${userId}`)
      .on(
        "postgres_changes" as never,
        { event: "*", schema: "public", table: "orders", filter: `user_id=eq.${userId}` },
        () => {
          // Refresh coffee queue + recent orders
          fetchCoffeeQueue(userId);
          supabase
            .from("orders")
            .select("id, status, total_amount_cents, created_at")
            .eq("user_id", userId)
            .order("created_at", { ascending: false })
            .limit(5)
            .then(({ data }) => {
              if (data) setOrders(data);
            });
        },
      )
      .subscribe();

    // ── 3. Coffee orders channel — item-level completion from KDS ──
    const coffeeChannel = supabase
      .channel(`portal-coffee-${userId}`)
      .on(
        "postgres_changes" as never,
        { event: "UPDATE", schema: "public", table: "coffee_orders" },
        () => {
          // Re-fetch coffee queue to pick up item-level completion
          fetchCoffeeQueue(userId);
        },
      )
      .subscribe();

    return () => {
      if (parcelsChannel) supabase.removeChannel(parcelsChannel);
      supabase.removeChannel(ordersChannel);
      supabase.removeChannel(coffeeChannel);
    };
  }, [user?.id, unitNumber]);

  /* ── Coffee queue TTL cleanup interval ─────────────────── */
  useEffect(() => {
    if (coffeeQueue.length === 0) return;
    const interval = setInterval(() => {
      setCoffeeQueue((prev) => prev.filter((o) => isWithinTTL(o.created_at)));
    }, 30_000); // check every 30s
    return () => clearInterval(interval);
  }, [coffeeQueue.length]);

  /* ── Coffee queue fetcher ──────────────────────────────── */
  async function fetchCoffeeQueue(userId: string) {
    const { data, error } = await supabase
      .from("orders")
      .select("id, status, created_at, customer_name, coffee_orders(id, drink_name, customizations, completed_at)")
      .eq("user_id", userId)
      .in("status", ["preparing", "ready"])
      .order("created_at", { ascending: true });

    if (error) {
      console.error("Coffee queue fetch error:", error.message);
      return;
    }
    // Apply 10-minute TTL filter
    const fresh = (data ?? []).filter((o: CoffeeQueueOrder) => isWithinTTL(o.created_at));
    setCoffeeQueue(fresh);
  }

  /* ── Data loader ───────────────────────────────────────── */
  async function loadData(userId: string, userEmail: string) {
    setDataLoading(true);
    try {
      // Step 1: Resolve resident's unit_number from the residents table
      const { data: residentData, error: residentErr } = await supabase
        .from("residents")
        .select("unit_number")
        .eq("email", userEmail)
        .maybeSingle();

      if (residentErr) {
        console.error("Resident lookup error:", residentErr.message);
      }

      const resolvedUnit = residentData?.unit_number ?? null;
      setUnitNumber(resolvedUnit);

      // Step 2: Parallel fetch — parcels (by unit), orders, coffee queue, loyalty
      const parcelPromise = resolvedUnit
        ? supabase
            .from("parcels")
            .select("id, tracking_number, carrier, status, received_at, unit_number")
            .eq("unit_number", resolvedUnit)
            .in("status", ["arrived", "pending_notification"])
            .order("received_at", { ascending: false })
        : Promise.resolve({ data: [] as ParcelRow[], error: null });

      const [parcelRes, orderRes, coffeeRes, loyaltyRes] = await Promise.all([
        parcelPromise,
        supabase
          .from("orders")
          .select("id, status, total_amount_cents, created_at")
          .eq("user_id", userId)
          .order("created_at", { ascending: false })
          .limit(5),
        supabase
          .from("orders")
          .select("id, status, created_at, customer_name, coffee_orders(id, drink_name, customizations, completed_at)")
          .eq("user_id", userId)
          .in("status", ["preparing", "ready"])
          .order("created_at", { ascending: true }),
        supabase
          .from("customers")
          .select("loyalty_points")
          .eq("email", userEmail)
          .maybeSingle(),
      ]);

      // If critical queries failed, surface maintenance mode
      if (orderRes.error || loyaltyRes.error) {
        console.error("Portal data load errors:", parcelRes.error?.message, orderRes.error?.message, loyaltyRes.error?.message);
        setIsMaintenanceMode(true);
        setDataLoading(false);
        return;
      }

      if (parcelRes.data) setParcels(parcelRes.data as ParcelRow[]);
      if (orderRes.data) setOrders(orderRes.data);
      if (coffeeRes.data) {
        const fresh = (coffeeRes.data as CoffeeQueueOrder[]).filter((o) => isWithinTTL(o.created_at));
        setCoffeeQueue(fresh);
      }
      if (loyaltyRes.data) setLoyalty({ points: loyaltyRes.data.loyalty_points });
    } catch (err: unknown) {
      console.error("Portal data load failed:", (err as Error)?.message);
      setIsMaintenanceMode(true);
    }
    setDataLoading(false);
  }

  /* ── Auth handler (with client-side rate limiting) ──────── */
  async function handleAuth(e: React.FormEvent) {
    e.preventDefault();
    setAuthError("");

    // Rate-limit check: cooldown active?
    const now = Date.now();
    if (now < cooldownUntilRef.current) {
      const secs = Math.ceil((cooldownUntilRef.current - now) / 1000);
      setAuthError(`Too many attempts. Please wait ${secs}s.`);
      return;
    }

    setAuthLoading(true);

    // Cap inputs before sending
    const safeEmail = email.slice(0, MAX_EMAIL);
    const safePassword = password.slice(0, MAX_PASSWORD);
    const safeName = name.slice(0, MAX_NAME);
    const safePhone = phone.slice(0, MAX_PHONE);

    try {
      if (authMode === "signup") {
        const { error } = await supabase.auth.signUp({
          email: safeEmail,
          password: safePassword,
          options: { data: { full_name: safeName, phone: safePhone } },
        });
        if (error) throw error;
        setAuthError("Check your email to confirm your account!");
        setSignupDone(true);
        authAttemptsRef.current = 0; // reset on success
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email: safeEmail, password: safePassword });
        if (error) throw error;
        authAttemptsRef.current = 0; // reset on success
      }
    } catch (err: unknown) {
      const raw = (err as Error)?.message || "";
      // Map common Supabase auth errors to friendly messages
      let friendly = "Authentication failed. Please try again.";
      if (raw.toLowerCase().includes("already registered") || raw.toLowerCase().includes("user already exists")) {
        friendly = "An account with this email already exists. Please sign in instead.";
      } else if (raw.toLowerCase().includes("invalid login") || raw.toLowerCase().includes("invalid credentials")) {
        friendly = "Incorrect email or password.";
      } else if (raw.toLowerCase().includes("email not confirmed")) {
        friendly = "Please confirm your email before signing in.";
      } else if (raw.toLowerCase().includes("too many requests") || raw.toLowerCase().includes("rate limit")) {
        friendly = "Too many attempts. Please wait a moment and try again.";
      }
      setAuthError(friendly);
      // Increment attempts + enforce cooldown
      authAttemptsRef.current += 1;
      if (authAttemptsRef.current >= MAX_AUTH_ATTEMPTS) {
        cooldownUntilRef.current = Date.now() + AUTH_COOLDOWN_MS;
        setCooldownRemaining(AUTH_COOLDOWN_MS / 1000);
        const timer = setInterval(() => {
          setCooldownRemaining((prev) => {
            if (prev <= 1) { clearInterval(timer); return 0; }
            return prev - 1;
          });
        }, 1000);
        authAttemptsRef.current = 0; // reset counter after cooldown triggers
      }
    }
    setAuthLoading(false);
  }

  /* ── Print keychain ────────────────────────────────────── */
  const printKeychain = () => {
    if (!user?.id) return;
    const uid = user.id;
    const printWindow = window.open("", "_blank");
    if (!printWindow) return;
    const doc = printWindow.document;
    doc.title = "BrewHub Loyalty";
    const container = doc.createElement("div");
    container.style.cssText = "border:2px dashed #000; padding:20px; width:200px; text-align:center;";
    const heading = doc.createElement("h3");
    heading.textContent = "BrewHub Loyalty";
    container.appendChild(heading);
    // H6: Generate barcode client-side — UUID never leaves the browser
    const barcodeCanvas = doc.createElement("canvas");
    drawBarcode128(barcodeCanvas, uid);
    barcodeCanvas.style.width = "100%";
    container.appendChild(barcodeCanvas);
    const idP = doc.createElement("p");
    idP.textContent = uid;
    idP.style.fontSize = "8px";
    idP.style.wordBreak = "break-all";
    container.appendChild(idP);
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
            <img
            src="/logo.png"
            alt="BrewHub"
            className="w-20 h-20 mx-auto rounded-full border-2 border-stone-700 mb-4"
            onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
          />
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
                  <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Jane Doe" required className="w-full pl-10 pr-4 py-3 bg-stone-800 border border-stone-700 rounded-lg text-white placeholder-stone-600 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/50 focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2" />
                </div>
              </div>
            )}

            <div>
              <label className="block text-xs uppercase tracking-wider text-stone-500 mb-2">Email</label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-500" size={18} />
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" required className="w-full pl-10 pr-4 py-3 bg-stone-800 border border-stone-700 rounded-lg text-white placeholder-stone-600 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/50 focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2" />
              </div>
            </div>

            {authMode === "signup" && (
              <div>
                <label className="block text-xs uppercase tracking-wider text-stone-500 mb-2">Phone Number</label>
                <div className="relative">
                  <Phone className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-500" size={18} />
                  <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="(555) 123-4567" required className="w-full pl-10 pr-4 py-3 bg-stone-800 border border-stone-700 rounded-lg text-white placeholder-stone-600 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/50 focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2" />
                </div>
              </div>
            )}

            <div>
              <label className="block text-xs uppercase tracking-wider text-stone-500 mb-2">Password</label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-500" size={18} />
                <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" required minLength={6} className="w-full pl-10 pr-4 py-3 bg-stone-800 border border-stone-700 rounded-lg text-white placeholder-stone-600 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/50 focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2" />
              </div>
            </div>

            {authError && (
              <div className={`text-sm p-3 rounded-lg ${authError.includes("Check your email") ? "bg-green-500/10 text-green-400 border border-green-500/20" : "bg-red-500/10 text-red-400 border border-red-500/20"}`}>
                {authError}
              </div>
            )}

            <button type="submit" disabled={authLoading || signupDone || cooldownRemaining > 0} className="w-full py-3 bg-amber-600 hover:bg-amber-500 text-white rounded-lg font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2">
              {authLoading ? (
                <>
                  <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>
                  Please wait…
                </>
              ) : cooldownRemaining > 0 ? `Wait ${cooldownRemaining}s…` : authMode === "login" ? "Sign In" : signupDone ? "Check Your Email" : "Create Account"}
            </button>
          </form>

          <div className="mt-6 space-y-3">
            <p className="text-center text-xs text-stone-600">
              By continuing, you agree to our{" "}
              <a href="/terms" className="underline hover:text-stone-400">Terms</a> and{" "}
              <a href="/privacy" className="underline hover:text-stone-400">Privacy Policy</a>
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
     RENDER — Maintenance Mode Fallback
     ═══════════════════════════════════════════════════════════ */
  if (isMaintenanceMode) {
    return (
      <div className="min-h-screen bg-stone-950 flex items-center justify-center pt-24 px-4">
        <div className="flex flex-col items-center justify-center p-8 text-center bg-stone-900 border border-stone-800 rounded-lg shadow-xl max-w-md w-full">
          <div className="w-16 h-16 rounded-full bg-amber-500/10 border border-amber-500/20 flex items-center justify-center mb-5">
            <Coffee size={28} className="text-amber-400" />
          </div>
          <h1 className="font-playfair text-3xl text-white mb-3">Systems Under Maintenance</h1>
          <p className="text-stone-400 mb-6 leading-relaxed">
            BrewHub systems are currently undergoing maintenance. Please order at the counter — we&apos;ll be back online shortly.
          </p>
          <Link
            href="/"
            className="inline-flex items-center gap-2 px-6 py-3 bg-amber-600 text-white rounded-lg font-semibold hover:bg-amber-500 transition-colors"
          >
            Return Home
          </Link>
        </div>
      </div>
    );
  }

  /* ═══════════════════════════════════════════════════════════
     RENDER — Authenticated Dashboard
     ═══════════════════════════════════════════════════════════ */
  const unitLabel = unitNumber ? ` — Unit ${unitNumber}` : "";

  return (
    <div className="min-h-screen bg-stone-950 pt-24 pb-16">
      <div className="max-w-2xl mx-auto px-4 space-y-6">

        {/* ── Header ─────────────────────────────────────── */}
        <div className="flex justify-between items-center">
          <div>
            <h1 className="font-playfair text-3xl text-white">Welcome Home.</h1>
            <p className="text-stone-500 text-sm mt-1">{user.email}{unitLabel}</p>
          </div>
          <button
            onClick={() => supabase.auth.signOut().then(() => window.location.reload())}
            className="min-h-[44px] min-w-[44px] text-stone-600 hover:text-red-400 transition-colors p-2 rounded-lg hover:bg-stone-900 flex items-center justify-center"
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
          {dataLoading ? (
            <Skeleton className="mx-auto h-[160px] w-[160px] rounded-lg" />
          ) : qrError ? (
            <div className="mx-auto w-[160px] rounded-xl border border-stone-700 bg-stone-800/60 px-3 py-4 text-center">
              <QrCode size={28} className="mx-auto mb-2 text-stone-600" />
              <p className="text-[10px] text-stone-500 leading-snug mb-2">
                QR unavailable — show this ID at the counter
              </p>
              <span className="font-mono text-[11px] text-stone-300 break-all select-all">
                {user?.id?.slice(0, 13)}…
              </span>
            </div>
          ) : qrDataUrl ? (
            <img
              src={qrDataUrl}
              alt="Loyalty QR Code — show this at the cafe to earn rewards"
              className="mx-auto rounded-lg border border-stone-700"
              width={160}
              height={160}
            />
          ) : (
            <div className="mx-auto h-[160px] w-[160px] animate-pulse rounded-lg bg-stone-800" />
          )}
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
              <span className="text-4xl font-playfair text-white">
                {dataLoading ? <Skeleton className="inline-block h-10 w-8" /> : Math.floor((loyalty.points % 500) / 50)}
              </span>
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
            <button onClick={printKeychain} className="mt-4 min-h-[44px] text-[10px] uppercase tracking-widest text-stone-500 hover:text-stone-300 border border-stone-700 px-4 py-2 rounded-lg hover:bg-stone-800 transition-colors">
              Print Keychain Card
            </button>
          </div>
          <QrCode className="absolute -right-6 -bottom-6 opacity-[0.03] text-white" size={160} />
        </div>

        {/* ── Your Packages — 80s Phosphor Monitor ────────── */}
        {dataLoading ? (
          <CardSkeleton />
        ) : (
          <div className="relative overflow-hidden rounded-xl border border-amber-500/30 bg-black shadow-[0_0_30px_rgba(245,158,11,0.08)]">
            <PhosphorOverlay />
            <div className="relative z-20 p-6">
              {/* Monitor header bar */}
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <Package size={16} className="text-amber-400" />
                  <h2 className="font-mono text-sm font-bold uppercase tracking-[0.2em] text-amber-400">
                    My Packages
                  </h2>
                  {unitNumber && (
                    <span className="ml-2 font-mono text-[10px] text-amber-600">
                      UNIT {unitNumber}
                    </span>
                  )}
                </div>
                {parcels.length > 0 && (
                  <span className="flex items-center gap-1.5 font-mono text-xs font-bold text-amber-400 bg-amber-500/10 border border-amber-500/30 px-3 py-1 rounded animate-pulse">
                    <span className="w-2 h-2 rounded-full bg-amber-400" />
                    {parcels.length} WAITING
                  </span>
                )}
              </div>

              {parcels.length === 0 ? (
                <div className="text-center py-8">
                  <Truck className="mx-auto text-amber-900 mb-3" size={32} />
                  <p className="font-mono text-amber-700 text-sm">NO PACKAGES IN QUEUE</p>
                  <p className="font-mono text-amber-900 text-[10px] mt-1">SYS IDLE...</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {parcels.map((p) => (
                    <div
                      key={p.id}
                      className={`flex items-center gap-4 border rounded-lg p-4 transition-all duration-300 ${
                        parcelPop === p.id
                          ? "border-amber-400 bg-amber-500/10 scale-[1.02] shadow-[0_0_20px_rgba(245,158,11,0.3)]"
                          : "border-amber-500/20 bg-amber-500/5 hover:border-amber-500/40"
                      }`}
                    >
                      {/* Carrier icon */}
                      <div className="flex-shrink-0 w-10 h-10 rounded-full bg-black border border-amber-500/30 flex items-center justify-center">
                        <Package size={16} className="text-amber-400" />
                      </div>

                      {/* Detail */}
                      <div className="flex-1 min-w-0">
                        <p className="font-mono text-amber-300 text-sm font-semibold truncate">
                          {p.carrier?.toUpperCase() || "UNKNOWN CARRIER"}
                        </p>
                        <p className="font-mono text-amber-600 text-xs">
                          TRK ...{p.tracking_number?.slice(-8)} &middot; {fmtDate(p.received_at)}
                        </p>
                      </div>

                      {/* Status badge */}
                      <span className="flex-shrink-0 font-mono text-[10px] uppercase font-bold px-3 py-1 rounded border border-amber-500/40 bg-amber-500/15 text-amber-400">
                        📥 ARRIVED
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {/* CRT power LED */}
              <div className="flex items-center gap-2 mt-4 pt-3 border-t border-amber-500/10">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shadow-[0_0_6px_rgba(245,158,11,0.8)]" />
                <span className="font-mono text-[9px] text-amber-700 uppercase tracking-widest">
                  Parcel Monitor v2.0 — Live
                </span>
              </div>
            </div>
          </div>
        )}

        {/* ── Coffee Queue — KDS Sync ────────────────────── */}
        {dataLoading ? (
          <CardSkeleton />
        ) : coffeeQueue.length > 0 ? (
          <div className="bg-stone-900 border border-stone-800 rounded-xl p-6">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2 text-stone-400">
                <Coffee size={16} />
                <h2 className="font-playfair text-lg text-white">Coffee Queue</h2>
              </div>
              <span className="flex items-center gap-1.5 text-xs font-bold text-amber-400 bg-amber-500/10 border border-amber-500/20 px-3 py-1 rounded-full">
                <Zap size={10} className="text-amber-400" />
                LIVE
              </span>
            </div>

            <div className="space-y-3">
              {coffeeQueue.map((order) => {
                const isPreparing = order.status === "preparing";
                const isReady = order.status === "ready";
                return (
                  <div
                    key={order.id}
                    className={`rounded-lg border p-4 transition-all ${
                      isReady
                        ? "border-green-500/40 bg-green-500/5 shadow-[0_0_15px_rgba(34,197,94,0.1)]"
                        : "border-amber-500/30 bg-amber-500/5"
                    }`}
                  >
                    {/* Status banner */}
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        {isPreparing ? (
                          <>
                            <Coffee size={14} className="text-amber-400 animate-pulse" />
                            <span className="font-mono text-sm font-bold text-amber-400 animate-pulse">
                              Brewing...
                            </span>
                          </>
                        ) : (
                          <>
                            <Zap size={14} className="text-green-400" />
                            <span className="font-mono text-sm font-bold text-green-400">
                              Ready for Pickup!
                            </span>
                          </>
                        )}
                      </div>
                      <span className="font-mono text-[10px] text-stone-600">
                        {fmtTime(order.created_at)}
                      </span>
                    </div>

                    {/* Drink items */}
                    <div className="space-y-1.5">
                      {order.coffee_orders.map((item) => (
                        <div
                          key={item.id}
                          className="flex items-center gap-2 text-sm"
                        >
                          <span className={item.completed_at ? "text-stone-600 line-through" : "text-white"}>
                            {item.drink_name}
                          </span>
                          {item.customizations && (
                            <span className="text-stone-500 text-xs">
                              ({typeof item.customizations === "string"
                                ? item.customizations
                                : JSON.stringify(item.customizations)})
                            </span>
                          )}
                          {item.completed_at && (
                            <span className="text-green-500 text-xs">✓</span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}

        {/* ── Pickup QR Code ─────────────────────────────── */}
        {!dataLoading && (parcels.length > 0 || coffeeQueue.some((o) => o.status === "ready")) && (
          <div className="bg-stone-900 border border-stone-800 rounded-xl p-6 text-center">
            <div className="flex items-center justify-center gap-2 mb-4 text-stone-500">
              <QrCode size={16} />
              <span className="uppercase tracking-[0.2em] text-[10px] font-bold">Pick-up QR</span>
            </div>
            {pickupQrUrl ? (
              <>
                <img
                  src={pickupQrUrl}
                  alt="Pick-up QR — show to staff to collect your items"
                  className="mx-auto rounded-lg border border-amber-500/20"
                  width={180}
                  height={180}
                />
                <p className="text-amber-500/80 text-xs mt-3 font-mono">
                  Show this to staff to pick up packages or orders
                </p>
              </>
            ) : (
              <Skeleton className="mx-auto h-[180px] w-[180px] rounded-lg" />
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