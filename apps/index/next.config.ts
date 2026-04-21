import type { NextConfig } from "next";

// Multi-zone: index is mounted at /index under the shell host.
const nextConfig: NextConfig = {
  reactStrictMode: false,
  basePath: "/index",
  assetPrefix: process.env.NEXT_PUBLIC_INDEX_ASSET_PREFIX || undefined,
};

export default nextConfig;
