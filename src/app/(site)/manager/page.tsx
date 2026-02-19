import Link from "next/link";
import React from "react";
import StatsGrid from "../components/manager/StatsGrid";
import InventoryTable from "../components/manager/InventoryTable";
import RecentActivity from "../components/manager/RecentActivity";
import KdsSection from "../components/manager/KdsSection";
import PayrollSection from "../components/manager/PayrollSection";
import ManagerNav from "../components/manager/ManagerNav";
import CatalogManager from "../components/manager/CatalogManager";

export const metadata = {
  title: "BrewHub Manager Dashboard",
  description: "Admin dashboard for BrewHub managers and staff.",
};

export default function ManagerDashboard() {
  return (
    <div className="min-h-screen bg-[#0f0f0f] text-[#f5f5f5]">
      <ManagerNav />
      <main className="container mx-auto px-8 py-8">
        <h1 className="text-3xl font-bold mb-6">Manager Dashboard</h1>
        <p className="text-gray-400 mb-8">Welcome to the BrewHub manager dashboard. All admin features are being migrated here.</p>
        <StatsGrid />
        <CatalogManager />

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 mt-10">
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
