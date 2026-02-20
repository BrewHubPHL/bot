
"use client";

import { useState, useEffect, useRef } from 'react';
import { ArrowLeft, ShoppingBag, CreditCard, Loader2, CheckCircle } from 'lucide-react';
import Link from 'next/link';
import Script from 'next/script';

interface CartItem {
  name: string;
  price_cents: number;
  quantity: number;
}

declare global {
  interface Window {
    Square?: any;
  }
}

export default function CheckoutPage() {
  const [cart, setCart] = useState<CartItem[]>([]);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [orderId, setOrderId] = useState('');
  const [squareReady, setSquareReady] = useState(false);
  const [cardReady, setCardReady] = useState(false);

  const cardRef = useRef<any>(null);
  const paymentsRef = useRef<any>(null);
  const squareConfigRef = useRef<{ appId: string; locationId: string } | null>(null);

  const totalCents = cart.reduce((sum, item) => sum + (item.price_cents * item.quantity), 0);

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

  // Initialize Square when SDK loads
  useEffect(() => {
    if (!squareReady || cart.length === 0) return;

    async function initSquare() {
      try {
        // Fetch Square config
        const configRes = await fetch('/.netlify/functions/public-config');
        const config = await configRes.json();
        
        if (!config.squareAppId || !config.squareLocationId) {
          setError('Payment configuration unavailable');
          return;
        }

        squareConfigRef.current = {
          appId: config.squareAppId,
          locationId: config.squareLocationId,
        };

        // Initialize Square Payments
        paymentsRef.current = window.Square.payments(config.squareAppId, config.squareLocationId);

        // Create card input
        cardRef.current = await paymentsRef.current.card();
        await cardRef.current.attach('#card-container');
        setCardReady(true);
      } catch (e) {
        console.error('Square init error:', e);
        setError('Payment system unavailable. Please try again later.');
      }
    }

    initSquare();

    return () => {
      if (cardRef.current) {
        cardRef.current.destroy();
      }
    };
  }, [squareReady, cart.length]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!cardRef.current || !email.trim()) {
      setError('Please fill in your email and card details');
      return;
    }

    setLoading(true);
    setError('');

    try {
      // Tokenize card
      const result = await cardRef.current.tokenize();
      
      if (result.status !== 'OK') {
        throw new Error(result.errors?.[0]?.message || 'Card validation failed');
      }

      // Process payment
      const response = await fetch('/.netlify/functions/process-merch-payment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-BrewHub-Action': 'true' },
        body: JSON.stringify({
          cart,
          sourceId: result.token,
          customerEmail: email.trim(),
          customerName: name.trim(),
        }),
      });

      const data = await response.json();

      if (response.ok && data.success) {
        setSuccess(true);
        setOrderId(data.orderId);
        localStorage.removeItem('brewhub_cart');
      } else {
        throw new Error(data.error || 'Payment failed');
      }
    } catch (err: any) {
      setError(err.message || 'Payment failed. Please try again.');
    }

    setLoading(false);
  }

  // Success state
  if (success) {
    return (
      <div className="min-h-screen pt-24 pb-16 px-4">
        <div className="max-w-md mx-auto text-center">
          <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-6">
            <CheckCircle size={40} className="text-green-600" />
          </div>
          <h1 className="font-playfair text-3xl text-[var(--hub-espresso)] mb-4">Order Confirmed!</h1>
          <p className="text-stone-600 mb-2">Order #{orderId}</p>
          <p className="text-stone-500 mb-8">Check your email for a receipt and updates.</p>
          <Link
            href="/"
            className="inline-block px-6 py-3 bg-[var(--hub-brown)] text-white rounded-lg font-semibold hover:bg-[var(--hub-espresso)] transition-colors"
          >
            Back to Home
          </Link>
        </div>
      </div>
    );
  }

  // Empty cart
  if (cart.length === 0) {
    return (
      <div className="min-h-screen pt-24 pb-16 px-4">
        <div className="max-w-md mx-auto text-center">
          <ShoppingBag size={64} className="mx-auto text-stone-300 mb-6" />
          <h1 className="font-playfair text-3xl text-[var(--hub-espresso)] mb-4">Your Cart is Empty</h1>
          <p className="text-stone-500 mb-8">Add some merch to get started!</p>
          <Link
            href="/shop"
            className="inline-block px-6 py-3 bg-[var(--hub-brown)] text-white rounded-lg font-semibold hover:bg-[var(--hub-espresso)] transition-colors"
          >
            Shop Now
          </Link>
        </div>
      </div>
    );
  }

  return (
    <>
      <Script
        src="https://web.squarecdn.com/v1/square.js"
        onLoad={() => setSquareReady(true)}
      />

      <div className="min-h-screen pt-24 pb-16 px-4">
        <div className="max-w-4xl mx-auto">
          {/* Back Link */}
          <Link href="/shop" className="inline-flex items-center gap-2 text-stone-500 hover:text-[var(--hub-brown)] mb-8 transition-colors">
            <ArrowLeft size={20} />
            Back to Shop
          </Link>

          <div className="grid md:grid-cols-2 gap-8">
            {/* Order Summary */}
            <div>
              <h2 className="font-playfair text-2xl text-[var(--hub-espresso)] mb-6">Order Summary</h2>
              <div className="bg-white rounded-xl border border-stone-200 p-6">
                <div className="space-y-4 mb-6">
                  {cart.map((item) => (
                    <div key={item.name} className="flex justify-between items-center">
                      <div>
                        <p className="font-medium text-[var(--hub-espresso)]">{item.name}</p>
                        <p className="text-sm text-stone-500">Qty: {item.quantity}</p>
                      </div>
                      <p className="font-semibold">${((item.price_cents * item.quantity) / 100).toFixed(2)}</p>
                    </div>
                  ))}
                </div>
                <div className="border-t border-stone-200 pt-4">
                  <div className="flex justify-between items-center">
                    <span className="text-lg font-semibold text-[var(--hub-espresso)]">Total</span>
                    <span className="text-2xl font-bold text-[var(--hub-brown)]">${(totalCents / 100).toFixed(2)}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Payment Form */}
            <div>
              <h2 className="font-playfair text-2xl text-[var(--hub-espresso)] mb-6">Payment Details</h2>
              <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-stone-200 p-6 space-y-5">
                {/* Name */}
                <div>
                  <label className="block text-sm font-medium text-stone-600 mb-2">Name (optional)</label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Jane Doe"
                    className="w-full px-4 py-3 border border-stone-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[var(--hub-tan)]"
                  />
                </div>

                {/* Email */}
                <div>
                  <label className="block text-sm font-medium text-stone-600 mb-2">Email *</label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    required
                    className="w-full px-4 py-3 border border-stone-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[var(--hub-tan)]"
                  />
                </div>

                {/* Card Input */}
                <div>
                  <label className="block text-sm font-medium text-stone-600 mb-2">
                    <CreditCard size={16} className="inline mr-2" />
                    Card Details *
                  </label>
                  <div id="card-container" className="min-h-[50px] border border-stone-300 rounded-lg p-3"></div>
                  {!cardReady && squareReady && (
                    <p className="text-sm text-stone-400 mt-2 flex items-center gap-2">
                      <Loader2 size={14} className="animate-spin" />
                      Loading payment form...
                    </p>
                  )}
                </div>

                {/* Error */}
                {error && (
                  <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
                    {error}
                  </div>
                )}

                {/* Submit */}
                <button
                  type="submit"
                  disabled={loading || !cardReady}
                  className="w-full py-4 bg-[var(--hub-brown)] text-white rounded-lg font-semibold hover:bg-[var(--hub-espresso)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {loading ? (
                    <>
                      <Loader2 size={20} className="animate-spin" />
                      Processing...
                    </>
                  ) : (
                    `Pay $${(totalCents / 100).toFixed(2)}`
                  )}
                </button>

                <p className="text-xs text-stone-400 text-center">
                  Payments secured by Square. Your card details are encrypted.
                </p>
              </form>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

