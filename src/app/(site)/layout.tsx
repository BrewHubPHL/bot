import ScrollToTop from "@/components/ScrollToTop";
import SiteNav from "@/components/SiteNav";

export default function SiteLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="bg-gradient-to-br from-[#f8f4f0] via-[#fdfcfb] to-[#e9ded6] text-[var(--hub-espresso)] min-h-screen flex flex-col">
      <ScrollToTop />
      <SiteNav />
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
            <a href="/pos" className="nav-link">Staff</a>
            <a href="/privacy" className="nav-link">Privacy</a>
            <a href="/terms" className="nav-link">Terms</a>
            <a href="/about" className="nav-link">About</a>
            <a href="/careers" className="nav-link">Careers</a>
            <a href="/portal" className="nav-link">Resident Login</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
