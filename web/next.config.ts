import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  serverExternalPackages: ['ccxt'],
  // Use separate build directories for dev and production to prevent `next build`
  // from wiping out and corrupting active development assets (e.g. CSS layout 404).
  distDir: process.env.NODE_ENV === 'development' ? '.next-dev' : '.next',
  async redirects() {
    return [
      {
        source: '/exchange',
        destination: '/settings/exchange',
        permanent: false,
      },
    ];
  },
};

export default nextConfig;
