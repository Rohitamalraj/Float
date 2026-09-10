/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // @float/* packages ship as TS source (built to dist); transpile them here.
  transpilePackages: [
    '@float/config',
    '@float/core',
    '@float/db',
    '@float/contracts-sdk',
    '@float/ens',
    '@float/wallet',
  ],
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: false },
};

export default nextConfig;
