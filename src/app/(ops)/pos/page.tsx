"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/lib/supabase";
import { useOpsSession } from "@/components/OpsGate";
import {
  Coffee, CupSoda, Croissant, ShoppingCart, Plus, X,
  ChevronRight, CheckCircle2, Loader2, CreditCard, Monitor,
  AlertTriangle, RotateCcw, ScanLine, UserCheck, Ticket,
  Gift, WifiOff, RefreshCw, Package, Printer
} from "lucide-react";
import SwipeCartItem from "@/components/SwipeCartItem";
import { useConnection } from "@/lib/useConnection";
import OfflineBanner from "@/components/OfflineBanner";
import OnscreenKeyboard from "@/components/OnscreenKeyboard";
import { toUserSafeMessage, toUserSafeMessageFromUnknown } from "@/lib/errorCatalog";
import {
  cacheMenu, getCachedMenu, queueOfflineOrder, getUnsyncedOrders,
  markOrderSynced, clearSyncedOrders, type OfflineOrder, type CachedMenuItem,
} from "@/lib/offlineStore";

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
  {
    key: "merch",
    label: "Merch",
    icon: <Package size={18} />,
    match: (n) => /tee|shirt|hat|cap|hoodie|beanie|mug|tumbler|sticker|tote|bag|merch|pin|patch|poster/i.test(n),
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

/** Categories that skip the drink modifier panel */
const NO_MODIFIER_CATEGORIES = new Set(["food", "merch"]);

function cents(c: number) {
  return `$${(c / 100).toFixed(2)}`;
}

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

export default function POSPage() {
  /* ─── Connection monitoring ──────────────────────────────────── */
  const { isOnline, wasOffline, offlineSince } = useConnection();

  /* ─── State ──────────────────────────────────────────────────── */
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [menuSource, setMenuSource] = useState<"live" | "cached">("live");
  const [loading, setLoading] = useState(true);
  const [offlineOrders, setOfflineOrders] = useState<OfflineOrder[]>([]);
  const [syncingOrders, setSyncingOrders] = useState(false);
  const [activeCategory, setActiveCategory] = useState("hot");

  // Offline session management (Ghost Revenue defense)
  const [offlineSessionId, setOfflineSessionId] = useState<string | null>(null);
  const [offlineExposure, setOfflineExposure] = useState<{
    cashTotalCents: number;
    capCents: number;
    pctUsed: number;
    remainingCents: number;
  } | null>(null);
  const [offlineCapBlocked, setOfflineCapBlocked] = useState(false);
  const [recoveryReport, setRecoveryReport] = useState<{
    durationMinutes: number;
    cashTotalCents: number;
    ordersCount: number;
  } | null>(null);
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
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Voucher redemption
  const [voucherPhase, setVoucherPhase] = useState<"idle" | "redeeming" | "success" | "network-error" | "error">("idle");
  const [voucherError, setVoucherError] = useState("");
  const [voucherRetryCode, setVoucherRetryCode] = useState<string | null>(null);

  // Mobile cart drawer
  const [cartDrawerOpen, setCartDrawerOpen] = useState(false);

  // Loyalty scanner
  const [loyaltyCustomer, setLoyaltyCustomer] = useState<LoyaltyCustomer | null>(null);
  const [loyaltyModalOpen, setLoyaltyModalOpen] = useState(false);
  const [loyaltyScanning, setLoyaltyScanning] = useState(false);
  const [loyaltyCamError, setLoyaltyCamError] = useState<string | null>(null);
  const loyaltyVideoRef = useRef<HTMLVideoElement>(null);
  const loyaltyStreamRef = useRef<MediaStream | null>(null);
  const loyaltyAnimRef = useRef<number>(0);
  const loyaltyScanLock = useRef(false);

  // Guest-first-name modal (Option 2)
  const [guestModalOpen, setGuestModalOpen] = useState(false);
  const [guestFirstName, setGuestFirstName] = useState<string>("");
  const guestInputRef = useRef<HTMLInputElement | null>(null);
  const [showOnscreenKeyboard, setShowOnscreenKeyboard] = useState(false);

  // Comp modal
  const [compModalOpen, setCompModalOpen] = useState(false);
  const [compReason, setCompReason] = useState("");
  const [compSubmitting, setCompSubmitting] = useState(false);

  // Receipt reprint
  const [reprintLoading, setReprintLoading] = useState(false);

  // POS-6: ref-stable handleLoyaltyScan so startLoyaltyDetection never holds a stale closure
  const handleLoyaltyScanRef = useRef<(rawValue: string) => Promise<void>>(null!);

  // POS-1: useRef lock to prevent duplicate handleSendToKDS calls (race condition fix)
  const submittingRef = useRef(false);

  /* ─── Clock (POS-7: 60s interval — display is HH:MM only) ───── */
  useEffect(() => {
    const t = setInterval(() => setClock(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);

  /* ─── Fetch menu (with offline fallback) ──────────────────────── */
  useEffect(() => {
    (async () => {
      try {
        const { data, error } = await supabase
          .from("merch_products")
          .select("id, name, price_cents, description, image_url")
          .eq("is_active", true)
          .is("archived_at", null)
          .order("sort_order", { ascending: true })
          .order("name", { ascending: true });

        if (!error && data && data.length > 0) {
          setMenuItems(data);
          setMenuSource("live");
          // Cache to IndexedDB for offline use
          cacheMenu(data).catch(() => {});
        } else {
          throw new Error("No menu data from Supabase");
        }
      } catch {
        // Network down or Supabase unreachable — load from IndexedDB
        try {
          const cached = await getCachedMenu();
          if (cached.length > 0) {
            setMenuItems(cached as MenuItem[]);
            setMenuSource("cached");
          }
        } catch { /* IndexedDB also failed — menu stays empty */ }
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  /* ─── Auto-open offline session when connection drops ────── */
  useEffect(() => {
    if (isOnline || offlineSessionId) return;
    (async () => {
      try {
        const token = getAccessToken();
        if (!token) return;
        const res = await fetch("/.netlify/functions/offline-session", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
            "X-BrewHub-Action": "true",
          },
          body: JSON.stringify({ action: "open" }),
        });
        if (res.ok) {
          const data = await res.json();
          setOfflineSessionId(data.session_id);
          setOfflineExposure({
            cashTotalCents: 0,
            capCents: data.cap_cents || 20000,
            pctUsed: 0,
            remainingCents: data.cap_cents || 20000,
          });
          setOfflineCapBlocked(false);
          console.log(`[POS] Opened offline session ${data.session_id} (cap: $${(data.cap_cents / 100).toFixed(2)})`);
        }
      } catch {
        // Can't reach server — that's expected, open session locally
        const localId = `local-${Date.now()}`;
        setOfflineSessionId(localId);
        setOfflineExposure({
          cashTotalCents: 0,
          capCents: 20000, // Default $200 cap
          pctUsed: 0,
          remainingCents: 20000,
        });
      }
    })();
  }, [isOnline, offlineSessionId]);

  /* ─── Sync offline orders when connection restores ──────────── */
  useEffect(() => {
    if (!wasOffline || !isOnline) return;
    (async () => {
      setSyncingOrders(true);

      // ── Close offline session and show recovery report ──
      if (offlineSessionId && !offlineSessionId.startsWith('local-')) {
        try {
          const token = getAccessToken();
          if (token) {
            const closeRes = await fetch("/.netlify/functions/offline-session", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${token}`,
                "X-BrewHub-Action": "true",
              },
              body: JSON.stringify({ action: "close", session_id: offlineSessionId }),
            });
            if (closeRes.ok) {
              const data = await closeRes.json();
              if (data.session_id) {
                setRecoveryReport({
                  durationMinutes: data.duration_minutes || 0,
                  cashTotalCents: data.cash_total_cents || 0,
                  ordersCount: data.orders_count || 0,
                });
                console.log(`[POS] Closed offline session — ${data.duration_minutes}min, $${(data.cash_total_cents / 100).toFixed(2)}, ${data.orders_count} orders`);
                // Auto-dismiss recovery report after 10 seconds
                setTimeout(() => setRecoveryReport(null), 10000);
              }
            }
          }
        } catch (e: unknown) {
          console.error('[POS] Failed to close offline session:', (e as Error)?.message);
        }
      }
      setOfflineSessionId(null);
      setOfflineExposure(null);
      setOfflineCapBlocked(false);

      try {
        const pending = await getUnsyncedOrders();
        const token = getAccessToken();
        for (const order of pending) {
          try {
            await fetch("/.netlify/functions/cafe-checkout", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${token}`,
                "X-BrewHub-Action": "true",
              },
              body: JSON.stringify({
                items: order.items.map((i) => ({
                  product_id: i.product_id,
                  quantity: i.quantity,
                  customizations: i.customizations,
                })),
                offline_id: order.id,
                offline_created_at: order.created_at,
                payment_method: order.payment_method,
              }),
            });
            await markOrderSynced(order.id);
          } catch (err: unknown) {
            console.error("[POS] Failed to sync offline order:", order.id, (err as Error)?.message);
          }
        }
        await clearSyncedOrders();
        setOfflineOrders(await getUnsyncedOrders());
        // Re-fetch live menu
        const { data } = await supabase
          .from("merch_products")
          .select("id, name, price_cents, description, image_url")
          .eq("is_active", true)
          .is("archived_at", null)
          .order("sort_order", { ascending: true })
          .order("name", { ascending: true });
        if (data && data.length > 0) {
          setMenuItems(data);
          setMenuSource("live");
          cacheMenu(data).catch(() => {});
        }
      } finally {
        setSyncingOrders(false);
      }
    })();
  }, [wasOffline, isOnline]);

  /* ─── Offline order creation (cash-only, with cap enforcement) ── */
  const handleOfflineOrder = useCallback(async () => {
    if (cart.length === 0) return;
    const total = cart.reduce(
      (sum, ci) => sum + (ci.price_cents + ci.modifiers.reduce((s, m) => s + m.price_cents, 0)) * ci.quantity, 0
    );

    // ── Check cap BEFORE accepting the order ──
    if (offlineSessionId && !offlineSessionId.startsWith('local-')) {
      try {
        const token = getAccessToken();
        if (token) {
          const capRes = await fetch("/.netlify/functions/offline-session", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
              "X-BrewHub-Action": "true",
            },
            body: JSON.stringify({
              action: "record_sale",
              session_id: offlineSessionId,
              amount_cents: total,
            }),
          });

          if (capRes.status === 403) {
            // Cap reached — block the order
            const capData = await capRes.json();
            setOfflineCapBlocked(true);
            setOfflineExposure(prev => prev ? {
              ...prev,
              cashTotalCents: capData.total_cents || prev.cashTotalCents,
              pctUsed: capData.pct_used || prev.pctUsed,
              remainingCents: capData.remaining_cents || 0,
            } : prev);
            haptic("error");
            setErrorMsg(`Cash cap of ${cents(capData.cap_cents || 20000)} reached. Manager override required to continue.`);
            setTicketPhase("error");
            return;
          }

          if (capRes.ok) {
            const capData = await capRes.json();
            setOfflineExposure({
              cashTotalCents: capData.total_cents,
              capCents: capData.cap_cents,
              pctUsed: capData.pct_used,
              remainingCents: capData.remaining_cents,
            });
          }
        }
      } catch {
        // Server unreachable — check local cap estimate
        if (offlineExposure) {
          const newTotal = offlineExposure.cashTotalCents + total;
          if (newTotal > offlineExposure.capCents) {
            setOfflineCapBlocked(true);
            haptic("error");
            setErrorMsg(`Cash cap of ${cents(offlineExposure.capCents)} reached locally. Wait for connection to restore.`);
            setTicketPhase("error");
            return;
          }
          // Update local estimate
          setOfflineExposure(prev => prev ? {
            ...prev,
            cashTotalCents: newTotal,
            pctUsed: Math.min(100, Math.round((newTotal / prev.capCents) * 100)),
            remainingCents: Math.max(0, prev.capCents - newTotal),
          } : prev);
        }
      }
    } else if (offlineExposure) {
      // Local-only session — enforce cap locally
      const newTotal = offlineExposure.cashTotalCents + total;
      if (newTotal > offlineExposure.capCents) {
        setOfflineCapBlocked(true);
        haptic("error");
        setErrorMsg(`Cash cap of ${cents(offlineExposure.capCents)} reached. Manager override required to continue.`);
        setTicketPhase("error");
        return;
      }
      setOfflineExposure(prev => prev ? {
        ...prev,
        cashTotalCents: newTotal,
        pctUsed: Math.min(100, Math.round((newTotal / prev.capCents) * 100)),
        remainingCents: Math.max(0, prev.capCents - newTotal),
      } : prev);
    }

    // ── Cap check passed — queue the order ──
    const orderId = `offline-${Date.now()}-${uid()}`;
    const order: OfflineOrder = {
      id: orderId,
      items: cart.map((ci) => ({
        product_id: ci.productId,
        name: ci.name,
        quantity: ci.quantity,
        price_cents: ci.price_cents + ci.modifiers.reduce((s, m) => s + m.price_cents, 0),
        customizations: ci.modifiers.length > 0 ? ci.modifiers.map(m => m.name) : undefined,
      })),
      total_cents: total,
      payment_method: "cash",
      created_at: new Date().toISOString(),
      synced: false,
    };
    await queueOfflineOrder(order);
    setOfflineOrders((prev) => [...prev, order]);
    haptic("success");
    setTicketPhase("paid");
    setTerminalStatus(`OFFLINE order queued — Collect ${cents(total)} cash`);
    setTimeout(() => {
      setCart([]);
      setTicketPhase("building");
      setCreatedOrderId(null);
      setTerminalStatus("");
    }, 4000);
  }, [cart, offlineSessionId, offlineExposure]);

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
    setIsSubmitting(false);
    setLoyaltyCustomer(null);
    setVoucherPhase("idle");
    setVoucherError("");
    setVoucherRetryCode(null);
  }, []);

  /* ── Cancel order: delete pending DB row then clear cart ──── */
  const handleCancelOrder = useCallback(async () => {
    if (!createdOrderId) {
      clearCart();
      return;
    }
    try {
      const token = getAccessToken();
      await fetch("/.netlify/functions/cancel-order", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          "X-BrewHub-Action": "true",
        },
        body: JSON.stringify({ orderId: createdOrderId }),
      });
    } catch (e: unknown) {
      console.error("[POS] Failed to cancel order:", (e as Error)?.message);
    } finally {
      clearCart();
    }
  }, [createdOrderId, clearCart]);

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
    // For food & merch items, skip the drink modifier builder and add directly
    if (NO_MODIFIER_CATEGORIES.has(categorize(item.name))) {
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
      const msg = toUserSafeMessageFromUnknown(err, "Camera access denied.");
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
    const detector = new BarcodeDetector({ formats: ["qr_code"] });
    const detect = async () => {
      if (!loyaltyVideoRef.current || !loyaltyStreamRef.current) return;
      try {
        const barcodes = await detector.detect(loyaltyVideoRef.current);
        if (barcodes.length > 0 && !loyaltyScanLock.current) {
          loyaltyScanLock.current = true;
          haptic("tap");
          await handleLoyaltyScanRef.current(barcodes[0].rawValue);
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

  /* ─── Loyalty Lookup (Audit #25: via PIN-auth'd Netlify function) ── */
  const handleLoyaltyScan = async (rawValue: string) => {
    const email = rawValue.trim().toLowerCase().slice(0, 254); // POS-4: length cap
    const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!EMAIL_RE.test(email)) {
      haptic("error");
      setLoyaltyCamError("QR does not contain a valid email");
      loyaltyScanLock.current = false;
      return;
    }

    try {
      const token = getAccessToken();
      const resp = await fetch("/.netlify/functions/get-staff-loyalty", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          "X-BrewHub-Action": "true",
        },
        body: JSON.stringify({ email }),
      });

      const result = await resp.json();

      if (!resp.ok || !result.found) {
        haptic("error");
        setLoyaltyCamError(toUserSafeMessage(result.error, "No loyalty account found for this code."));
        loyaltyScanLock.current = false;
        return;
      }

      setLoyaltyCustomer({
        id: result.profile_id,
        email: result.email,
        name: result.name,
        points: result.loyalty_points ?? 0,
        vouchers: result.vouchers ?? [],
      });
      haptic("success");
      closeLoyaltyScanner();
    } catch (err: unknown) {
      const msg = toUserSafeMessageFromUnknown(err, "Unable to look up loyalty right now.");
      setLoyaltyCamError(msg);
      haptic("error");
      loyaltyScanLock.current = false;
    }
  };
  // POS-6: keep ref in sync so startLoyaltyDetection always calls latest version
  handleLoyaltyScanRef.current = handleLoyaltyScan;

  /* ─── Step 1: Send to KDS (create Supabase order immediately) ─ */
  const handleSendToKDS = async () => {
    if (cart.length === 0 || submittingRef.current) return; // POS-1: ref lock (primary guard)

    // If no loyalty customer or missing name, prompt for guest first name
    if (!loyaltyCustomer || !loyaltyCustomer.name) {
      setGuestFirstName("");
      setGuestModalOpen(true);
      // Attempt to focus the input in the user gesture — fallback to autoFocus on mount
      setTimeout(() => guestInputRef.current?.focus(), 0);
      return;
    }

    submittingRef.current = true;
    setIsSubmitting(true);

    try {
      const token = getAccessToken();

      // Build cart payload — one entry per distinct item with quantity
      // Uses product_id (UUID) for secure server-side price lookup
      // Include customizations (modifier names) for server-side pricing
      const payload = cart.map((ci) => ({
        product_id: ci.productId,
        quantity: ci.quantity,
        customizations: ci.modifiers.length > 0 ? ci.modifiers.map(m => m.name) : undefined,
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
      setTicketPhase("confirm");
      setCartDrawerOpen(true); // Auto-open cart drawer on mobile for payment phase
      setOrderSuccess(orderId.slice(0, 6).toUpperCase());
      setTimeout(() => setOrderSuccess(null), 4000);

    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Order creation failed";
      setErrorMsg(msg);
      setTicketPhase("error");
    } finally {
      submittingRef.current = false; // POS-1: release ref lock
      setIsSubmitting(false);
    }
  };

  // Helper to create order (shared by modal confirm)
  const createKDSOrder = async (checkoutBody: Record<string, unknown>) => {
    submittingRef.current = true;
    setIsSubmitting(true);
    try {
      const token = getAccessToken();
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
      setTicketPhase("confirm");
      setCartDrawerOpen(true);
      setOrderSuccess(orderId.slice(0, 6).toUpperCase());
      setTimeout(() => setOrderSuccess(null), 4000);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Order creation failed";
      setErrorMsg(msg);
      setTicketPhase("error");
    } finally {
      submittingRef.current = false;
      setIsSubmitting(false);
    }
  };

  const confirmGuestAndSend = async () => {
    const name = guestFirstName.trim().slice(0, 100);
    if (!name) return; // noop if blank
    setGuestModalOpen(false);

    const payload = cart.map((ci) => ({
      product_id: ci.productId,
      quantity: ci.quantity,
      customizations: ci.modifiers.length > 0 ? ci.modifiers.map(m => m.name) : undefined,
    }));

    const checkoutBody: Record<string, unknown> = { items: payload, terminal: true };
    checkoutBody.customer_name = name;

    await createKDSOrder(checkoutBody);
  };

  /* ─── Step 2: Pay on Terminal (calls collect-payment) ────────── */
  /* Recovery logic: If the network blips mid-request, the checkout may
     have been created on Square's side. On retry, the server returns 409
     "Order already paid/preparing" which we treat as success (idempotent).
     We also add a 15-second timeout with AbortController to detect hangs. */
  const paymentRetryRef = useRef(0);
  const MAX_PAYMENT_RETRIES = 2;

  /* ─── WEBHOOK RESILIENCE: Active Payment Polling ───────────────
     Instead of passively waiting for Square's webhook (which can be delayed
     5-15+ minutes), we actively poll Square's Terminal API every 3 seconds
     to check if the customer has tapped/inserted their card.
     This gives us <3 second order-to-KDS visibility. */
  const paymentPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const paymentPollOrderRef = useRef<string | null>(null);
  const paymentPollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const POLL_DEADLINE_MS = 45_000; // 45s hard ceiling for reconciliation polling

  const stopPaymentPolling = useCallback(() => {
    if (paymentPollRef.current) {
      clearInterval(paymentPollRef.current);
      paymentPollRef.current = null;
    }
    if (paymentPollTimeoutRef.current) {
      clearTimeout(paymentPollTimeoutRef.current);
      paymentPollTimeoutRef.current = null;
    }
    paymentPollOrderRef.current = null;
  }, []);

  const startPaymentPolling = useCallback((orderId: string, options?: { isReconciliation?: boolean }) => {
    stopPaymentPolling(); // Clear any existing poll
    paymentPollOrderRef.current = orderId;
    const isReconciliation = options?.isReconciliation ?? false;

    // H5: bounded timeout — if polling never confirms, surface a clear
    // verification-pending message so the cashier doesn't hang forever.
    paymentPollTimeoutRef.current = setTimeout(() => {
      stopPaymentPolling();
      if (isReconciliation) {
        // 409 reconciliation path timed out — do NOT show success
        setTerminalStatus("");
        setErrorMsg(
          "Verification pending — could not confirm payment within timeout. " +
          "Please check the terminal or manager dashboard before retrying."
        );
        setTicketPhase("error");
        haptic("error");
      } else {
        // Normal payment polling timed out
        setTerminalStatus("");
        setErrorMsg(
          "Payment verification timed out. The customer may have tapped — " +
          "check the terminal or manager dashboard."
        );
        setTicketPhase("error");
        haptic("error");
      }
    }, POLL_DEADLINE_MS);

    const poll = async () => {
      // Stop if order changed or component unmounted
      if (paymentPollOrderRef.current !== orderId) {
        stopPaymentPolling();
        return;
      }

      try {
        const token = getAccessToken();
        if (!token) return;

        const res = await fetch("/.netlify/functions/poll-terminal-payment", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
            "X-BrewHub-Action": "true",
          },
          body: JSON.stringify({ orderId }),
        });

        if (!res.ok) return; // Silently retry next interval

        const data = await res.json();

        if (data.status === "COMPLETED" || data.status === "ALREADY_CONFIRMED") {
          // Payment confirmed! Transition to success state.
          stopPaymentPolling();
          setTicketPhase("paid");
          setTerminalStatus(
            isReconciliation
              ? "Payment verified \u2014 order confirmed on KDS."
              : data.confirmedVia === "poll"
                ? "Payment confirmed! Order is on the KDS."
                : "Payment confirmed!"
          );
          haptic("success");
          setTimeout(() => {
            setCart([]);
            setTicketPhase("building");
            setCreatedOrderId(null);
            setTerminalStatus("");
          }, 4000);
        } else if (data.status === "CANCELED") {
          // Terminal checkout was cancelled
          stopPaymentPolling();
          setTerminalStatus("Terminal checkout was cancelled.");
          setTicketPhase("error");
          setErrorMsg("Terminal checkout cancelled. Try again or use cash.");
        } else {
          // Still pending — update status message for staff visibility
          if (data.message) {
            setTerminalStatus(data.message);
          } else if (isReconciliation) {
            setTerminalStatus("Verifying payment status\u2026");
          }
        }
      } catch {
        // Network error — silently retry next interval
      }
    };

    // Start polling every 3 seconds
    paymentPollRef.current = setInterval(poll, 3000);
    // Also run immediately (don't wait for first interval)
    poll();
  }, [stopPaymentPolling]);

  // Cleanup polling on unmount
  useEffect(() => {
    return () => stopPaymentPolling();
  }, [stopPaymentPolling]);

  const handlePayOnTerminal = async () => {
    if (!createdOrderId) return;
    setTicketPhase("paying");
    setTerminalStatus("Sending to terminal…");

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

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
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (resp.status === 409) {
        // H5 fix: 409 = order may already be in a post-payment status, but we
        // must NOT assume success. Transition to awaiting_confirmation and use
        // the existing polling flow to require explicit COMPLETED / ALREADY_CONFIRMED
        // from the backend before showing the paid UI.
        paymentRetryRef.current = 0;
        setTicketPhase("paying");
        setTerminalStatus("Order conflict detected \u2014 verifying payment status\u2026");
        startPaymentPolling(createdOrderId, { isReconciliation: true });
        return;
      }

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err.error || "Terminal payment failed");
      }

      const result = await resp.json();
      setTerminalStatus("Waiting for customer tap/swipe…");

      // ── WEBHOOK RESILIENCE: Start active polling ──────────────
      // Instead of hoping Square's webhook arrives, we actively poll
      // Square's Terminal API every 3 seconds. The moment the customer
      // taps their card, we detect it and push the order to the KDS.
      // The webhook becomes a backup, not the primary path.
      setTicketPhase("paying");
      setTerminalStatus(`Sent to terminal — waiting for customer tap/swipe…`);
      haptic("success");
      paymentRetryRef.current = 0;

      // Start polling for payment confirmation
      startPaymentPolling(createdOrderId);

    } catch (e: unknown) {
      clearTimeout(timeout);
      stopPaymentPolling(); // Stop any active polling on error

      const isNetworkError =
        (e instanceof DOMException && e.name === "AbortError") ||
        (e instanceof TypeError);

      // Automatic retry on network blip (up to MAX_PAYMENT_RETRIES)
      if (isNetworkError && paymentRetryRef.current < MAX_PAYMENT_RETRIES) {
        paymentRetryRef.current += 1;
        setTerminalStatus(`Connection lost — retrying (${paymentRetryRef.current}/${MAX_PAYMENT_RETRIES})…`);
        haptic("error");
        // Exponential backoff: 2s, 4s
        const delay = 2000 * paymentRetryRef.current;
        setTimeout(() => handlePayOnTerminal(), delay);
        return;
      }

      paymentRetryRef.current = 0;
      const msg = e instanceof Error ? e.message : "Terminal payment failed";
      setErrorMsg(isNetworkError
        ? "Connection lost. Tap retry — if the terminal is waiting, the customer can still tap."
        : msg);
      setTicketPhase("error");
      haptic("error");
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
        // 409 = order already moved past pending (e.g., KDS tapped "Start"
        // or the abandon-cron fired). Parse the body to decide if it's safe.
        if (resp.status === 409) {
          const conflict = await resp.json().catch(() => ({} as Record<string, unknown>));
          const currentStatus = (conflict.currentStatus ?? conflict.status ?? "").toString().toLowerCase();
          const safeStatuses = ["preparing", "paid", "ready", "completed", "shipped", "picked_up"];

          if (safeStatuses.includes(currentStatus)) {
            console.warn(`[POS] Cash payment 409 — backend status "${currentStatus}", safe to proceed`);
            setTicketPhase("paid");
            setTerminalStatus("Payment recorded (order already active)");
            setTimeout(() => {
              setCart([]);
              setTicketPhase("building");
              setCreatedOrderId(null);
              setTerminalStatus("");
            }, 3000);
            return;
          }

          // Unsafe / unknown status — surface error instead of false success
          console.error(`[POS] Cash payment 409 — backend status "${currentStatus}", not safe`);
          throw new Error(
            currentStatus
              ? `Order is ${currentStatus} — cannot record cash payment`
              : "Order conflict: unable to confirm payment (status unknown)"
          );
        }
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

  /* ─── Comp Order (requires reason) ────────────────────────────── */
  const handleCompOrder = async () => {
    if (!createdOrderId) return;
    const reason = compReason.trim();
    if (!reason || reason.length < 2) return;

    setCompSubmitting(true);
    setCompModalOpen(false);

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
          paymentMethod: "comp",
          reason,
        }),
      });

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err.error || "Failed to comp order");
      }

      setTicketPhase("paid");
      setTerminalStatus("Comped — order on KDS");
      haptic("success");

      setTimeout(() => {
        setCart([]);
        setTicketPhase("building");
        setCreatedOrderId(null);
        setTerminalStatus("");
        setCompReason("");
      }, 3000);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Failed to comp order";
      setErrorMsg(msg);
      setTicketPhase("error");
    } finally {
      setCompSubmitting(false);
    }
  };

  /* ─── Reprint Receipt ─────────────────────────────────────────── */
  const handleReprintReceipt = async () => {
    if (!createdOrderId) return;
    setReprintLoading(true);
    try {
      const token = getAccessToken();
      const resp = await fetch("/.netlify/functions/get-receipts", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          "X-BrewHub-Action": "true",
        },
        body: JSON.stringify({ orderId: createdOrderId }),
      });
      if (resp.ok) {
        const data = await resp.json();
        if (data.receipt_text) {
          // Open receipt in a print-friendly window
          const w = window.open("", "_blank", "width=400,height=600");
          if (w) {
            w.document.write(`<pre style="font-family:monospace;font-size:12px;white-space:pre;margin:20px;">${data.receipt_text}</pre>`);
            w.document.close();
            w.print();
          }
        }
      }
    } catch (e: unknown) {
      console.error("[POS] Reprint failed:", (e as Error)?.message);
    } finally {
      setReprintLoading(false);
    }
  };

  /* ─── Step 3: Use Free Drink Voucher ──────────────────────────── */
  const handleUseVoucher = async (voucherCode?: string) => {
    if (!createdOrderId || !loyaltyCustomer) return;
    const code = voucherCode || loyaltyCustomer.vouchers[0]?.code;
    if (!code) return;

    setVoucherPhase("redeeming");
    setVoucherError("");
    setVoucherRetryCode(code);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000); // 12s timeout

    try {
      const token = getAccessToken();
      const resp = await fetch("/.netlify/functions/redeem-voucher", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          "X-BrewHub-Action": "true",
        },
        body: JSON.stringify({
          code,
          orderId: createdOrderId,
          managerOverride: false,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (resp.ok) {
        // Voucher burned, order is free
        setVoucherPhase("success");
        setTicketPhase("paid");
        setTerminalStatus("🎟️ Free drink applied!");
        // Remove the redeemed voucher from local state
        setLoyaltyCustomer((prev) =>
          prev ? { ...prev, vouchers: prev.vouchers.filter((v) => v.code !== code) } : prev
        );
        setTimeout(() => {
          setCart([]);
          setTicketPhase("building");
          setCreatedOrderId(null);
          setTerminalStatus("");
          setVoucherPhase("idle");
          setVoucherRetryCode(null);
        }, 4000);
        haptic("success");
        return;
      }

      const body = await resp.json().catch(() => ({}));

      // ALREADY_REDEEMED → the first request DID succeed, response just got lost.
      // Treat as success (idempotent by hash — no double burn).
      if (body.code === "ALREADY_REDEEMED") {
        setVoucherPhase("success");
        setTicketPhase("paid");
        setTerminalStatus("🎟️ Free drink applied! (confirmed on retry)");
        setLoyaltyCustomer((prev) =>
          prev ? { ...prev, vouchers: prev.vouchers.filter((v) => v.code !== code) } : prev
        );
        setTimeout(() => {
          setCart([]);
          setTicketPhase("building");
          setCreatedOrderId(null);
          setTerminalStatus("");
          setVoucherPhase("idle");
          setVoucherRetryCode(null);
        }, 4000);
        haptic("success");
        return;
      }

      // DAILY_LIMIT — actionable, no retry
      if (body.code === "DAILY_LIMIT") {
        setVoucherPhase("error");
        setVoucherError(body.error || "Daily limit reached (3 per day)");
        haptic("error");
        return;
      }

      // Other server error
      setVoucherPhase("error");
      setVoucherError(body.error || "Voucher redemption failed");
      haptic("error");
    } catch (err: unknown) {
      clearTimeout(timeout);
      // AbortError (timeout) or TypeError (offline) → network issue
      const isNetwork =
        (err instanceof DOMException && err.name === "AbortError") ||
        (err instanceof TypeError);

      if (isNetwork) {
        setVoucherPhase("network-error");
        setVoucherError("Connection lost. The voucher may have been applied — tap Retry to check.");
        haptic("error");
      } else {
        setVoucherPhase("error");
        setVoucherError(toUserSafeMessageFromUnknown(err, "Unable to redeem voucher right now."));
        haptic("error");
      }
    }
  };

  const handleVoucherRetry = () => {
    if (voucherRetryCode) handleUseVoucher(voucherRetryCode);
  };

  const dismissVoucherError = () => {
    setVoucherPhase("idle");
    setVoucherError("");
    setVoucherRetryCode(null);
  };

  /* ─── Reset from error ───────────────────────────────────────── */
  const handleRetry = () => {
    setTicketPhase("building");
    setErrorMsg("");
    setTerminalStatus("");
    setVoucherPhase("idle");
    setVoucherError("");
    setVoucherRetryCode(null);
  };

  /* ─── Render ─────────────────────────────────────────────────── */
  return (
    <div className="h-screen w-screen flex flex-col md:flex-row bg-stone-950 text-white select-none overflow-hidden">
      {/* Skip link for keyboard navigation */}
      <a
        href="#product-grid"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:bg-amber-500 focus:text-stone-900 focus:px-4 focus:py-2 focus:rounded font-bold"
      >
        Skip to menu
      </a>
      {/* ═══════ Offline Banner ═══════ */}
      <OfflineBanner
        isOnline={isOnline}
        wasOffline={wasOffline}
        offlineSince={offlineSince}
        exposure={offlineExposure ? {
          sessionId: offlineSessionId,
          cashTotalCents: offlineExposure.cashTotalCents,
          capCents: offlineExposure.capCents,
          pctUsed: offlineExposure.pctUsed,
          remainingCents: offlineExposure.remainingCents,
        } : null}
      />

      {/* ═══════ COL 1 — Categories (iPad sidebar / hidden on mobile) ═══════ */}
      <aside aria-label="Menu categories" className="hidden md:flex w-[140px] bg-stone-900 flex-col border-r border-stone-800 shrink-0">
        {/* Logo */}
        <div className="px-4 py-5 border-b border-stone-800 flex items-center gap-2">
          <img src="/logo.png" alt="BrewHub" className="w-8 h-8 rounded-full" />
          <span className="font-bold text-sm tracking-tight">POS</span>
        </div>

        {/* Category Buttons */}
        <nav aria-label="Product categories" className="flex-1 py-4 space-y-1 px-2">
          {CATEGORIES.map((cat) => (
            <button
              key={cat.key}
              onClick={() => { setActiveCategory(cat.key); setSelectedItem(null); }}
              aria-pressed={activeCategory === cat.key}
              aria-current={activeCategory === cat.key ? "true" : undefined}
              className={`w-full flex items-center gap-2 px-3 py-3 min-h-[48px] rounded-lg text-xs font-semibold uppercase tracking-wider transition-all
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

      {/* ═══════ Mobile Category Bar (phone only) ═══════ */}
      <div className="flex md:hidden bg-stone-900 border-b border-stone-800 overflow-x-auto shrink-0 px-2 py-2 gap-1.5 scrollbar-hide">
        {CATEGORIES.map((cat) => (
          <button
            key={cat.key}
            onClick={() => { setActiveCategory(cat.key); setSelectedItem(null); }}
            aria-pressed={activeCategory === cat.key}
            className={`flex items-center gap-1.5 px-3 min-h-[44px] rounded-lg text-[11px] font-semibold uppercase tracking-wider whitespace-nowrap shrink-0 transition-all
              ${activeCategory === cat.key
                ? "bg-amber-500/20 text-amber-400 border border-amber-500/30"
                : "text-stone-400 bg-stone-800/60 border border-transparent"
              }`}
          >
            {cat.icon}
            <span>{cat.label}</span>
          </button>
        ))}
      </div>

      {/* ═══════ COL 2 — Product Builder (Item Grid + Modifier Panel) ═══════ */}
      <main id="product-grid" aria-label="Product selection" className="flex-1 flex flex-col min-w-0 relative">
        {/* Top Bar */}
        <header className="h-14 bg-stone-900/60 backdrop-blur border-b border-stone-800 flex items-center justify-between px-6 shrink-0">
          <h1 className="text-sm font-bold uppercase tracking-[0.2em] text-stone-400">
            {CATEGORIES.find((c) => c.key === activeCategory)?.label || "Menu"}
          </h1>
          <div className="flex items-center gap-3 text-xs text-stone-500">
            {isOnline ? (
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                {menuSource === "cached" ? "Cached Menu" : "Connected"}
              </span>
            ) : (
              <span className="flex items-center gap-1 text-red-400">
                <WifiOff size={14} />
                <span className="font-bold uppercase tracking-wider">Offline</span>
              </span>
            )}
            {syncingOrders && (
              <span className="flex items-center gap-1 text-amber-400">
                <RefreshCw size={12} className="animate-spin" />
                Syncing…
              </span>
            )}
          </div>
        </header>

        {/* Item Grid */}
        <div className="flex-1 overflow-y-auto p-4 md:p-6 pb-24 md:pb-6">
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
                  className="group bg-stone-900 hover:bg-stone-800 border border-stone-800 hover:border-amber-500/40 rounded-xl p-4 md:p-5 text-left transition-all active:scale-[0.97] flex flex-col justify-between min-h-[120px] md:min-h-[140px] disabled:opacity-40 disabled:pointer-events-none"
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
                        className={`w-full flex items-center justify-between px-4 py-3 min-h-[48px] rounded-lg border transition-all text-sm
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
      </main>

      {/* ═══════ COL 3 — Live Ticket (desktop sidebar / mobile bottom sheet) ═══════ */}
      <aside aria-label="Order cart" className={`
        fixed inset-x-0 bottom-0 z-40 h-[85vh] rounded-t-2xl shadow-2xl
        transition-transform duration-300 ease-out
        ${cartDrawerOpen ? "translate-y-0" : "translate-y-full"}
        md:relative md:inset-auto md:z-auto md:h-auto md:rounded-none md:shadow-none
        md:translate-y-0 md:w-[340px] md:shrink-0
        bg-stone-900 border-l border-stone-800 flex flex-col
      `}>
        {/* Mobile drawer grab handle */}
        <div className="md:hidden flex justify-center pt-2 pb-1">
          <button
            onClick={() => setCartDrawerOpen(false)}
            className="w-12 h-1.5 rounded-full bg-stone-700 active:bg-stone-500"
            aria-label="Close cart"
          />
        </div>
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
            <div className="divide-y divide-stone-800/50" role="list">
              {cart.map((ci) => (
                <SwipeCartItem
                  key={ci.id}
                  item={ci}
                  disabled={ticketPhase !== "building"}
                  onUpdateQty={updateQty}
                  onRemove={removeItem}
                  formatCents={cents}
                />
              ))}
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

          {/* Phase: BUILDING — Send to KDS or Offline Queue */}
          {ticketPhase === "building" && (
            <>
              {isOnline ? (
                <button
                  disabled={cart.length === 0 || isSubmitting}
                  onClick={handleSendToKDS}
                  className="w-full min-h-[48px] py-4 bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-400 disabled:bg-stone-800 disabled:text-stone-600 text-white font-bold text-sm uppercase tracking-[0.2em] rounded-lg transition-all active:scale-[0.98] flex items-center justify-center gap-2"
                >
                  {isSubmitting ? (
                    <><Loader2 size={16} className="animate-spin" /> Processing…</>
                  ) : (
                    <><ChevronRight size={16} /> Send to KDS</>
                  )}
                </button>
              ) : (
                <button
                  disabled={cart.length === 0 || offlineCapBlocked}
                  onClick={handleOfflineOrder}
                  className="w-full min-h-[48px] py-4 bg-red-700 hover:bg-red-600 active:bg-red-500 disabled:bg-stone-800 disabled:text-stone-600 text-white font-bold text-sm uppercase tracking-[0.2em] rounded-lg transition-all active:scale-[0.98] flex items-center justify-center gap-2 animate-pulse"
                >
                  <WifiOff size={16} /> {offlineCapBlocked ? 'Cap Reached — Manager Override Needed' : 'Queue Order (Cash Only)'}
                </button>
              )}
            </>
          )}

          {/* Guest name modal (first-name only) */}
          {guestModalOpen && (
            <div
              className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
              role="dialog"
              aria-modal="true"
              aria-labelledby="guest-modal-title"
              onKeyDown={(e) => {
                // Simple focus trap: keep focus on the input; Escape closes modal
                if (e.key === "Escape") {
                  setGuestModalOpen(false);
                }
                if (e.key === "Tab") {
                  e.preventDefault();
                  guestInputRef.current?.focus();
                }
              }}
            >
              <div className="w-full max-w-md bg-stone-900 border border-stone-800 rounded-lg p-6">
                <h3 id="guest-modal-title" className="text-lg font-bold mb-2">Enter customer first name</h3>
                <p className="text-sm text-stone-400 mb-4">This will appear on the KDS as the customer's first name.</p>
                <input
                  ref={guestInputRef}
                  autoFocus
                  name="guestFirstName"
                  aria-label="Customer first name"
                  value={guestFirstName}
                  onChange={(e) => setGuestFirstName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); confirmGuestAndSend(); } }}
                  maxLength={100}
                  inputMode="text"
                  autoCorrect="off"
                  spellCheck={false}
                  placeholder="First name"
                  readOnly={showOnscreenKeyboard}
                  onFocus={() => { if (!showOnscreenKeyboard) guestInputRef.current?.focus(); }}
                  className="w-full p-3 bg-stone-800 border border-stone-700 rounded-lg mb-2 outline-none"
                />
                <div className="flex items-center justify-between mb-3">
                  <div className="text-sm text-stone-400">Max 100 chars</div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => { setShowOnscreenKeyboard((s) => !s); guestInputRef.current?.focus(); }}
                      type="button"
                      className="px-3 py-1 bg-stone-700 rounded-lg text-sm"
                    >{showOnscreenKeyboard ? 'Hide Keyboard' : 'Use On-screen Keyboard'}</button>
                    <button onClick={() => setGuestModalOpen(false)} className="px-4 py-2 bg-stone-700 rounded-lg">Cancel</button>
                    <button onClick={confirmGuestAndSend} className="px-4 py-2 bg-emerald-600 rounded-lg">Send to KDS</button>
                  </div>
                </div>

                {showOnscreenKeyboard && (
                  <div className="mt-2">
                    <OnscreenKeyboard
                      onKey={(k) => {
                        // Append character, enforce maxLength
                        setGuestFirstName((prev) => (prev + k).slice(0, 100));
                        haptic('tap');
                      }}
                      onBackspace={() => { setGuestFirstName((prev) => prev.slice(0, -1)); haptic('tap'); }}
                      onEnter={() => { confirmGuestAndSend(); haptic('success'); }}
                    />
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Phase: CONFIRM — Pay on Terminal / Mark Paid */}
          {ticketPhase === "confirm" && (
            <div className="space-y-2">
              {createdOrderId && (
                <p className="text-xs text-emerald-400 font-mono text-center mb-2">
                  Order #{createdOrderId.slice(0, 6).toUpperCase()} on KDS
                </p>
              )}

              {isOnline ? (
                <button
                  onClick={handlePayOnTerminal}
                  className="w-full min-h-[48px] py-4 bg-blue-600 hover:bg-blue-500 active:bg-blue-400 text-white font-bold text-sm uppercase tracking-[0.2em] rounded-lg transition-all active:scale-[0.98] flex items-center justify-center gap-2"
                >
                  <Monitor size={16} /> Pay on Terminal
                </button>
              ) : (
                <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/30 rounded-lg p-3">
                  <WifiOff size={14} className="text-red-400 shrink-0" />
                  <p className="text-xs text-red-300">Terminal unavailable offline — collect cash</p>
                </div>
              )}

              {/* Use Free Drink Voucher — shown when loyalty customer has unredeemed vouchers */}
              {loyaltyCustomer && loyaltyCustomer.vouchers.length > 0 && voucherPhase === "idle" && (
                <button
                  onClick={() => handleUseVoucher()}
                  className="w-full py-4 bg-amber-600 hover:bg-amber-500 text-white font-bold text-sm uppercase tracking-[0.2em] rounded-lg transition-all active:scale-[0.98] flex items-center justify-center gap-2"
                >
                  <Gift size={16} /> Use Free Drink
                </button>
              )}

              {/* Voucher redeeming spinner */}
              {voucherPhase === "redeeming" && (
                <div className="flex items-center justify-center gap-2 py-4 bg-amber-500/10 border border-amber-500/30 rounded-lg">
                  <Loader2 size={16} className="animate-spin text-amber-400" />
                  <span className="text-amber-300 text-xs font-semibold">Applying free drink…</span>
                </div>
              )}

              {/* Voucher network error — retry safe (idempotent by hash) */}
              {voucherPhase === "network-error" && (
                <div className="space-y-2">
                  <div className="flex items-start gap-2 bg-orange-500/10 border border-orange-500/30 rounded-lg p-3">
                    <WifiOff size={14} className="text-orange-400 shrink-0 mt-0.5" />
                    <p className="text-xs text-orange-300">{voucherError}</p>
                  </div>
                  <button
                    onClick={handleVoucherRetry}
                    className="w-full py-3 bg-amber-600 hover:bg-amber-500 text-white font-semibold text-xs uppercase tracking-[0.15em] rounded-lg transition-all flex items-center justify-center gap-2"
                  >
                    <RefreshCw size={14} /> Retry Free Drink
                  </button>
                  <button
                    onClick={dismissVoucherError}
                    className="w-full py-2 text-xs text-stone-600 hover:text-stone-400 transition-colors text-center"
                  >
                    Skip — pay another way
                  </button>
                </div>
              )}

              {/* Voucher non-network error (daily limit, not found, etc.) */}
              {voucherPhase === "error" && (
                <div className="space-y-2">
                  <div className="flex items-start gap-2 bg-red-500/10 border border-red-500/30 rounded-lg p-3">
                    <AlertTriangle size={14} className="text-red-400 shrink-0 mt-0.5" />
                    <p className="text-xs text-red-300">{voucherError}</p>
                  </div>
                  <button
                    onClick={dismissVoucherError}
                    className="w-full py-2 text-xs text-stone-600 hover:text-stone-400 transition-colors text-center"
                  >
                    Dismiss
                  </button>
                </div>
              )}

              <button
                onClick={handleMarkPaid}
                className="w-full min-h-[48px] py-3 bg-stone-800 hover:bg-stone-700 active:bg-stone-600 text-stone-300 font-semibold text-xs uppercase tracking-[0.15em] rounded-lg transition-all flex items-center justify-center gap-2"
              >
                <CreditCard size={14} /> Cash / Already Paid
              </button>

              <button
                onClick={() => { setCompReason(""); setCompModalOpen(true); }}
                className="w-full min-h-[48px] py-3 bg-stone-800/60 hover:bg-stone-700 active:bg-stone-600 text-stone-400 font-semibold text-xs uppercase tracking-[0.15em] rounded-lg transition-all flex items-center justify-center gap-2"
              >
                <Gift size={14} /> Comp (Free)
              </button>

              <button
                onClick={handleCancelOrder}
                className="w-full min-h-[48px] py-2 text-xs text-stone-600 hover:text-red-400 active:text-red-300 transition-colors text-center rounded-lg"
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
              {createdOrderId && (
                <button
                  onClick={handleReprintReceipt}
                  disabled={reprintLoading}
                  className="mt-1 flex items-center gap-1.5 text-xs text-stone-500 hover:text-stone-300 transition-colors disabled:opacity-40"
                >
                  {reprintLoading ? <Loader2 size={12} className="animate-spin" /> : <Printer size={12} />}
                  Reprint Receipt
                </button>
              )}
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

      {/* ═══════ Mobile: Backdrop when drawer is open ═══════ */}
      {cartDrawerOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/60 md:hidden"
          onClick={() => setCartDrawerOpen(false)}
        />
      )}

      {/* ═══════ Mobile: Sticky bottom cart bar (shown when drawer closed) ═══════ */}
      {!cartDrawerOpen && (
        <div className="fixed bottom-0 inset-x-0 z-30 md:hidden safe-area-bottom">
          <button
            onClick={() => setCartDrawerOpen(true)}
            className="w-full flex items-center justify-between px-5 py-4 bg-stone-900 border-t border-stone-800"
          >
            <div className="flex items-center gap-2">
              <ShoppingCart size={18} className="text-amber-400" />
              <span className="text-sm font-bold text-white">
                {cartCount > 0 ? `${cartCount} ${cartCount === 1 ? "item" : "items"}` : "Cart"}
              </span>
            </div>
            <div className="flex items-center gap-2">
              {cartTotal > 0 && (
                <span className="text-lg font-bold text-amber-400 font-mono">{cents(cartTotal)}</span>
              )}
              <ChevronRight size={16} className="text-stone-500 rotate-[-90deg]" />
            </div>
          </button>
        </div>
      )}

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

      {/* ═══════ Offline Recovery Report Toast ═══════ */}
      {recoveryReport && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 z-50 bg-stone-900 border border-stone-700 text-white px-6 py-4 rounded-xl shadow-2xl max-w-sm animate-in slide-in-from-top duration-300">
          <div className="flex items-center gap-2 mb-2">
            <WifiOff size={16} className="text-amber-400" />
            <p className="font-bold text-sm uppercase tracking-wider text-amber-300">Offline Session Ended</p>
          </div>
          <div className="grid grid-cols-3 gap-3 text-center">
            <div>
              <p className="text-2xl font-bold font-mono text-white">{recoveryReport.durationMinutes}</p>
              <p className="text-[10px] text-stone-500 uppercase">minutes</p>
            </div>
            <div>
              <p className="text-2xl font-bold font-mono text-white">{recoveryReport.ordersCount}</p>
              <p className="text-[10px] text-stone-500 uppercase">orders</p>
            </div>
            <div>
              <p className="text-2xl font-bold font-mono text-amber-400">${(recoveryReport.cashTotalCents / 100).toFixed(2)}</p>
              <p className="text-[10px] text-stone-500 uppercase">cash</p>
            </div>
          </div>
          <button
            onClick={() => setRecoveryReport(null)}
            className="mt-3 w-full text-xs text-stone-500 hover:text-stone-300 text-center transition-colors"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* ═══════ Comp Reason Modal ═══════ */}
      {compModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 animate-in fade-in duration-200">
          <div className="bg-stone-900 border border-stone-700 rounded-2xl w-full max-w-sm mx-4 overflow-hidden shadow-2xl">
            <div className="px-5 py-4 border-b border-stone-800">
              <h3 className="font-bold text-sm uppercase tracking-[0.15em] text-stone-300">Comp Reason</h3>
              <p className="text-xs text-stone-500 mt-1">Required — logged for audit</p>
            </div>
            <div className="px-5 py-4 space-y-3">
              <input
                type="text"
                autoFocus
                maxLength={200}
                placeholder="e.g. Spilled drink remake, VIP guest…"
                value={compReason}
                onChange={(e) => setCompReason(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleCompOrder(); }}
                className="w-full px-4 py-3 bg-stone-800 border border-stone-700 rounded-lg text-sm text-white placeholder-stone-500 focus:outline-none focus:border-amber-500/50"
              />
              <div className="flex items-center gap-2 justify-end">
                <button
                  onClick={() => setCompModalOpen(false)}
                  className="px-4 py-2 bg-stone-700 rounded-lg text-sm text-stone-300"
                >
                  Cancel
                </button>
                <button
                  onClick={handleCompOrder}
                  disabled={compReason.trim().length < 2 || compSubmitting}
                  className="px-4 py-2 bg-amber-600 hover:bg-amber-500 rounded-lg text-sm font-semibold text-white disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {compSubmitting ? "…" : "Confirm Comp"}
                </button>
              </div>
            </div>
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
