import Link from "next/link";

export const metadata = {
  title: "Welcome to the Hub | BrewHub PHL",
  description: "Thank you for joining BrewHub PHL. We'll alert you as soon as our doors open.",
};

export default function ThankYouPage() {
  return (
    <main className="flex flex-col items-center justify-center min-h-screen bg-stone-50 text-center">
      <div className="bg-white p-10 rounded-3xl shadow-lg max-w-md w-full border border-stone-200">
        <h1 className="font-playfair text-3xl mb-4 text-stone-700">You're in! ☕📦</h1>
        <p className="mb-4 text-stone-600">Thanks for joining the inner circle. We'll alert you as soon as our doors open.</p>
        <p className="font-bold mb-2 text-stone-700">While you wait, let's connect:</p>
        <div className="flex justify-center gap-4 mb-4">
          <a href="https://www.instagram.com/brewhubphl" className="bg-stone-900 text-white px-6 py-3 rounded-lg font-bold hover:bg-stone-700 transition" target="_blank" rel="noopener">Instagram</a>
          <a href="https://www.facebook.com/thebrewhubphl" className="bg-stone-900 text-white px-6 py-3 rounded-lg font-bold hover:bg-stone-700 transition" target="_blank" rel="noopener">Facebook</a>
        </div>
        <Link href="/" className="block mt-6 text-stone-500 hover:text-stone-900 font-bold">← Back to Home</Link>
      </div>
      <footer className="mt-10 text-xs text-stone-400 uppercase">BrewHub PHL &bull; Point Breeze, Philadelphia</footer>
    </main>
  );
}
