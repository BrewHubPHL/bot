"use client";

import { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { LogOut, Package, Coffee, QrCode, Mail, Lock, User, Phone } from 'lucide-react';
import Link from "next/link";

export default function ResidentPortal() {
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [authMode, setAuthMode] = useState<'login' | 'signup'>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [authError, setAuthError] = useState('');
  const [authLoading, setAuthLoading] = useState(false);
  const [parcels, setParcels] = useState<any[]>([]);
  const [loyalty, setLoyalty] = useState({ points: 0 });

  useEffect(() => {
    const getSession = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        setUser(session.user);
        loadData(String(session.user.email));
      }
      setLoading(false);
    };
    getSession();

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (session) {
        setUser(session.user);
        loadData(String(session.user.email));
      } else {
        setUser(null);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  async function loadData(email: string) {
    const [parcelRes, loyaltyRes] = await Promise.all([
      supabase.from('expected_parcels').select('*').eq('customer_email', email),
      supabase.from('customers').select('loyalty_points').eq('email', email).maybeSingle()
    ]);
    if (parcelRes.data) setParcels(parcelRes.data);
    if (loyaltyRes.data) setLoyalty({ points: loyaltyRes.data.loyalty_points });
  }

  async function handleAuth(e: React.FormEvent) {
    e.preventDefault();
    setAuthError('');
    setAuthLoading(true);

    try {
      if (authMode === 'signup') {
        const { error } = await supabase.auth.signUp({ 
          email, 
          password,
          options: {
            data: {
              full_name: name,
              phone: phone
            }
          }
        });
        if (error) throw error;
        setAuthError('Check your email to confirm your account!');
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
    } catch (err: any) {
      setAuthError(err.message || 'Authentication failed');
    }
    setAuthLoading(false);
  }

  const printKeychain = () => {
    const safeEmail = user.email.replace(/[<>&"']/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&#39;'}[c] || c));
    const barcodeUrl = `https://barcodeapi.org/api/128/${encodeURIComponent(user.email)}`;
    const printWindow = window.open('', '_blank');
    printWindow?.document.write(`<html><body><div style="border:2px dashed #000; padding:20px; width:200px; text-align:center;">
      <h3>BrewHub Loyalty</h3><img src="${barcodeUrl}" style="width:100%" /><p>${safeEmail}</p>
    </div></body></html>`);
    printWindow?.print();
  };

  // Loading state
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center pt-24">
        <div className="animate-pulse text-center">
          <div className="w-16 h-16 bg-[var(--hub-tan)] rounded-full mx-auto mb-4"></div>
          <p className="text-[var(--hub-brown)]">Loading...</p>
        </div>
      </div>
    );
  }

  // Auth form when not logged in
  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center pt-24 px-4">
        <div className="w-full max-w-md bg-white rounded-lg shadow-xl p-8 border border-stone-200">
          <div className="text-center mb-8">
            <img src="/logo.png" alt="BrewHub" className="w-20 h-20 mx-auto rounded-full border-2 border-[var(--hub-tan)] mb-4" />
            <h1 className="font-playfair text-3xl text-[var(--hub-espresso)]">Resident Portal</h1>
            <p className="text-stone-500 text-sm mt-2">Track packages, earn rewards, and more</p>
          </div>

          <div className="flex mb-6 border-b border-stone-200">
            <button
              onClick={() => setAuthMode('login')}
              className={`flex-1 pb-3 text-sm font-semibold transition-colors ${authMode === 'login' ? 'text-[var(--hub-espresso)] border-b-2 border-[var(--hub-brown)]' : 'text-stone-400'}`}
            >
              Sign In
            </button>
            <button
              onClick={() => setAuthMode('signup')}
              className={`flex-1 pb-3 text-sm font-semibold transition-colors ${authMode === 'signup' ? 'text-[var(--hub-espresso)] border-b-2 border-[var(--hub-brown)]' : 'text-stone-400'}`}
            >
              Create Account
            </button>
          </div>

          <form onSubmit={handleAuth} className="space-y-4">
            {authMode === 'signup' && (
              <div>
                <label className="block text-xs uppercase tracking-wider text-stone-500 mb-2">Full Name</label>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" size={18} />
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Jane Doe"
                    required
                    className="w-full pl-10 pr-4 py-3 border border-stone-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[var(--hub-tan)] text-sm"
                  />
                </div>
              </div>
            )}

            <div>
              <label className="block text-xs uppercase tracking-wider text-stone-500 mb-2">Email</label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" size={18} />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  required
                  className="w-full pl-10 pr-4 py-3 border border-stone-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[var(--hub-tan)] text-sm"
                />
              </div>
            </div>

            {authMode === 'signup' && (
              <div>
                <label className="block text-xs uppercase tracking-wider text-stone-500 mb-2">Phone Number</label>
                <div className="relative">
                  <Phone className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" size={18} />
                  <input
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="(555) 123-4567"
                    required
                    className="w-full pl-10 pr-4 py-3 border border-stone-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[var(--hub-tan)] text-sm"
                  />
                </div>
              </div>
            )}

            <div>
              <label className="block text-xs uppercase tracking-wider text-stone-500 mb-2">Password</label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" size={18} />
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  minLength={6}
                  className="w-full pl-10 pr-4 py-3 border border-stone-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[var(--hub-tan)] text-sm"
                />
              </div>
            </div>

            {authError && (
              <div className={`text-sm p-3 rounded ${authError.includes('Check your email') ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                {authError}
              </div>
            )}

            <button
              type="submit"
              disabled={authLoading}
              className="w-full py-3 bg-[var(--hub-brown)] text-white rounded-md font-semibold hover:bg-[var(--hub-espresso)] transition-colors disabled:opacity-50"
            >
              {authLoading ? 'Please wait...' : authMode === 'login' ? 'Sign In' : 'Create Account'}
            </button>
          </form>

          <div className="mt-6 space-y-3">
            <p className="text-center text-xs text-stone-400">
              By continuing, you agree to our <a href="/terms.html" className="underline hover:text-stone-600">Terms</a> and <a href="/privacy.html" className="underline hover:text-stone-600">Privacy Policy</a>
            </p>
            {authMode === 'signup' && (
              <div className="bg-stone-50 border border-stone-200 rounded-md p-3 text-xs text-stone-500 space-y-1">
                <p className="font-medium text-stone-600">🔒 Your Privacy Matters</p>
                <p>We never sell your data to third parties. Your information is used only to provide BrewHub services.</p>
                <p>SMS: Reply <span className="font-semibold">STOP</span> anytime to unsubscribe from text messages. Msg & data rates may apply.</p>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto p-6 space-y-8 min-h-screen pt-24">
      <div className="flex justify-between items-center">
        <h1 className="font-playfair text-4xl">Welcome Home.</h1>
        <button onClick={() => supabase.auth.signOut().then(() => window.location.reload())} className="text-stone-400 hover:text-red-500 transition-colors">
          <LogOut size={20} />
        </button>
      </div>

      {/* Package Card */}
      <div className="bg-white border border-stone-200 p-8 rounded-sm shadow-sm">
        <div className="flex items-center gap-3 mb-6">
          <Package className="text-stone-400" />
          <h2 className="font-playfair text-2xl">Your Packages</h2>
        </div>
        {parcels.length === 0 ? (
          <p className="text-stone-400 italic">No packages currently tracked.</p>
        ) : (
          <div className="space-y-4">
            {parcels.map((p: any) => (
              <div key={p.id} className="flex justify-between items-center border-b border-stone-100 pb-2">
                <div>
                  <p className="font-bold text-sm">{p.carrier}</p>
                  <p className="text-xs text-stone-400 uppercase">...{p.tracking_number?.slice(-6)}</p>
                </div>
                <span className={`text-[10px] px-2 py-1 uppercase font-bold rounded-full ${p.status === 'arrived' ? 'bg-green-100 text-green-700' : 'bg-stone-100 text-stone-500'}`}>
                  {p.status}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Loyalty Card */}
      <div className="bg-stone-900 text-white p-8 rounded-sm shadow-xl relative overflow-hidden">
        <div className="relative z-10">
          <div className="flex items-center gap-3 mb-4 text-stone-400">
            <Coffee size={20} />
            <span className="uppercase tracking-[0.3em] text-[10px] font-bold">Coffee Rewards</span>
          </div>
          <div className="text-5xl font-playfair mb-2">{Math.floor((loyalty.points % 500) / 50)}/10</div>
          <p className="text-stone-400 text-xs mb-6 italic">Cups until your next free drink</p>
          <button onClick={printKeychain} className="text-[10px] uppercase tracking-widest border border-stone-700 px-4 py-2 hover:bg-stone-800 transition-colors">
            Print Physical Keychain Card
          </button>
        </div>
        <QrCode className="absolute -right-10 -bottom-10 opacity-5" size={200} />
      </div>

      {/* QR Code Card */}
      <div className="bg-white border border-stone-200 p-8 rounded-sm shadow-sm text-center">
        <div className="flex items-center justify-center gap-3 mb-6 text-stone-500">
          <QrCode size={20} />
          <h2 className="font-playfair text-2xl text-[var(--hub-espresso)]">Your Loyalty QR</h2>
        </div>
        <p className="text-stone-400 text-sm mb-4">Show this at the cafe to earn rewards</p>
        <img 
          src={`https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(user?.email || '')}`}
          alt="Loyalty QR Code"
          className="mx-auto rounded-lg border-2 border-stone-200"
          width={180}
          height={180}
        />
        <p className="text-xs text-stone-400 mt-4">{user?.email}</p>
      </div>
    </div>
  );
}