"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/lib/supabase";
import { useOpsSession } from "@/components/OpsGate";
import {
  Coffee, CupSoda, Croissant, ShoppingCart, Plus, Minus, Trash2, X,
  ChevronRight, Clock, CheckCircle2, Loader2, CreditCard, Monitor,
  AlertTriangle, RotateCcw, ScanLine, UserCheck, Ticket, Video, VideoOff
} from "lucide-react";

/* ─── Types ────────────────────────────────────────────────────── */

interface MenuItem {
  id: string;
  name: string;
  price_cents: number;
  description: string | null;
  image_url: string | null;
}

interface Modifier {
  name: string;
  price_cents: number;
}

interface CartItem {
  id: string; // unique cart-line id
  productId: string; // merch_products UUID (for server-side price lookup)
  name: string;
  price_cents: number;
  modifiers: Modifier[];
  quantity: number;
}

interface LoyaltyCustomer {
  id: string;
  email: string;
  name: string | null;
  points: number;
  vouchers: { id: string; code: string }[];
}

type TicketPhase = "building" | "confirm" | "paying" | "paid" | "error";

/* ─── Haptic helper ────────────────────────────────────────────── */
function haptic(pattern: "tap" | "success" | "error") {
  if (typeof navigator === "undefined" || !navigator.vibrate) return;
  const p: Record<string, number | number[]> = {
    tap: 15, success: [15, 80, 15], error: [50, 30, 50, 30, 50],
  };
  try { navigator.vibrate(p[pattern]); } catch {}
}

/* ─── Constants ────────────────────────────────────────────────── */

const CATEGORIES: { key: string; label: string; icon: React.ReactNode; match: (n: string) => boolean }[] = [
  {
    key: "hot",
    label: "Hot Drinks",
    icon: <Coffee size={18} />,
    match: (n) => /latte|espresso|americano|cappuccino|drip|mocha|macchiato|cortado|coffee/i.test(n) && !/cold|iced/i.test(n),
  },
  {
    key: "cold",
    label: "Cold Drinks",
    icon: <CupSoda size={18} />,
    match: (n) => /cold brew|iced|lemonade|smoothie|frappe/i.test(n),
  },
  {
    key: "food",
    label: "Pastries & Food",
    icon: <Croissant size={18} />,
    match: (n) => /croissant|muffin|scone|bagel|sandwich|toast|cookie|cake|pastry|wrap/i.test(n),
  },
];

const DRINK_MODIFIERS: Modifier[] = [
  { name: "Oat Milk", price_cents: 75 },
  { name: "Almond Milk", price_cents: 75 },
  { name: "Extra Shot", price_cents: 100 },
  { name: "Vanilla Syrup", price_cents: 50 },
  { name: "Caramel Syrup", price_cents: 50 },
  { name: "Make it Iced", price_cents: 0 },
];

function categorize(name: string): string {
  for (const cat of CATEGORIES) {
    if (cat.match(name)) return cat.key;
  }
  return "food"; // default
}

function cents(c: number) {
  return `$${(c / 100).toFixed(2)}`;
}

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

