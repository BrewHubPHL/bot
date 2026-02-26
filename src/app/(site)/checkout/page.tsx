
"use client";

import { useState, useEffect, useRef, useCallback } from 'react';
import { ArrowLeft, ShoppingBag, CreditCard, Loader2, CheckCircle, Wallet, AlertTriangle, RefreshCw } from 'lucide-react';
import Link from 'next/link';
import Script from 'next/script';

interface CartItem {
  id: string;
  name: string;
  price_cents: number;
  quantity: number;
  category?: 'menu' | 'merch';
  customizations?: string[];
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
  const [walletProcessing, setWalletProcessing] = useState(false);
  const isProcessing = loading || walletProcessing;

  // Fulfillment & shipping state
  const [fulfillmentType, setFulfillmentType] = useState<'pickup' | 'shipping'>('pickup');
  const [addressLine1, setAddressLine1] = useState('');
  const [addressLine2, setAddressLine2] = useState('');
  const [city, setCity] = useState('');
  const [state, setState] = useState('');
  const [zip, setZip] = useState('');
  const [phone, setPhone] = useState('');
  const [squareReady, setSquareReady] = useState(false);
  const [cardReady, setCardReady] = useState(false);
  const [applePayReady, setApplePayReady] = useState(false);
  const [googlePayReady, setGooglePayReady] = useState(false);
  const [awaitingFinality, setAwaitingFinality] = useState(false);
  const [finalityMessage, setFinalityMessage] = useState('');
  const [paymentTimedOut, setPaymentTimedOut] = useState(false);
  const cardRef = useRef<SquareCard | null>(null);
  const paymentsRef = useRef<SquarePayments | null>(null);
  const applePayRef = useRef<SquarePaymentMethod | null>(null);
  const googlePayRef = useRef<SquarePaymentMethod | null>(null);
  const squareConfigRef = useRef<{ appId: string; locationId: string } | null>(null);
  const walletPaymentRequestRef = useRef<SquarePaymentRequest | null>(null);

  const [squareLoadError, setSquareLoadError] = useState(false);

  const totalCents = cart.reduce((sum, item) => sum + (item.price_cents * item.quantity), 0);
  const hasMerch = cart.some((item) => item.category === 'merch');

