"use client";
import Link from "next/link";
import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import type { User } from "@supabase/supabase-js";

interface MenuItem {
  id: string;
  name: string;
  price_cents: number;
}

interface CartEntry {
  product_id: string;
  name: string;
  price_cents: number;
  quantity: number;
}

const MAX_ITEM_QTY = 50;
const MAX_CART_ITEMS = 25;

export default function CafePage() {
  const [menu, setMenu] = useState<MenuItem[]>([]);
  const [cart, setCart] = useState<CartEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [menuError, setMenuError] = useState(false);
  const [orderSuccess, setOrderSuccess] = useState("");
  const [orderError, setOrderError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Auth state
  const [user, setUser] = useState<User | null>(null);
  const [loyaltyPoints, setLoyaltyPoints] = useState<number | null>(null);
  const [authChecked, setAuthChecked] = useState(false);

  /* ─── Cart persistence ──────────────────────────────────── */
  useEffect(() => {
    const saved = localStorage.getItem("brewhub_cafe_cart");
    if (saved) {
      try { setCart(JSON.parse(saved)); } catch { /* ignore corrupt data */ }
    }
  }, []);
  useEffect(() => {
    localStorage.setItem("brewhub_cafe_cart", JSON.stringify(cart));
  }, [cart]);

  /* ─── Auth bootstrap (mirrors portal pattern) ────────────── */
  useEffect(() => {
    const bootstrap = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        setUser(session.user);
        loadLoyalty(session.user.id);
      }
      setAuthChecked(true);
    };
    bootstrap();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) {
        setUser(session.user);
        loadLoyalty(session.user.id);
      } else {
        setUser(null);
        setLoyaltyPoints(null);
      }
    });
    return () => subscription.unsubscribe();
  }, []);

  const loadLoyalty = useCallback(async (userId: string) => {
    try {
      const { data, error } = await supabase
        .from("profiles")
        .select("loyalty_points")
        .eq("id", userId)
        .maybeSingle();
      if (error) { console.error("Loyalty load error:", error.message); return; }
      if (data) setLoyaltyPoints(data.loyalty_points ?? 0);
    } catch (err: unknown) {
      console.error("Loyalty load failed:", (err as Error)?.message);
    }
  }, []);

  useEffect(() => {
    async function fetchMenu() {
      setLoading(true);
      const { data, error } = await supabase
        .from("merch_products")
        .select("id, name, price_cents")
        .eq("is_active", true)
        .is("archived_at", null)
        .order("sort_order", { ascending: true })
        .order("name", { ascending: true });
      if (error) {
        console.error("Menu fetch error:", error.message);
        setMenuError(true);
      } else if (data) {
        setMenu(data);
      }
      setLoading(false);
    }
    fetchMenu();
  }, []);

  function addToCart(item: MenuItem) {
    setCart((c) => {
      const existing = c.find((e) => e.product_id === item.id);
      if (existing) {
        if (existing.quantity >= MAX_ITEM_QTY) return c; // cap per-item qty
        return c.map((e) => e.product_id === item.id ? { ...e, quantity: e.quantity + 1 } : e);
      }
      if (c.length >= MAX_CART_ITEMS) return c; // cap total distinct items
      return [...c, { product_id: item.id, name: item.name, price_cents: item.price_cents, quantity: 1 }];
    });
  }
  function removeFromCart(idx: number) {
    setCart((c) => c.filter((_, i) => i !== idx));
  }

  async function handleOrder(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return; // guard against double-submit
    setOrderSuccess("");
    setOrderError("");
    if (cart.length === 0) {
      setOrderError("Please add at least one item.");
      return;
    }
    setSubmitting(true);
    try {
      // Build headers — attach Supabase JWT when logged in for loyalty tracking
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        "X-BrewHub-Action": "true",
      };
      if (user) {
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.access_token) {
          headers["Authorization"] = `Bearer ${session.access_token}`;
        }
      }

      const resp = await fetch("/.netlify/functions/cafe-checkout", {
        method: "POST",
        headers,
        body: JSON.stringify({
          items: cart.map((i) => ({ product_id: i.product_id, quantity: i.quantity })),
        }),
      });
      const result = await resp.json();
      if (!resp.ok) throw new Error(result.error || "Order failed");
      setCart([]);
      setCart([]);
      localStorage.removeItem("brewhub_cafe_cart");
      setOrderSuccess(
        user
          ? "Order placed! You earned loyalty points toward a free drink. ☕"
          : "Order placed! Thank you."
      );
      setOrderError("");
      // Refresh loyalty points after successful order
      if (user) loadLoyalty(user.id);
    } catch (err: unknown) {
      const msg = (err as Error)?.message;
      setOrderError(msg && !msg.includes("supabase") ? msg : "Order failed. Please try again.");
      setOrderSuccess("");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="max-w-2xl mx-auto px-4 py-10 text-stone-900 bg-white rounded-md shadow-md">
      <header className="flex items-center justify-between mb-8 border-b pb-4">
        <div className="flex items-center gap-3 font-bold text-lg">
          <img
            src="/logo.png"
            alt="BrewHub PHL logo"
            className="h-9 w-9 rounded-full"
            onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
          />
          BrewHub Cafe
        </div>
        <nav className="flex gap-4 text-xs">
          <Link href="/" className="text-stone-500 hover:text-stone-900">Home</Link>
          <Link href="/portal" className="text-stone-500 hover:text-stone-900">My Account</Link>
        </nav>
      </header>
      <h1 className="font-playfair text-2xl mb-4">Order Coffee &amp; Drinks</h1>
      <p className="mb-6 text-stone-600">Order coffee, espresso, and drinks at BrewHub Cafe in Point Breeze, Philadelphia. Fast pickup for locals in 19146.</p>

      {/* ── Loyalty Banner ─────────────────────────────────── */}
      {authChecked && !user && (
        <div className="mb-6 bg-amber-50 border border-amber-200 rounded-lg p-4 flex items-start gap-3">
          <span className="text-2xl">☕</span>
          <div>
            <p className="font-semibold text-amber-900 text-sm">Earn free drinks with every order!</p>
            <p className="text-xs text-amber-700 mt-1">
              <Link href="/portal" className="underline font-bold hover:text-amber-900">Log in</Link> or{" "}
              <Link href="/portal" className="underline font-bold hover:text-amber-900">create an account</Link> to
              earn loyalty points. Every $1 = 1 point. Hit 500 points and your next drink is on us!
            </p>
          </div>
        </div>
      )}

      {authChecked && user && (
        <div className="mb-6 bg-emerald-50 border border-emerald-200 rounded-lg p-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-2xl">🎉</span>
            <div>
              <p className="font-semibold text-emerald-900 text-sm">Welcome back, {user.email?.split("@")[0]}!</p>
              {loyaltyPoints !== null && (
                <p className="text-xs text-emerald-700 mt-0.5">
                  You have <strong>{loyaltyPoints} pts</strong> — {Math.max(0, 500 - (loyaltyPoints % 500))} more to your next free drink.
                </p>
              )}
            </div>
          </div>
          <button
            onClick={() => supabase.auth.signOut()}
            className="text-xs text-emerald-600 hover:text-red-500 underline ml-4"
          >
            Sign out
          </button>
        </div>
      )}
      <div className="mb-8">
        <h2 className="font-bold mb-2">Menu</h2>
        {loading ? (
          <div className="bg-stone-100 p-4 rounded text-center text-stone-500">Loading menu...</div>
        ) : menuError ? (
          <div className="bg-red-50 border border-red-200 p-4 rounded text-center text-red-600 text-sm">Unable to load menu. Please refresh the page.</div>
        ) : menu.length === 0 ? (
          <div className="bg-stone-100 p-4 rounded text-center text-stone-500">No menu items available.</div>
        ) : (
          <div className="grid gap-3">
            {menu.map((item) => (
              <div key={item.id} className="flex items-center justify-between bg-stone-50 border border-stone-200 rounded p-3">
                <div>
                  <div className="font-semibold">{item.name}</div>
                  <div className="text-xs text-stone-500">${(item.price_cents / 100).toFixed(2)}</div>
                </div>
                <button
                  className="bg-stone-900 text-white px-4 rounded text-sm font-bold min-h-[44px] min-w-[44px] hover:bg-stone-700 transition-colors"
                  onClick={() => addToCart(item)}
                >
                  Add
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="mb-8">
        <h2 className="font-bold mb-2">Cart</h2>
        {cart.length === 0 ? (
          <div className="bg-stone-100 p-4 rounded text-center text-stone-500">No items in cart.</div>
        ) : (
          <ul className="mb-2">
            {cart.map((item, idx) => (
              <li key={idx} className="flex items-center justify-between border-b border-stone-100 py-1">
                <span>{item.name} x{item.quantity} — ${((item.price_cents * item.quantity) / 100).toFixed(2)}</span>
                <button
                  className="text-red-500 text-xs ml-2 min-h-[44px] px-3 hover:text-red-700 transition-colors"
                  onClick={() => removeFromCart(idx)}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
        <form onSubmit={handleOrder}>
          <button type="submit" className="w-full bg-stone-900 text-white py-2 rounded font-bold mt-2 disabled:opacity-50 disabled:cursor-not-allowed" disabled={cart.length === 0 || submitting}>
            {submitting ? "Placing Order…" : "Place Order"}
          </button>
        </form>
        {orderSuccess && (
          <div className="mt-2 text-xs text-center text-green-700 font-semibold">{orderSuccess}</div>
        )}
        {orderError && (
          <div className="mt-2 text-xs text-center text-red-600">{orderError}</div>
        )}
      </div>
      <footer className="mt-10 text-xs text-stone-400 uppercase">BrewHub PHL &bull; Point Breeze, Philadelphia</footer>
    </main>
  );
}