export default function POSPage() {
  /* ─── State ──────────────────────────────────────────────────── */
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeCategory, setActiveCategory] = useState("hot");
  const [cart, setCart] = useState<CartItem[]>([]);
  const [selectedItem, setSelectedItem] = useState<MenuItem | null>(null);
  const [pendingMods, setPendingMods] = useState<Modifier[]>([]);
  const [clock, setClock] = useState(new Date());

  // Ticket lifecycle
  const [ticketPhase, setTicketPhase] = useState<TicketPhase>("building");
  const [createdOrderId, setCreatedOrderId] = useState<string | null>(null);
  const [terminalStatus, setTerminalStatus] = useState<string>("");
  const [errorMsg, setErrorMsg] = useState<string>("");
  const [orderSuccess, setOrderSuccess] = useState<string | null>(null);

  // Loyalty scanner
  const [loyaltyCustomer, setLoyaltyCustomer] = useState<LoyaltyCustomer | null>(null);
  const [loyaltyModalOpen, setLoyaltyModalOpen] = useState(false);
  const [loyaltyScanning, setLoyaltyScanning] = useState(false);
  const [loyaltyCamError, setLoyaltyCamError] = useState<string | null>(null);
  const loyaltyVideoRef = useRef<HTMLVideoElement>(null);
  const loyaltyStreamRef = useRef<MediaStream | null>(null);
  const loyaltyAnimRef = useRef<number>(0);
  const loyaltyScanLock = useRef(false);

  /* ─── Clock ──────────────────────────────────────────────────── */
  useEffect(() => {
    const t = setInterval(() => setClock(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  /* ─── Fetch menu ─────────────────────────────────────────────── */
  useEffect(() => {
    (async () => {
      const { data, error } = await supabase
        .from("merch_products")
        .select("id, name, price_cents, description, image_url")
        .eq("is_active", true)
        .order("sort_order", { ascending: true })
        .order("name", { ascending: true });

      if (!error && data) setMenuItems(data);
      setLoading(false);
    })();
  }, []);

  /* ─── Derived ────────────────────────────────────────────────── */
  const filteredItems = menuItems.filter((i) => categorize(i.name) === activeCategory);
  const cartTotal = cart.reduce(
    (sum, ci) => sum + (ci.price_cents + ci.modifiers.reduce((s, m) => s + m.price_cents, 0)) * ci.quantity,
    0
  );
  const cartCount = cart.reduce((s, ci) => s + ci.quantity, 0);

  /* ─── Cart helpers ───────────────────────────────────────────── */
  const addToCart = useCallback(
    (item: MenuItem, mods: Modifier[]) => {
      setCart((prev) => [
        ...prev,
        { id: uid(), productId: item.id, name: item.name, price_cents: item.price_cents, modifiers: mods, quantity: 1 },
      ]);
    },
    []
  );

  const updateQty = useCallback((id: string, delta: number) => {
    setCart((prev) =>
      prev
        .map((ci) => (ci.id === id ? { ...ci, quantity: ci.quantity + delta } : ci))
        .filter((ci) => ci.quantity > 0)
    );
  }, []);

  const removeItem = useCallback((id: string) => {
    setCart((prev) => prev.filter((ci) => ci.id !== id));
  }, []);

  const clearCart = useCallback(() => {
    setCart([]);
    setTicketPhase("building");
    setCreatedOrderId(null);
    setTerminalStatus("");
    setErrorMsg("");
    setLoyaltyCustomer(null);
  }, []);

  /* ─── Builder panel ──────────────────────────────────────────── */
  const openBuilder = (item: MenuItem) => {
    setSelectedItem(item);
    setPendingMods([]);
  };

  const toggleMod = (mod: Modifier) => {
    setPendingMods((prev) =>
      prev.find((m) => m.name === mod.name) ? prev.filter((m) => m.name !== mod.name) : [...prev, mod]
    );
  };

  const confirmBuilder = () => {
    if (selectedItem) addToCart(selectedItem, pendingMods);
    setSelectedItem(null);
    setPendingMods([]);
  };

  const quickAdd = (item: MenuItem) => {
    // For food items, skip builder and add directly
    if (categorize(item.name) === "food") {
      addToCart(item, []);
    } else {
      openBuilder(item);
    }
  };

  /* ─── Auth: use PIN session token for API calls ───────────── */
  const opsSession = useOpsSession();
  const getAccessToken = () => opsSession.token;

  /* ─── Loyalty Camera Scanning ─────────────────────────────── */
  const openLoyaltyScanner = () => {
    setLoyaltyModalOpen(true);
    setLoyaltyCamError(null);
    loyaltyScanLock.current = false;
  };

  const closeLoyaltyScanner = useCallback(() => {
    // Stop camera tracks
    if (loyaltyStreamRef.current) {
      loyaltyStreamRef.current.getTracks().forEach(t => t.stop());
      loyaltyStreamRef.current = null;
    }
    if (loyaltyAnimRef.current) cancelAnimationFrame(loyaltyAnimRef.current);
    setLoyaltyScanning(false);
    setLoyaltyModalOpen(false);
    setLoyaltyCamError(null);
  }, []);

  const startLoyaltyCamera = useCallback(async () => {
    setLoyaltyCamError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      loyaltyStreamRef.current = stream;
      if (loyaltyVideoRef.current) {
        loyaltyVideoRef.current.srcObject = stream;
        await loyaltyVideoRef.current.play();
      }
      setLoyaltyScanning(true);
      startLoyaltyDetection();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Camera access denied";
      setLoyaltyCamError(msg);
      haptic("error");
    }
  }, []);

  // Use native BarcodeDetector (Safari/iOS 17+) with no-op fallback
  const startLoyaltyDetection = useCallback(() => {
    if (!("BarcodeDetector" in window)) {
      setLoyaltyCamError("BarcodeDetector not available — use Safari on iOS 16.4+");
      return;
    }
    const detector = new (window as any).BarcodeDetector({ formats: ["qr_code"] });
    const detect = async () => {
      if (!loyaltyVideoRef.current || !loyaltyStreamRef.current) return;
      try {
        const barcodes = await detector.detect(loyaltyVideoRef.current);
        if (barcodes.length > 0 && !loyaltyScanLock.current) {
          loyaltyScanLock.current = true;
          haptic("tap");
          await handleLoyaltyScan(barcodes[0].rawValue);
        }
      } catch {}
      loyaltyAnimRef.current = requestAnimationFrame(detect);
    };
    loyaltyAnimRef.current = requestAnimationFrame(detect);
  }, []);

  // Auto-start camera when modal opens
  useEffect(() => {
    if (loyaltyModalOpen) {
      // Small delay to let the <video> element mount
      const t = setTimeout(() => startLoyaltyCamera(), 150);
      return () => clearTimeout(t);
    }
  }, [loyaltyModalOpen, startLoyaltyCamera]);

  // Cleanup camera on unmount
  useEffect(() => () => closeLoyaltyScanner(), [closeLoyaltyScanner]);

  /* ─── Loyalty Lookup ──────────────────────────────────────── */
  const handleLoyaltyScan = async (rawValue: string) => {
    const email = rawValue.trim().toLowerCase();
    const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!EMAIL_RE.test(email)) {
      haptic("error");
      setLoyaltyCamError("QR does not contain a valid email");
      loyaltyScanLock.current = false;
      return;
    }

    try {
      // Look up profile by email
      const { data: profile, error: pErr } = await supabase
        .from("profiles")
        .select("id, full_name, loyalty_points")
        .eq("email", email)
        .maybeSingle();

      if (pErr) throw pErr;
      if (!profile) {
        haptic("error");
        setLoyaltyCamError(`No account found for ${email}`);
        loyaltyScanLock.current = false;
        return;
      }

      // Fetch unredeemed vouchers
      const { data: vouchers } = await supabase
        .from("vouchers")
        .select("id, code")
        .eq("user_id", profile.id)
        .eq("is_redeemed", false);

      setLoyaltyCustomer({
        id: profile.id,
        email,
        name: profile.full_name,
        points: profile.loyalty_points ?? 0,
        vouchers: vouchers ?? [],
      });
      haptic("success");
      closeLoyaltyScanner();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Lookup failed";
      setLoyaltyCamError(msg);
      haptic("error");
      loyaltyScanLock.current = false;
    }
  };

  /* ─── Step 1: Send to KDS (create Supabase order immediately) ─ */
  const handleSendToKDS = async () => {
    if (cart.length === 0) return;
    setTicketPhase("confirm");

    try {
      const token = getAccessToken();

      // Build cart payload — one entry per distinct item with quantity
      // Uses product_id (UUID) for secure server-side price lookup
      const payload: { product_id: string; quantity: number }[] = cart.map((ci) => ({
        product_id: ci.productId,
        quantity: ci.quantity,
      }));

      // Attach loyalty customer fields when scanned
      const checkoutBody: Record<string, unknown> = { items: payload, terminal: true };
      if (loyaltyCustomer) {
        checkoutBody.user_id = loyaltyCustomer.id;
        checkoutBody.customer_email = loyaltyCustomer.email;
        checkoutBody.customer_name = loyaltyCustomer.name;
      }

      // Call cafe-checkout to create the order in Supabase
      // This creates both the orders row AND coffee_orders line items
      const resp = await fetch("/.netlify/functions/cafe-checkout", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          "X-BrewHub-Action": "true",
        },
        body: JSON.stringify(checkoutBody),
      });

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err.error || "Failed to create order");
      }

      const result = await resp.json();
      const orderId = result.order?.id;

      if (!orderId) throw new Error("No order ID returned");

      setCreatedOrderId(orderId);
      setOrderSuccess(orderId.slice(0, 6).toUpperCase());
      setTimeout(() => setOrderSuccess(null), 4000);

    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Order creation failed";
      setErrorMsg(msg);
      setTicketPhase("error");
    }
  };

  /* ─── Step 2: Pay on Terminal (calls collect-payment) ────────── */
  const handlePayOnTerminal = async () => {
    if (!createdOrderId) return;
    setTicketPhase("paying");
    setTerminalStatus("Sending to terminal…");

    try {
      const token = getAccessToken();

      const resp = await fetch("/.netlify/functions/collect-payment", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          "X-BrewHub-Action": "true",
        },
        body: JSON.stringify({ orderId: createdOrderId }),
      });

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err.error || "Terminal payment failed");
      }

      const result = await resp.json();
      setTerminalStatus("Waiting for customer tap/swipe…");

      // Payment was sent to the Square Terminal successfully
      // The webhook will update the order status when payment completes
      setTicketPhase("paid");
      setTerminalStatus(`Checkout sent! ID: ${result.checkout?.id?.slice(0, 8) || "OK"}`);

      // Clear after delay
      setTimeout(() => {
        setCart([]);
        setTicketPhase("building");
        setCreatedOrderId(null);
        setTerminalStatus("");
      }, 5000);

    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Terminal payment failed";
      setErrorMsg(msg);
      setTicketPhase("error");
    }
  };

  /* ─── Mark as Paid (skip terminal — cash, comp, etc.) ────────── */
  const handleMarkPaid = async () => {
    if (!createdOrderId) return;
    setTicketPhase("paying");
    setTerminalStatus("Recording cash payment…");

    try {
      const token = getAccessToken();
      const resp = await fetch("/.netlify/functions/update-order-status", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          "X-BrewHub-Action": "true",
        },
        body: JSON.stringify({
          orderId: createdOrderId,
          status: "preparing",
          paymentMethod: "cash",
        }),
      });

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err.error || "Failed to record payment");
      }

      setTicketPhase("paid");
      setTerminalStatus("Marked paid (cash) — order on KDS");

      setTimeout(() => {
        setCart([]);
        setTicketPhase("building");
        setCreatedOrderId(null);
        setTerminalStatus("");
      }, 3000);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Failed to record payment";
      setErrorMsg(msg);
      setTicketPhase("error");
    }
  };

  /* ─── Reset from error ───────────────────────────────────────── */
  const handleRetry = () => {
    setTicketPhase("building");
    setErrorMsg("");
    setTerminalStatus("");
  };

  /* ─── Render ─────────────────────────────────────────────────── */
  return (
    <div className="h-screen w-screen flex bg-stone-950 text-white select-none overflow-hidden">
      {/* ═══════ COL 1 — Categories ═══════ */}
      <aside className="w-[140px] bg-stone-900 flex flex-col border-r border-stone-800 shrink-0">
        {/* Logo */}
        <div className="px-4 py-5 border-b border-stone-800 flex items-center gap-2">
          <img src="/logo.png" alt="BrewHub" className="w-8 h-8 rounded-full" />
          <span className="font-bold text-sm tracking-tight">POS</span>
        </div>

        {/* Category Buttons */}
        <nav className="flex-1 py-4 space-y-1 px-2">
          {CATEGORIES.map((cat) => (
            <button
              key={cat.key}
              onClick={() => { setActiveCategory(cat.key); setSelectedItem(null); }}
              className={`w-full flex items-center gap-2 px-3 py-3 rounded-lg text-xs font-semibold uppercase tracking-wider transition-all
                ${activeCategory === cat.key
                  ? "bg-amber-500/20 text-amber-400 border border-amber-500/30"
                  : "text-stone-400 hover:bg-stone-800 hover:text-stone-200 border border-transparent"
                }`}
            >
              {cat.icon}
              <span className="truncate">{cat.label}</span>
            </button>
          ))}
        </nav>

        {/* Clock */}
        <div className="px-4 py-4 border-t border-stone-800 text-center">
          <div className="text-lg font-mono font-bold text-stone-300">
            {clock.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          </div>
          <div className="text-[10px] text-stone-600 uppercase tracking-widest mt-0.5">
            {clock.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })}
          </div>
        </div>
      </aside>

      {/* ═══════ COL 2 — Product Builder (Item Grid + Modifier Panel) ═══════ */}
      <div className="flex-1 flex flex-col min-w-0 relative">
        {/* Top Bar */}
        <header className="h-14 bg-stone-900/60 backdrop-blur border-b border-stone-800 flex items-center justify-between px-6 shrink-0">
          <h1 className="text-sm font-bold uppercase tracking-[0.2em] text-stone-400">
            {CATEGORIES.find((c) => c.key === activeCategory)?.label || "Menu"}
          </h1>
          <div className="flex items-center gap-3 text-xs text-stone-500">
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              Connected
            </span>
          </div>
        </header>

        {/* Item Grid */}
        <div className="flex-1 overflow-y-auto p-6">
          {loading ? (
            <div className="flex items-center justify-center h-full">
              <Loader2 className="animate-spin text-stone-600" size={32} />
            </div>
          ) : filteredItems.length === 0 ? (
            <div className="flex items-center justify-center h-full text-stone-600 text-sm">
              No items in this category
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
              {filteredItems.map((item) => (
                <button
                  key={item.id}
                  onClick={() => quickAdd(item)}
                  disabled={ticketPhase !== "building"}
                  className="group bg-stone-900 hover:bg-stone-800 border border-stone-800 hover:border-amber-500/40 rounded-xl p-5 text-left transition-all active:scale-[0.97] flex flex-col justify-between min-h-[140px] disabled:opacity-40 disabled:pointer-events-none"
                >
                  <div>
                    <h3 className="font-bold text-base text-stone-100 group-hover:text-amber-300 transition-colors">
                      {item.name}
                    </h3>
                    {item.description && (
                      <p className="text-stone-500 text-xs mt-1 line-clamp-2">{item.description}</p>
                    )}
                  </div>
                  <div className="flex items-end justify-between mt-3">
                    <span className="text-amber-400 font-bold text-lg">{cents(item.price_cents)}</span>
                    <Plus size={18} className="text-stone-600 group-hover:text-amber-400 transition-colors" />
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* ═══════ Builder Panel Overlay ═══════ */}
        {selectedItem && (
          <>
            {/* Backdrop */}
            <div
              className="absolute inset-0 bg-black/50 z-10 animate-in fade-in duration-200"
              onClick={() => setSelectedItem(null)}
            />
            {/* Panel */}
            <div className="absolute inset-y-0 right-0 w-full max-w-md bg-stone-900 border-l border-stone-700 z-20 flex flex-col animate-in slide-in-from-right duration-300">
              {/* Header */}
              <div className="p-6 border-b border-stone-800 flex items-start justify-between">
                <div>
                  <h2 className="text-2xl font-bold text-white">{selectedItem.name}</h2>
                  <p className="text-amber-400 font-semibold text-lg mt-1">{cents(selectedItem.price_cents)}</p>
                  {selectedItem.description && (
                    <p className="text-stone-500 text-sm mt-2">{selectedItem.description}</p>
                  )}
                </div>
                <button
                  onClick={() => setSelectedItem(null)}
                  className="p-2 hover:bg-stone-800 rounded-lg transition-colors"
                >
                  <X size={20} className="text-stone-400" />
                </button>
              </div>

              {/* Modifiers */}
              <div className="flex-1 overflow-y-auto p-6">
                <h3 className="text-xs font-bold uppercase tracking-[0.2em] text-stone-500 mb-4">
                  Customize
                </h3>
                <div className="space-y-2">
                  {DRINK_MODIFIERS.map((mod) => {
                    const active = pendingMods.some((m) => m.name === mod.name);
                    return (
                      <button
                        key={mod.name}
                        onClick={() => toggleMod(mod)}
                        className={`w-full flex items-center justify-between px-4 py-3 rounded-lg border transition-all text-sm
                          ${active
                            ? "bg-amber-500/15 border-amber-500/40 text-amber-300"
                            : "bg-stone-800/50 border-stone-700 text-stone-300 hover:border-stone-600"
                          }`}
                      >
                        <span className="font-medium">{mod.name}</span>
                        <span className="text-xs">
                          {mod.price_cents > 0 ? `+${cents(mod.price_cents)}` : "Free"}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Confirm */}
              <div className="p-6 border-t border-stone-800">
                <div className="flex items-center justify-between mb-3 text-sm">
                  <span className="text-stone-500">Item total</span>
                  <span className="font-bold text-white text-lg">
                    {cents(selectedItem.price_cents + pendingMods.reduce((s, m) => s + m.price_cents, 0))}
                  </span>
                </div>
                <button
                  onClick={confirmBuilder}
                  className="w-full py-4 bg-amber-500 hover:bg-amber-400 text-stone-950 font-bold text-sm uppercase tracking-[0.15em] rounded-lg transition-colors active:scale-[0.98]"
                >
                  Add to Order
                </button>
              </div>
            </div>
          </>
        )}
      </div>

      {/* ═══════ COL 3 — Live Ticket ═══════ */}
      <aside className="w-[340px] bg-stone-900 border-l border-stone-800 flex flex-col shrink-0">
        {/* Ticket Header */}
        <div className="px-5 py-4 border-b border-stone-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ShoppingCart size={16} className="text-stone-500" />
            <h2 className="font-bold text-sm uppercase tracking-widest text-stone-400">
              {ticketPhase === "building" ? "Current Order" :
               ticketPhase === "confirm" ? "Confirm & Pay" :
               ticketPhase === "paying" ? "Processing…" :
               ticketPhase === "paid" ? "Complete" : "Error"}
            </h2>
          </div>
          {cart.length > 0 && ticketPhase === "building" && (
            <button onClick={clearCart} className="text-xs text-stone-600 hover:text-red-400 transition-colors">
              Clear
            </button>
          )}
        </div>

        {/* ── Loyalty Badge / Scan Button ── */}
        <div className="px-5 py-3 border-b border-stone-800/60">
          {loyaltyCustomer ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-emerald-400 text-xs font-semibold">
                  <UserCheck size={14} />
                  <span>👤 Linked: {loyaltyCustomer.name ?? loyaltyCustomer.email}</span>
                </div>
                <button
                  onClick={() => setLoyaltyCustomer(null)}
                  className="text-stone-600 hover:text-red-400 transition-colors"
                  title="Unlink customer"
                >
                  <X size={14} />
                </button>
              </div>
              <p className="text-[11px] text-stone-500">
                {loyaltyCustomer.points} pts
              </p>
              {loyaltyCustomer.vouchers.length > 0 && (
                <div className="flex items-center gap-1.5 bg-amber-500/15 border border-amber-500/30 rounded-lg px-3 py-2">
                  <Ticket size={14} className="text-amber-400" />
                  <span className="text-amber-300 text-xs font-bold">
                    🎟️ Free Drink Available!
                  </span>
                </div>
              )}
            </div>
          ) : (
            <button
              onClick={openLoyaltyScanner}
              disabled={ticketPhase !== "building"}
              className="w-full flex items-center justify-center gap-2 py-2.5 bg-stone-800 hover:bg-stone-700 disabled:opacity-40 disabled:pointer-events-none border border-stone-700 rounded-lg text-xs font-semibold text-stone-300 uppercase tracking-[0.1em] transition-all"
            >
              <ScanLine size={14} /> Scan Loyalty
            </button>
          )}
        </div>

        {/* Cart Items */}
        <div className="flex-1 overflow-y-auto">
          {cart.length === 0 && ticketPhase === "building" ? (
            <div className="flex flex-col items-center justify-center h-full text-stone-700 gap-2">
              <ShoppingCart size={32} />
              <p className="text-xs uppercase tracking-widest">No items yet</p>
            </div>
          ) : (
            <div className="divide-y divide-stone-800/50">
              {cart.map((ci) => {
                const lineTotal = (ci.price_cents + ci.modifiers.reduce((s, m) => s + m.price_cents, 0)) * ci.quantity;
                return (
                  <div key={ci.id} className="px-5 py-3 group">
                    <div className="flex items-start justify-between">
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-sm text-stone-200">{ci.name}</p>
                        {ci.modifiers.length > 0 && (
                          <p className="text-xs text-amber-500/70 mt-0.5">
                            {ci.modifiers.map((m) => m.name).join(", ")}
                          </p>
                        )}
                      </div>
                      <span className="text-sm font-bold text-stone-300 ml-2">{cents(lineTotal)}</span>
                    </div>
                    {ticketPhase === "building" && (
                      <div className="flex items-center justify-between mt-2">
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => updateQty(ci.id, -1)}
                            className="w-7 h-7 flex items-center justify-center rounded bg-stone-800 hover:bg-stone-700 transition-colors"
                          >
                            <Minus size={12} />
                          </button>
                          <span className="w-8 text-center text-sm font-mono font-bold">{ci.quantity}</span>
                          <button
                            onClick={() => updateQty(ci.id, 1)}
                            className="w-7 h-7 flex items-center justify-center rounded bg-stone-800 hover:bg-stone-700 transition-colors"
                          >
                            <Plus size={12} />
                          </button>
                        </div>
                        <button
                          onClick={() => removeItem(ci.id)}
                          className="opacity-0 group-hover:opacity-100 p-1 text-stone-600 hover:text-red-400 transition-all"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* ═══════ Ticket Footer — phase-dependent ═══════ */}
        <div className="border-t border-stone-800 p-5 space-y-3">
          {/* Total (always visible when cart has items) */}
          {cartCount > 0 && (
            <div className="flex items-end justify-between">
              <div>
                <span className="text-[10px] text-stone-600 uppercase tracking-widest block">
                  {cartCount} {cartCount === 1 ? "item" : "items"}
                </span>
                <span className="text-xs text-stone-500 uppercase tracking-widest">Total</span>
              </div>
              <span className="text-3xl font-bold text-white font-mono">{cents(cartTotal)}</span>
            </div>
          )}

          {/* Phase: BUILDING — Send to KDS button */}
          {ticketPhase === "building" && (
            <button
              disabled={cart.length === 0}
              onClick={handleSendToKDS}
              className="w-full py-4 bg-emerald-600 hover:bg-emerald-500 disabled:bg-stone-800 disabled:text-stone-600 text-white font-bold text-sm uppercase tracking-[0.2em] rounded-lg transition-all active:scale-[0.98] flex items-center justify-center gap-2"
            >
              <ChevronRight size={16} /> Send to KDS
            </button>
          )}

          {/* Phase: CONFIRM — Pay on Terminal / Mark Paid */}
          {ticketPhase === "confirm" && (
            <div className="space-y-2">
              {createdOrderId && (
                <p className="text-xs text-emerald-400 font-mono text-center mb-2">
                  Order #{createdOrderId.slice(0, 6).toUpperCase()} on KDS
                </p>
              )}

              <button
                onClick={handlePayOnTerminal}
                className="w-full py-4 bg-blue-600 hover:bg-blue-500 text-white font-bold text-sm uppercase tracking-[0.2em] rounded-lg transition-all active:scale-[0.98] flex items-center justify-center gap-2"
              >
                <Monitor size={16} /> Pay on Terminal
              </button>

              <button
                onClick={handleMarkPaid}
                className="w-full py-3 bg-stone-800 hover:bg-stone-700 text-stone-300 font-semibold text-xs uppercase tracking-[0.15em] rounded-lg transition-all flex items-center justify-center gap-2"
              >
                <CreditCard size={14} /> Cash / Comp / Already Paid
              </button>

              <button
                onClick={clearCart}
                className="w-full py-2 text-xs text-stone-600 hover:text-red-400 transition-colors text-center"
              >
                Cancel Order
              </button>
            </div>
          )}

          {/* Phase: PAYING — waiting on terminal */}
          {ticketPhase === "paying" && (
            <div className="flex flex-col items-center gap-3 py-4">
              <Loader2 size={28} className="animate-spin text-blue-400" />
              <p className="text-sm text-blue-300 font-semibold">{terminalStatus}</p>
              <p className="text-[10px] text-stone-600 uppercase tracking-widest">
                Waiting for Square Terminal
              </p>
            </div>
          )}

          {/* Phase: PAID — success */}
          {ticketPhase === "paid" && (
            <div className="flex flex-col items-center gap-3 py-4">
              <CheckCircle2 size={28} className="text-emerald-400" />
              <p className="text-sm text-emerald-300 font-semibold">{terminalStatus}</p>
              <p className="text-[10px] text-stone-600 uppercase tracking-widest">Starting next order…</p>
            </div>
          )}

          {/* Phase: ERROR */}
          {ticketPhase === "error" && (
            <div className="space-y-3">
              <div className="flex items-start gap-2 bg-red-500/10 border border-red-500/30 rounded-lg p-3">
                <AlertTriangle size={16} className="text-red-400 shrink-0 mt-0.5" />
                <p className="text-xs text-red-300">{errorMsg}</p>
              </div>
              <button
                onClick={handleRetry}
                className="w-full py-3 bg-stone-800 hover:bg-stone-700 text-stone-300 font-semibold text-xs uppercase tracking-[0.15em] rounded-lg transition-all flex items-center justify-center gap-2"
              >
                <RotateCcw size={14} /> Try Again
              </button>
            </div>
          )}
        </div>
      </aside>

      {/* ═══════ Order Success Toast ═══════ */}
      {orderSuccess && (
        <div className="fixed top-8 left-1/2 -translate-x-1/2 z-50 bg-emerald-600 text-white px-8 py-4 rounded-xl shadow-2xl flex items-center gap-3 animate-in slide-in-from-top duration-300">
          <CheckCircle2 size={24} />
          <div>
            <p className="font-bold text-sm">Order on KDS!</p>
            <p className="text-emerald-200 text-xs font-mono">#{orderSuccess}</p>
          </div>
        </div>
      )}

      {/* ═══════ Loyalty QR Camera Modal ═══════ */}
      {loyaltyModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 animate-in fade-in duration-200">
          <div className="bg-stone-900 border border-stone-700 rounded-2xl w-full max-w-md mx-4 overflow-hidden shadow-2xl">
            {/* Modal Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-stone-800">
              <div className="flex items-center gap-2">
                <ScanLine size={16} className="text-amber-400" />
                <h3 className="font-bold text-sm uppercase tracking-[0.15em] text-stone-300">Scan Loyalty QR</h3>
              </div>
              <button onClick={closeLoyaltyScanner} className="p-2 hover:bg-stone-800 rounded-lg transition-colors">
                <X size={18} className="text-stone-400" />
              </button>
            </div>

            {/* Camera Viewfinder */}
            <div className="relative bg-black aspect-[4/3]">
              <video
                ref={loyaltyVideoRef}
                className="w-full h-full object-cover"
                playsInline
                muted
              />
              {/* Scan overlay crosshair */}
              {loyaltyScanning && (
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <div className="w-48 h-48 border-2 border-amber-400/60 rounded-2xl" />
                </div>
              )}
              {!loyaltyScanning && !loyaltyCamError && (
                <div className="absolute inset-0 flex items-center justify-center">
                  <Loader2 size={32} className="animate-spin text-stone-600" />
                </div>
              )}
            </div>

            {/* Error / Status */}
            {loyaltyCamError && (
              <div className="px-5 py-3 bg-red-500/10 border-t border-red-500/30">
                <div className="flex items-start gap-2">
                  <AlertTriangle size={14} className="text-red-400 shrink-0 mt-0.5" />
                  <p className="text-xs text-red-300">{loyaltyCamError}</p>
                </div>
              </div>
            )}

            {/* Footer hint */}
            <div className="px-5 py-3 border-t border-stone-800 text-center">
              <p className="text-[11px] text-stone-500">
                Point camera at the customer&apos;s QR code in the BrewHub app
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
