"use client";
import Link from "next/link";

export default function ManagerNav() {
  return (
    <header className="bg-[#1a1a1a] border-b border-[#333] flex items-center justify-between px-8 py-4">
      <div className="text-2xl font-bold text-white cursor-pointer">
        <Link href="/">Brew<span className="text-yellow-500">Hub</span> Dashboard</Link>
      </div>
      <nav className="flex space-x-8 text-sm">
        <Link href="/kds" className="text-gray-300 hover:text-yellow-500">KDS</Link>
        <Link href="/cafe" className="text-gray-300 hover:text-yellow-500">Cafe POS</Link>
        <Link href="/parcels" className="text-gray-300 hover:text-yellow-500">Parcel Hub</Link>
        <Link href="/scan" className="text-gray-300 hover:text-yellow-500">Inventory</Link>
        <Link href="/manager" className="text-yellow-500 font-semibold">Dashboard</Link>
        <button className="text-red-400 hover:text-red-600 ml-4" onClick={() => {/* TODO: sign out logic */}}>Logout</button>
      </nav>
    </header>
  );
}
