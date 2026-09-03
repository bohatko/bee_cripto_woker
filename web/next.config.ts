import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  serverExternalPackages: ['ccxt'],
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
