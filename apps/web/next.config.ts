import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Skip ESLint during build to avoid ESLint 9 compatibility issues
  // The a.getSource error is a known issue with ESLint 9 + eslint-config-next
  eslint: {
    ignoreDuringBuilds: true,
  },
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
  experimental: {
    serverActions: {
      bodySizeLimit: '100mb',
    },
    optimizePackageImports: [
      'lucide-react',
      '@radix-ui/react-accordion',
      '@radix-ui/react-alert-dialog',
      '@radix-ui/react-avatar',
      '@radix-ui/react-checkbox',
      '@radix-ui/react-collapsible',
      '@radix-ui/react-dialog',
      '@radix-ui/react-dropdown-menu',
      '@radix-ui/react-label',
      '@radix-ui/react-popover',
      '@radix-ui/react-progress',
      '@radix-ui/react-radio-group',
      '@radix-ui/react-scroll-area',
      '@radix-ui/react-select',
      '@radix-ui/react-separator',
      '@radix-ui/react-slider',
      '@radix-ui/react-slot',
      '@radix-ui/react-switch',
      '@radix-ui/react-tabs',
      '@radix-ui/react-toggle',
      '@radix-ui/react-toggle-group',
      '@radix-ui/react-tooltip',
      '@radix-ui/react-visually-hidden',
      'recharts',
      'framer-motion',
      'date-fns',
      '@supabase/supabase-js',
    ],
  },
  async rewrites() {
    return [
      { source: '/workflows/:id', destination: '/dashboard?workflow=:id' },
      { source: '/executions/:id', destination: '/dashboard?execution=:id' },
    ];
  },
};

export default nextConfig;
