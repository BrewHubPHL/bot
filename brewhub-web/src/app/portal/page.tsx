"use client";

import { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { LogOut, Package, Coffee, QrCode } from 'lucide-react';
import Link from "next/link";

export const metadata = {
  title: "BrewHub Resident Portal",
  description: "Resident login and dashboard for BrewHub PHL parcel and mailbox services.",
};

export default function ResidentPortal() {
  const [user, setUser] = useState<any>(null);
  const [parcels, setParcels] = useState<any[]>([]);
  const [loyalty, setLoyalty] = useState({ points: 0 });

  useEffect(() => {
    const getSession = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        setUser(session.user);
        loadData(String(session.user.email));
      }
    };
    getSession();
  }, []);

  async function loadData(email: string) {
    const [parcelRes, loyaltyRes] = await Promise.all([
      supabase.from('expected_parcels').select('*').eq('customer_email', email),
      supabase.from('customers').select('loyalty_points').eq('email', email).maybeSingle()
    ]);
    if (parcelRes.data) setParcels(parcelRes.data);
    if (loyaltyRes.data) setLoyalty({ points: loyaltyRes.data.loyalty_points });
  }

  const printKeychain = () => {
    const barcodeUrl = `https://barcodeapi.org/api/128/${encodeURIComponent(user.email)}`;
    const printWindow = window.open('', '_blank');
    printWindow?.document.write(`<html><body><div style="border:2px dashed #000; padding:20px; width:200px; text-align:center;">
      <h3>BrewHub Loyalty</h3><img src="${barcodeUrl}" style="width:100%" /><p>${user.email}</p>
    </div></body></html>`);
    printWindow?.print();
  };

  if (!user) return <div className="p-20 text-center font-playfair">Loading Portal...</div>;

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
    </div>
  );
}