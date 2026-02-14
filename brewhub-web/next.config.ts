import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      {
        source: '/.netlify/functions/:path*',
        destination: 'http://localhost:9999/.netlify/functions/:path*',
      },
    ];
  },
};

export default nextConfig;
