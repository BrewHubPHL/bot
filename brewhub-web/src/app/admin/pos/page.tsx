"use client";

import { useState, useEffect } from 'react';
import { supabase } from '../../../lib/supabase';
import { ShoppingCart, Plus, CheckCircle } from 'lucide-react';

export default function CafePOS() {
  const [cart, setCart] = useState<any[]>([]);
  const [recentOrders, setRecentOrders] = useState<any[]>([]);

  useEffect(() => {
    loadRecentOrders();
    // Real-time subscription for the order feed
    const channel = supabase.channel('orders-pos')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'orders' }, (payload) => {
        setRecentOrders(prev => [payload.new, ...prev].slice(0, 5));
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);

  async function loadRecentOrders() {
    const { data } = await supabase.from('orders').select('*').order('created_at', { ascending: false }).limit(5);
    if (data) setRecentOrders(data);
  }

  const addToCart = (item: { name: string; price: number }) => {
    setCart([...cart, item]);
  };

  const cartTotal = cart.reduce((sum, item) => sum + item.price, 0);

  async function handleCheckout() {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return alert("Session expired. Log in again.");

    try {
      const resp = await fetch('/.netlify/functions/cafe-checkout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`
        },
        body: JSON.stringify({ cart })
      });

      if (resp.ok) {
        alert("Order Success!");
        setCart([]);
      }
    } catch (err) {
      alert("Checkout failed. Check connection.");
    }
  }

  return (
    <div className="min-h-screen bg-stone-50 pt-24 px-6 max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-3 gap-10">
      <div className="lg:col-span-2 space-y-8">
        <h1 className="font-playfair text-4xl mb-4">Cafe POS</h1>
        
        {/* Quick Actions */}
        <div className="flex gap-4">
          <button onClick={() => addToCart({name: 'Latte', price: 4.50})} className="flex items-center gap-2 bg-stone-900 text-white px-6 py-4 rounded-sm text-xs font-bold uppercase tracking-widest">
            <Plus size={16} /> Add Latte
          </button>
          <button onClick={() => addToCart({name: 'Croissant', price: 3.50})} className="flex items-center gap-2 bg-stone-900 text-white px-6 py-4 rounded-sm text-xs font-bold uppercase tracking-widest">
            <Plus size={16} /> Add Croissant
          </button>
        </div>

        <div className="space-y-4">
          <h2 className="font-playfair text-xl text-stone-400 uppercase tracking-widest">Live Orders Feed</h2>
          {recentOrders.map(order => (
            <div key={order.id} className="bg-white border border-stone-200 p-4 flex justify-between items-center shadow-sm">
              <span className="font-mono text-xs">Order #{order.id.slice(0, 5)}</span>
              <span className="bg-emerald-100 text-emerald-700 text-[10px] font-bold px-2 py-1 rounded-full uppercase">{order.status}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Cart Aside */}
      <aside className="bg-white border border-stone-200 p-8 rounded-sm shadow-xl h-fit sticky top-28">
        <div className="flex items-center gap-3 mb-6">
          <ShoppingCart className="text-stone-400" />
          <h2 className="font-playfair text-2xl text-stone-900">Current Order</h2>
        </div>
        
        <div className="space-y-3 mb-8 min-h-[100px]">
          {cart.map((item, i) => (
            <div key={i} className="flex justify-between text-sm border-b border-stone-100 pb-2">
              <span>{item.name}</span>
              <span className="font-bold">${item.price.toFixed(2)}</span>
            </div>
          ))}
          {cart.length === 0 && <p className="text-stone-300 italic text-sm">Cart is empty...</p>}
        </div>

        <div className="border-t border-stone-200 pt-6 flex justify-between items-end mb-6">
          <span className="text-stone-400 text-xs uppercase tracking-widest">Total</span>
          <span className="text-3xl font-playfair font-bold">${cartTotal.toFixed(2)}</span>
        </div>

        <button 
          disabled={cart.length === 0}
          onClick={handleCheckout}
          className="w-full bg-emerald-600 text-white py-4 rounded-sm font-bold tracking-widest uppercase hover:bg-emerald-700 disabled:bg-stone-200 transition-colors"
        >
          Pay & Complete
        </button>
      </aside>
    </div>
  );
}