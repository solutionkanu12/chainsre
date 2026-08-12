/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Compile the source-first workspace package instead of expecting a prebuilt dist.
  transpilePackages: ['@chainsre/shared'],
  eslint: {
    // Linting is run centrally from the repo root; skip Next's own pass in build.
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
