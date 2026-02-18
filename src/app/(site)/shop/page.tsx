"use client";

import { useState, useEffect } from 'react';
import { ShoppingCart, X, Plus, Minus, Trash2 } from 'lucide-react';
import Link from 'next/link';

interface Product {
  name: string;
  price_cents: number;
  description: string;
  image_url: string;
  checkout_url: string;
  sort_order: number;
}

interface CartItem {
  name: string;
  price_cents: number;
  quantity: number;
}

export default function ShopPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [cartOpen, setCartOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [shopEnabled, setShopEnabled] = useState(true);
  const [addedProduct, setAddedProduct] = useState<string | null>(null);

  // Load cart from localStorage
  useEffect(() => {
    const saved = localStorage.getItem('brewhub_cart');
    if (saved) {
      try {
        setCart(JSON.parse(saved));
      } catch (e) {
        console.error('Failed to load cart:', e);
      }
    }
  }, []);

  // Save cart to localStorage
  useEffect(() => {
    localStorage.setItem('brewhub_cart', JSON.stringify(cart));
  }, [cart]);

  // Load products from Netlify function
  useEffect(() => {
    async function loadProducts() {
      try {
        const res = await fetch('/.netlify/functions/shop-data');
        const data = await res.json();
        setShopEnabled(data.shopEnabled !== false);
        setProducts(data.products || []);
      } catch (err) {
        console.error('Failed to load shop:', err);
      } finally {
        setLoading(false);
      }
    }
    loadProducts();
  }, []);

  const totalItems = cart.reduce((sum, item) => sum + item.quantity, 0);
  const totalCents = cart.reduce((sum, item) => sum + (item.price_cents * item.quantity), 0);

  function addToCart(product: Product) {
    setCart(prev => {
      const existing = prev.find(item => item.name === product.name);
      if (existing) {
        return prev.map(item =>
          item.name === product.name
            ? { ...item, quantity: item.quantity + 1 }
            : item
        );
      }
      return [...prev, { name: product.name, price_cents: product.price_cents, quantity: 1 }];
    });
    setAddedProduct(product.name);
    setTimeout(() => setAddedProduct(null), 1000);
  }

  function updateQty(index: number, delta: number) {
    setCart(prev => {
      const updated = [...prev];
      updated[index].quantity += delta;
      if (updated[index].quantity <= 0) {
        updated.splice(index, 1);
      }
      return updated;
    });
  }

  function removeFromCart(index: number) {
    setCart(prev => prev.filter((_, i) => i !== index));
  }

  function getEmoji(name: string) {
    const lower = name.toLowerCase();
    if (lower.includes('mug')) return '🏺';
    if (lower.includes('tee') || lower.includes('shirt')) return '👕';
    if (lower.includes('bean') || lower.includes('coffee')) return '☕';
    if (lower.includes('bag')) return '👜';
    return '✨';
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center pt-24">
        <div className="animate-pulse text-center">
          <div className="w-16 h-16 bg-[var(--hub-tan)] rounded-full mx-auto mb-4"></div>
          <p className="text-[var(--hub-brown)]">Loading the shop...</p>
        </div>
      </div>
    );
  }

  if (!shopEnabled) {
    return (
      <div className="min-h-screen flex items-center justify-center pt-24 px-4">
        <div className="text-center max-w-md">
          <div className="text-6xl mb-6">☕</div>
          <h1 className="font-playfair text-4xl text-[var(--hub-espresso)] mb-4">The Shop is Resting</h1>
          <p className="text-stone-500 mb-8">We're roasting fresh beans in Point Breeze. Check back soon!</p>
          <Link href="/" className="inline-block px-6 py-3 bg-[var(--hub-brown)] text-white rounded-lg font-semibold hover:bg-[var(--hub-espresso)] transition-colors">
            Return Home
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen pt-24 pb-16">
      {/* Hero Section */}
      <div className="max-w-6xl mx-auto px-4 sm:px-6 mb-12">
        <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-[var(--hub-tan)] to-[var(--hub-cream)] p-8 md:p-12">
          <div className="relative z-10">
            <h1 className="font-playfair text-4xl md:text-5xl text-[var(--hub-espresso)] mb-4">
              The BrewHub Shop
            </h1>
            <p className="text-lg text-[var(--hub-brown)] max-w-xl">
              Fresh roasted coffee + merch from Point Breeze, Philadelphia. Pickup in South Philly or ship nationwide.
            </p>
          </div>
          <div className="absolute right-0 top-0 w-1/3 h-full opacity-20">
            <div className="absolute inset-0 bg-[url('/logo.png')] bg-contain bg-no-repeat bg-center"></div>
          </div>
        </div>
      </div>

      {/* Cart Button (Fixed) */}
      <button
        onClick={() => setCartOpen(true)}
        className="fixed bottom-6 right-6 z-40 bg-[var(--hub-brown)] text-white p-4 rounded-full shadow-lg hover:bg-[var(--hub-espresso)] transition-all hover:scale-105"
        aria-label="Open cart"
      >
        <ShoppingCart size={24} />
        {totalItems > 0 && (
          <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs font-bold w-6 h-6 rounded-full flex items-center justify-center">
            {totalItems}
          </span>
        )}
      </button>

      {/* Products Grid */}
      <div className="max-w-6xl mx-auto px-4 sm:px-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          {products.map((product) => (
            <div
              key={product.name}
              className="bg-white rounded-2xl border border-stone-200 shadow-sm hover:shadow-lg transition-shadow overflow-hidden flex flex-col"
            >
              {/* Product Image */}
              <div className="h-48 bg-gradient-to-br from-[var(--hub-cream)] to-stone-100 flex items-center justify-center">
                {product.image_url && /^https?:\/\//.test(product.image_url) ? (
                  <img
                    src={product.image_url}
                    alt={product.name}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <span className="text-6xl">{getEmoji(product.name)}</span>
                )}
              </div>

              {/* Product Info */}
              <div className="p-5 flex flex-col flex-1">
                <h3 className="font-semibold text-lg text-[var(--hub-espresso)] mb-1">
                  {product.name}
                </h3>
                <p className="text-2xl font-bold text-[var(--hub-brown)] mb-2">
                  ${(product.price_cents / 100).toFixed(2)}
                </p>
                {product.description && (
                  <p className="text-sm text-stone-500 mb-4 flex-1">
                    {product.description}
                  </p>
                )}
                <button
                  onClick={() => addToCart(product)}
                  className={`w-full py-3 rounded-lg font-semibold transition-all ${
                    addedProduct === product.name
                      ? 'bg-green-500 text-white'
                      : 'bg-[var(--hub-brown)] text-white hover:bg-[var(--hub-espresso)]'
                  }`}
                >
                  {addedProduct === product.name ? '✓ Added!' : 'Add to Cart'}
                </button>
              </div>
            </div>
          ))}
        </div>

        {products.length === 0 && (
          <div className="text-center py-20">
            <div className="text-6xl mb-4">📦</div>
            <p className="text-stone-500">No products available right now. Check back soon!</p>
          </div>
        )}
      </div>

      {/* Cart Drawer Overlay */}
      {cartOpen && (
        <div
          className="fixed inset-0 bg-black/30 z-50"
          onClick={() => setCartOpen(false)}
        />
      )}

      {/* Cart Drawer */}
      <div
        className={`fixed top-0 right-0 h-full w-full max-w-md bg-white shadow-2xl z-50 transform transition-transform duration-300 ${
          cartOpen ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        {/* Cart Header */}
        <div className="flex items-center justify-between p-5 border-b border-stone-200">
          <h2 className="font-playfair text-2xl text-[var(--hub-espresso)]">Your Cart</h2>
          <button
            onClick={() => setCartOpen(false)}
            className="p-2 hover:bg-stone-100 rounded-lg transition-colors"
            aria-label="Close cart"
          >
            <X size={24} />
          </button>
        </div>

        {/* Cart Items */}
        <div className="flex-1 overflow-y-auto p-5" style={{ maxHeight: 'calc(100vh - 200px)' }}>
          {cart.length === 0 ? (
            <div className="text-center py-12">
              <ShoppingCart size={48} className="mx-auto text-stone-300 mb-4" />
              <p className="text-stone-500">Your cart is empty</p>
            </div>
          ) : (
            <div className="space-y-4">
              {cart.map((item, idx) => (
                <div key={item.name} className="flex items-center gap-4 p-3 bg-stone-50 rounded-lg">
                  <div className="flex-1">
                    <p className="font-semibold text-[var(--hub-espresso)]">{item.name}</p>
                    <p className="text-sm text-stone-500">
                      ${(item.price_cents / 100).toFixed(2)} each
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => updateQty(idx, -1)}
                      className="w-8 h-8 flex items-center justify-center border border-stone-300 rounded hover:bg-stone-200 transition-colors"
                      aria-label="Decrease quantity"
                    >
                      <Minus size={16} />
                    </button>
                    <span className="w-8 text-center font-semibold">{item.quantity}</span>
                    <button
                      onClick={() => updateQty(idx, 1)}
                      className="w-8 h-8 flex items-center justify-center border border-stone-300 rounded hover:bg-stone-200 transition-colors"
                      aria-label="Increase quantity"
                    >
                      <Plus size={16} />
                    </button>
                  </div>
                  <button
                    onClick={() => removeFromCart(idx)}
                    className="p-2 text-stone-400 hover:text-red-500 transition-colors"
                    aria-label="Remove item"
                  >
                    <Trash2 size={18} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Cart Footer */}
        {cart.length > 0 && (
          <div className="absolute bottom-0 left-0 right-0 p-5 border-t border-stone-200 bg-white">
            <div className="flex justify-between items-center mb-4">
              <span className="text-lg font-semibold text-[var(--hub-espresso)]">Total</span>
              <span className="text-2xl font-bold text-[var(--hub-brown)]">
                ${(totalCents / 100).toFixed(2)}
              </span>
            </div>
            <Link
              href="/checkout"
              className="block w-full py-4 bg-[var(--hub-brown)] text-white text-center rounded-lg font-semibold hover:bg-[var(--hub-espresso)] transition-colors"
              onClick={() => setCartOpen(false)}
            >
              Proceed to Checkout
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
