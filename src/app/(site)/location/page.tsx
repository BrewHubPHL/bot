"use client";

import Image from "next/image";

export default function LocationPage() {
  return (
    <div className="about-page">
      <div className="about-page-card">
        <Image src="/logo.png" alt="BrewHub PHL" width={80} height={80} className="about-logo" priority />
        <h1 className="about-page-title">Our Location</h1>
        <div className="about-page-content">
          <div style={{ fontSize: '2.5rem', textAlign: 'center', marginBottom: '0.5rem' }}>📍</div>
          <p style={{ textAlign: 'center', fontWeight: 600, fontSize: '1.15rem', color: 'var(--hub-espresso)' }}>
            Point Breeze &bull; Philadelphia, PA 19146
          </p>
          <div style={{
            background: 'var(--hub-espresso)',
            color: '#fff',
            borderRadius: 12,
            padding: '1.5rem',
            margin: '1.5rem 0',
            textAlign: 'center',
          }}>
            <p style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: '0.5rem' }}>
              🚧 Coming Soon
            </p>
            <p style={{ fontSize: '0.95rem', opacity: 0.85, lineHeight: 1.6 }}>
              We&apos;ve secured a property and are currently building out BrewHub&apos;s permanent home.
              Stay tuned for our grand opening!
            </p>
          </div>
          <p style={{ textAlign: 'center', color: 'var(--hub-brown)', lineHeight: 1.7 }}>
            Follow us for construction updates, sneak peeks, and opening day announcements.
          </p>
          <div style={{ display: 'flex', justifyContent: 'center', gap: '1rem', marginTop: '1.25rem' }}>
            <a
              href="https://instagram.com/brewhubphl"
              target="_blank"
              rel="noopener noreferrer"
              className="hero-btn"
              style={{ fontSize: '0.9rem', padding: '0.65rem 1.5rem' }}
            >
              Instagram
            </a>
            <a
              href="https://facebook.com/thebrewhubphl"
              target="_blank"
              rel="noopener noreferrer"
              className="hero-btn"
              style={{ fontSize: '0.9rem', padding: '0.65rem 1.5rem', background: 'var(--hub-brown)' }}
            >
              Facebook
            </a>
          </div>
        </div>
        <a href="/" className="about-back-link">← Back to Home</a>
      </div>
    </div>
  );
}
