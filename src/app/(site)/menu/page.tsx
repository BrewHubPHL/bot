import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Menu | BrewHub PHL",
  description:
    "Our full cafe menu is coming soon. Espresso, cold brew, pastries and more — crafted in Point Breeze, Philadelphia.",
};

export default function MenuPage() {
  return (
    <section className="flex flex-col items-center justify-center min-h-[70vh] px-6 text-center">
      {/* Icon */}
      <span className="text-6xl mb-6" aria-hidden="true">
        ☕
      </span>

      {/* Heading */}
      <h1 className="text-4xl md:text-5xl font-bold tracking-tight mb-4">
        Menu Coming Soon
      </h1>

      {/* Subtext */}
      <p className="text-lg md:text-xl text-[var(--hub-espresso)]/70 max-w-md mb-8 leading-relaxed">
        We&rsquo;re putting the finishing touches on our full menu.
        In the meantime, swing by the shop or ask{" "}
        <span className="font-semibold">Elise</span> — she knows everything we serve.
      </p>

      {/* CTA buttons */}
      <div className="flex flex-col sm:flex-row gap-4">
        <a
          href="/"
          className="inline-flex items-center justify-center px-6 py-3 rounded-full bg-[var(--hub-espresso)] text-white font-semibold hover:opacity-90 transition-opacity"
        >
          Back to Home
        </a>
        <a
          href="/waitlist"
          className="inline-flex items-center justify-center px-6 py-3 rounded-full border-2 border-[var(--hub-espresso)] text-[var(--hub-espresso)] font-semibold hover:bg-[var(--hub-espresso)]/5 transition-colors"
        >
          Join the Waitlist
        </a>
      </div>

      {/* Social nudge */}
      <p className="mt-10 text-sm text-[var(--hub-espresso)]/50">
        Follow{" "}
        <a
          href="https://instagram.com/brewhubphl"
          target="_blank"
          rel="noopener noreferrer"
          className="underline hover:text-[var(--hub-espresso)]/80"
        >
          @brewhubphl
        </a>{" "}
        for menu drops and opening updates.
      </p>
    </section>
  );
}
