import type { NextConfig } from "next";

// Multi-zone: iss is mounted at /iss under the shell host.
const devOrigins = (process.env.NEXT_PUBLIC_ALLOWED_DEV_ORIGINS ?? '')
  .split(',').map((s) => s.trim()).filter(Boolean);

const nextConfig: NextConfig = {
  basePath: "/iss",
  assetPrefix: process.env.NEXT_PUBLIC_ISS_ASSET_PREFIX || undefined,
  allowedDevOrigins: devOrigins.length ? devOrigins : undefined,
};

export default nextConfig;
