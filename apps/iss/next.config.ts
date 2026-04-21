import type { NextConfig } from "next";

// Multi-zone: iss is mounted at /iss under the shell host.
const nextConfig: NextConfig = {
  basePath: "/iss",
  // Assets are fetched from the zone origin via the shell's rewrites.
  assetPrefix: process.env.NEXT_PUBLIC_ISS_ASSET_PREFIX || undefined,
};

export default nextConfig;
