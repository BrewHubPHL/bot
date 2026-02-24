
"use client";

import { useState, useEffect, useRef, useCallback } from 'react';
import { ArrowLeft, ShoppingBag, CreditCard, Loader2, CheckCircle, Wallet } from 'lucide-react';
import Link from 'next/link';
import Script from 'next/script';

interface CartItem {
  name: string;
  price_cents: number;
  quantity: number;
}

/* ── Square Web SDK — minimal ambient types ──────────────────────── */
interface SquareTokenizeResult {
  status: string;
  token: string;
  errors?: { message: string }[];
}
interface SquareCard {
  attach(selector: string): Promise<void>;
  tokenize(): Promise<SquareTokenizeResult>;
  destroy(): void;
}
interface SquarePaymentMethod {
  tokenize(): Promise<SquareTokenizeResult>;
  attach(selector: string): Promise<void>;
  destroy?(): void;
}
interface SquarePaymentRequest {
  update(options: { total: { amount: string; label: string } }): void;
}
interface SquarePayments {
  card(): Promise<SquareCard>;
  applePay(request: SquarePaymentRequest): Promise<SquarePaymentMethod>;
  googlePay(request: SquarePaymentRequest): Promise<SquarePaymentMethod>;
  paymentRequest(options: {
    countryCode: string;
    currencyCode: string;
    total: { amount: string; label: string };
  }): SquarePaymentRequest;
}
declare global {
  interface Window {
    Square?: {
      payments(appId: string, locationId: string): SquarePayments;
    };
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
  const [applePayReady, setApplePayReady] = useState(false);
  const [googlePayReady, setGooglePayReady] = useState(false);
  const [walletProcessing, setWalletProcessing] = useState(false);

  const cardRef = useRef<SquareCard | null>(null);
  const paymentsRef = useRef<SquarePayments | null>(null);
  const applePayRef = useRef<SquarePaymentMethod | null>(null);
  const googlePayRef = useRef<SquarePaymentMethod | null>(null);
  const squareConfigRef = useRef<{ appId: string; locationId: string } | null>(null);
  const walletPaymentRequestRef = useRef<SquarePaymentRequest | null>(null);

  const [squareLoadError, setSquareLoadError] = useState(false);

  const totalCents = cart.reduce((sum, item) => sum + (item.price_cents * item.quantity), 0);

  // Load cart from localStorage
  useEffect(() => {
    const saved = localStorage.getItem('brewhub_cart');
    if (saved) {
      try {
        setCart(JSON.parse(saved));
      } catch (e) {
        console.error('Failed to load cart:', (e as Error)?.message);
      }
    }
  }, []);

  // SDK load timeout — if square.js never fires onLoad, warn the user after 10s
  useEffect(() => {
    if (squareReady) return;
    const id = setTimeout(() => setSquareLoadError(true), 10_000);
    return () => clearTimeout(id);
  }, [squareReady]);

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
        if (!window.Square) throw new Error('Square SDK not loaded');
        paymentsRef.current = window.Square.payments(config.squareAppId, config.squareLocationId);

        // Create card input
        cardRef.current = await paymentsRef.current.card();
        await cardRef.current.attach('#card-container');
        setCardReady(true);

        // Build a payment request for wallet methods
        const walletPaymentRequest = paymentsRef.current.paymentRequest({
          countryCode: 'US',
          currencyCode: 'USD',
          total: {
            amount: (totalCents / 100).toFixed(2),
            label: 'BrewHub PHL',
          },
        });
        walletPaymentRequestRef.current = walletPaymentRequest;

        // Try Apple Pay (only available on Safari / iOS with configured wallet)
        try {
          applePayRef.current = await paymentsRef.current.applePay(walletPaymentRequest);
          setApplePayReady(true);
        } catch {
          console.log('Apple Pay not available on this device');
        }

        // Try Google Pay (available on Chrome with configured wallet)
        try {
          googlePayRef.current = await paymentsRef.current.googlePay(walletPaymentRequest);
          await googlePayRef.current.attach('#google-pay-button');
          setGooglePayReady(true);
        } catch {
          console.log('Google Pay not available on this device');
        }
      } catch (e) {
        console.error('Square init error:', e);
        setError('Payment system unavailable. Please try again later.');
      }
    }

    initSquare();

    return () => {
      if (cardRef.current) cardRef.current.destroy();
      if (googlePayRef.current) googlePayRef.current.destroy?.();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [squareReady, cart.length]);

  // Keep wallet payment request amount in sync when total changes (FE-H3 fix)
  useEffect(() => {
    if (walletPaymentRequestRef.current && totalCents > 0) {
      try {
        walletPaymentRequestRef.current.update({
          total: {
            amount: (totalCents / 100).toFixed(2),
            label: 'BrewHub PHL',
          },
        });
      } catch {
        // Square SDK may not support update on all payment request types
      }
    }
  }, [totalCents]);

  // ── Shared: submit payment with a tokenized nonce ──
  const submitPayment = useCallback(async (sourceId: string) => {
    setLoading(true);
    setError('');

    try {
      const response = await fetch('/.netlify/functions/process-merch-payment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-BrewHub-Action': 'true' },
        body: JSON.stringify({
          cart,
          sourceId,
          customerEmail: email.trim().slice(0, 254),
          customerName: name.trim().slice(0, 100),
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
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Payment failed. Please try again.');
    }

    setLoading(false);
    setWalletProcessing(false);
  }, [cart, email, name]);

  // ── Card payment (form submit) ──
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!cardRef.current || !email.trim()) {
      setError('Please fill in your email and card details');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const result = await cardRef.current.tokenize();
      
      if (result.status !== 'OK') {
        throw new Error(result.errors?.[0]?.message || 'Card validation failed');
      }

      await submitPayment(result.token);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Payment failed. Please try again.');
      setLoading(false);
    }
  }

  // ── Wallet payment (Apple Pay / Google Pay) ──
  async function handleWalletPayment(walletMethod: SquarePaymentMethod, walletName: string) {
    if (!email.trim()) {
      setError('Please enter your email before paying');
      return;
    }

    setWalletProcessing(true);
    setError('');

    try {
      const result = await walletMethod.tokenize();

      if (result.status === 'OK') {
        await submitPayment(result.token);
      } else {
        throw new Error(result.errors?.[0]?.message || `${walletName} payment failed`);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : `${walletName} payment failed. Please try card payment.`);
      setWalletProcessing(false);
    }
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
              <h2 className="font-playfair text-2xl text-[var(--hub-espresso)] mb-6 mt-8 md:mt-0">Payment Details</h2>
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
                  <label className="block text-sm font-medium text-stone-600 mb-2">Email <span className="ml-1 text-red-500" aria-hidden="true">*</span></label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    required
                    className="w-full px-4 py-3 border border-stone-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[var(--hub-tan)]"
                  />
                </div>

                {/* Wallet Buttons (Apple Pay / Google Pay) */}
                {(applePayReady || googlePayReady) && (
                  <div className="space-y-3">
                    <label className="block text-sm font-medium text-stone-600">
                      <Wallet size={16} className="inline mr-2" />
                      Express Checkout
                    </label>

                    {applePayReady && (
                      <button
                        type="button"
                        aria-label="Pay with Apple Pay"
                        onClick={() => handleWalletPayment(applePayRef.current!, 'Apple Pay')}
                        disabled={loading || walletProcessing}
                        className="w-full h-12 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
                        style={{
                          WebkitAppearance: '-apple-pay-button',
                          '--apple-pay-button-type': 'pay',
                          '--apple-pay-button-style': 'black',
                        } as React.CSSProperties}
                      />
                    )}

                    {googlePayReady && (
                      <div
                        id="google-pay-button"
                        onClick={() => handleWalletPayment(googlePayRef.current!, 'Google Pay')}
                        className="min-h-[48px] rounded-lg overflow-hidden cursor-pointer"
                      />
                    )}

                    {/* Divider */}
                    <div className="flex items-center gap-3 text-stone-400 text-sm">
                      <div className="flex-1 border-t border-stone-200" />
                      or pay with card
                      <div className="flex-1 border-t border-stone-200" />
                    </div>
                  </div>
                )}

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
                  {squareLoadError && !squareReady && (
                    <p className="text-sm text-red-600 mt-2">
                      Payment system failed to load. Please refresh the page or try a different browser.
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
                  disabled={loading || walletProcessing || !cardReady}
                  className="w-full py-4 bg-[var(--hub-brown)] text-white rounded-lg font-semibold hover:bg-[var(--hub-espresso)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {(loading || walletProcessing) ? (
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

