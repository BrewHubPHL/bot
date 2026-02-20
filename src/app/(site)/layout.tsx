import ScrollToTop from "@/components/ScrollToTop";

export default function SiteLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="bg-gradient-to-br from-[#f8f4f0] via-[#fdfcfb] to-[#e9ded6] text-[var(--hub-espresso)] min-h-screen flex flex-col">
      <ScrollToTop />
      {/* Premium Glass Nav */}
      <nav className="fixed top-0 w-full z-40 nav-glass shadow-lg">
        <div className="max-w-6xl mx-auto px-6 h-20 flex items-center justify-between">
          <a href="/" className="flex items-center gap-3">
            <img src="/logo.png" alt="BrewHub Logo" width={48} height={48} className="rounded-full border-2 border-[var(--hub-tan)] shadow-md bg-white" style={{boxShadow:'0 2px 12px 0 rgba(44,24,16,0.10)'}} />
            <span className="nav-logo">BrewHub<span>PHL</span></span>
          </a>
          <div className="hidden md:flex space-x-6">
            <a href="/shop" className="nav-link">Shop</a>
            <a href="/about" className="nav-link">Our Story</a>
            <a href="#location" className="nav-link">Location</a>
            <a href="/careers" className="nav-link">Careers</a>
            <a href="mailto:info@brewhubphl.com" className="nav-link">Contact</a>
          </div>
          {/* Mobile Menu */}
          <div className="md:hidden flex items-center">
            <a href="/shop" className="nav-link text-sm">Shop</a>
          </div>
        </div>
      </nav>
      {/* Main Content */}
      <main className="flex flex-col w-full mx-auto px-2 sm:px-0 pt-24 pb-12">
        {children}
      </main>
      {/* Elegant Footer with Socials */}
      <footer className="footer-glass mt-auto">
        <div className="max-w-6xl mx-auto px-6 text-center flex flex-col items-center gap-2">
          <p className="font-semibold text-[1.08rem] text-[var(--hub-espresso)]">&copy; 2026 BrewHubPHL. Point Breeze, Philadelphia.</p>
          <div className="flex flex-wrap justify-center gap-4 mt-1">
            <a href="https://instagram.com/brewhubphl" target="_blank" rel="noopener" className="nav-link flex items-center gap-1">
              <svg width="18" height="18" fill="none" viewBox="0 0 24 24"><rect width="18" height="18" x="3" y="3" rx="5" stroke="#3c2f2f" strokeWidth="2"/><circle cx="12" cy="12" r="4" stroke="#3c2f2f" strokeWidth="2"/><circle cx="17" cy="7" r="1.2" fill="#3c2f2f"/></svg>
              Instagram
            </a>
            <a href="https://facebook.com/thebrewhubphl" target="_blank" rel="noopener" className="nav-link flex items-center gap-1">
              <svg width="18" height="18" fill="none" viewBox="0 0 24 24"><path d="M17 2.5h-2.5A4.5 4.5 0 0 0 10 7v2H7v4h3v7h4v-7h3l1-4h-4V7a1.5 1.5 0 0 1 1.5-1.5H17V2.5Z" stroke="#3c2f2f" strokeWidth="2"/></svg>
              Facebook
            </a>
            <a href="/staff" className="nav-link">Staff</a>
            <a href="/privacy.html" className="nav-link">Privacy</a>
            <a href="/terms.html" className="nav-link">Terms</a>
            <a href="/about" className="nav-link">About</a>
            <a href="/careers" className="nav-link">Careers</a>
            <a href="/portal" className="nav-link">Resident Login</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
