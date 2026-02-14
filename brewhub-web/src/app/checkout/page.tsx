
"use client";
import React, { useState } from "react";

export const metadata = {
  title: "Checkout | BrewHub Resident Services",
  description: "Complete your purchase at BrewHub. Secure, fast, and easy checkout for residents and guests.",
};

export default function CheckoutPage() {
  const [form, setForm] = useState({ name: "", email: "", amount: "" });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSuccess("");
    if (!form.name || !form.email || !form.amount) {
      setError("Please fill in all fields.");
      return;
    }
    setLoading(true);
    try {
      const cart = [{ name: "Custom Payment", quantity: 1, price: parseFloat(form.amount) }];
      const customer_details = { name: form.name, email: form.email };
      const resp = await fetch("/.netlify/functions/create-checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cart, user_id: null, customer_details })
      });
      const result = await resp.json();
      if (!resp.ok || !result.url) throw new Error(result.error || "Checkout failed");
      window.location.href = result.url;
    } catch (err: any) {
      setError(err.message || "Checkout failed");
    }
    setLoading(false);
  }

  return (
    <main className="min-h-screen bg-gray-50 flex flex-col items-center justify-center py-8 px-4">
      <div className="w-full max-w-md bg-white rounded-lg shadow-lg p-8">
        <h1 className="text-2xl font-bold mb-4 text-center text-brew-primary">Checkout</h1>
        <form className="space-y-4" onSubmit={handleSubmit}>
          <div>
            <label htmlFor="name" className="block text-sm font-medium text-gray-700">Name</label>
            <input type="text" id="name" name="name" required className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-brew-primary focus:ring focus:ring-brew-primary/20" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
          </div>
          <div>
            <label htmlFor="email" className="block text-sm font-medium text-gray-700">Email</label>
            <input type="email" id="email" name="email" required className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-brew-primary focus:ring focus:ring-brew-primary/20" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
          </div>
          <div>
            <label htmlFor="amount" className="block text-sm font-medium text-gray-700">Amount</label>
            <input type="number" id="amount" name="amount" min="1" step="0.01" required className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-brew-primary focus:ring focus:ring-brew-primary/20" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} />
          </div>
          {error && <div className="bg-red-100 text-red-800 p-2 rounded text-center">{error}</div>}
          <button type="submit" className="w-full py-2 px-4 bg-brew-primary text-white rounded-md font-semibold hover:bg-brew-primary-dark transition" disabled={loading}>{loading ? "Processing..." : "Pay Now"}</button>
        </form>
        <p className="mt-6 text-xs text-gray-500 text-center">Payments are processed securely. For help, contact support@brewhub.com.</p>
      </div>
    </main>
  );
}
