"use client";

import { useState, useEffect, useRef } from "react";
import { usePathname } from "next/navigation";

const NAV_LINKS = [
  { href: "/shop", label: "Shop" },
  { href: "/about", label: "Our Story" },
  { href: "/location", label: "Location" },
  { href: "mailto:info@brewhubphl.com", label: "Contact" },
];

export default function SiteNav() {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const pathname = usePathname();

  // Close mobile menu on route change
  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  // Close menu when clicking outside
  useEffect(() => {
    if (!menuOpen) return;
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [menuOpen]);

  // Prevent body scroll when mobile menu is open
  useEffect(() => {
    if (menuOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => { document.body.style.overflow = ""; };
  }, [menuOpen]);

  return (
    <nav className="fixed top-0 w-full z-40 nav-glass shadow-lg" ref={menuRef}>
      <div className="max-w-6xl mx-auto px-6 h-20 flex items-center justify-between">
        {/* Logo */}
        <a href="/" className="flex items-center gap-3">
          <img
            src="/logo.png"
            alt="BrewHub Logo"
            width={48}
            height={48}
            className="rounded-full border-2 border-[var(--hub-tan)] shadow-md bg-white"
            style={{ boxShadow: "0 2px 12px 0 rgba(44,24,16,0.10)" }}
          />
          <span className="nav-logo">
            BrewHub<span>PHL</span>
          </span>
        </a>

        {/* Desktop Links */}
        <div className="hidden md:flex space-x-6">
          {NAV_LINKS.map((link) => (
            <a key={link.href} href={link.href} className="nav-link">
              {link.label}
            </a>
          ))}
        </div>

        {/* Mobile Hamburger Button */}
        <button
          className="md:hidden flex flex-col justify-center items-center w-10 h-10 rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-500"
          onClick={() => setMenuOpen((prev) => !prev)}
          aria-label={menuOpen ? "Close menu" : "Open menu"}
          aria-expanded={menuOpen}
        >
          <span
            className="block w-6 h-0.5 bg-[var(--hub-espresso)] rounded-full transition-all duration-200"
            style={{
              transform: menuOpen ? "rotate(45deg) translateY(3px)" : "none",
            }}
          />
          <span
            className="block w-6 h-0.5 bg-[var(--hub-espresso)] rounded-full mt-1.5 transition-all duration-200"
            style={{
              opacity: menuOpen ? 0 : 1,
            }}
          />
          <span
            className="block w-6 h-0.5 bg-[var(--hub-espresso)] rounded-full mt-1.5 transition-all duration-200"
            style={{
              transform: menuOpen ? "rotate(-45deg) translateY(-3px)" : "none",
            }}
          />
        </button>
      </div>

      {/* Mobile Dropdown Menu */}
      {menuOpen && (
        <div className="md:hidden bg-white/95 backdrop-blur-md border-t-2 border-[var(--hub-tan)] shadow-xl animate-fade-in-up">
          <div className="flex flex-col items-center gap-1 py-4 px-6">
            {NAV_LINKS.map((link) => (
              <a
                key={link.href}
                href={link.href}
                className="nav-link w-full text-center py-3 text-base"
              >
                {link.label}
              </a>
            ))}
          </div>
        </div>
      )}
    </nav>
  );
}
