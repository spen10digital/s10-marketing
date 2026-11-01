import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Hosted on Vercel (ADR 0012). Server code runs on the Node.js runtime so it can use the AWS SDK.
  reactStrictMode: true,
  poweredByHeader: false,
  transpilePackages: ['@s10/core'],
  env: {
    // Vercel sets VERCEL_GIT_COMMIT_SHA during the build; it is not a secret.
    APP_VERSION: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? 'local',
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ];
  },
};

export default nextConfig;
