import type { NextConfig } from "next";

// Multi-zone host: rewrite /iss, /index, /drawings (and their _next assets)
// to the respective zone origins. Each zone runs its own Next.js app with
// a matching basePath, so the path stays intact across the rewrite.
//
// Zone origins are configured per-environment:
//   - dev: http://localhost:3001, :3002, :3003
//   - prod: the zone's private Vercel URL (e.g. https://iss-xyz.vercel.app)
const ISS_ZONE = process.env.ISS_ZONE_URL || "http://localhost:3001";
const INDEX_ZONE = process.env.INDEX_ZONE_URL || "http://localhost:3002";
const DRAWINGS_ZONE = process.env.DRAWINGS_ZONE_URL || "http://localhost:3003";

function zoneRewrites(prefix: string, origin: string) {
  return [
    { source: prefix, destination: `${origin}${prefix}` },
    { source: `${prefix}/:path*`, destination: `${origin}${prefix}/:path*` },
  ];
}

const nextConfig: NextConfig = {
  async rewrites() {
    // beforeFiles: zone rewrites must run before Next.js's filesystem
    // routing. Otherwise `/index` is normalized to `/` (Next.js treats
    // `index` as the root page alias) and the rewrite never fires,
    // so shell's homepage answers /index instead of the index zone.
    return {
      beforeFiles: [
        ...zoneRewrites("/iss", ISS_ZONE),
        ...zoneRewrites("/index", INDEX_ZONE),
        ...zoneRewrites("/drawings", DRAWINGS_ZONE),
      ],
      afterFiles: [],
      fallback: [],
    };
  },
};

export default nextConfig;
