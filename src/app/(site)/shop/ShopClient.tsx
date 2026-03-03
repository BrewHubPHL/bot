"use client";

import { useState, useEffect, useCallback, useRef } from 'react';
import { ShoppingCart, X, Plus, Minus, Trash2, Coffee, ShoppingBag, Info } from 'lucide-react';
import Link from 'next/link';

/* ═══════════════════════════════════════════════════════════════════
   Types
   ═══════════════════════════════════════════════════════════════════ */

type ShopTab = 'menu' | 'merch';

interface Product {
  id: string;
  name: string;
  price_cents: number;
  description: string;
  long_description: string | null;
  image_url: string;
  checkout_url: string;
  sort_order: number;
  category?: string;
  allowed_modifiers: string[] | null;
}

interface CartModifier {
  name: string;
  qty: number;
}

interface CartItem {
  id: string;
  name: string;
  base_price_cents: number;
  quantity: number;
  category?: 'menu' | 'merch';
  customizations: CartModifier[];
}

interface ShopClientProps {
  products: Product[];
  shopEnabled: boolean;
  isMaintenanceMode?: boolean;
}

/* ═══════════════════════════════════════════════════════════════════
   Modifier definitions — mirrors POS MODIFIER_GROUPS exactly
   ═══════════════════════════════════════════════════════════════════ */

interface Modifier {
  name: string;
  price_cents: number;
}

const MODIFIER_GROUPS: Record<string, { label: string; mods: Modifier[] }> = {
  milks: {
    label: 'Milk',
    mods: [
      { name: 'Whole Milk', price_cents: 0 },
      { name: 'Half & Half', price_cents: 0 },
      { name: 'Oat Milk', price_cents: 75 },
      { name: 'Almond Milk', price_cents: 75 },
    ],
  },
  sweeteners: {
    label: 'Sweeteners',
    mods: [
      { name: 'Sugar', price_cents: 0 },
    ],
  },
  standard_syrups: {
    label: 'Syrups',
    mods: [
      { name: 'Vanilla Syrup', price_cents: 50 },
      { name: 'Caramel Syrup', price_cents: 50 },
    ],
  },
  specialty_addins: {
    label: 'Extras',
    mods: [
      { name: 'Chocolate', price_cents: 75 },
      { name: 'Extra Shot', price_cents: 100 },
      { name: 'Make it Iced', price_cents: 0 },
    ],
  },
};

/** Look up a modifier's per-unit price from the groups dictionary */
function modPriceCents(modName: string): number {
  for (const group of Object.values(MODIFIER_GROUPS)) {
    const found = group.mods.find(m => m.name === modName);
    if (found) return found.price_cents;
  }
  return 0;
}

/** Resolve allowed_modifiers JSON array from DB into grouped modifier sets */
function getModifierGroupsForItem(product: Product): { label: string; mods: Modifier[] }[] {
  const keys = product.allowed_modifiers;
  if (!keys || keys.length === 0) return [];
  const result: { label: string; mods: Modifier[] }[] = [];
  for (const key of keys) {
    const group = MODIFIER_GROUPS[key];
    if (group) result.push(group);
  }
  return result;
}

/** Format a single CartModifier for display */
function formatMod(m: CartModifier): string {
  return m.qty > 1 ? `${m.name} (x${m.qty})` : m.name;
}

/** Build a unique cart key from product name + sorted mods+qty */
function cartKey(name: string, mods: CartModifier[]): string {
  const modStr = [...mods]
    .filter(m => m.qty > 0)
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(m => `${m.name}:${m.qty}`)
    .join(',');
  return `${name}::${modStr}`;
}

/** Compute total modifier surcharge for a cart line */
function modSurcharge(mods: CartModifier[]): number {
  return mods.reduce((sum, m) => sum + modPriceCents(m.name) * m.qty, 0);
}

/** Unit price for a cart item (base + mods) */
function unitPrice(item: CartItem): number {
  return item.base_price_cents + modSurcharge(item.customizations);
}

const MAX_QTY_PER_PRODUCT = 20;
const MAX_MOD_QTY = 5;

/* ═══════════════════════════════════════════════════════════════════
   Component
   ═══════════════════════════════════════════════════════════════════ */

