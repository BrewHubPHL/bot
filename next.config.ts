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
};

export default nextConfig;
