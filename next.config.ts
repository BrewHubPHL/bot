import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Disable automatic scroll restoration - we handle it manually
  experimental: {
    scrollRestoration: false,
  },
  // Allow .html files to be served from public folder
  async rewrites() {
    return {
      beforeFiles: [
        // Serve legacy HTML pages directly from public
        { source: '/:path*.html', destination: '/:path*.html' },
      ],
      afterFiles: [],
      fallback: [],
    };
  },
  // Security headers — prevent clickjacking, MIME-sniffing, and info leakage
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'Content-Security-Policy', value: "frame-ancestors 'self';" },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        ],
      },
    ];
  },
};

export default nextConfig;
