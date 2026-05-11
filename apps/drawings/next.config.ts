import type { NextConfig } from "next";

// Multi-zone: drawings is mounted at /drawings under the shell host.
const devOrigins = (process.env.NEXT_PUBLIC_ALLOWED_DEV_ORIGINS ?? '')
  .split(',').map((s) => s.trim()).filter(Boolean);

const nextConfig: NextConfig = {
  reactStrictMode: false,
  basePath: "/drawings",
  assetPrefix: process.env.NEXT_PUBLIC_DRAWINGS_ASSET_PREFIX || undefined,
  allowedDevOrigins: devOrigins.length ? devOrigins : undefined,
};

export default nextConfig;
