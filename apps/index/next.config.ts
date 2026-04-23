import type { NextConfig } from "next";

// Multi-zone: index is mounted at /index under the shell host.
const devOrigins = (process.env.NEXT_PUBLIC_ALLOWED_DEV_ORIGINS ?? '')
  .split(',').map((s) => s.trim()).filter(Boolean);

const nextConfig: NextConfig = {
  reactStrictMode: false,
  basePath: "/index",
  assetPrefix: process.env.NEXT_PUBLIC_INDEX_ASSET_PREFIX || undefined,
  allowedDevOrigins: devOrigins.length ? devOrigins : undefined,
};

export default nextConfig;