  // Force pickup when cart has no merch (no shipping hot coffee!)
  useEffect(() => {
    if (!hasMerch && fulfillmentType === 'shipping') {
      setFulfillmentType('pickup');
    }
  }, [hasMerch, fulfillmentType]);

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
          // Apple Pay not available on this device
        }

        // Try Google Pay (available on Chrome with configured wallet)
        try {
          googlePayRef.current = await paymentsRef.current.googlePay(walletPaymentRequest);
          await googlePayRef.current.attach('#google-pay-button');
          setGooglePayReady(true);
        } catch {
          // Google Pay not available on this device
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
  const waitForPaymentFinality = useCallback(async (pendingOrderId: string, pendingPaymentId: string) => {
    const MAX_ATTEMPTS = 12;
    const POLL_INTERVAL_MS = 2_500;
    const PER_FETCH_TIMEOUT_MS = 8_000; // abort if a single poll hangs > 8s
    const hardDeadline = Date.now() + 45_000; // 45s absolute ceiling

    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      if (Date.now() >= hardDeadline) break;

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), PER_FETCH_TIMEOUT_MS);

      try {
        const res = await fetch('/.netlify/functions/poll-merch-payment', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-BrewHub-Action': 'true' },
          body: JSON.stringify({ orderId: pendingOrderId, paymentId: pendingPaymentId }),
          signal: controller.signal,
        });
        clearTimeout(timer);

        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(data.error || 'Payment confirmation check failed');
        }

        // H4 finality gate: only explicit backend finality markers transition to success
        if (data.confirmed === true || data.finality === 'confirmed') {
          return true;
        }

        setFinalityMessage(data.message || `Verifying payment confirmation… (${i + 1}/${MAX_ATTEMPTS})`);
      } catch (err) {
        clearTimeout(timer);
        // AbortError = per-fetch timeout — continue to next attempt
        if (err instanceof DOMException && err.name === 'AbortError') {
          setFinalityMessage(`Verification slow — retrying… (${i + 1}/${MAX_ATTEMPTS})`);
        } else {
          throw err;
        }
      }

      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }

    return false;
  }, []);

  const submitPayment = useCallback(async (sourceId: string) => {
    const SUBMIT_TIMEOUT_MS = 15_000; // 15-second hard timeout (Scenario 9 fix)

    setLoading(true);
    setError('');
    setAwaitingFinality(false);
    setFinalityMessage('');
    setPaymentTimedOut(false);

    // AbortController: kills the fetch if the network hangs (Wi-Fi→5G switch)
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SUBMIT_TIMEOUT_MS);

    try {
      let response: Response;
      try {
        response = await fetch('/.netlify/functions/process-merch-payment', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-BrewHub-Action': 'true' },
          body: JSON.stringify({
            cart,
            sourceId,
            customerEmail: email.trim().slice(0, 254),
            customerName: name.trim().slice(0, 100),
            fulfillmentType,
            ...(fulfillmentType === 'shipping' ? {
              shippingAddress: {
                line1: addressLine1.trim().slice(0, 200),
                line2: addressLine2.trim().slice(0, 200) || undefined,
                city: city.trim().slice(0, 100),
                state: state.trim().slice(0, 50),
                zip: zip.trim().slice(0, 10),
                phone: phone.trim().slice(0, 20),
              },
            } : {}),
          }),
          signal: controller.signal,
        });
      } catch (fetchErr) {
        clearTimeout(timer);
        // Network timeout — payment may have been captured server-side
        if (fetchErr instanceof DOMException && fetchErr.name === 'AbortError') {
          setPaymentTimedOut(true);
          setError(
            'The connection timed out while processing your payment. ' +
            'Your card may have been charged. Please check your email for a receipt ' +
            'before trying again, or tap "Verify Payment" below.'
          );
          return;
        }
        throw fetchErr;
      }
      clearTimeout(timer);

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Payment failed');
      }

      setOrderId(data.orderId || '');

      // H4 finality gate: only explicit backend finality markers allow success.
      // orderStatus is treated as informational only — never an authority for success.
      const finalized =
        data.confirmed === true ||
        data.finality === 'confirmed';

      if (!finalized) {
        // Transition to awaiting_finality — poll until backend confirms or timeout
        setAwaitingFinality(true);
        setFinalityMessage('Processing payment — verifying confirmation with provider…');
        const confirmed = await waitForPaymentFinality(String(data.orderId || ''), String(data.paymentId || ''));
        if (!confirmed) {
          throw new Error(
            'Payment received but confirmation is still pending. ' +
            'Please check your email for a receipt before placing another order.'
          );
        }
      }

      setSuccess(true);
      localStorage.removeItem('brewhub_cart');
    } catch (err: unknown) {
      if (!paymentTimedOut) {
        setError(err instanceof Error ? err.message : 'Payment failed. Please try again.');
      }
    } finally {
      clearTimeout(timer);
      setLoading(false);
      setWalletProcessing(false);
      setAwaitingFinality(false);
    }
  }, [cart, email, name, fulfillmentType, addressLine1, addressLine2, city, state, zip, phone, waitForPaymentFinality, paymentTimedOut]);

  /** Validate fulfillment fields; returns error message or empty string */
  function validateFulfillment(): string {
    if (!name.trim()) return 'Name is required.';
    if (fulfillmentType === 'shipping') {
      if (!addressLine1.trim()) return 'Address Line 1 is required.';
      if (!city.trim()) return 'City is required.';
      if (!state.trim()) return 'State is required.';
      if (!/^\d{5}(-\d{4})?$/.test(zip.trim())) return 'Please enter a valid ZIP code (e.g. 19145).';
      if (!/^\+?[\d\s()-]{7,20}$/.test(phone.trim())) return 'Please enter a valid phone number.';
    }
    return '';
  }

  // ── Card payment (form submit) ──
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (isProcessing) return;
    const ffError = validateFulfillment();
    if (ffError) { setError(ffError); return; }
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
    if (isProcessing) return;
    const ffError = validateFulfillment();
    if (ffError) { setError(ffError); return; }
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
                  {cart.map((item, idx) => (
                    <div key={`${item.name}-${idx}`} className="flex justify-between items-center">
                      <div>
                        <p className="font-medium text-[var(--hub-espresso)]">{item.name}</p>
                        {item.customizations && item.customizations.length > 0 && (
                          <p className="text-xs text-stone-400">{item.customizations.join(', ')}</p>
                        )}
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
                {/* Fulfillment Toggle — only show shipping option for merch orders */}
                {hasMerch ? (
                  <fieldset>
                    <legend className="block text-sm font-medium text-stone-600 mb-2">Fulfillment Method</legend>
                    <div className="flex gap-3">
                      <button
                        type="button"
                        onClick={() => setFulfillmentType('pickup')}
                        className={`flex-1 py-3 rounded-lg border text-sm font-semibold transition-colors ${
                          fulfillmentType === 'pickup'
                            ? 'border-[var(--hub-brown)] bg-[var(--hub-brown)]/10 text-[var(--hub-brown)]'
                            : 'border-stone-300 text-stone-500 hover:border-stone-400'
                        }`}
                      >
                        In-Store Pickup
                      </button>
                      <button
                        type="button"
                        onClick={() => setFulfillmentType('shipping')}
                        className={`flex-1 py-3 rounded-lg border text-sm font-semibold transition-colors ${
                          fulfillmentType === 'shipping'
                            ? 'border-[var(--hub-brown)] bg-[var(--hub-brown)]/10 text-[var(--hub-brown)]'
                            : 'border-stone-300 text-stone-500 hover:border-stone-400'
                        }`}
                      >
                        Ship to Address
                      </button>
                    </div>
                  </fieldset>
                ) : (
                  <div className="text-sm text-stone-500 bg-stone-50 rounded-lg px-4 py-3">
                    <span className="font-medium text-stone-600">In-Store Pickup</span> — food &amp; drink orders are picked up at the counter
                  </div>
                )}

                {/* Name */}
                <div>
                  <label className="block text-sm font-medium text-stone-600 mb-2">
                    Name <span className="ml-1 text-red-500" aria-hidden="true">*</span>
                  </label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Jane Doe"
                    required
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

                {/* Shipping Address Fields (conditional) */}
                {fulfillmentType === 'shipping' && (
                  <div className="space-y-4 border-t border-stone-200 pt-5">
                    <p className="text-sm font-medium text-stone-600">Shipping Address</p>
                    <div>
                      <label className="block text-xs text-stone-500 mb-1">Address Line 1 <span className="text-red-500">*</span></label>
                      <input
                        type="text"
                        value={addressLine1}
                        onChange={(e) => setAddressLine1(e.target.value)}
                        placeholder="123 Main St"
                        required
                        className="w-full px-4 py-3 border border-stone-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[var(--hub-tan)]"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-stone-500 mb-1">Address Line 2</label>
                      <input
                        type="text"
                        value={addressLine2}
                        onChange={(e) => setAddressLine2(e.target.value)}
                        placeholder="Apt, Suite, etc. (optional)"
                        className="w-full px-4 py-3 border border-stone-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[var(--hub-tan)]"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs text-stone-500 mb-1">City <span className="text-red-500">*</span></label>
                        <input
                          type="text"
                          value={city}
                          onChange={(e) => setCity(e.target.value)}
                          placeholder="Philadelphia"
                          required
                          className="w-full px-4 py-3 border border-stone-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[var(--hub-tan)]"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-stone-500 mb-1">State <span className="text-red-500">*</span></label>
                        <input
                          type="text"
                          value={state}
                          onChange={(e) => setState(e.target.value)}
                          placeholder="PA"
                          maxLength={2}
                          required
                          className="w-full px-4 py-3 border border-stone-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[var(--hub-tan)]"
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs text-stone-500 mb-1">ZIP Code <span className="text-red-500">*</span></label>
                        <input
                          type="text"
                          value={zip}
                          onChange={(e) => setZip(e.target.value)}
                          placeholder="19145"
                          maxLength={10}
                          required
                          className="w-full px-4 py-3 border border-stone-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[var(--hub-tan)]"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-stone-500 mb-1">Phone <span className="text-red-500">*</span></label>
                        <input
                          type="tel"
                          value={phone}
                          onChange={(e) => setPhone(e.target.value)}
                          placeholder="(215) 555-0123"
                          required
                          className="w-full px-4 py-3 border border-stone-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[var(--hub-tan)]"
                        />
                      </div>
                    </div>
                  </div>
                )}

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
                    {paymentTimedOut && (
                      <div className="flex items-center gap-2 mb-2 font-semibold">
                        <AlertTriangle size={16} />
                        Connection Timeout
                      </div>
                    )}
                    {error}
                  </div>
                )}

                {/* Timeout recovery: Verify Payment button */}
                {paymentTimedOut && (
                  <button
                    type="button"
                    onClick={() => {
                      setPaymentTimedOut(false);
                      setError('');
                      setAwaitingFinality(true);
                      setFinalityMessage('Checking payment status with Square…');
                      // Use the email as a lookup hint — waitForPaymentFinality
                      // polls poll-merch-payment which checks the DB for recent
                      // orders matching this email.
                      waitForPaymentFinality('', '').then((confirmed) => {
                        if (confirmed) {
                          setSuccess(true);
                          localStorage.removeItem('brewhub_cart');
                        } else {
                          setError(
                            'Could not verify a completed payment. If your card was charged, ' +
                            'please contact us at hello@brewhubphl.com with your email address and we\'ll sort it out.'
                          );
                        }
                      }).catch(() => {
                        setError('Verification failed. Please check your email for a receipt or contact us.');
                      }).finally(() => {
                        setAwaitingFinality(false);
                        setLoading(false);
                      });
                    }}
                    className="w-full py-3 bg-amber-600 text-white rounded-lg font-semibold hover:bg-amber-700 transition-colors flex items-center justify-center gap-2"
                  >
                    <RefreshCw size={18} />
                    Verify Payment Status
                  </button>
                )}

                {/* Finality status */}
                {awaitingFinality && !error && (
                  <div className="bg-amber-50 border border-amber-200 text-amber-800 px-4 py-3 rounded-lg text-sm flex items-center gap-2">
                    <Loader2 size={14} className="animate-spin" />
                    {finalityMessage || 'Verifying payment confirmation...'}
                  </div>
                )}

                {/* Submit */}
                <button
                  type="submit"
                  disabled={isProcessing || !cardReady}
                  className="w-full py-4 bg-[var(--hub-brown)] text-white rounded-lg font-semibold hover:bg-[var(--hub-espresso)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {isProcessing ? (
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