export default function ShopClient({ products, shopEnabled, isMaintenanceMode }: ShopClientProps) {
  const [cart, setCart] = useState<CartItem[]>([]);
  const [cartOpen, setCartOpen] = useState(false);
  const [addedProduct, setAddedProduct] = useState<string | null>(null);
  const addedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [activeTab, setActiveTab] = useState<ShopTab>('menu');
  const [failedImages, setFailedImages] = useState<Set<string>>(new Set());

  // Customization modal (menu items)
  const [customizeProduct, setCustomizeProduct] = useState<Product | null>(null);
  const [modQtys, setModQtys] = useState<Record<string, number>>({});

  // Info modal (long_description)
  const [infoProduct, setInfoProduct] = useState<Product | null>(null);

  /* ── Cart persistence ──────────────────────────────────────── */
  // Cleanup addedProduct timer on unmount
  useEffect(() => {
    return () => { if (addedTimerRef.current) clearTimeout(addedTimerRef.current); };
  }, []);

  useEffect(() => {
    const saved = localStorage.getItem('brewhub_cart');
    if (saved) {
      try { setCart(JSON.parse(saved)); }
      catch (e) { console.error('Failed to load cart:', (e as Error)?.message); }
    }
  }, []);

  useEffect(() => {
    localStorage.setItem('brewhub_cart', JSON.stringify(cart));
  }, [cart]);

  /* ── Escape to close drawers/modals ────────────────────────── */
  const closeCart = useCallback(() => setCartOpen(false), []);
  useEffect(() => {
    if (!cartOpen && !customizeProduct && !infoProduct) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (infoProduct) setInfoProduct(null);
        else if (customizeProduct) setCustomizeProduct(null);
        else closeCart();
      }
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [cartOpen, customizeProduct, infoProduct, closeCart]);

  /* ── Derived values ────────────────────────────────────────── */
  const totalItems = cart.reduce((sum, item) => sum + item.quantity, 0);
  const totalCents = cart.reduce((sum, item) => sum + unitPrice(item) * item.quantity, 0);

  /* ── Category classification (DB-driven, no regex) ─────────── */
  function classifyProduct(p: Product): ShopTab {
    if (p.category === 'menu') return 'menu';
    if (p.category === 'merch') return 'merch';
    // Fallback for un-categorized products: default to merch
    return 'merch';
  }

  const filteredProducts = products.filter(p => classifyProduct(p) === activeTab);
  const menuCount = products.filter(p => classifyProduct(p) === 'menu').length;
  const merchCount = products.filter(p => classifyProduct(p) === 'merch').length;

  /* ── Handlers ──────────────────────────────────────────────── */
  function handleProductClick(product: Product) {
    if (classifyProduct(product) === 'menu') {
      setCustomizeProduct(product);
      // Reset modifier quantities
      const initial: Record<string, number> = {};
      const groups = getModifierGroupsForItem(product);
      for (const g of groups) for (const m of g.mods) initial[m.name] = 0;
      setModQtys(initial);
    } else {
      addToCartDirect(product);
    }
  }

  function updateModQty(modName: string, delta: number) {
    setModQtys(prev => {
      const current = prev[modName] || 0;
      const next = Math.max(0, Math.min(MAX_MOD_QTY, current + delta));
      return { ...prev, [modName]: next };
    });
  }

  function confirmCustomization() {
    if (!customizeProduct) return;
    const mods: CartModifier[] = Object.entries(modQtys)
      .filter(([, qty]) => qty > 0)
      .map(([name, qty]) => ({ name, qty }));
    addToCartWithMods(customizeProduct, mods);
    setCustomizeProduct(null);
  }

  function addAsIs() {
    if (!customizeProduct) return;
    addToCartWithMods(customizeProduct, []);
    setCustomizeProduct(null);
  }

  function addToCartDirect(product: Product) {
    addToCartWithMods(product, []);
  }

  function addToCartWithMods(product: Product, mods: CartModifier[]) {
    const key = cartKey(product.name, mods);
    setCart(prev => {
      const existing = prev.find(item => cartKey(item.name, item.customizations) === key);
      if (existing) {
        if (existing.quantity >= MAX_QTY_PER_PRODUCT) return prev;
        return prev.map(item =>
          cartKey(item.name, item.customizations) === key
            ? { ...item, quantity: Math.min(item.quantity + 1, MAX_QTY_PER_PRODUCT) }
            : item
        );
      }
      return [...prev, {
        id: product.id,
        name: product.name,
        base_price_cents: product.price_cents,
        quantity: 1,
        category: classifyProduct(product),
        customizations: mods,
      }];
    });
    setAddedProduct(product.name);
    if (addedTimerRef.current) clearTimeout(addedTimerRef.current);
    addedTimerRef.current = setTimeout(() => setAddedProduct(null), 1000);
  }

  function updateQty(index: number, delta: number) {
    setCart(prev => {
      const updated = [...prev];
      updated[index] = { ...updated[index], quantity: updated[index].quantity + delta };
      if (updated[index].quantity <= 0) {
        updated.splice(index, 1);
      } else if (updated[index].quantity > MAX_QTY_PER_PRODUCT) {
        updated[index] = { ...updated[index], quantity: MAX_QTY_PER_PRODUCT };
      }
      return updated;
    });
  }

  function removeFromCart(index: number) {
    setCart(prev => prev.filter((_, i) => i !== index));
  }

  function getEmoji(name: string) {
    const lower = name.toLowerCase();
    if (lower.includes('latte') || lower.includes('espresso') || lower.includes('coffee') || lower.includes('americano')) return '☕';
    if (lower.includes('mug')) return '🏺';
    if (lower.includes('tee') || lower.includes('shirt')) return '👕';
    if (lower.includes('bean')) return '☕';
    if (lower.includes('bag')) return '👜';
    return '✨';
  }

  /* ═══════════════════════════════════════════════════════════════
     Maintenance / Disabled states
     ═══════════════════════════════════════════════════════════════ */

  if (isMaintenanceMode) {
    return (
      <div className="min-h-screen flex items-center justify-center pt-24 px-4">
        <div className="flex flex-col items-center justify-center p-8 text-center bg-stone-50 border border-stone-200 rounded-lg shadow-xl max-w-md w-full">
          <div className="w-16 h-16 rounded-full bg-amber-100 flex items-center justify-center mb-5">
            <Coffee size={28} className="text-amber-600" />
          </div>
          <h1 className="font-playfair text-3xl text-[var(--hub-espresso)] mb-3">Systems Under Maintenance</h1>
          <p className="text-stone-500 mb-6 leading-relaxed">BrewHub systems are currently undergoing maintenance. Please order at the counter — we&apos;ll be back online shortly.</p>
          <Link href="/" className="inline-flex items-center gap-2 px-6 py-3 bg-[var(--hub-brown)] text-white rounded-lg font-semibold hover:bg-[var(--hub-espresso)] transition-colors">
            Return Home
          </Link>
        </div>
      </div>
    );
  }

  if (!shopEnabled) {
    return (
      <div className="min-h-screen flex items-center justify-center pt-24 px-4">
        <div className="flex flex-col items-center justify-center p-8 text-center bg-stone-50 border border-stone-200 rounded-lg shadow-xl max-w-md w-full">
          <div className="w-16 h-16 rounded-full bg-amber-100 flex items-center justify-center mb-5">
            <Coffee size={28} className="text-amber-600" />
          </div>
          <h1 className="font-playfair text-4xl text-[var(--hub-espresso)] mb-3">The Shop is Resting</h1>
          <p className="text-stone-500 mb-6 leading-relaxed">We&apos;re roasting fresh beans in Point Breeze. Check back soon!</p>
          <Link href="/" className="inline-flex items-center gap-2 px-6 py-3 bg-[var(--hub-brown)] text-white rounded-lg font-semibold hover:bg-[var(--hub-espresso)] transition-colors">
            Return Home
          </Link>
        </div>
      </div>
    );
  }

  /* ═══════════════════════════════════════════════════════════════
     Live modifier running total for the customization modal
     ═══════════════════════════════════════════════════════════════ */
  const customizeModCents = customizeProduct
    ? Object.entries(modQtys).reduce((sum, [name, qty]) => sum + modPriceCents(name) * qty, 0)
    : 0;

  /* ═══════════════════════════════════════════════════════════════
     Main render
     ═══════════════════════════════════════════════════════════════ */

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
        className="fixed bottom-6 right-6 z-30 bg-[var(--hub-brown)] text-white p-4 rounded-full shadow-lg hover:bg-[var(--hub-espresso)] transition-all hover:scale-105 pb-[max(1rem,env(safe-area-inset-bottom))]"
        aria-label="Open cart"
      >
        <ShoppingCart size={24} />
        {totalItems > 0 && (
          <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs font-bold w-6 h-6 rounded-full flex items-center justify-center">
            {totalItems}
          </span>
        )}
      </button>

      {/* ═══ Segmented Control ═══ */}
      <div className="max-w-6xl mx-auto px-4 sm:px-6 mb-8">
        <div className="inline-flex w-full sm:w-auto bg-stone-200/70 rounded-xl p-1 gap-1">
          {([
            { key: 'menu' as ShopTab, label: 'Cafe Menu', icon: <Coffee size={16} />, count: menuCount },
            { key: 'merch' as ShopTab, label: 'Merch & Beans', icon: <ShoppingBag size={16} />, count: merchCount },
          ]).map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex-1 sm:flex-initial flex items-center justify-center gap-2 px-6 py-3 rounded-lg text-sm font-semibold transition-all duration-200 ${
                activeTab === tab.key
                  ? 'bg-[var(--hub-brown)] text-white shadow-md'
                  : 'text-stone-500 hover:text-[var(--hub-espresso)] hover:bg-white/60'
              }`}
            >
              {tab.icon}
              {tab.label}
              {tab.count > 0 && (
                <span className={`text-xs px-1.5 py-0.5 rounded-full font-bold ${
                  activeTab === tab.key ? 'bg-white/20 text-white' : 'bg-stone-300/60 text-stone-500'
                }`}>
                  {tab.count}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Products Grid — 2-col mobile, 2-col sm, 3-col lg */}
      <div className="max-w-6xl mx-auto px-4 sm:px-6">
        <div
          key={activeTab}
          className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6 animate-fade-in-up"
        >
          {filteredProducts.map((product) => (
            <div
              key={product.id}
              className="bg-white rounded-2xl border border-stone-200 shadow-sm hover:shadow-lg transition-shadow overflow-hidden flex flex-col"
            >
              {/* Product Image — shorter on mobile */}
              <div className="h-28 sm:h-48 bg-gradient-to-br from-[var(--hub-cream)] to-stone-100 flex items-center justify-center">
                {product.image_url && /^https?:\/\//.test(product.image_url) && !failedImages.has(product.id) ? (
                  <img
                    src={product.image_url}
                    alt={product.name}
                    className="w-full h-full object-cover"
                    onError={() => setFailedImages(prev => new Set(prev).add(product.id))}
                  />
                ) : (
                  <span className="text-5xl sm:text-6xl" aria-hidden="true">{getEmoji(product.name)}</span>
                )}
              </div>

              {/* Product Info */}
              <div className="p-3 sm:p-5 flex flex-col flex-1">
                <h3 className="font-semibold text-sm sm:text-lg text-[var(--hub-espresso)] mb-1 leading-tight line-clamp-3">
                  {product.name}
                </h3>
                <div className="flex items-center gap-2 mb-2">
                  <p className="text-xl sm:text-2xl font-bold text-[var(--hub-brown)]">
                    ${(product.price_cents / 100).toFixed(2)}
                  </p>
                  {product.long_description && (
                    <button
                      onClick={(e) => { e.stopPropagation(); setInfoProduct(product); }}
                      className="px-2 py-0.5 text-[10px] sm:text-xs font-bold uppercase tracking-wider rounded-full border border-[var(--hub-brown)]/30 text-[var(--hub-brown)] hover:bg-[var(--hub-brown)]/10 transition-colors"
                      aria-label={`Info about ${product.name}`}
                    >
                      Info
                    </button>
                  )}
                </div>
                {product.description && (
                  <p className="text-xs sm:text-sm text-stone-500 mb-3 sm:mb-4 flex-1 line-clamp-2">
                    {product.description}
                  </p>
                )}
                <button
                  onClick={() => handleProductClick(product)}
                  className={`w-full py-2.5 sm:py-3 rounded-lg font-semibold text-sm sm:text-base transition-all ${
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

        {filteredProducts.length === 0 && (
          <div className="text-center py-20 animate-fade-in-up">
            <div className="text-6xl mb-4">{activeTab === 'menu' ? '☕' : '📦'}</div>
            <p className="text-stone-500">
              {activeTab === 'menu'
                ? 'No cafe items available right now. Check out our merch!'
                : 'No merch available right now. Grab a coffee instead!'}
            </p>
          </div>
        )}
      </div>

      {/* ═══ Cart Drawer Overlay ═══ */}
      {cartOpen && (
        <div
          className="fixed inset-0 bg-black/30 z-50"
          onClick={() => setCartOpen(false)}
        />
      )}

      {/* Cart Drawer */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Shopping cart"
        className={`fixed top-0 right-0 h-full w-full max-w-md bg-white shadow-2xl z-50 transform transition-transform duration-300 ${
          cartOpen ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        <div className="flex items-center justify-between p-5 border-b border-stone-200">
          <h2 className="font-playfair text-2xl text-[var(--hub-espresso)]">Your Cart</h2>
          <button
            onClick={() => setCartOpen(false)}
            className="min-h-[48px] min-w-[48px] p-3 hover:bg-stone-100 rounded-lg transition-colors flex items-center justify-center"
            aria-label="Close cart"
          >
            <X size={24} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5" style={{ maxHeight: 'calc(100vh - 200px)' }}>
          {cart.length === 0 ? (
            <div className="text-center py-12">
              <ShoppingCart size={48} className="mx-auto text-stone-300 mb-4" />
              <p className="text-stone-500">Your cart is empty</p>
            </div>
          ) : (
            <div className="space-y-4">
              {cart.map((item, idx) => (
                <div key={`${item.name}-${cartKey(item.name, item.customizations)}`} className="flex items-center gap-4 p-3 bg-stone-50 rounded-lg">
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-[var(--hub-espresso)] leading-tight line-clamp-2">{item.name}</p>
                    {item.customizations.length > 0 && (
                      <p className="text-xs text-stone-400 mt-0.5 leading-snug">
                        {item.customizations.map(formatMod).join(', ')}
                      </p>
                    )}
                    <p className="text-sm text-stone-500">
                      ${(unitPrice(item) / 100).toFixed(2)} each
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => updateQty(idx, -1)}
                      className="min-h-[48px] min-w-[48px] flex items-center justify-center border border-stone-300 rounded hover:bg-stone-200 transition-colors"
                      aria-label="Decrease quantity"
                    >
                      <Minus size={16} />
                    </button>
                    <span className="w-8 text-center font-semibold">{item.quantity}</span>
                    <button
                      onClick={() => updateQty(idx, 1)}
                      className="min-h-[48px] min-w-[48px] flex items-center justify-center border border-stone-300 rounded hover:bg-stone-200 transition-colors"
                      aria-label="Increase quantity"
                    >
                      <Plus size={16} />
                    </button>
                  </div>
                  <button
                    onClick={() => removeFromCart(idx)}
                    className="min-h-[48px] min-w-[48px] p-3 flex items-center justify-center text-stone-400 hover:text-red-500 transition-colors"
                    aria-label="Remove item"
                  >
                    <Trash2 size={18} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {cart.length > 0 && (
          <div className="absolute bottom-0 left-0 right-0 p-5 border-t border-stone-200 bg-white pb-[max(1.25rem,env(safe-area-inset-bottom))]">
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

      {/* ═══ Info Modal (long_description / origin story) ═══ */}
      {infoProduct && (
        <>
          <div className="fixed inset-0 bg-black/40 z-[60]" onClick={() => setInfoProduct(null)} />
          <div
            role="dialog"
            aria-modal="true"
            aria-label={`About ${infoProduct.name}`}
            className="fixed inset-x-4 top-1/2 -translate-y-1/2 z-[60] mx-auto max-w-lg bg-white rounded-2xl shadow-2xl overflow-hidden animate-fade-in-up"
          >
            <div className="bg-gradient-to-r from-[var(--hub-tan)] to-[var(--hub-cream)] px-6 py-5 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Info size={20} className="text-[var(--hub-brown)]" />
                <h3 className="font-playfair text-xl text-[var(--hub-espresso)]">{infoProduct.name}</h3>
              </div>
              <button
                onClick={() => setInfoProduct(null)}
                className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg hover:bg-black/10 transition-colors"
                aria-label="Close"
              >
                <X size={20} />
              </button>
            </div>
            <div className="px-6 py-5 max-h-[60vh] overflow-y-auto">
              <p className="text-stone-600 leading-relaxed whitespace-pre-line">
                {infoProduct.long_description}
              </p>
            </div>
            <div className="px-6 py-4 border-t border-stone-200">
              <button
                type="button"
                onClick={() => { setInfoProduct(null); handleProductClick(infoProduct); }}
                className="w-full py-3 rounded-lg bg-[var(--hub-brown)] text-white font-semibold hover:bg-[var(--hub-espresso)] transition-colors text-sm"
              >
                Add to Cart
              </button>
            </div>
          </div>
        </>
      )}

      {/* ═══ Customization Modal (POS-parity modifier qty picker) ═══ */}
      {customizeProduct && (() => {
        const groups = getModifierGroupsForItem(customizeProduct);
        return (
          <>
            <div className="fixed inset-0 bg-black/40 z-[60]" onClick={() => setCustomizeProduct(null)} />
            <div
              role="dialog"
              aria-modal="true"
              aria-label={`Customize ${customizeProduct.name}`}
              className="fixed inset-x-4 top-1/2 -translate-y-1/2 z-[60] mx-auto max-w-md bg-white rounded-2xl shadow-2xl overflow-hidden animate-fade-in-up"
            >
              {/* Header */}
              <div className="bg-gradient-to-r from-[var(--hub-tan)] to-[var(--hub-cream)] px-6 py-5 flex items-center justify-between">
                <div>
                  <h3 className="font-playfair text-xl text-[var(--hub-espresso)]">{customizeProduct.name}</h3>
                  <p className="text-sm text-[var(--hub-brown)] mt-0.5">
                    ${(customizeProduct.price_cents / 100).toFixed(2)}
                    {customizeModCents > 0 && (
                      <span className="ml-1 text-xs">+ ${(customizeModCents / 100).toFixed(2)} mods</span>
                    )}
                  </p>
                </div>
                <button
                  onClick={() => setCustomizeProduct(null)}
                  className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg hover:bg-black/10 transition-colors"
                  aria-label="Close"
                >
                  <X size={20} />
                </button>
              </div>

              <div className="px-6 py-5 space-y-5 max-h-[60vh] overflow-y-auto">
                {groups.length === 0 ? (
                  <p className="text-sm text-stone-500 text-center py-4">No customizations available for this item.</p>
                ) : (
                  groups.map(group => (
                    <div key={group.label}>
                      <p className="text-sm font-semibold text-stone-700 mb-2">{group.label}</p>
                      <div className="space-y-2">
                        {group.mods.map(mod => {
                          const qty = modQtys[mod.name] || 0;
                          return (
                            <div
                              key={mod.name}
                              className={`flex items-center justify-between px-3 py-2.5 rounded-lg border transition-colors ${
                                qty > 0
                                  ? 'border-[var(--hub-brown)] bg-[var(--hub-brown)]/5'
                                  : 'border-stone-200'
                              }`}
                            >
                              <div>
                                <span className="text-sm font-medium text-stone-700">{mod.name}</span>
                                {mod.price_cents > 0 && (
                                  <span className="text-xs text-stone-400 ml-1.5">+${(mod.price_cents / 100).toFixed(2)}</span>
                                )}
                              </div>
                              <div className="flex items-center gap-2">
                                <button
                                  type="button"
                                  onClick={() => updateModQty(mod.name, -1)}
                                  disabled={qty === 0}
                                  className="min-h-[36px] min-w-[36px] flex items-center justify-center border border-stone-300 rounded-md hover:bg-stone-100 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                                  aria-label={`Decrease ${mod.name}`}
                                >
                                  <Minus size={14} />
                                </button>
                                <span className="w-6 text-center text-sm font-semibold tabular-nums">{qty}</span>
                                <button
                                  type="button"
                                  onClick={() => updateModQty(mod.name, 1)}
                                  disabled={qty >= MAX_MOD_QTY}
                                  className="min-h-[36px] min-w-[36px] flex items-center justify-center border border-stone-300 rounded-md hover:bg-stone-100 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                                  aria-label={`Increase ${mod.name}`}
                                >
                                  <Plus size={14} />
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))
                )}
              </div>

              {/* Actions */}
              <div className="px-6 py-4 border-t border-stone-200 flex gap-3">
                <button
                  type="button"
                  onClick={addAsIs}
                  className="flex-1 py-3 rounded-lg border border-stone-300 text-stone-600 font-semibold hover:bg-stone-50 transition-colors text-sm"
                >
                  Add As-Is
                </button>
                <button
                  type="button"
                  onClick={confirmCustomization}
                  className="flex-1 py-3 rounded-lg bg-[var(--hub-brown)] text-white font-semibold hover:bg-[var(--hub-espresso)] transition-colors text-sm"
                >
                  {customizeModCents > 0 ? `Add · $${((customizeProduct.price_cents + customizeModCents) / 100).toFixed(2)}` : 'Add with Options'}
                </button>
              </div>
            </div>
          </>
        );
      })()}
    </div>
  );
}
