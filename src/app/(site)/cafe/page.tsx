"use client";
import Link from "next/link";;
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

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

export default function CafePage() {
  const [menu, setMenu] = useState<MenuItem[]>([]);
  const [cart, setCart] = useState<CartEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [orderStatus, setOrderStatus] = useState("");

  useEffect(() => {
    async function fetchMenu() {
      setLoading(true);
      const { data, error } = await supabase
        .from("merch_products")
        .select("id, name, price_cents")
        .eq("is_active", true)
        .order("sort_order", { ascending: true })
        .order("name", { ascending: true });
      if (!error && data) setMenu(data);
      setLoading(false);
    }
    fetchMenu();
  }, []);

  function addToCart(item: MenuItem) {
    setCart((c) => {
      const existing = c.find((e) => e.product_id === item.id);
      if (existing) return c.map((e) => e.product_id === item.id ? { ...e, quantity: e.quantity + 1 } : e);
      return [...c, { product_id: item.id, name: item.name, price_cents: item.price_cents, quantity: 1 }];
    });
  }
  function removeFromCart(idx: number) {
    setCart((c) => c.filter((_, i) => i !== idx));
  }

  async function handleOrder(e: React.FormEvent) {
    e.preventDefault();
    setOrderStatus("");
    if (cart.length === 0) {
      setOrderStatus("Please add at least one item.");
      return;
    }
    try {
      const resp = await fetch("/.netlify/functions/cafe-checkout", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-BrewHub-Action": "true",
        },
        body: JSON.stringify({
          items: cart.map((i) => ({ product_id: i.product_id, quantity: i.quantity })),
        }),
      });
      const result = await resp.json();
      if (!resp.ok) throw new Error(result.error || "Order failed");
      setCart([]);
      setOrderStatus("Order placed! Thank you.");
    } catch (err: any) {
      setOrderStatus(err.message || "Order failed. Try again.");
    }
  }

  return (
    <main className="max-w-2xl mx-auto px-4 py-10 text-stone-900 bg-white rounded-md shadow-md">
      <header className="flex items-center justify-between mb-8 border-b pb-4">
        <div className="flex items-center gap-3 font-bold text-lg">
          <img src="/logo.png" alt="BrewHub PHL logo" className="h-9 w-9 rounded-full" />
          BrewHub Cafe
        </div>
        <nav className="flex gap-4 text-xs">
          <Link href="/cafe" className="text-stone-900 font-bold underline">Cafe POS</Link>
          <Link href="/parcels" className="text-stone-500 hover:text-stone-900">Parcel Hub</Link>
          <Link href="/scanner" className="text-stone-500 hover:text-stone-900">Inventory</Link>
          <Link href="/manager" className="text-stone-500 hover:text-stone-900">Dashboard</Link>
        </nav>
      </header>
      <h1 className="font-playfair text-2xl mb-4">Order Coffee &amp; Drinks</h1>
      <p className="mb-6 text-stone-600">Order coffee, espresso, and drinks at BrewHub Cafe in Point Breeze, Philadelphia. Fast pickup for locals in 19146.</p>
      <div className="mb-8">
        <h2 className="font-bold mb-2">Menu</h2>
        {loading ? (
          <div className="bg-stone-100 p-4 rounded text-center text-stone-500">Loading menu...</div>
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
                <button className="bg-stone-900 text-white px-3 py-1 rounded text-xs font-bold" onClick={() => addToCart(item)}>
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
                <button className="text-red-500 text-xs ml-2" onClick={() => removeFromCart(idx)}>
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
        <form onSubmit={handleOrder}>
          <button type="submit" className="w-full bg-stone-900 text-white py-2 rounded font-bold mt-2" disabled={cart.length === 0}>
            Place Order
          </button>
        </form>
        {orderStatus && <div className="mt-2 text-xs text-center text-stone-600">{orderStatus}</div>}
      </div>
      <footer className="mt-10 text-xs text-stone-400 uppercase">BrewHub PHL &bull; Point Breeze, Philadelphia</footer>
    </main>
  );
}
