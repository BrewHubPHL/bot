
"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

export const metadata = {
  title: "BrewHub PHL | Shop Coffee & Merch | Point Breeze Philadelphia",
  description: "Shop BrewHub coffee bags, mugs, and merch from Point Breeze, Philadelphia. Pickup in South Philly or ship nationwide.",
};

export default function ShopPage() {
  const [products, setProducts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchProducts() {
      setLoading(true);
      const { data, error } = await supabase.from("merch_products").select("id, name, description, price_cents, image_url, is_active").eq("is_active", true);
      if (!error && data) setProducts(data);
      setLoading(false);
    }
    fetchProducts();
  }, []);

  return (
    <main className="max-w-2xl mx-auto px-4 py-10 text-stone-900 bg-white rounded-md shadow-md">
      <header className="flex items-center justify-between mb-8 border-b pb-4">
        <div className="flex items-center gap-3 font-bold text-lg">
          <img src="/logo.png" alt="BrewHub PHL logo" className="h-9 w-9 rounded-full" />
          BrewHub PHL
        </div>
        <Link href="/" className="text-stone-500 hover:text-stone-900">Home</Link>
      </header>
      <h1 className="font-playfair text-2xl mb-4">Shop Coffee &amp; Merch</h1>
      <p className="mb-6 text-stone-600">Shop BrewHub coffee bags, mugs, and merch from Point Breeze, Philadelphia. Pickup in South Philly or ship nationwide.</p>
      {loading ? (
        <div className="bg-stone-100 p-6 rounded mb-6 text-center text-stone-500">Loading products...</div>
      ) : products.length === 0 ? (
        <div className="bg-stone-100 p-6 rounded mb-6 text-center text-stone-500">No products available. Visit us in person for coffee, mugs, and more.</div>
      ) : (
        <div className="grid gap-6 mb-6">
          {products.map((p) => (
            <div key={p.id} className="flex gap-4 bg-stone-50 rounded p-4 border border-stone-200 items-center">
              {p.image_url && <img src={p.image_url} alt={p.name} className="h-20 w-20 object-cover rounded" />}
              <div className="flex-1">
                <div className="font-bold text-lg">{p.name}</div>
                <div className="text-xs text-stone-500 mb-1">{p.description}</div>
                <div className="font-semibold text-stone-900">${(p.price_cents / 100).toFixed(2)}</div>
              </div>
              {/* TODO: Add to cart/buy button */}
            </div>
          ))}
        </div>
      )}
      <footer className="mt-10 text-xs text-stone-400 uppercase">BrewHub PHL &bull; Point Breeze, Philadelphia</footer>
    </main>
  );
}
