import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'eshwntsgsputksqamckh.supabase.co',
        port: '',
        pathname: '/storage/v1/object/**',
      },
    ],
  },
  serverExternalPackages: ['@mastra/*'],
  async rewrites() {
    return [
      { source: '/workflows/:id', destination: '/dashboard?workflow=:id' },
      { source: '/executions/:id', destination: '/dashboard?execution=:id' },
    ];
  },
};

export default nextConfig;
