"use client";
import { useState } from "react";
import Image from "next/image";

export default function MobileNav() {
  const [open, setOpen] = useState(false);
  return (
    <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
      <div className="flex items-center gap-2">
        <Image src="/logo.png" alt="BrewHub PHL logo" width={40} height={40} className="rounded-full" priority unoptimized />
        <span className="font-playfair text-xl tracking-tight font-semibold">BrewHub<span className="text-stone-400 font-light italic">PHL</span></span>
      </div>
      <div className="hidden md:flex space-x-6 text-xs uppercase tracking-widest font-medium text-stone-500">
        <a href="/about" className="hover:text-stone-900 transition-colors">Our Story</a>
        <a href="#location" className="hover:text-stone-900 transition-colors">Location</a>
        <a href="/portal.html" className="hover:text-stone-900 transition-colors">Parcel Hub</a>
        <a href="/" className="hover:text-stone-900 transition-colors">Mailbox Rentals</a>
        <a href="mailto:info@brewhubphl.com" className="hover:text-stone-900 transition-colors">Contact</a>
      </div>
      <div className="md:hidden">
        <button
          aria-label="Open menu"
          className="p-2 rounded focus:outline-none focus:ring-2 focus:ring-stone-400"
          onClick={() => setOpen((v: boolean) => !v)}
        >
          <span className="block w-6 h-0.5 bg-stone-900 mb-1" />
          <span className="block w-6 h-0.5 bg-stone-900 mb-1" />
          <span className="block w-6 h-0.5 bg-stone-900" />
        </button>
        {open && (
          <div className="absolute right-4 top-16 bg-white border border-stone-200 rounded shadow-lg flex flex-col w-48 z-50 animate-fade-in">
            <a href="/about" className="px-6 py-3 border-b border-stone-100 hover:bg-stone-50" onClick={() => setOpen(false)}>Our Story</a>
            <a href="#location" className="px-6 py-3 border-b border-stone-100 hover:bg-stone-50" onClick={() => setOpen(false)}>Location</a>
            <a href="/portal.html" className="px-6 py-3 border-b border-stone-100 hover:bg-stone-50" onClick={() => setOpen(false)}>Parcel Hub</a>
            <a href="/" className="px-6 py-3 border-b border-stone-100 hover:bg-stone-50" onClick={() => setOpen(false)}>Mailbox Rentals</a>
            <a href="mailto:info@brewhubphl.com" className="px-6 py-3 hover:bg-stone-50" onClick={() => setOpen(false)}>Contact</a>
          </div>
        )}
      </div>
    </div>
  );
}
