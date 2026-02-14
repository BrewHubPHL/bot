
import Link from "next/link";
import React from "react";
import StatsGrid from "../components/manager/StatsGrid";
import InventoryTable from "../components/manager/InventoryTable";
import RecentActivity from "../components/manager/RecentActivity";
import KdsSection from "../components/manager/KdsSection";
import PayrollSection from "../components/manager/PayrollSection";

export const metadata = {
  title: "BrewHub Manager Dashboard",
  description: "Admin dashboard for BrewHub managers and staff.",
};

function ManagerNav() {
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

export default function ManagerDashboard() {
  return (
    <div className="min-h-screen bg-[#0f0f0f] text-[#f5f5f5]">
      <ManagerNav />
      <main className="container mx-auto px-8 py-8">
        <h1 className="text-3xl font-bold mb-6">Manager Dashboard</h1>
        <p className="text-gray-400 mb-8">Welcome to the BrewHub manager dashboard. All admin features are being migrated here.</p>
        <StatsGrid />
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2">
            <InventoryTable />
            <KdsSection />
            <PayrollSection />
          </div>
          <div>
            <RecentActivity />
          </div>
        </div>
      </main>
    </div>
  );
}
